/** Logi aplikacji, logi błędów i historia awarii z redakcją danych poufnych. */

import { APP_NAME, APP_VERSION } from './version.js';

const SENSITIVE_PATTERNS = [
  'password', 'passphrase', 'haslo', 'hasło', 'token', 'secret', 'apikey',
  'api_key', 'api-key', 'authorization', 'recoverycode', 'privatekey',
  'salt', 'hash', 'mfa', 'bearer'
];

export function isSensitiveKey(key) {
  const normalized = String(key ?? '').toLowerCase();
  return SENSITIVE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

const SECRET_VALUE_PATTERNS = [
  [/bearer\s+[a-z0-9._~+/=-]{8,}/gi, 'Bearer [zredagowano]'],
  [/(password|passphrase|token|secret|api[-_]?key)\s*[=:]\s*"[^"]*"/gi, '$1="[zredagowano]"'],
  [/(password|passphrase|token|secret|api[-_]?key)\s*[=:]\s*'[^']*'/gi, "$1='[zredagowano]'"]
];

export function redactString(value) {
  let text = String(value);
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/** Głęboka kopia z zamianą wartości poufnych. Nigdy nie rzuca wyjątku. */
export function redact(value, depth = 0, seen = new WeakSet()) {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return '[funkcja]';
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message || ''),
        code: value.code ?? null,
        stack: value.stack ? redactString(String(value.stack).split('\n').slice(0, 6).join('\n')) : null
      };
    }
    if (depth >= 4) return '[głębiej]';
    if (seen.has(value)) return '[cykliczne]';
    seen.add(value);

    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => redact(item, depth + 1, seen));
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const output = {};
      for (const key of Object.keys(value).slice(0, 40)) {
        output[key] = isSensitiveKey(key) ? '[zredagowano]' : redact(value[key], depth + 1, seen);
      }
      return output;
    }
    return String(value);
  } catch (err) {
    return '[nieczytelne]';
  }
}

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor({ maxLogs = 600, maxErrors = 200, maxCrashes = 50, level = 'info' } = {}) {
    this.maxLogs = maxLogs;
    this.maxErrors = maxErrors;
    this.maxCrashes = maxCrashes;
    this.level = level;
    this.logs = [];
    this.errors = [];
    this.crashes = [];
    this.subscribers = new Set();
    this.persistHandler = null;
    this.persistTimer = null;
    this.app = { name: APP_NAME, version: APP_VERSION };
  }

  setLevel(level) {
    if (LEVEL_WEIGHT[level]) this.level = level;
  }

  /** Rejestruje funkcję zapisującą logi w trwałym magazynie (debounce). */
  setPersist(handler) {
    this.persistHandler = typeof handler === 'function' ? handler : null;
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  _notify() {
    for (const listener of this.subscribers) {
      try {
        listener();
      } catch (err) {
        // Awaria subskrybenta nie może zatrzymać logowania.
        console.warn('Logger: subskrybent zgłosił błąd', err);
      }
    }
    this._schedulePersist();
  }

  _schedulePersist() {
    if (!this.persistHandler || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this.persistHandler(this.snapshot());
      } catch (err) {
        console.warn('Logger: nie udało się zapisać logów', err);
      }
    }, 1200);
  }

  _push(level, message, context) {
    if ((LEVEL_WEIGHT[level] ?? 0) < (LEVEL_WEIGHT[this.level] ?? 0) && level !== 'crash') return;
    const entry = {
      id: `${Date.now().toString(36)}-${this.logs.length}`,
      ts: new Date().toISOString(),
      level,
      message: redactString(String(message ?? '').slice(0, 1200)),
      context: context === undefined ? null : redact(context)
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
    if (level === 'error' || level === 'crash') {
      this.errors.push(entry);
      if (this.errors.length > this.maxErrors) this.errors.splice(0, this.errors.length - this.maxErrors);
    }
    this._notify();
    return entry;
  }

  debug(message, context) { return this._push('debug', message, context); }
  info(message, context) { return this._push('info', message, context); }
  warn(message, context) { return this._push('warn', message, context); }

  error(errorOrMessage, context) {
    const message = errorOrMessage instanceof Error
      ? errorOrMessage.message || errorOrMessage.name
      : errorOrMessage;
    const details = errorOrMessage instanceof Error
      ? { error: redact(errorOrMessage), ...(context ? { context: redact(context) } : {}) }
      : context;
    return this._push('error', message, details);
  }

  /** Historia awarii — nieoczekiwane wyjątki i odrzucone obietnice. */
  crash(error, context) {
    const entry = this._push('crash', error instanceof Error ? error.message : String(error), {
      error: error instanceof Error ? redact(error) : String(error),
      context: context ? redact(context) : null
    });
    const crashEntry = { ...entry, level: 'crash' };
    this.crashes.push(crashEntry);
    if (this.crashes.length > this.maxCrashes) this.crashes.splice(0, this.crashes.length - this.maxCrashes);
    return crashEntry;
  }

  counts() {
    const byLevel = { debug: 0, info: 0, warn: 0, error: 0, crash: 0 };
    for (const entry of this.logs) byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
    return {
      logs: this.logs.length,
      errors: this.errors.length,
      crashes: this.crashes.length,
      byLevel
    };
  }

  snapshot() {
    return {
      logs: this.logs.slice(-this.maxLogs),
      errors: this.errors.slice(-this.maxErrors),
      crashes: this.crashes.slice(-this.maxCrashes),
      counts: this.counts()
    };
  }

  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (Array.isArray(snapshot.logs)) this.logs = snapshot.logs.slice(-this.maxLogs);
    if (Array.isArray(snapshot.errors)) this.errors = snapshot.errors.slice(-this.maxErrors);
    if (Array.isArray(snapshot.crashes)) this.crashes = snapshot.crashes.slice(-this.maxCrashes);
  }

  clear() {
    this.logs = [];
    this.errors = [];
    this.crashes = [];
    this._notify();
  }

  exportObject(extra = {}) {
    return {
      app: this.app,
      generatedAt: new Date().toISOString(),
      counts: this.counts(),
      ...extra,
      logs: this.logs,
      errors: this.errors,
      crashes: this.crashes
    };
  }

  exportJSON(extra = {}) {
    return JSON.stringify(this.exportObject(extra), null, 2);
  }

  exportText() {
    const lines = [
      `${this.app.name} ${this.app.version} — dziennik`,
      `Wygenerowano: ${new Date().toISOString()}`,
      ''
    ];
    for (const entry of this.logs) {
      const ctx = entry.context ? ` | ${JSON.stringify(entry.context)}` : '';
      lines.push(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}${ctx}`);
    }
    return lines.join('\n');
  }
}
