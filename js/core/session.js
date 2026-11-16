/** Uwierzytelnianie, sesje, blokady, MFA i zarządzanie kontami. */

import { AppError, AuthError, AuthzError, ValidationError } from './errors.js';
import * as crypto from './crypto.js';
import {
  assertCan, assertOwner, assertRoleChangeAllowed, assertUserRemovalAllowed,
  can, isValidRole
} from './authz.js';
import {
  requireDisplayName, requireOtpCode, requirePassword, requireRecoveryCode, requireUsername
} from './validate.js';
import { uid } from './util.js';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MFA_WRAP_ITERATIONS = 150000;
const TOKEN_AUX_KEY = 'session';
const MAX_FAILURE_ENTRIES = 200;

export class SessionManager {
  constructor({ store, logger = null, now = () => Date.now(), passwordIterations = crypto.PBKDF2_ITERATIONS }) {
    if (!store) throw new AppError('SessionManager wymaga magazynu danych.', 'session_store');
    this.store = store;
    this.logger = logger;
    this.now = now;
    this.passwordIterations = Math.max(
      crypto.PBKDF2_MIN_ITERATIONS,
      Number(passwordIterations) || crypto.PBKDF2_ITERATIONS
    );
    this.userId = null;
    this.tokenHash = null;
    this.issuedAt = null;
    this.lastTouchAt = 0;
    this.lastTouchWrite = 0;
    this.pendingMfa = null;
    this.dummyRecord = null;
  }

  get user() {
    if (!this.userId) return null;
    const found = this.store.state.users.find((entry) => entry.id === this.userId);
    return found || null;
  }

  isAuthenticated() {
    const user = this.user;
    return Boolean(user && !user.disabled);
  }

