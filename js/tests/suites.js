/** Zestawy testów: jednostkowe, integracyjne, bezpieczeństwa i regresyjne. */

import { TestRunner, assert, assertEquals, assertIncludes, assertRejects, assertThrows, skip } from './runner.js';
import {
  base32Decode, base32Encode, encryptText, decryptText, hashPassword, verifyPassword,
  hotp, totp, verifyTotp, generateRecoveryCode, normalizeRecoveryCode,
  timingSafeEqualString, PBKDF2_MIN_ITERATIONS
} from '../core/crypto.js';
import * as validate from '../core/validate.js';
import {
  Store, createMemoryDriver, emptyState, normalizeState, migrateState, validateStateObject, SETTING_DEFAULTS
} from '../core/store.js';
import { Diagnostics } from '../core/diagnostics.js';
import { can, assertCan, assertRoleChangeAllowed, permissionLabel } from '../core/authz.js';
import { SessionManager, SESSION_IDLE_MS, MAX_FAILURES, LOCK_MS } from '../core/session.js';
import { BackupService } from '../core/backup.js';
import { matchesSearch, normalizeSearch, paginate, sortBy, sum } from '../core/util.js';
import { SCHEMA_VERSION } from '../core/version.js';
import { createZip, crc32 } from '../core/zip.js';
import songsModule from '../modules/songs.js';
import dashboardModule from '../modules/dashboard.js';
import { parseManifest, folderAllows } from '../modules/reaper.js';
import mixingModule from '../modules/mixing.js';
import { CHAIN_DEFINITIONS, CHAIN_VARIANTS, PLUGIN_CATALOG, PLUGIN_PACKS,
  buildPlan, bundleFileName, bundleFiles, catalogMarkdown, chainFiles, chainFileName,
  chainPack, packFileName, pluginUid, recipeMarkdown, rfxChainText, slugify, validateCatalog
} from '../core/mix-engine.js';
import * as engineApi from '../core/mix-engine.js';
import { MODULE_REGISTRY } from '../modules/registry.js';

const PASSWORD = 'bardzoTajne123';
const TEST_ITERATIONS = PBKDF2_MIN_ITERATIONS;
const TOTP_SECRET_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function makeStore(prefix = 'test') {
  const driver = createMemoryDriver();
  const store = new Store({ driver, prefix });
  store.init();
  return { store, driver };
}

function makeSession() {
  const { store, driver } = makeStore();
  const clock = { value: 1700000000000 };
  const session = new SessionManager({
    store,
    logger: null,
    now: () => clock.value,
    passwordIterations: TEST_ITERATIONS
  });
  return { store, driver, clock, session };
}

async function registerOwner(session, username = 'xaro', password = PASSWORD) {
  return session.register({ username, displayName: 'XARO', password });
}

/** Znajduje nagłówek końca katalogu centralnego w archiwum ZIP. */
function findEocd(bytes) {
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b
      && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      return index;
    }
  }
  return -1;
}

