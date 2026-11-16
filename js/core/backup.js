/** Kopie zapasowe: migawki lokalne, eksport zaszyfrowany i import z walidacją. */

import { AppError, StorageError } from './errors.js';
import { decryptText, encryptText } from './crypto.js';
import { migrateState, validateStateObject } from './store.js';

export const BACKUP_FORMAT = 'bsxs.manager.backup';
export const BACKUP_VERSION = 1;

export class BackupService {
  constructor({ store, logger = null }) {
    this.store = store;
    this.logger = logger;
  }

  listSnapshots() {
    return this.store.listSnapshots();
  }

  createSnapshot(reason = 'ręczna') {
    const result = this.store.createSnapshot(reason);
    if (result && this.logger) this.logger.info(`Utworzono migawkę: ${reason}.`);
    return result;
  }

  restoreSnapshot(index) {
    const result = this.store.restoreSnapshot(index);
    if (this.logger) this.logger.warn('Przywrócono dane z migawki.', { snapshot: index });
    return result;
  }

  /** Eksport bez haseł i tokenów — do szybkiego przejrzenia lub przeniesienia treści. */
  exportPlain() {
    const state = this.store.snapshotState();
    const sanitized = {
      ...state,
      users: state.users.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        disabled: Boolean(user.disabled),
        password: null,
        mfa: null,
        recovery: null
      })),
      sessions: []
    };
    sanitized.security = { failures: {} };
    return JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      encrypted: false,
      createdAt: new Date().toISOString(),
      note: 'Eksport bez danych uwierzytelniania — nie pozwala zalogować się na inne konto.',
      state: sanitized
    }, null, 2);
  }

  async exportEncrypted(passphrase) {
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      encrypted: false,
      createdAt: new Date().toISOString(),
      state: this.store.snapshotState()
    };
    const encrypted = await encryptText(JSON.stringify(payload), passphrase);
    if (this.logger) this.logger.info('Wyeksportowano zaszyfrowaną kopię zapasową.');
    return JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      encrypted: true,
      createdAt: payload.createdAt,
      cipher: encrypted.cipher,
      kdf: encrypted.kdf,
      iv: encrypted.iv,
      data: encrypted.data
    }, null, 2);
  }

  _parseEnvelope(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new AppError('Plik nie jest prawidłowym JSON-em.', 'backup_parse');
    }
    if (!parsed || parsed.format !== BACKUP_FORMAT) {
      throw new AppError('To nie jest kopia zapasowa BSXS Manager.', 'backup_format');
    }
    if (Number(parsed.version) > BACKUP_VERSION) {
      throw new AppError('Kopia pochodzi z nowszej wersji aplikacji.', 'backup_version');
    }
    return parsed;
  }

  _validateState(candidate) {
    const issues = validateStateObject(candidate);
    if (issues.length) {
      throw new StorageError(`Kopia zawiera niespójne dane: ${issues.slice(0, 3).join(' ')}`);
    }
    return migrateState(candidate);
  }

  async importEncrypted(text, passphrase) {
    const envelope = this._parseEnvelope(text);
    if (!envelope.encrypted) {
      throw new AppError('Ten plik nie jest zaszyfrowany — użyj importu zwykłego.', 'backup_not_encrypted');
    }
    const plaintext = await decryptText({
      cipher: envelope.cipher || 'AES-GCM-256',
      kdf: envelope.kdf,
      iv: envelope.iv,
      data: envelope.data
    }, passphrase);
    let payload;
    try {
      payload = JSON.parse(plaintext);
    } catch (err) {
      throw new AppError('Odszyfrowana kopia ma nieprawidłową strukturę.', 'backup_parse');
    }
    if (!payload?.state) throw new AppError('Kopia nie zawiera danych aplikacji.', 'backup_format');
    const state = this._validateState(payload.state);
    this.store.importState(state);
    if (this.logger) this.logger.warn('Zaimportowano zaszyfrowaną kopię zapasową.');
    return { users: state.users.length, createdAt: payload.createdAt ?? null };
  }

  importPlain(text) {
    const envelope = this._parseEnvelope(text);
    if (envelope.encrypted) {
      throw new AppError('Ten plik jest zaszyfrowany — podaj hasło w imporcie zaszyfrowanym.', 'backup_encrypted');
    }
    if (!envelope.state) throw new AppError('Kopia nie zawiera danych aplikacji.', 'backup_format');
    const withoutCredentials = (Array.isArray(envelope.state.users) ? envelope.state.users : [])
      .filter((user) => !user || !user.password || !user.password.hash);
    if (withoutCredentials.length) {
      throw new AppError(
        'Ta kopia nie zawiera danych logowania, więc nie można jej użyć do przywrócenia kont. Wybierz kopię szyfrowaną.',
        'backup_no_credentials'
      );
    }
    const state = this._validateState(envelope.state);
    this.store.importState(state);
    if (this.logger) this.logger.warn('Zaimportowano jawną kopię zapasową.');
    return { users: state.users.length, createdAt: envelope.createdAt ?? null };
  }
}
