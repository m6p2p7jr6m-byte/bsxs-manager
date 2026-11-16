/**
 * Warstwa danych: wersjonowany stan, migracje, walidacja, autozapis,
 * kopie bezpieczeństwa i odzyskiwanie po uszkodzeniu.
 */

import { SCHEMA_VERSION } from './version.js';
import { StorageError, AppError } from './errors.js';
import { clamp, deepClone, nowISO } from './util.js';

export const ARRAY_FIELDS = ['songs', 'releases', 'studioSessions', 'finances', 'tasks', 'members'];
export const SETTING_DEFAULTS = {
  animations: 'on',
  pageSize: 20,
  autosaveMs: 900,
  currency: 'PLN',
  reducedDataMode: false
};
export const CONSENT_DEFAULTS = {
  externalAi: false,
  externalServices: false,
  reaperFolderAccess: false
};

export function emptyState() {
  const timestamp = nowISO();
  return {
    schema: SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    users: [],
    sessions: [],
    security: { failures: {} },
    data: {
      songs: [],
      releases: [],
      studioSessions: [],
      finances: [],
      tasks: [],
      members: [],
      settings: { ...SETTING_DEFAULTS },
      consents: { ...CONSENT_DEFAULTS },
      reaper: { allowedFolders: [] },
      meta: { revision: 0, demoSeeded: false }
    },
    diagnostics: { logs: [], errors: [], crashes: [], lastTestRun: null },
    backup: { lastSnapshotAt: null }
  };
}

/** Uzupełnia brakujące pola, żeby starsze/niepełne dane nie wysypały widoków. */
export function normalizeState(input) {
  const base = emptyState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;

  const state = {
    ...base,
    ...input,
    schema: Number.isFinite(Number(input.schema)) ? Number(input.schema) : SCHEMA_VERSION,
    users: Array.isArray(input.users) ? input.users : [],
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
    security: { failures: {} },
    data: {
      ...base.data,
      ...(input.data && typeof input.data === 'object' ? input.data : {})
    },
    diagnostics: { ...base.diagnostics },
    backup: { ...base.backup }
  };

  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(state.data[field])) state.data[field] = [];
  }

  state.data.settings = { ...SETTING_DEFAULTS, ...(input.data?.settings || {}) };
  state.data.consents = { ...CONSENT_DEFAULTS, ...(input.data?.consents || {}) };
  state.data.reaper = {
    allowedFolders: Array.isArray(input.data?.reaper?.allowedFolders)
      ? input.data.reaper.allowedFolders.map(String).slice(0, 50)
      : []
  };
  state.data.meta = { revision: 0, demoSeeded: false, ...(input.data?.meta || {}) };
  state.security = {
    failures: input.security && typeof input.security.failures === 'object' && input.security.failures
      ? input.security.failures
      : {}
  };
  state.diagnostics = {
    logs: Array.isArray(input.diagnostics?.logs) ? input.diagnostics.logs.slice(-600) : [],
    errors: Array.isArray(input.diagnostics?.errors) ? input.diagnostics.errors.slice(-200) : [],
    crashes: Array.isArray(input.diagnostics?.crashes) ? input.diagnostics.crashes.slice(-50) : [],
    lastTestRun: input.diagnostics?.lastTestRun ?? null
  };
  state.backup = {
    lastSnapshotAt: input.backup?.lastSnapshotAt ?? null
  };
  state.createdAt = input.createdAt || base.createdAt;
  state.updatedAt = input.updatedAt || base.updatedAt;

  return state;
}