export async function runAllTests({ logger = null, ctx = null } = {}) {
  const runner = new TestRunner({ timeoutMs: 30000 });

  runner.suite('Kryptografia', () => {
    runner.test('PBKDF2: hash i weryfikacja hasła', async () => {
      const record = await hashPassword(PASSWORD, { iterations: TEST_ITERATIONS });
      assertEquals(record.algo, 'PBKDF2-SHA256');
      assert(record.salt.length > 0 && record.hash.length > 0, 'Brak soli lub hasha');
      assertEquals(await verifyPassword(PASSWORD, record), true);
      assertEquals(await verifyPassword(`${PASSWORD}x`, record), false);
    });

    runner.test('PBKDF2: odrzuca zbyt małą liczbę iteracji', async () => {
      await assertRejects(() => hashPassword(PASSWORD, { iterations: 10 }), 'iteracji');
    });

    runner.test('AES-GCM: szyfrowanie i odszyfrowanie', async () => {
      const pkg = await encryptText('tajna notatka', 'hasloKopii123', { iterations: 1000 });
      assertEquals(pkg.cipher, 'AES-GCM-256');
      assertEquals(await decryptText(pkg, 'hasloKopii123'), 'tajna notatka');
    });

    runner.test('AES-GCM: błędne hasło nie odszyfrowuje', async () => {
      const pkg = await encryptText('tajna notatka', 'hasloKopii123', { iterations: 1000 });
      await assertRejects(() => decryptText(pkg, 'inneHaslo123'), 'odszyfrować');
    });

    runner.test('TOTP: wektor RFC 6238 (SHA-1, T=59)', async () => {
      assertEquals(await totp(TOTP_SECRET_RFC, { timeMs: 59000, digits: 8 }), '94287082');
    });

    runner.test('TOTP: wektor RFC 6238 (SHA-1, T=1111111109)', async () => {
      assertEquals(await totp(TOTP_SECRET_RFC, { timeMs: 1111111109 * 1000, digits: 8 }), '07081804');
    });

    runner.test('TOTP: weryfikacja z oknem czasowym', async () => {
      const code = await totp(TOTP_SECRET_RFC, { timeMs: 59000 });
      assertEquals(await verifyTotp(TOTP_SECRET_RFC, code, { timeMs: 60000 }), true);
      assertEquals(await verifyTotp(TOTP_SECRET_RFC, '000000', { timeMs: 60000 }), false);
    });

    runner.test('HOTP: licznik 0 dla klucza testowego', async () => {
      const secret = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      assertEquals(await hotp(secret, 0, { digits: 6 }), '755224');
    });

    runner.test('Base32: kodowanie i dekodowanie', () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      assertEquals(base32Encode(bytes), base32Encode(bytes).toUpperCase());
      assertEquals(Array.from(base32Decode(base32Encode(bytes))).join(','), Array.from(bytes).join(','));
    });

    runner.test('Kod odzyskiwania: format i normalizacja', () => {
      const code = generateRecoveryCode();
      assertEquals(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(code), true);
      assertEquals(normalizeRecoveryCode(code.toLowerCase()).length, 20);
    });

    runner.test('Porównanie w stałym czasie', () => {
      assertEquals(timingSafeEqualString('abc', 'abc'), true);
      assertEquals(timingSafeEqualString('abc', 'abd'), false);
      assertEquals(timingSafeEqualString('abc', 'ab'), false);
    });
  });

  runner.suite('Walidacja danych', () => {
    runner.test('requireText: przycina i wymaga treści', () => {
      assertEquals(validate.requireText('  XARO  ', 'Tytuł'), 'XARO');
      assertThrows(() => validate.requireText('   ', 'Tytuł'), 'wymagane');
    });

    runner.test('requireText: limit długości', () => {
      assertThrows(() => validate.requireText('a'.repeat(201), 'Tytuł', { max: 200 }), 'maksymalnie');
    });

    runner.test('requireUsername: normalizuje i odrzuca niepoprawne', () => {
      assertEquals(validate.requireUsername('  XARO.01 '), 'xaro.01');
      assertThrows(() => validate.requireUsername('X'), '3–32');
      assertThrows(() => validate.requireUsername('zły login!'), '3–32');
    });

    runner.test('requirePassword: polityka siły hasła', () => {
      assertEquals(validate.requirePassword('dlugieHaslo1'), 'dlugieHaslo1');
      assertThrows(() => validate.requirePassword('qwerty123'), '10 znaków');
      assertThrows(() => validate.requirePassword('tylkoliterki'), 'cyfrę');
      assertThrows(() => validate.requirePassword('1234567890123'), 'literę');
      assertThrows(() => validate.requirePassword('password123'), 'popularne');
    });

    runner.test('requireDate: odrzuca nieistniejące daty', () => {
      assertEquals(validate.requireDate('2024-02-29', 'Data'), '2024-02-29');
      assertThrows(() => validate.requireDate('2023-02-30', 'Data'), 'nieistniejącą');
      assertThrows(() => validate.requireDate('30-02-2024', 'Data'), 'rrrr-mm-dd');
    });

    runner.test('requireMoney: zakres kwoty', () => {
      assertEquals(validate.requireMoney('1200,50'), 1200.5);
      assertThrows(() => validate.requireMoney('-1'), 'mniejsze');
      assertThrows(() => validate.requireMoney('abc'), 'liczbą');
    });

    runner.test('requireEnum: tylko dozwolone wartości', () => {
      assertEquals(validate.requireEnum('single', ['single', 'EP'], 'Typ'), 'single');
      assertThrows(() => validate.requireEnum('vinyl', ['single', 'EP'], 'Typ'), 'nieprawidłową');
    });

    runner.test('safeRelativePath: blokuje path traversal i ścieżki absolutne', () => {
      assertEquals(validate.safeRelativePath('XARO/2025/Noc.rpp'), 'XARO/2025/Noc.rpp');
      assertEquals(validate.safeRelativePath('XARO\\2025\\Noc.rpp'), 'XARO/2025/Noc.rpp');
      assertThrows(() => validate.safeRelativePath('../etc/passwd'), 'niedozwolony');
      assertThrows(() => validate.safeRelativePath('/tmp/x.rpp'), 'względną');
      assertThrows(() => validate.safeRelativePath('C:/x.rpp'), 'względną');
      assertThrows(() => validate.safeRelativePath('~/x.rpp'), 'domowego');
      assertThrows(() => validate.safeRelativePath('XARO/\u0000zły'), 'sterujące');
    });

    runner.test('sanitizeFilename: usuwa znaki niebezpieczne dla systemu plików', () => {
      assertEquals(validate.sanitizeFilename('a/b\\c:d?.RfxChain'), 'a-b-c-d-.RfxChain');
      assertEquals(validate.sanitizeFilename('   '), 'plik');
    });
  });

  runner.suite('Magazyn danych', () => {
    runner.test('Nowy magazyn tworzy poprawny, spójny stan', () => {
      const { store } = makeStore();
      assertEquals(store.state.schema, SCHEMA_VERSION);
      assertEquals(validateStateObject(store.state).length, 0);
      assertEquals(store.state.data.settings.pageSize, SETTING_DEFAULTS.pageSize);
      assertEquals(store.state.loadReport.source, 'fresh');
    });

    runner.test('commit zwiększa rewizję i zapisuje stan', () => {
      const { store, driver } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'A' }); }, { immediate: true });
      assertEquals(store.state.data.meta.revision, 1);
      assertIncludes(driver.getItem('test.state'), 's1');
    });

    runner.test('Nieudana walidacja nie psuje danych (mutacja na kopii roboczej)', () => {
      const { store } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'A' }); }, { immediate: true });
      assertThrows(() => store.commit((state) => {
        state.users.push({ id: 'x' });
      }, { immediate: true }), 'niespójne');
      assertEquals(store.state.data.songs.length, 1);
      assertEquals(store.state.users.length, 0);
    });

    runner.test('Odzyskiwanie z kopii safety po uszkodzeniu stanu głównego', () => {
      const { store, driver } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'Bezpieczny' }); }, { immediate: true });
      store.createSnapshot('ręczna');
      driver.setItem('test.state', '{ to nie jest JSON');

      const restored = new Store({ driver, prefix: 'test' });
      const report = restored.init();
      assertEquals(report.recovered, true);
      assertEquals(restored.state.data.songs.length, 1);
      assertEquals(restored.state.data.songs[0].id, 's1');
      assertEquals(restored.state.data.songs[0].title, 'Bezpieczny');
    });

    runner.test('Uszkodzone dane są zachowywane do wglądu, nie nadpisywane', () => {
      const { store, driver } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'A' }); }, { immediate: true });
      driver.setItem('test.state', '{ uszkodzony');
      const restored = new Store({ driver, prefix: 'test' });
      restored.init();
      const corruptKeys = driver.keys().filter((key) => key.startsWith('test.corrupt.'));
      assertEquals(corruptKeys.length, 1);
      assertEquals(driver.getItem(corruptKeys[0]), '{ uszkodzony');
    });

    runner.test('Migawki rotują i przywracają dane (regresja)', () => {
      const { store } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'A' }); }, { immediate: true });
      store.createSnapshot('A');
      store.commit((state) => { state.data.songs.push({ id: 's2', title: 'B' }); }, { immediate: true });
      store.createSnapshot('B');
      store.commit((state) => { state.data.songs = []; }, { immediate: true });
      store.restoreSnapshot(1);
      assertEquals(store.state.data.songs.length, 1);
      assertEquals(store.state.data.songs[0].id, 's1');
    });

    runner.test('normalizeState uzupełnia brakujące pola', () => {
      const state = normalizeState({ data: { songs: 'złe' } });
      assertEquals(Array.isArray(state.data.songs), true);
      assertEquals(state.data.settings.animations, SETTING_DEFAULTS.animations);
      assertEquals(state.users.length, 0);
    });

    runner.test('Start nie tworzy migawki synchronicznie — robi to konserwacja w tle', () => {
      const { store } = makeStore();
      assertEquals(store.listSnapshots().length, 0);
      assertEquals(store.maintenancePending, true);
      const savedAt = store.runMaintenance();
      assertEquals(typeof savedAt, 'string');
      assertEquals(store.listSnapshots().length, 1);
      assertEquals(store.maintenancePending, false);
      assertEquals(store.runMaintenance(), null);
    });

    runner.test('migrateState odrzuca dane z nowszego schematu', () => {
      const state = emptyState();
      state.schema = SCHEMA_VERSION + 1;
      assertThrows(() => migrateState(state), 'nowszej wersji');
    });
  });

  runner.suite('Autoryzacja', () => {
    runner.test('Macierz uprawnień: role mają właściwy zakres', () => {
      assertEquals(can({ role: 'viewer' }, 'songs:read'), true);
      assertEquals(can({ role: 'viewer' }, 'songs:write'), false);
      assertEquals(can({ role: 'member' }, 'tasks:write'), true);
      assertEquals(can({ role: 'member' }, 'finances:read'), false);
      assertEquals(can({ role: 'admin' }, 'users:manage'), false);
      assertEquals(can({ role: 'owner' }, 'users:manage'), true);
      assertEquals(can({ role: 'nieznana' }, 'songs:read'), false);
    });

    runner.test('assertCan zwraca czytelny komunikat po polsku', () => {
      const error = assertThrows(() => assertCan({ role: 'viewer' }, 'finances:write'));
      assertIncludes(error.message, 'Brak uprawnień');
      assertEquals(permissionLabel('finances:write'), 'edycja finansów');
    });

    runner.test('Nie można zmienić własnej roli', () => {
      const actor = { id: 'u1', role: 'owner' };
      assertThrows(() => assertRoleChangeAllowed(actor, { id: 'u1', role: 'owner' }, 'admin', [actor]), 'własnej roli');
    });

    runner.test('Nie można odebrać roli ostatniemu właścicielowi', () => {
      const actor = { id: 'u1', role: 'owner' };
      const target = { id: 'u2', role: 'owner' };
      assertThrows(() => assertRoleChangeAllowed(actor, target, 'member', [target]), 'co najmniej jeden właściciel');
    });

    runner.test('Zmianę ról może wykonywać wyłącznie właściciel', () => {
      const actor = { id: 'u1', role: 'admin' };
      const target = { id: 'u2', role: 'member' };
      assertThrows(() => assertRoleChangeAllowed(actor, target, 'owner', [actor, target]), 'wyłącznie dla właściciela');
    });
  });

  runner.suite('Sesje i logowanie', () => {
    runner.test('Polityka bezpieczeństwa ma spójne progi', () => {
      assertEquals(SESSION_IDLE_MS, 30 * 60 * 1000);
      assertEquals(MAX_FAILURES, 5);
      assertEquals(LOCK_MS, 15 * 60 * 1000);
    });

    runner.test('Rejestracja pierwszego konta daje rolę właściciela i kod odzyskiwania', async () => {
      const { session } = makeSession();
      const result = await registerOwner(session);
      assertEquals(result.user.role, 'owner');
      assertEquals(result.isFirst, true);
      assertEquals(/^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/.test(result.recoveryCode), true);
    });

    runner.test('Drugie konto wymaga zalogowanego właściciela', async () => {
      const { session } = makeSession();
      await registerOwner(session);
      await assertRejects(() => session.register({
        username: 'czlonek', displayName: 'Członek', password: PASSWORD
      }), 'właściciel');
    });

    runner.test('Logowanie tworzy sesję z hashem tokenu, bez jawnego tokenu', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      const user = await session.login({ username: 'xaro', password: PASSWORD });
      assertEquals(user.role, 'owner');
      assertEquals(session.isAuthenticated(), true);
      assertEquals(store.state.sessions.length, 1);
      assertEquals(store.state.sessions[0].tokenHash.length, 64);
      assertEquals(JSON.stringify(store.state.sessions).includes('"token"'), false);
    });

    runner.test('Pięć nieudanych prób blokuje konto na 15 minut', async () => {
      const { clock, session } = makeSession();
      await registerOwner(session);
      for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
        await assertRejects(
          () => session.login({ username: 'xaro', password: 'zleHaslo123' }),
          'Nieprawidłowa nazwa użytkownika lub hasło'
        );
      }
      assertEquals(session.lockStatus('xaro').locked, true);
      await assertRejects(() => session.login({ username: 'xaro', password: PASSWORD }), 'Zbyt wiele');
      clock.value += LOCK_MS;
      assertEquals(session.lockStatus('xaro').locked, false);
      const user = await session.login({ username: 'xaro', password: PASSWORD });
      assertEquals(user.username, 'xaro');
    });

    runner.test('Wylogowanie unieważnia sesję i token klienta', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      session.logout();
      assertEquals(store.state.sessions.length, 0);
      assertEquals(await session.bootstrap(), null);
    });

    runner.test('Zmiana hasła unieważnia inne sesje i stare hasło przestaje działać', async () => {
      const { session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      await session.changePassword(PASSWORD, 'noweHaslo456');
      session.logout();
      await assertRejects(() => session.login({ username: 'xaro', password: PASSWORD }), 'Nieprawidłowa');
      const user = await session.login({ username: 'xaro', password: 'noweHaslo456' });
      assertEquals(user.username, 'xaro');
    });

    runner.test('Reset kodem odzyskiwania unieważnia sesje i zmienia hasło', async () => {
      const { store, session } = makeSession();
      const created = await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      const result = await session.resetWithRecoveryCode({
        username: 'xaro',
        recoveryCode: created.recoveryCode,
        newPassword: 'poResecie789'
      });
      assertEquals(typeof result.recoveryCode, 'string');
      assertEquals(store.state.sessions.length, 0);
      await assertRejects(() => session.login({ username: 'xaro', password: PASSWORD }), 'Nieprawidłowa');
      const user = await session.login({ username: 'xaro', password: 'poResecie789' });
      assertEquals(user.username, 'xaro');
    });

    runner.test('Nie można usunąć własnego konta przez listę użytkowników', async () => {
      const { session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      await assertRejects(async () => session.removeUser(session.user.id), 'własnego konta');
    });

    runner.test('Usunięcie użytkownika czyści jego sesje (regresja)', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      const created = await session.register({
        username: 'czlonek', displayName: 'Członek', password: PASSWORD, role: 'member', actor: session.user
      });
      store.commit((state) => {
        state.sessions.push({
          id: 'sess-x',
          userId: created.user.id,
          tokenHash: 'x',
          issuedAt: Date.now(),
          lastSeenAt: Date.now(),
          expiresAt: Date.now() + 1000
        });
      }, { immediate: true });
      session.removeUser(created.user.id);
      assertEquals(store.state.sessions.filter((entry) => entry.userId === created.user.id).length, 0);
    });

    runner.test('Zmiana roli unieważnia sesje zmienionego użytkownika', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      const created = await session.register({
        username: 'czlonek', displayName: 'Członek', password: PASSWORD, role: 'member', actor: session.user
      });
      store.commit((state) => {
        state.sessions.push({
          id: 'sess-y',
          userId: created.user.id,
          tokenHash: 'y',
          issuedAt: Date.now(),
          lastSeenAt: Date.now(),
          expiresAt: Date.now() + 1000
        });
      }, { immediate: true });
      session.setUserRole(created.user.id, 'viewer');
      assertEquals(store.state.sessions.filter((entry) => entry.userId === created.user.id).length, 0);
      assertEquals(store.state.users.find((user) => user.id === created.user.id).role, 'viewer');
    });

    runner.test('Nie można usunąć ostatniego konta właściciela', async () => {
      const { session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      await assertRejects(async () => session.deleteOwnAccount(PASSWORD), 'ostatniego konta właściciela');
    });
  });

  runner.suite('Kopie zapasowe', () => {
    runner.test('Eksport jawny nie zawiera haseł ani sesji', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      await session.login({ username: 'xaro', password: PASSWORD });
      const backup = new BackupService({ store });
      const parsed = JSON.parse(backup.exportPlain());
      assertEquals(parsed.format, 'bsxs.manager.backup');
      assertEquals(parsed.encrypted, false);
      assertEquals(parsed.state.sessions.length, 0);
      assertEquals(parsed.state.users[0].password, null);
      assertEquals(parsed.state.users[0].recovery, null);
    });

    runner.test('Import kopii bez danych logowania jest odrzucany i nie niszczy danych', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'Bezpieczny' }); }, { immediate: true });
      const backup = new BackupService({ store });
      const plain = backup.exportPlain();
      await assertRejects(async () => backup.importPlain(plain), 'logowania');
      assertEquals(store.state.data.songs.length, 1);
    });

    runner.test('Nieprawidłowa kopia nie niszczy danych (regresja)', () => {
      const { store } = makeStore();
      store.commit((state) => { state.data.songs.push({ id: 's1', title: 'Bezpieczny' }); }, { immediate: true });
      const backup = new BackupService({ store });
      assertThrows(
        () => backup.importPlain(JSON.stringify({ format: 'bsxs.manager.backup', version: 1, state: { złe: true } })),
        'niespójne'
      );
      assertEquals(store.state.data.songs.length, 1);
    });

    runner.test('Kopia szyfrowana przechodzi pełny obieg, a błędne hasło jest odrzucane', async () => {
      const { store, session } = makeSession();
      await registerOwner(session);
      const backup = new BackupService({ store });
      const encrypted = await backup.exportEncrypted('kopiaHaslo123');

      const other = makeStore('test2');
      const otherBackup = new BackupService({ store: other.store });
      const result = await otherBackup.importEncrypted(encrypted, 'kopiaHaslo123');
      assertEquals(result.users, 1);
      assertEquals(other.store.state.users.length, 1);

      const third = makeStore('test3');
      const thirdBackup = new BackupService({ store: third.store });
      await assertRejects(async () => thirdBackup.importEncrypted(encrypted, 'zleHaslo123'), 'odszyfrować');
    });
  });

  runner.suite('Narzędzia i wydajność', () => {
    runner.test('Paginacja nie wychodzi poza zakres', () => {
      const page = paginate([1, 2, 3, 4, 5], 9, 2);
      assertEquals(page.items.length, 1);
      assertEquals(page.page, 3);
      assertEquals(page.pages, 3);
      assertEquals(paginate([], 1, 20).pages, 1);
    });

    runner.test('Wyszukiwanie ignoruje polskie znaki i wielkość liter', () => {
      assertEquals(normalizeSearch('Łódź'), 'lodz');
      assertEquals(matchesSearch('Noc w Warszawie', 'noc'), true);
      assertEquals(matchesSearch('Noc w Warszawie', 'lodz'), false);
    });

    runner.test('sortBy nie modyfikuje wejściowej listy', () => {
      const input = [{ v: 2 }, { v: 1 }];
      const sorted = sortBy(input, (item) => item.v, 'asc');
      assertEquals(input[0].v, 2);
      assertEquals(sorted[0].v, 1);
    });

    runner.test('sumy ignorują wartości nieliczbowe', () => {
      const total = sum([{ amount: 100 }, { amount: '50,5' }, { amount: null }], (entry) => entry.amount);
      assertEquals(Math.round(total * 100) / 100, 150.5);
    });
  });

  runner.suite('Mix Master', () => {
    runner.test('Katalog wtyczek jest spójny (unikalne id, HTTPS, pliki)', () => {
      assertEquals(validateCatalog().length, 0);
      assertEquals(PLUGIN_CATALOG.some((plugin) => plugin.id === 'pro-q4'), true);
      assertEquals(PLUGIN_CATALOG.every((plugin) => plugin.url.startsWith('https://')), true);
      assertEquals(PLUGIN_CATALOG.every((plugin) => /\.(vst3|dll)$/i.test(plugin.file)), true);
      assertEquals(new Set(PLUGIN_CATALOG.map((plugin) => plugin.id)).size, PLUGIN_CATALOG.length);
    });

    runner.test('Zestawy wtyczek wskazują istniejące pozycje katalogu', () => {
      assert(PLUGIN_PACKS.length >= 4, 'Za mało zestawów wtyczek');
      for (const pack of PLUGIN_PACKS) {
        assert(pack.ids.length > 0, `Pusty zestaw: ${pack.id}`);
        assertEquals(new Set(pack.ids).size, pack.ids.length);
        for (const id of pack.ids) {
          assert(
            PLUGIN_CATALOG.some((plugin) => plugin.id === id),
            `Nieznana wtyczka w zestawie ${pack.id}: ${id}`
          );
        }
      }
    });

    runner.test('Plan zawiera wszystkie etapy i cel głośności platformy', () => {
      const plan = buildPlan({ bpm: '140', style: 'trap', platform: 'streaming', keySig: 'Am' });
      assertEquals(plan.stages.length, CHAIN_DEFINITIONS.length);
      assertEquals(plan.target.lufs, -14);
      assertEquals(plan.target.truePeak, -1);
      assertEquals(plan.keySig, 'Am');
      const apple = buildPlan({ bpm: 140, style: 'trap', platform: 'apple' });
      assertEquals(apple.target.lufs, -16);
    });

    runner.test('Plan jest deterministyczny (to samo wejście = ten sam plan)', () => {
      const first = buildPlan({ bpm: 128, style: 'drill', platform: 'club' });
      const second = buildPlan({ bpm: 128, style: 'drill', platform: 'club' });
      assertEquals(JSON.stringify(first), JSON.stringify(second));
    });

    runner.test('Nowe style rapu i platforma TikTok dają poprawny plan', () => {
      for (const style of ['afro', 'phonk', 'rage']) {
        const plan = buildPlan({ bpm: 150, style, platform: 'tiktok' });
        assertEquals(plan.style, style);
        assertEquals(plan.target.lufs, -10);
        assertEquals(plan.stages.length, CHAIN_DEFINITIONS.length);
      }
    });

    runner.test('RfxChain: nagłówek, wtyczki i poprawna liczba cudzysłowów', () => {
      const plan = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming' });
      const vocal = plan.stages.find((stage) => stage.id === 'vocal');
      const text = rfxChainText(vocal);
      assertEquals(text.startsWith('BYPASS 0 0 0'), true);
      assertIncludes(text, 'FabFilter Pro-Q 4');
      const vstLines = text.split('\n').filter((line) => line.startsWith('<VST '));
      assertEquals(vstLines.length, vocal.steps.length);
      for (const line of vstLines) {
        assertEquals((line.match(/"/g) || []).length, 6);
      }
    });

    runner.test('RfxChain: pusty łańcuch jest odrzucany', () => {
      assertThrows(() => rfxChainText({ steps: [] }), 'wtyczek');
      assertThrows(() => rfxChainText(null), 'wtyczek');
    });

    runner.test('Walidacja: BPM, styl i platforma są sprawdzane', () => {
      assertThrows(() => buildPlan({ bpm: 500, style: 'trap', platform: 'streaming' }), 'większe');
      assertThrows(() => buildPlan({ bpm: 140, style: 'disco', platform: 'streaming' }), 'nieprawidłową');
      assertThrows(() => buildPlan({ bpm: 140, style: 'trap', platform: 'radio' }), 'nieprawidłową');
      assertThrows(() => buildPlan({ bpm: 140, style: 'trap', platform: 'streaming' }, { variant: 'demo' }), 'wariant');
    });

    runner.test('Wariant stock nie zawiera wtyczek premium', () => {
      const plan = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming' }, { variant: 'stock' });
      for (const stage of plan.stages) {
        for (const entry of stage.steps) {
          assertEquals(entry.plugin.tier, 'stock');
        }
      }
      const text = rfxChainText(plan.stages[0]);
      assertIncludes(text, 'ReaEQ');
      assertEquals(text.includes('FabFilter'), false);
    });

    runner.test('Etap sends ma pogłos premium i czyste stock', () => {
      const premium = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming' });
      const premiumSends = premium.stages.find((stage) => stage.id === 'sends');
      assert(premiumSends, 'Brak etapu sends');
      assert(premiumSends.steps.some((entry) => entry.plugin.id === 'vintageverb'), 'Brak pogłosu w sends');

      const stock = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming' }, { variant: 'stock' });
      const stockSends = stock.stages.find((stage) => stage.id === 'sends');
      for (const entry of stockSends.steps) assertEquals(entry.plugin.tier, 'stock');
    });

    runner.test('Nazwy plików są bezpieczne (bez ścieżek i „..”)', () => {
      const name = chainFileName({ title: '../../etc/passwd' }, 'vocal');
      assertEquals(name, 'bsxs-etc-passwd-vocal-premium.RfxChain');
      assertEquals(/^bsxs-[a-z0-9-]+\.RfxChain$/.test(name), true);
      assertEquals(slugify('../../'), 'chain');
      assertEquals(name.includes('..'), false);
    });

    runner.test('chainFiles: unikalne, bezpieczne nazwy i komplet etapów', () => {
      const plan = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming', title: 'Noc' });
      const files = chainFiles(plan);
      assertEquals(files.length, CHAIN_DEFINITIONS.length);
      assertEquals(new Set(files.map((file) => file.fileName)).size, files.length);
      for (const file of files) {
        assertEquals(file.fileName.endsWith('.RfxChain'), true);
        assertEquals(file.fileName.includes('..'), false);
        assertEquals(file.text.startsWith('BYPASS 0 0 0'), true);
      }
      assertThrows(() => chainFiles(null), 'planu');
    });

    runner.test('Paczka ZIP zawiera oba warianty, receptę, pakiety i README', () => {
      const files = bundleFiles(
        { bpm: 140, style: 'drill', platform: 'streaming', title: 'Noc' },
        { createdAt: '2025-01-01T00:00:00.000Z' }
      );
      const chains = files.filter((file) => file.name.endsWith('.RfxChain'));
      assertEquals(chains.length, CHAIN_DEFINITIONS.length * CHAIN_VARIANTS.length);
      assertEquals(files.filter((file) => file.name.endsWith('.json')).length, 2);
      assertEquals(files.filter((file) => file.name.endsWith('.md')).length, 1);
      assertEquals(files.some((file) => file.name === 'README.txt'), true);
      assertEquals(new Set(files.map((file) => file.name)).size, files.length);
      assertEquals(bundleFileName({ title: 'Noc' }), 'bsxs-mixmaster-noc.zip');
      assertEquals(packFileName({ title: '../../x', variant: 'stock' }), 'bsxs-mixplan-x-stock.json');
    });

    runner.test('Pakiet JSON zawiera wszystkie łańcuchy', () => {
      const plan = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming', title: 'Noc' });
      const pack = JSON.parse(chainPack(plan, { createdAt: '2025-01-01T00:00:00.000Z' }));
      assertEquals(pack.format, 'bsxs.fxchain.pack');
      assertEquals(pack.chains.length, CHAIN_DEFINITIONS.length);
      assertEquals(pack.chains.every((chain) => chain.rfxChain.includes('BYPASS 0 0 0')), true);
    });

    runner.test('Recepta zawiera etapy, ustawienia i instrukcję REAPERa', () => {
      const plan = buildPlan({ bpm: 140, style: 'trap', platform: 'streaming', title: 'Noc' });
      const text = recipeMarkdown(plan);
      assertIncludes(text, '## 1. Wokal');
      assertIncludes(text, 'FabFilter Pro-Q 4');
      assertIncludes(text, 'Retune');
      assertIncludes(text, 'Jak wstawić do REAPERa');
      for (const stage of plan.stages) assertIncludes(text, stage.label);
    });

    runner.test('Katalog: eksport listy zawiera producentów i linki', () => {
      const text = catalogMarkdown();
      assertIncludes(text, 'FabFilter');
      assertIncludes(text, 'Auto-Tune');
      assertIncludes(text, 'https://');
      assertIncludes(text, 'nie pobiera');
    });

    runner.test('Identyfikator wtyczki w chunku jest stabilny i liczbowy', () => {
      assertEquals(pluginUid('FabFilter Pro-Q 4'), pluginUid('FabFilter Pro-Q 4'));
      assertEquals(/^\d+$/.test(pluginUid('ReaEQ')), true);
    });

    runner.test('Regresja: cudzysłowy i nowe linie w nazwie nie psują chunku', () => {
      const text = rfxChainText({
        steps: [{
          plugin: { name: 'Zła "nazwa"\nLinia', vendor: 'X', file: 'x.vst3', format: 'VST3' },
          settings: []
        }]
      });
      assertEquals(text.split('\n').length, 4);
      assertIncludes(text, `"VST3: Zła 'nazwa' Linia (X)"`);
    });

    runner.test('Moduł Mix Master zgłasza sprawny katalog', () => {
      const result = mixingModule.selfCheck();
      assertEquals(result.ok, true);
      assertIncludes(result.message, 'wtyczek');
      assertEquals(mixingModule.title, 'Mix Master');
    });

    runner.test('Silnik miksu eksportuje wszystko, czego wymaga moduł (regresja importu)', () => {
      const required = [
        'CHAIN_DEFINITIONS', 'CHAIN_VARIANTS', 'PLATFORMS', 'PLUGIN_CATALOG', 'PLUGIN_PACKS',
        'STYLES', 'buildPlan', 'bundleFileName', 'bundleFiles', 'catalogFileName',
        'catalogMarkdown', 'chainFileName', 'chainPack', 'packFileName', 'planFileName',
        'recipeMarkdown', 'rfxChainText', 'validateCatalog'
      ];
      for (const name of required) {
        assertEquals(name in engineApi, true, `Brak eksportu: ${name}`);
      }
      assertEquals(createZip instanceof Function, true);
      assertEquals(typeof mixingModule.mount, 'function');
      assertEquals(mixingModule.id, 'mixing');
    });
  });

  runner.suite('ZIP', () => {
    runner.test('CRC32 zgadza się z wektorem kontrolnym', () => {
      const bytes = typeof TextEncoder === 'function'
        ? new TextEncoder().encode('123456789')
        : new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57]);
      assertEquals(crc32(bytes), 0xcbf43926);
      assertEquals(crc32(new Uint8Array(0)), 0);
    });

    runner.test('Archiwum ma poprawne sygnatury, liczbę wpisów i nazwy', () => {
      const bytes = createZip([
        { name: 'a.txt', text: 'alfa' },
        { name: 'b.RfxChain', text: 'BYPASS 0 0 0\n' }
      ], { date: new Date(2025, 0, 2, 3, 4, 6) });

      assertEquals(bytes[0], 0x50);
      assertEquals(bytes[1], 0x4b);
      assertEquals(bytes[2], 0x03);
      assertEquals(bytes[3], 0x04);

      const eocd = findEocd(bytes);
      assert(eocd > 0, 'Brak nagłówka EOCD');
      assertEquals(eocd, bytes.length - 22);

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assertEquals(view.getUint16(eocd + 10, true), 2);
      assertEquals(view.getUint32(eocd + 16, true), eocd - view.getUint32(eocd + 12, true));

      const nameLength = view.getUint16(26, true);
      assertEquals(nameLength, 5);
      const name = Array.from(bytes.slice(30, 30 + nameLength))
        .map((code) => String.fromCharCode(code)).join('');
      assertEquals(name, 'a.txt');

      const text = Array.from(bytes).map((code) => String.fromCharCode(code)).join('');
      assertIncludes(text, 'b.RfxChain');
      assertIncludes(text, 'BYPASS 0 0 0');
    });

    runner.test('Archiwum przyjmuje dane binarne i datę domyślną', () => {
      const bytes = createZip([{ name: 'x.bin', bytes: new Uint8Array([1, 2, 3, 4]) }]);
      assertEquals(findEocd(bytes), bytes.length - 22);
      assertEquals(bytes[0], 0x50);
    });

    runner.test('ZIP odrzuca niebezpieczne i zduplikowane nazwy', () => {
      assertThrows(() => createZip([{ name: '../evil.txt', text: 'x' }]), 'Niedozwolona');
      assertThrows(() => createZip([{ name: 'katalog/plik.txt', text: 'x' }]), 'Niedozwolona');
      assertThrows(() => createZip([{ name: 'a.txt', text: 'x' }, { name: 'a.txt', text: 'y' }]), 'Zduplikowana');
      assertThrows(() => createZip([]), 'co najmniej jeden');
      assertThrows(() => createZip([{ name: '', text: 'x' }]), 'nazwy');
    });

    runner.test('Paczka Mix Master buduje się do poprawnego ZIP-a', () => {
      const files = bundleFiles({ bpm: 140, style: 'trap', platform: 'streaming', title: 'Noc' });
      const bytes = createZip(files);
      const eocd = findEocd(bytes);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assertEquals(view.getUint16(eocd + 10, true), files.length);
      assertEquals(bytes[0], 0x50);
    });
  });

  runner.suite('Rejestr modułów i ładowanie', () => {
    runner.test('Każdy wpis rejestru wskazuje istniejący moduł o zgodnych metadanych', async () => {
      const seen = new Set();
      for (const meta of MODULE_REGISTRY) {
        assert(meta && meta.id, 'Wpis rejestru bez identyfikatora');
        assert(!seen.has(meta.id), `Zduplikowany identyfikator modułu: ${meta.id}`);
        seen.add(meta.id);
        assertEquals(typeof meta.importModule, 'function');

        const module = (await meta.importModule()).default;
        assertEquals(module.id, meta.id);
        assertEquals(module.title, meta.title);
        assertEquals(module.shortTitle || module.title, meta.shortTitle || meta.title);
        assertEquals(module.icon, meta.icon);
        assertEquals(module.group || 'Praca', meta.group || 'Praca');
        assertEquals(module.permission ?? null, meta.permission ?? null);
        assertEquals(typeof module.mount, 'function');
      }
    });

    runner.test('Rejestr zawiera wszystkie moduły nawigacji', () => {
      assertEquals(MODULE_REGISTRY.length, 13);
      const ids = [
        'dashboard', 'songs', 'releases', 'studio', 'mixing', 'finances', 'tasks',
        'team', 'reaper', 'diagnostics', 'security', 'privacy', 'settings'
      ];
      for (const id of ids) {
        assert(MODULE_REGISTRY.some((entry) => entry.id === id), `Brak modułu: ${id}`);
      }
      assertEquals(MODULE_REGISTRY.filter((entry) => entry.permission === null).length, 2);
    });

    runner.test('Diagnostyka nie oznacza niezaładowanego modułu jako sprawdzonego', async () => {
      const diagnostics = new Diagnostics({});
      diagnostics.registerModule({ id: 'testowy', title: 'Testowy' });
      const before = await diagnostics.runChecks({});
      assertEquals(before[0].loaded, false);
      assertEquals(before[0].status, 'unknown');
      assertIncludes(before[0].message, 'Nie załadowano');

      diagnostics.registerModule({
        id: 'testowy',
        title: 'Testowy',
        mount() {},
        selfCheck: () => ({ ok: true })
      });
      const after = await diagnostics.runChecks({});
      assertEquals(after[0].loaded, true);
      assertEquals(after[0].status, 'ok');
    });
  });

  runner.suite('Spójność modułów', () => {
    runner.test('Moduł utworów wykrywa utwór bez wydawnictwa', () => {
      const { store } = makeStore();
      store.commit((state) => {
        state.data.songs.push({ id: 's1', title: 'A', releaseId: 'nie-ma' });
      }, { immediate: true });
      const result = songsModule.selfCheck({ store });
      assertEquals(result.status, 'degraded');
    });

    runner.test('Moduł utworów: spójne dane bez ostrzeżeń', () => {
      const { store } = makeStore();
      store.commit((state) => {
        state.data.releases.push({ id: 'r1', title: 'EP' });
        state.data.songs.push({ id: 's1', title: 'A', releaseId: 'r1' });
      }, { immediate: true });
      assertEquals(songsModule.selfCheck({ store }).ok, true);
    });

    runner.test('Pulpit raportuje stan danych', () => {
      const { store } = makeStore();
      const result = dashboardModule.selfCheck({ store });
      assertEquals(result.ok, true);
      assertIncludes(result.message, 'utworów');
    });
  });

  runner.suite('Regresje', () => {
    runner.test('Regresja: TOTP akceptuje kod ze spacjami', async () => {
      const code = await totp(TOTP_SECRET_RFC, { timeMs: 59000 });
      const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
      assertEquals(await verifyTotp(TOTP_SECRET_RFC, spaced, { timeMs: 59000 }), true);
    });

    runner.test('Regresja: kod odzyskiwania normalizuje wielkość liter', () => {
      const code = generateRecoveryCode();
      assertEquals(normalizeRecoveryCode(code.toLowerCase()), normalizeRecoveryCode(code));
    });

    runner.test('Regresja: manifest REAPERa wymaga ścieżek względnych', () => {
      assertThrows(() => parseManifest(JSON.stringify({
        format: 'bsxs.reaper.manifest',
        version: 1,
        projects: [{ name: 'Zły', path: '/tmp/x.rpp' }]
      })), 'względną');
    });

    runner.test('Regresja: folder dozwolony nie łapie prefiksu innej nazwy', () => {
      assertEquals(folderAllows('XARO/2025/Noc.rpp', ['XARO']), true);
      assertEquals(folderAllows('XARO', ['XARO']), true);
      assertEquals(folderAllows('XAROevil/Noc.rpp', ['XARO']), false);
      assertEquals(folderAllows('Inny/Noc.rpp', ['XARO']), false);
    });

    runner.test('Service worker jest dostępny', () => {
      if (!('serviceWorker' in navigator)) skip('Brak obsługi service workerów w tym środowisku');
      if (location.protocol !== 'https:') skip('Service worker wymaga HTTPS');
      assert('serviceWorker' in navigator, 'Brak serviceWorkera');
    });
  });

  const summary = await runner.run();
  if (logger) {
    logger.info('Zestaw testów zakończony.', {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      durationMs: Math.round(summary.durationMs)
    });
    if (summary.failed) {
      logger.error('Testy niezaliczone.', {
        failures: summary.suites.flatMap((suite) => suite.tests
          .filter((test) => test.status === 'failed')
          .map((test) => `${suite.name}: ${test.name}`))
      });
    }
  }
  return summary;
}