  publicUser(user = this.user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
      disabled: Boolean(user.disabled),
      mfaEnabled: Boolean(user.mfa?.enabled)
    };
  }

  usersPublic() {
    return this.store.state.users.map((user) => this.publicUser(user));
  }

  _clearIdentity() {
    this.userId = null;
    this.tokenHash = null;
    this.issuedAt = null;
    this.lastTouchAt = 0;
    this.pendingMfa = null;
  }

  async bootstrap() {
    const raw = this.store.readAux(TOKEN_AUX_KEY);
    if (!raw) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.store.removeAux(TOKEN_AUX_KEY);
      if (this.logger) this.logger.warn('Nieczytelny zapis sesji — usunięto.');
      return null;
    }
    if (!parsed?.token || !parsed?.userId) {
      this.store.removeAux(TOKEN_AUX_KEY);
      return null;
    }
    const tokenHash = await crypto.sha256Hex(String(parsed.token));
    const now = this.now();
    const session = this.store.state.sessions.find(
      (entry) => entry.tokenHash === tokenHash && entry.userId === parsed.userId
    );
    const user = this.store.state.users.find((entry) => entry.id === parsed.userId);

    if (!session || !user || user.disabled) {
      this.store.removeAux(TOKEN_AUX_KEY);
      if (session) this._revokeSessionById(session.id);
      return null;
    }
    if (now >= session.expiresAt || now - session.lastSeenAt > SESSION_IDLE_MS) {
      this._revokeSessionById(session.id);
      this.store.removeAux(TOKEN_AUX_KEY);
      if (this.logger) this.logger.info('Sesja wygasła — wymagane ponowne logowanie.');
      return null;
    }

    this.userId = user.id;
    this.tokenHash = tokenHash;
    this.issuedAt = session.issuedAt;
    this.lastTouchAt = session.lastSeenAt;
    return this.publicUser(user);
  }

  /** Sprawdza ważność bieżącej sesji (wygaszenie bezczynności i czas absolutny). */
  checkValidity() {
    if (!this.userId || !this.tokenHash) return false;
    const session = this.store.state.sessions.find((entry) => entry.tokenHash === this.tokenHash);
    if (!session) return false;
    const now = this.now();
    if (now >= session.expiresAt || now - session.lastSeenAt > SESSION_IDLE_MS) {
      this._revokeSessionById(session.id);
      this.store.removeAux(TOKEN_AUX_KEY);
      this._clearIdentity();
      return false;
    }
    return true;
  }

  requireAuth() {
    if (!this.isAuthenticated()) {
      this._clearIdentity();
      this.store.removeAux(TOKEN_AUX_KEY);
      throw new AuthError('Sesja wygasła. Zaloguj się ponownie.', 'session');
    }
    return this.user;
  }

  can(permission) {
    return can(this.user, permission);
  }

  require(permission) {
    const user = this.requireAuth();
    assertCan(user, permission);
    return user;
  }

  touch() {
    if (!this.isAuthenticated() || !this.tokenHash) return;
    const now = this.now();
    if (now - this.lastTouchWrite < 60000) return;
    this.lastTouchWrite = now;
    this.lastTouchAt = now;
    try {
      this.store.commit((state) => {
        const session = state.sessions.find((entry) => entry.tokenHash === this.tokenHash);
        if (session) session.lastSeenAt = now;
      }, { notify: false });
    } catch (err) {
      if (this.logger) this.logger.warn('Nie udało się odświeżyć znacznika sesji.', { error: err });
    }
  }

  async _getDummyRecord() {
    if (!this.dummyRecord) {
      this.dummyRecord = await crypto.hashPassword(`dummy-${crypto.randomHex(8)}`, {
        iterations: this.passwordIterations
      });
    }
    return this.dummyRecord;
  }

  async register({ username, displayName, password, role = 'member', actor = null }) {
    const name = requireUsername(username);
    const display = requireDisplayName(displayName);
    const pwd = requirePassword(password);
    const isFirst = this.store.state.users.length === 0;

    let assignedRole = 'owner';
    if (!isFirst) {
      if (!actor) throw new AuthzError('Nowe konta może zakładać tylko właściciel.');
      assertCan(actor, 'users:manage');
      if (!isValidRole(role)) throw new ValidationError('Nieznana rola użytkownika.');
      if (role === 'owner' && actor.role !== 'owner') {
        throw new AuthzError('Tylko właściciel może nadać rolę właściciela.');
      }
      assignedRole = role;
    }

    if (this.store.state.users.some((entry) => entry.username === name)) {
      throw new ValidationError('Ta nazwa użytkownika jest już zajęta.');
    }

    const hash = await crypto.hashPassword(pwd, { iterations: this.passwordIterations });
    const recoveryCode = crypto.generateRecoveryCode();
    const recoveryHash = await crypto.sha256Hex(crypto.normalizeRecoveryCode(recoveryCode));
    const id = uid('user');
    const createdAt = new Date(this.now()).toISOString();

    this.store.commit((state) => {
      state.users.push({
        id,
        username: name,
        displayName: display,
        role: assignedRole,
        password: hash,
        recovery: { hash: recoveryHash, createdAt },
        mfa: null,
        disabled: false,
        createdAt,
        lastLoginAt: null
      });
    }, { immediate: true });

    if (this.logger) this.logger.info('Utworzono konto.', { username: name, role: assignedRole });
    return {
      user: this.publicUser(this.store.state.users.find((entry) => entry.id === id)),
      recoveryCode,
      isFirst
    };
  }

  lockStatus(username) {
    const entry = this.store.state.security?.failures?.[username];
    if (!entry) return { locked: false, count: 0, until: null };
    const now = this.now();
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return { locked: true, until: entry.lockedUntil, count: entry.count ?? 0 };
    }
    return { locked: false, count: entry.count ?? 0, until: null };
  }

  _registerFailure(username) {
    try {
      this.store.commit((state) => {
        if (!state.security) state.security = { failures: {} };
        if (!state.security.failures) state.security.failures = {};
        const failures = state.security.failures;
        const keys = Object.keys(failures);
        if (!failures[username] && keys.length >= MAX_FAILURE_ENTRIES) {
          for (const key of keys.slice(0, keys.length - MAX_FAILURE_ENTRIES + 1)) delete failures[key];
        }
        const now = this.now();
        const entry = failures[username] || { count: 0, firstAt: now, lockedUntil: 0 };
        if (now - entry.firstAt > ATTEMPT_WINDOW_MS) {
          entry.count = 0;
          entry.firstAt = now;
        }
        entry.count = Number(entry.count || 0) + 1;
        entry.lastAt = now;
        if (entry.count >= MAX_FAILURES) {
          entry.lockedUntil = now + LOCK_MS;
          entry.count = 0;
          entry.firstAt = now;
        }
        failures[username] = entry;
      }, { immediate: true, notify: false });
    } catch (err) {
      if (this.logger) this.logger.warn('Nie udało się zapisać nieudanej próby logowania.', { error: err });
    }
  }

  _clearFailures(username) {
    if (!this.store.state.security?.failures?.[username]) return;
    try {
      this.store.commit((state) => {
        if (state.security?.failures) delete state.security.failures[username];
      }, { notify: false });
    } catch (err) {
      if (this.logger) this.logger.warn('Nie udało się wyczyścić licznika prób.', { error: err });
    }
  }

  async _decryptMfaSecret(user, password) {
    if (!user.mfa?.secret) throw new AuthError('MFA nie jest skonfigurowane.', 'policy');
    try {
      return await crypto.decryptText(user.mfa.secret, password);
    } catch (err) {
      if (this.logger) this.logger.error('Nie udało się odszyfrować sekretu MFA.', { username: user.username });
      throw new AuthError('Nie udało się zweryfikować MFA. Skontaktuj się z właścicielem konta.', 'mfa');
    }
  }

  async login({ username, password, code = '' }) {
    if (this.store.state.users.length === 0) {
      throw new AuthError('Brak kont w aplikacji. Utwórz pierwsze konto właściciela.', 'policy');
    }

    let name;
    try {
      name = requireUsername(username);
    } catch (err) {
      throw new AuthError('Nieprawidłowa nazwa użytkownika lub hasło.', 'credentials');
    }

    const lock = this.lockStatus(name);
    if (lock.locked) {
      const time = new Date(lock.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      throw new AuthError(`Zbyt wiele nieudanych prób. Następna próba możliwa po ${time}.`, 'locked');
    }

    const found = this.store.state.users.find((entry) => entry.username === name);
    const record = found && !found.disabled ? found : null;
    const passwordRecord = record ? record.password : await this._getDummyRecord();
    const passwordOk = await crypto.verifyPassword(String(password ?? ''), passwordRecord);

    if (!record || !passwordOk) {
      this._registerFailure(name);
      if (this.logger) this.logger.warn('Nieudane logowanie.', { username: name });
      throw new AuthError('Nieprawidłowa nazwa użytkownika lub hasło.', 'credentials');
    }

    if (record.mfa?.enabled) {
      if (!code) throw new AuthError('Podaj kod weryfikacyjny z aplikacji MFA.', 'mfa');
      const secret = await this._decryptMfaSecret(record, String(password));
      let codeOk = false;
      try {
        codeOk = await crypto.verifyTotp(secret, code);
      } catch (err) {
        codeOk = false;
      }
      if (!codeOk) {
        this._registerFailure(name);
        throw new AuthError('Nieprawidłowy kod weryfikacyjny.', 'mfa');
      }
    }

    this._clearFailures(name);

    const token = crypto.randomHex(32);
    const tokenHash = await crypto.sha256Hex(token);
    const issuedAt = this.now();

    this.store.commit((state) => {
      state.sessions = state.sessions.filter((session) => session.expiresAt > issuedAt);
      const userSessions = state.sessions.filter((session) => session.userId === record.id);
      if (userSessions.length >= 5) {
        const oldest = userSessions.sort((a, b) => a.issuedAt - b.issuedAt)[0];
        state.sessions = state.sessions.filter((session) => session.id !== oldest.id);
      }
      state.sessions.push({
        id: uid('sess'),
        userId: record.id,
        tokenHash,
        issuedAt,
        lastSeenAt: issuedAt,
        expiresAt: issuedAt + SESSION_MAX_MS,
        createdAt: new Date(issuedAt).toISOString()
      });
      const user = state.users.find((entry) => entry.id === record.id);
      if (user) user.lastLoginAt = new Date(issuedAt).toISOString();
    }, { immediate: true });

    const stored = this.store.writeAux(TOKEN_AUX_KEY, JSON.stringify({ token, userId: record.id }));
    if (!stored) {
      this._revokeTokenHash(tokenHash);
      throw new AuthError('Nie można zapisać sesji — brak miejsca w pamięci przeglądarki.', 'policy');
    }

    this.userId = record.id;
    this.tokenHash = tokenHash;
    this.issuedAt = issuedAt;
    this.lastTouchAt = issuedAt;
    this.lastTouchWrite = issuedAt;

    if (this.logger) this.logger.info('Zalogowano użytkownika.', { username: record.username, role: record.role });
    return this.publicUser(this.user);
  }

  _revokeSessionById(id) {
    try {
      this.store.commit((state) => {
        state.sessions = state.sessions.filter((session) => session.id !== id);
      }, { notify: false });
    } catch (err) {
      if (this.logger) this.logger.warn('Nie udało się unieważnić sesji.', { error: err });
    }
  }

  _revokeTokenHash(tokenHash) {
    try {
      this.store.commit((state) => {
        state.sessions = state.sessions.filter((session) => session.tokenHash !== tokenHash);
      }, { notify: false });
    } catch (err) {
      if (this.logger) this.logger.warn('Nie udało się unieważnić sesji.', { error: err });
    }
  }

  logout() {
    const name = this.user?.username ?? null;
    if (this.tokenHash) this._revokeTokenHash(this.tokenHash);
    this.store.removeAux(TOKEN_AUX_KEY);
    this._clearIdentity();
    if (this.logger) this.logger.info('Wylogowano.', { username: name });
  }

  logoutAll() {
    const user = this.requireAuth();
    try {
      this.store.commit((state) => {
        state.sessions = state.sessions.filter((session) => session.userId !== user.id);
      }, { immediate: true });
      this.store.removeAux(TOKEN_AUX_KEY);
      this._clearIdentity();
      if (this.logger) this.logger.warn('Unieważniono wszystkie sesje użytkownika.', { username: user.username });
    } catch (err) {
      if (this.logger) this.logger.error('Nie udało się unieważnić sesji.', { error: err });
      throw err;
    }
  }

  sessionsList() {
    const user = this.requireAuth();
    return this.store.state.sessions
      .filter((session) => session.userId === user.id)
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        issuedAt: session.issuedAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        current: session.tokenHash === this.tokenHash
      }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  revokeOtherSessions() {
    const user = this.requireAuth();
    const keep = this.tokenHash;
    const removed = this.store.state.sessions.filter(
      (session) => session.userId === user.id && session.tokenHash !== keep
    ).length;
    this.store.commit((state) => {
      state.sessions = state.sessions.filter(
        (session) => session.userId !== user.id || session.tokenHash === keep
      );
    }, { immediate: true });
    if (this.logger) this.logger.info('Unieważniono pozostałe sesje.', { count: removed });
    return removed;
  }

  /** Weryfikacja hasła przed operacją krytyczną (np. usunięciem danych). */
  async verifyPassword(password) {
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    return true;
  }

  async changePassword(currentPassword, newPassword) {
    const user = this.requireAuth();
    const currentOk = await crypto.verifyPassword(String(currentPassword ?? ''), user.password);
    if (!currentOk) throw new AuthError('Obecne hasło jest nieprawidłowe.', 'credentials');

    const nextPassword = requirePassword(newPassword);
    const same = await crypto.verifyPassword(nextPassword, user.password);
    if (same) throw new ValidationError('Nowe hasło musi różnić się od obecnego.');

    let mfaSecret = null;
    if (user.mfa?.enabled) {
      mfaSecret = await this._decryptMfaSecret(user, String(currentPassword));
    }

    const hash = await crypto.hashPassword(nextPassword, { iterations: this.passwordIterations });
    const newMfa = mfaSecret
      ? await crypto.encryptText(mfaSecret, nextPassword, { iterations: MFA_WRAP_ITERATIONS })
      : null;
    const keepHash = this.tokenHash;

    this.store.commit((state) => {
      const target = state.users.find((entry) => entry.id === user.id);
      if (!target) throw new AppError('Konto nie istnieje.', 'session_user');
      target.password = hash;
      if (newMfa) target.mfa = { ...(target.mfa || {}), enabled: true, secret: newMfa };
      state.sessions = state.sessions.filter(
        (session) => session.userId !== user.id || session.tokenHash === keepHash
      );
    }, { immediate: true });

    if (this.logger) this.logger.info('Zmieniono hasło; inne sesje unieważnione.', { username: user.username });
    return true;
  }

  async startMfaSetup(password) {
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    if (user.mfa?.enabled) throw new ValidationError('MFA jest już włączone. Najpierw je wyłącz.');
    const secret = crypto.generateTotpSecret();
    this.pendingMfa = { userId: user.id, secret, createdAt: this.now() };
    return {
      secret,
      otpauth: crypto.otpauthUrl({ secret, label: user.username, issuer: 'BSXS Manager' })
    };
  }

  async confirmMfa({ password, code }) {
    const pending = this.pendingMfa;
    if (!pending || pending.userId !== this.userId) {
      throw new AppError('Brak rozpoczętej konfiguracji MFA.', 'mfa_setup');
    }
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    const otp = requireOtpCode(code);
    let valid = false;
    try {
      valid = await crypto.verifyTotp(pending.secret, otp);
    } catch (err) {
      valid = false;
    }
    if (!valid) throw new ValidationError('Kod nieprawidłowy lub wygasł. Sprawdź zegar urządzenia.');

    const wrapped = await crypto.encryptText(pending.secret, String(password), {
      iterations: MFA_WRAP_ITERATIONS
    });
    this.store.commit((state) => {
      const target = state.users.find((entry) => entry.id === user.id);
      if (!target) throw new AppError('Konto nie istnieje.', 'session_user');
      target.mfa = {
        enabled: true,
        secret: wrapped,
        enabledAt: new Date(this.now()).toISOString()
      };
    }, { immediate: true });
    this.pendingMfa = null;
    if (this.logger) this.logger.info('Włączono MFA (TOTP).', { username: user.username });
    return true;
  }

  async disableMfa({ password, code }) {
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    if (!user.mfa?.enabled) throw new ValidationError('MFA nie jest włączone.');
    const secret = await this._decryptMfaSecret(user, String(password));
    const otp = requireOtpCode(code);
    let valid = false;
    try {
      valid = await crypto.verifyTotp(secret, otp);
    } catch (err) {
      valid = false;
    }
    if (!valid) throw new ValidationError('Kod weryfikacyjny jest nieprawidłowy.');

    this.store.commit((state) => {
      const target = state.users.find((entry) => entry.id === user.id);
      if (target) target.mfa = null;
    }, { immediate: true });
    if (this.logger) this.logger.warn('Wyłączono MFA.', { username: user.username });
    return true;
  }

  async regenerateRecoveryCode(password) {
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    const code = crypto.generateRecoveryCode();
    const hash = await crypto.sha256Hex(crypto.normalizeRecoveryCode(code));
    this.store.commit((state) => {
      const target = state.users.find((entry) => entry.id === user.id);
      if (target) {
        target.recovery = { hash, createdAt: new Date(this.now()).toISOString() };
      }
    }, { immediate: true });
    if (this.logger) this.logger.info('Wygenerowano nowy kod odzyskiwania.', { username: user.username });
    return code;
  }

  async resetWithRecoveryCode({ username, recoveryCode, newPassword }) {
    const name = requireUsername(username);
    const code = requireRecoveryCode(recoveryCode);
    const nextPassword = requirePassword(newPassword);

    const lock = this.lockStatus(name);
    if (lock.locked) {
      const time = new Date(lock.until).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      throw new AuthError(`Zbyt wiele prób. Spróbuj ponownie po ${time}.`, 'locked');
    }

    const user = this.store.state.users.find((entry) => entry.username === name && !entry.disabled);
    const codeHash = await crypto.sha256Hex(crypto.normalizeRecoveryCode(code));
    const storedHash = user?.recovery?.hash ?? '';
    const matches = Boolean(storedHash) && crypto.timingSafeEqualString(codeHash, storedHash);

    if (!user || !matches) {
      this._registerFailure(name);
      if (this.logger) this.logger.warn('Nieudana próba resetu hasła.', { username: name });
      throw new AuthError('Nieprawidłowa nazwa użytkownika lub kod odzyskiwania.', 'credentials');
    }

    const passwordHash = await crypto.hashPassword(nextPassword, { iterations: this.passwordIterations });
    const newRecovery = crypto.generateRecoveryCode();
    const newRecoveryHash = await crypto.sha256Hex(crypto.normalizeRecoveryCode(newRecovery));

    this.store.commit((state) => {
      const target = state.users.find((entry) => entry.id === user.id);
      if (!target) throw new AppError('Konto nie istnieje.', 'session_user');
      target.password = passwordHash;
      target.recovery = { hash: newRecoveryHash, createdAt: new Date(this.now()).toISOString() };
      target.mfa = null;
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    }, { immediate: true });

    this._clearFailures(name);
    if (this.logger) this.logger.warn('Hasło zresetowane kodem odzyskiwania; MFA wymaga ponownej konfiguracji.', {
      username: name
    });
    return { recoveryCode: newRecovery };
  }

  setUserRole(userId, nextRole) {
    const actor = this.requireAuth();
    const users = this.store.state.users;
    const target = users.find((entry) => entry.id === userId);
    assertRoleChangeAllowed(actor, target, nextRole, users);
    this.store.commit((state) => {
      const entry = state.users.find((user) => user.id === userId);
      if (entry) entry.role = nextRole;
      // Zmiana roli unieważnia sesje zmienionego użytkownika.
      state.sessions = state.sessions.filter((session) => session.userId !== userId);
    }, { immediate: true });
    if (this.logger) this.logger.warn('Zmieniono rolę użytkownika.', {
      target: target.username, role: nextRole, by: actor.username
    });
    return true;
  }

  setUserDisabled(userId, disabled) {
    const actor = this.requireAuth();
    assertOwner(actor);
    if (actor.id === userId) throw new AuthzError('Nie możesz wyłączyć własnego konta.');
    const target = this.store.state.users.find((entry) => entry.id === userId);
    if (!target) throw new AuthzError('Nie znaleziono użytkownika.');
    this.store.commit((state) => {
      const entry = state.users.find((user) => user.id === userId);
      if (entry) entry.disabled = Boolean(disabled);
      if (disabled) state.sessions = state.sessions.filter((session) => session.userId !== userId);
    }, { immediate: true });
    if (this.logger) this.logger.warn(disabled ? 'Wyłączono konto.' : 'Włączono konto.', {
      target: target.username, by: actor.username
    });
    return true;
  }

  removeUser(userId) {
    const actor = this.requireAuth();
    const users = this.store.state.users;
    const target = users.find((entry) => entry.id === userId);
    assertUserRemovalAllowed(actor, target, users);
    this.store.commit((state) => {
      state.users = state.users.filter((user) => user.id !== userId);
      state.sessions = state.sessions.filter((session) => session.userId !== userId);
    }, { immediate: true });
    if (this.logger) this.logger.warn('Usunięto konto użytkownika.', { target: target.username, by: actor.username });
    return true;
  }

  async deleteOwnAccount(password) {
    const user = this.requireAuth();
    const ok = await crypto.verifyPassword(String(password ?? ''), user.password);
    if (!ok) throw new AuthError('Nieprawidłowe hasło.', 'credentials');
    if (user.role === 'owner' && this.store.state.users.filter((entry) => entry.role === 'owner').length <= 1) {
      throw new AuthzError('Nie można usunąć ostatniego konta właściciela. Najpierw utwórz inne konto właściciela.');
    }
    this.store.commit((state) => {
      state.users = state.users.filter((entry) => entry.id !== user.id);
      state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    }, { immediate: true });
    this.store.removeAux(TOKEN_AUX_KEY);
    this._clearIdentity();
    if (this.logger) this.logger.warn('Użytkownik usunął własne konto.', { username: user.username });
    return true;
  }

  securityPolicy() {
    return {
      hashing: 'PBKDF2-HMAC-SHA256',
      iterations: crypto.PBKDF2_ITERATIONS,
      saltBits: 128,
      idleTimeoutMs: SESSION_IDLE_MS,
      absoluteTimeoutMs: SESSION_MAX_MS,
      maxFailures: MAX_FAILURES,
      lockMs: LOCK_MS,
      mfa: 'TOTP (RFC 6238), opcjonalne',
      cipher: 'AES-GCM 256',
      transmission: location.protocol === 'https:'
        ? 'HTTPS (TLS)'
        : `Niezabezpieczony kanał (${location.protocol}) — otwórz aplikację przez HTTPS`,
      cryptoAvailable: crypto.hasSubtle(),
      storage: this.store.driver.kind
    };
  }
}
