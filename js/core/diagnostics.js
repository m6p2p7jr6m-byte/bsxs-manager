/** Monitoring czasu odpowiedzi, stan modułów i raport diagnostyczny. */

import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from './version.js';
import { fmtTime, nowMs } from './util.js';

const MAX_SAMPLES = 60;
const SLOW_THRESHOLD_MS = 500;

export class Diagnostics {
  constructor({ logger = null, version = APP_VERSION, now = () => Date.now() } = {}) {
    this.logger = logger;
    this.version = version;
    this.now = now;
    this.samples = new Map();
    this.modules = new Map();
    this.lastCheckAt = null;
  }

  /** Mierzy czas operacji synchronicznej lub asynchronicznej. */
  measure(name, fn) {
    const started = nowMs();
    const finish = (ok) => {
      const elapsed = nowMs() - started;
      this.record(name, elapsed, ok);
    };
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => { finish(true); return value; },
          (err) => { finish(false); throw err; }
        );
      }
      finish(true);
      return result;
    } catch (err) {
      finish(false);
      throw err;
    }
  }

  record(name, ms, ok = true) {
    const key = String(name);
    if (!this.samples.has(key)) this.samples.set(key, []);
    const samples = this.samples.get(key);
    samples.push({ ms: Number(ms) || 0, ok: Boolean(ok), at: this.now() });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    if (!ok && this.logger) {
      this.logger.warn(`Operacja zakończona błędem: ${key}.`);
    } else if (ms > SLOW_THRESHOLD_MS && this.logger) {
      this.logger.warn(`Wolna operacja: ${key} (${Math.round(ms)} ms).`);
    }
  }

  stats() {
    const output = [];
    for (const [name, samples] of this.samples.entries()) {
      if (!samples.length) continue;
      const durations = samples.map((sample) => sample.ms).sort((a, b) => a - b);
      const total = durations.reduce((sum, value) => sum + value, 0);
      const p95Index = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
      output.push({
        name,
        count: samples.length,
        avg: total / samples.length,
        p95: durations[p95Index],
        max: durations[durations.length - 1],
        failures: samples.filter((sample) => !sample.ok).length
      });
    }
    return output.sort((a, b) => b.avg - a.avg);
  }

  registerModule(definition) {
    if (!definition || !definition.id) return;
    const loaded = typeof definition.mount === 'function';
    this.modules.set(definition.id, {
      id: definition.id,
      title: definition.title || definition.id,
      check: typeof definition.selfCheck === 'function' ? definition.selfCheck : null,
      loaded,
      status: 'unknown',
      message: loaded ? 'Nie sprawdzono' : 'Nie załadowano — sprawdzany po pierwszym otwarciu',
      checkedAt: null,
      durationMs: null
    });
  }

  async runChecks(context) {
    const results = [];
    for (const entry of this.modules.values()) {
      const started = nowMs();
      if (!entry.check) {
        entry.status = entry.loaded ? 'ok' : 'unknown';
        entry.message = entry.loaded
          ? 'Moduł załadowany'
          : 'Nie załadowano — sprawdzany po pierwszym otwarciu';
        entry.checkedAt = new Date(this.now()).toISOString();
        entry.durationMs = 0;
        results.push({ ...entry });
        continue;
      }
      try {
        const result = await entry.check(context);
        const elapsed = nowMs() - started;
        entry.durationMs = elapsed;
        entry.checkedAt = new Date(this.now()).toISOString();
        if (result && typeof result === 'object') {
          entry.status = result.ok === false ? 'error' : (result.status || 'ok');
          entry.message = result.message || (result.ok === false ? 'Wykryto problem' : 'OK');
        } else {
          entry.status = result === false ? 'error' : 'ok';
          entry.message = result === false ? 'Wykryto problem' : 'OK';
        }
        this.record(`selfcheck:${entry.id}`, elapsed, entry.status !== 'error');
      } catch (err) {
        entry.status = 'error';
        entry.message = err?.message ? String(err.message) : 'Wyjątek podczas sprawdzania';
        entry.checkedAt = new Date(this.now()).toISOString();
        entry.durationMs = nowMs() - started;
        if (this.logger) this.logger.error(`Sprawdzenie modułu ${entry.id} nie powiodło się.`, { error: err });
      }
      results.push({ ...entry });
    }
    this.lastCheckAt = new Date(this.now()).toISOString();
    return results;
  }

  moduleStatus() {
    return Array.from(this.modules.values()).map((entry) => ({ ...entry }));
  }

  async report({ store = null, session = null, tests = null, extra = {} } = {}) {
    const modules = this.moduleStatus();
    const counts = this.logger ? this.logger.counts() : { logs: 0, errors: 0, crashes: 0, byLevel: {} };
    let storageEstimate = null;
    try {
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        storageEstimate = { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
      }
    } catch (err) {
      storageEstimate = { error: 'niedostępne' };
    }

    return {
      app: { name: APP_NAME, version: this.version, schema: SCHEMA_VERSION },
      generatedAt: new Date(this.now()).toISOString(),
      environment: {
        online: navigator.onLine,
        protocol: location.protocol,
        secureContext: Boolean(globalThis.isSecureContext),
        language: navigator.language,
        platform: navigator.platform || 'nieznana',
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        pixelRatio: window.devicePixelRatio,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
        cryptoAvailable: Boolean(globalThis.crypto?.subtle),
        localStorage: { kind: store?.driver?.kind ?? 'brak', bytes: store?.sizeBytes?.() ?? 0 }
      },
      storage: store?.storageStats?.() ?? null,
      storageEstimate,
      session: session ? {
        authenticated: session.isAuthenticated(),
        user: session.user ? { username: session.user.username, role: session.user.role } : null,
        policy: session.securityPolicy()
      } : null,
      modules,
      latency: this.stats(),
      logs: counts,
      lastTestRun: store?.state?.diagnostics?.lastTestRun ?? null,
      tests,
      extra
    };
  }

  reportText(report) {
    const lines = [];
    lines.push(`${report.app.name} ${report.app.version} — raport diagnostyczny`);
    lines.push(`Wygenerowano: ${fmtTime(report.generatedAt)} (${report.generatedAt})`);
    lines.push('');
    lines.push('ŚRODOWISKO');
    for (const [key, value] of Object.entries(report.environment)) {
      lines.push(`  ${key}: ${String(value)}`);
    }
    lines.push('');
    lines.push('STAN MODUŁÓW');
    for (const module of report.modules) {
      lines.push(`  [${module.status.toUpperCase()}] ${module.title} — ${module.message}${module.durationMs != null ? ` (${Math.round(module.durationMs)} ms)` : ''}`);
    }
    lines.push('');
    lines.push('CZASY ODPOWIEDZI');
    if (!report.latency.length) lines.push('  brak pomiarów');
    for (const row of report.latency) {
      lines.push(`  ${row.name}: avg ${row.avg.toFixed(1)} ms, p95 ${row.p95.toFixed(1)} ms, max ${row.max.toFixed(1)} ms, próbek ${row.count}, błędów ${row.failures}`);
    }
    lines.push('');
    lines.push('LOGOWANIE');
    lines.push(`  logi: ${report.logs.logs}, błędy: ${report.logs.errors}, awarie: ${report.logs.crashes}`);
    lines.push('');
    lines.push('TESTY');
    const testRun = report.tests || report.lastTestRun;
    if (!testRun) {
      lines.push('  nie uruchomiono testów w tej sesji');
    } else {
      lines.push(`  ostatnie uruchomienie: ${testRun.finishedAt} — zaliczone ${testRun.passed}/${testRun.total}, niezaliczone ${testRun.failed}, pominięte ${testRun.skipped}`);
      for (const suite of testRun.suites || []) {
        lines.push(`  - ${suite.name}: ${suite.passed}/${suite.total}`);
      }
    }
    lines.push('');
    lines.push('POLITYKA BEZPIECZEŃSTWA');
    const policy = report.session?.policy;
    if (policy) {
      lines.push(`  hashowanie: ${policy.hashing} (${policy.iterations} iteracji)`);
      lines.push(`  sesja: bezczynność ${Math.round(policy.idleTimeoutMs / 60000)} min, maksymalnie ${Math.round(policy.absoluteTimeoutMs / 3600000)} h`);
      lines.push(`  blokada po ${policy.maxFailures} próbach na ${Math.round(policy.lockMs / 60000)} min`);
      lines.push(`  MFA: ${policy.mfa}`);
      lines.push(`  transmisja: ${policy.transmission}`);
    } else {
      lines.push('  brak aktywnej sesji');
    }
    lines.push('');
    lines.push('UWAGA: raport nie zawiera haseł, tokenów ani kluczy — dane poufne są redagowane.');
    return lines.join('\n');
  }
}