export function validateStateObject(state) {
  const issues = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['Stan nie jest obiektem.'];
  if (typeof state.schema !== 'number') issues.push('Brak numeru schematu.');
  if (!Array.isArray(state.users)) issues.push('Lista użytkowników nie jest tablicą.');
  if (!Array.isArray(state.sessions)) issues.push('Lista sesji nie jest tablicą.');
  if (!state.data || typeof state.data !== 'object') {
    issues.push('Brak sekcji danych.');
  } else {
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(state.data[field])) issues.push(`Lista „${field}” nie jest tablicą.`);
    }
    if (!state.data.settings || typeof state.data.settings !== 'object') issues.push('Brak ustawień.');
  }
  if (Array.isArray(state.users)) {
    for (const user of state.users) {
      if (!user || typeof user !== 'object') {
        issues.push('Nieprawidłowy wpis użytkownika.');
        continue;
      }
      if (!user.id) issues.push('Użytkownik bez identyfikatora.');
      if (!user.username) issues.push('Użytkownik bez nazwy.');
      if (!user.password || typeof user.password.hash !== 'string' || !user.password.salt) {
        issues.push(`Użytkownik „${user.username ?? '?'}” bez danych hasła.`);
      }
    }
  }
  if (state.sessions && !Array.isArray(state.sessions)) issues.push('Sesje są nieprawidłowe.');
  return issues;
}

export function assertValidState(state) {
  const issues = validateStateObject(state);
  if (issues.length) {
    throw new StorageError(`Dane są niespójne: ${issues.slice(0, 3).join(' ')}`, { issues });
  }
  return state;
}

const MIGRATIONS = {
  1: (state) => state
};

export function migrateState(state) {
  let current = normalizeState(state);
  if (current.schema > SCHEMA_VERSION) {
    throw new StorageError('Dane pochodzą z nowszej wersji aplikacji. Zaktualizuj aplikację, aby je otworzyć.');
  }
  while (current.schema < SCHEMA_VERSION) {
    const next = current.schema + 1;
    const migration = MIGRATIONS[next];
    if (!migration) throw new StorageError(`Brak migracji danych do schematu ${next}.`);
    current = normalizeState(migration(current));
    current.schema = next;
  }
  return current;
}

export function createMemoryDriver() {
  const map = new Map();
  return {
    kind: 'memory',
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    keys: () => Array.from(map.keys()),
    sizeBytes: () => Array.from(map.values()).reduce((total, value) => total + String(value).length, 0)
  };
}

export function createLocalStorageDriver(storage) {
  const target = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!target) {
    return {
      kind: 'unavailable',
      getItem: () => null,
      setItem: () => { throw new StorageError('Pamięć przeglądarki jest niedostępna.'); },
      removeItem: () => {},
      keys: () => [],
      sizeBytes: () => 0
    };
  }
  return {
    kind: 'localStorage',
    getItem: (key) => target.getItem(key),
    setItem: (key, value) => target.setItem(key, String(value)),
    removeItem: (key) => target.removeItem(key),
    keys: () => {
      const output = [];
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (key) output.push(key);
      }
      return output;
    },
    sizeBytes: () => {
      let total = 0;
      for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (!key) continue;
        const value = target.getItem(key) || '';
        total += key.length + value.length;
      }
      return total;
    }
  };
}

const SNAPSHOT_SLOTS = 3;
const SNAPSHOT_MAX_BYTES = 1500000;

export class Store {
  constructor({ driver, prefix = 'bsxs', logger = null, now = () => Date.now() } = {}) {
    if (!driver) throw new AppError('Store wymaga sterownika pamięci.', 'store_driver');
    this.driver = driver;
    this.prefix = prefix;
    this.logger = logger;
    this.now = now;
    this.state = null;
    this.subscribers = new Set();
    this.persistTimer = null;
    this.lastSavedAt = 0;
    this.lastSafetyAt = 0;
    this.lastError = null;
    this.dirty = false;
    this.loadReport = null;
    this.maintenancePending = false;
  }

  key(name) {
    return `${this.prefix}.${name}`;
  }

  readAux(name) {
    try {
      return this.driver.getItem(this.key(name));
    } catch (err) {
      this._storageWarning('odczyt', name, err);
      return null;
    }
  }

  writeAux(name, value) {
    try {
      this.driver.setItem(this.key(name), String(value));
      return true;
    } catch (err) {
      this._storageWarning('zapis', name, err);
      return false;
    }
  }

  removeAux(name) {
    try {
      this.driver.removeItem(this.key(name));
    } catch (err) {
      this._storageWarning('usuwanie', name, err);
    }
  }

  _storageWarning(action, name, err) {
    if (this.logger) {
      this.logger.warn(`Problem z pamięcią (${action}: ${name}).`, { error: String(err) });
    }
  }

  _parseCandidate(raw, name) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { error: `Nie można odczytać JSON (${name}).` };
    }
    const candidate = name.startsWith('snapshot.') ? parsed?.state : parsed;
    if (!candidate) return { error: `Brak danych stanu w ${name}.` };
    if (Number.isFinite(Number(candidate.schema)) && Number(candidate.schema) > SCHEMA_VERSION) {
      return {
        fatal: `Dane pochodzą z nowszej wersji aplikacji (schemat ${candidate.schema}). Zaktualizuj aplikację, aby je otworzyć.`
      };
    }
    const issues = validateStateObject(candidate);
    if (issues.length) return { error: `${name}: ${issues.slice(0, 2).join(' ')}` };
    try {
      return { state: migrateState(candidate) };
    } catch (err) {
      return { error: `${name}: ${err.message}` };
    }
  }

  init() {
    const report = { source: 'fresh', recovered: false, issues: [], savedAt: null };
    let loaded = null;

    const raw = this.readAux('state');
    if (raw !== null && raw !== undefined) {
      const result = this._parseCandidate(raw, 'state');
      // Nowszy schemat: przerywamy start, zamiast nadpisywać dane pustym stanem.
      if (result.fatal) throw new StorageError(result.fatal, { fatal: true });
      if (result.state) {
        loaded = result.state;
        report.source = 'primary';
      } else {
        report.issues.push(result.error || 'Nieczytelny stan główny.');
        // Zachowujemy uszkodzone dane do wglądu, zamiast je nadpisywać.
        this.writeAux(`corrupt.${Date.now()}`, raw);
      }
    }

    if (!loaded) {
      for (const name of ['safety', 'snapshot.0', 'snapshot.1', 'snapshot.2']) {
        const candidateRaw = this.readAux(name);
        if (!candidateRaw) continue;
        const result = this._parseCandidate(candidateRaw, name);
        if (!result.state) {
          report.issues.push(result.fatal || result.error || `Nieczytelna kopia ${name}.`);
          continue;
        }
        loaded = result.state;
        report.source = name;
        report.recovered = true;
        break;
      }
    }

    this.state = loaded || emptyState();
    this.loadReport = report;

    if (report.issues.length && this.logger) {
      this.logger.error('Wykryto uszkodzone dane — uruchomiono odzyskiwanie.', { issues: report.issues.slice(0, 5) });
    }
    if (report.recovered && this.logger) {
      this.logger.warn(`Stan odzyskany z kopii: ${report.source}.`, { issues: report.issues.slice(0, 3) });
    }

    this._persistNow();
    // Konserwacja (dzienna migawka) nie blokuje startu — wykonuje ją
    // runMaintenance() po pierwszym renderze.
    this.maintenancePending = true;

    return report;
  }

  get currentState() {
    return this.state;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  _notify() {
    for (const listener of Array.from(this.subscribers)) {
      try {
        listener(this.state);
      } catch (err) {
        if (this.logger) this.logger.error('Błąd subskrybenta stanu.', { error: err });
      }
    }
  }

  snapshotState() {
    return deepClone(this.state);
  }

  /** Mutacja stanu przez kopię roboczą — nieudana walidacja nie psuje danych. */
  commit(mutator, { immediate = false, notify = true } = {}) {
    if (typeof mutator !== 'function') {
      throw new AppError('Operacja zapisu wymaga funkcji mutującej.', 'store_commit');
    }
    const draft = deepClone(this.state);
    const result = mutator(draft);
    draft.updatedAt = nowISO();
    if (!draft.data.meta) draft.data.meta = { revision: 0 };
    draft.data.meta.revision = Number(draft.data.meta.revision || 0) + 1;
    assertValidState(draft);
    this.state = draft;

    if (immediate) {
      this._persistNow({ throwOnError: true });
    } else {
      this._schedulePersist();
    }
    if (notify) this._notify();
    return result;
  }

  _schedulePersist() {
    if (this.persistTimer) return;
    const delay = clamp(Number(this.state?.data?.settings?.autosaveMs ?? 900), 200, 5000);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this._persistNow();
        this._notify();
      } catch (err) {
        // Błąd został już zalogowany w _persistNow; stan pozostaje w pamięci.
      }
    }, delay);
  }

  _persistNow({ throwOnError = false } = {}) {
    let json;
    try {
      json = JSON.stringify(this.state);
    } catch (err) {
      const error = new StorageError('Nie udało się przygotować danych do zapisu.', { cause: String(err) });
      this.lastError = error;
      if (this.logger) this.logger.error(error);
      if (throwOnError) throw error;
      return;
    }

    try {
      const now = this.now();
      const firstSave = this.lastSavedAt === 0;
      this.driver.setItem(this.key('state'), json);
      this.dirty = false;
      this.lastSavedAt = now;
      this.lastError = null;
      // Pierwszy zapis startowy nie duplikuje stanu w kopii safety — kopia
      // powstaje przy pierwszej rzeczywistej zmianie (mniej pracy na starcie).
      if (!firstSave && now - this.lastSafetyAt > 30000) {
        try {
          this.driver.setItem(this.key('safety'), json);
          this.lastSafetyAt = this.now();
        } catch (err) {
          this._storageWarning('zapis kopii bezpieczeństwa', 'safety', err);
        }
      }
    } catch (err) {
      this.dirty = true;
      const quota = /quota|storage|full/i.test(`${err?.name ?? ''} ${err?.message ?? ''}`);
      const message = quota
        ? 'Brak miejsca w pamięci przeglądarki. Dane nie zostały zapisane — wyeksportuj kopię i usuń stare migawki.'
        : 'Nie udało się zapisać danych. Zmiany pozostają w pamięci do następnej próby.';
      const storageError = new StorageError(message, { cause: String(err) });
      const previousMessage = this.lastError ? String(this.lastError.message ?? '') : '';
      this.lastError = storageError;
      // Ten sam błąd zapisujemy raz — inaczej nieudany zapis logów mógłby się zapętlić.
      if (previousMessage !== message && this.logger) {
        this.logger.error(storageError);
      }
      if (throwOnError) throw storageError;
    }
  }

  flush() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._persistNow();
    return this.lastSavedAt;
  }

  hasUnsavedChanges() {
    return this.dirty || this.persistTimer !== null;
  }

  importState(candidate, { createSnapshot = true } = {}) {
    if (createSnapshot) this.createSnapshot('przed importem');
    const migrated = migrateState(candidate);
    assertValidState(migrated);
    this.state = migrated;
    this._persistNow({ throwOnError: true });
    this._notify();
    return this.state;
  }

  resetAll() {
    this.createSnapshot('przed resetem');
    this.state = emptyState();
    this._persistNow({ throwOnError: true });
    this._notify();
    return this.state;
  }

  listSnapshots() {
    const output = [];
    for (let index = 0; index < SNAPSHOT_SLOTS; index += 1) {
      const raw = this.readAux(`snapshot.${index}`);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        output.push({
          index,
          savedAt: parsed.savedAt ?? null,
          reason: parsed.reason ?? '',
          size: raw.length,
          valid: Boolean(parsed.state)
        });
      } catch (err) {
        output.push({ index, savedAt: null, reason: 'uszkodzona migawka', size: raw.length, valid: false });
      }
    }
    return output;
  }

  createSnapshot(reason = 'ręczna') {
    let json;
    try {
      json = JSON.stringify(this.state);
    } catch (err) {
      if (this.logger) this.logger.error('Nie udało się utworzyć migawki.', { error: err });
      return null;
    }
    if (json.length > SNAPSHOT_MAX_BYTES) {
      if (this.logger) this.logger.warn('Pominięto migawkę lokalną — dane przekraczają limit rozmiaru.');
      return null;
    }
    const savedAt = new Date(this.now()).toISOString();
    const payload = JSON.stringify({ savedAt, reason, state: this.state });
    try {
      for (let index = SNAPSHOT_SLOTS - 1; index >= 1; index -= 1) {
        const previous = this.readAux(`snapshot.${index - 1}`);
        if (previous) this.writeAux(`snapshot.${index}`, previous);
        else this.removeAux(`snapshot.${index}`);
      }
      this.writeAux('snapshot.0', payload);
      this.state.backup = { ...(this.state.backup || {}), lastSnapshotAt: savedAt };
      this._persistNow();
      return { savedAt, reason, size: payload.length };
    } catch (err) {
      if (this.logger) this.logger.error('Nie udało się zapisać migawki.', { error: err });
      return null;
    }
  }

  _rotateSnapshotsIfNeeded() {
    const last = this.state?.backup?.lastSnapshotAt;
    const lastTime = last ? new Date(last).getTime() : 0;
    const ageDays = (this.now() - lastTime) / 86400000;
    if (!last || ageDays >= 1) {
      this.createSnapshot('automatyczna dzienna');
    }
  }

  /**
   * Konserwacja po starcie: dzienna migawka powstaje już po pierwszym
   * renderze, żeby duży zapis nie opóźniał otwarcia aplikacji.
   */
  runMaintenance() {
    if (!this.maintenancePending) return null;
    this.maintenancePending = false;
    try {
      this._rotateSnapshotsIfNeeded();
    } catch (err) {
      this._storageWarning('konserwacja', 'snapshot', err);
      return null;
    }
    return this.state?.backup?.lastSnapshotAt ?? null;
  }

  restoreSnapshot(index) {
    const raw = this.readAux(`snapshot.${index}`);
    if (!raw) throw new StorageError('Nie znaleziono wybranej migawki.');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StorageError('Ta migawka jest uszkodzona i nie można jej przywrócić.');
    }
    if (!parsed?.state) throw new StorageError('Migawka nie zawiera danych.');
    const restored = migrateState(parsed.state);
    assertValidState(restored);
    this.createSnapshot('przed przywróceniem');
    this.state = restored;
    this._persistNow({ throwOnError: true });
    this._notify();
    return { savedAt: parsed.savedAt ?? null, reason: parsed.reason ?? '' };
  }

  setDiagnostics(snapshot) {
    if (!this.state) return;
    this.state.diagnostics = {
      ...this.state.diagnostics,
      logs: Array.isArray(snapshot?.logs) ? snapshot.logs.slice(-600) : [],
      errors: Array.isArray(snapshot?.errors) ? snapshot.errors.slice(-200) : [],
      crashes: Array.isArray(snapshot?.crashes) ? snapshot.crashes.slice(-50) : []
    };
    // Celowo bez powiadamiania subskrybentów — logi nie mogą wywoływać renderu.
    this._persistNow();
  }

  setLastTestRun(summary) {
    this.state.diagnostics = { ...this.state.diagnostics, lastTestRun: summary };
    this._persistNow();
  }

  sizeBytes() {
    try {
      return this.driver.sizeBytes ? this.driver.sizeBytes() : 0;
    } catch (err) {
      return 0;
    }
  }

  storageStats() {
    return {
      driver: this.driver.kind ?? 'nieznany',
      bytes: this.sizeBytes(),
      keys: this.driver.keys ? this.driver.keys().length : 0,
      lastSavedAt: this.lastSavedAt ? new Date(this.lastSavedAt).toISOString() : null,
      dirty: this.hasUnsavedChanges(),
      lastError: this.lastError ? String(this.lastError.message ?? this.lastError) : null,
      loadReport: this.loadReport
    };
  }
}
