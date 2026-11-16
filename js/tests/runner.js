/** Minimalny, uczciwy harness testowy: bez fałszywych „zaliczonych”. */

import { nowMs } from '../core/util.js';

export class TestSkipped extends Error {
  constructor(reason) {
    super(reason || 'Test pominięty');
    this.name = 'TestSkipped';
  }
}

export function skip(reason) {
  throw new TestSkipped(reason);
}

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition, message = 'Warunek nie jest spełniony') {
  if (!condition) throw new AssertionError(message);
}

export function assertEquals(actual, expected, message = '') {
  if (actual !== expected) {
    throw new AssertionError(`${message ? `${message}: ` : ''}oczekiwano ${JSON.stringify(expected)}, otrzymano ${JSON.stringify(actual)}`.trim());
  }
}

export function assertIncludes(haystack, needle, message = '') {
  const text = String(haystack ?? '');
  if (!text.includes(needle)) {
    throw new AssertionError(`${message ? `${message}: ` : ''}nie znaleziono „${needle}” w „${text.slice(0, 120)}”`);
  }
}

export async function assertRejects(fn, expectedSubstring = '') {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  if (!error) throw new AssertionError('Oczekiwano odrzucenia, ale operacja zakończyła się sukcesem.');
  if (expectedSubstring && !String(error.message).toLowerCase().includes(expectedSubstring.toLowerCase())) {
    throw new AssertionError(`Nieoczekiwany komunikat błędu: „${error.message}” (oczekiwano fragmentu „${expectedSubstring}”)`);
  }
  return error;
}

export function assertThrows(fn, expectedSubstring = '') {
  let error = null;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  if (!error) throw new AssertionError('Oczekiwano wyjątku, ale operacja zakończyła się sukcesem.');
  if (expectedSubstring && !String(error.message).toLowerCase().includes(expectedSubstring.toLowerCase())) {
    throw new AssertionError(`Nieoczekiwany komunikat błędu: „${error.message}” (oczekiwano fragmentu „${expectedSubstring}”)`);
  }
  return error;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AssertionError(`Test „${label}” przekroczył limit ${ms} ms.`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export class TestRunner {
  constructor({ timeoutMs = 25000 } = {}) {
    this.suites = [];
    this.current = null;
    this.timeoutMs = timeoutMs;
  }

  suite(name, define) {
    const suite = { name, tests: [] };
    this.suites.push(suite);
    this.current = suite;
    try {
      define();
    } finally {
      this.current = null;
    }
  }

  test(name, run) {
    if (!this.current) throw new Error('test() musi być wywołane wewnątrz suite().');
    this.current.tests.push({ name, run });
  }

  async run() {
    const startedAt = new Date().toISOString();
    const started = nowMs();
    const suites = [];
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const suite of this.suites) {
      const results = [];
      let suitePassed = 0;
      let suiteFailed = 0;
      let suiteSkipped = 0;

      for (const test of suite.tests) {
        total += 1;
        const testStart = nowMs();
        try {
          await withTimeout(Promise.resolve().then(() => test.run()), this.timeoutMs, test.name);
          const durationMs = nowMs() - testStart;
          results.push({ name: test.name, status: 'passed', durationMs, message: '' });
          passed += 1;
          suitePassed += 1;
        } catch (err) {
          const durationMs = nowMs() - testStart;
          if (err instanceof TestSkipped) {
            results.push({ name: test.name, status: 'skipped', durationMs, message: err.message });
            skipped += 1;
            suiteSkipped += 1;
          } else {
            results.push({
              name: test.name,
              status: 'failed',
              durationMs,
              message: err?.message ? String(err.message).slice(0, 400) : 'nieznany błąd'
            });
            failed += 1;
            suiteFailed += 1;
          }
        }
      }

      suites.push({
        name: suite.name,
        total: results.length,
        passed: suitePassed,
        failed: suiteFailed,
        skipped: suiteSkipped,
        tests: results
      });
    }

    const durationMs = nowMs() - started;
    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      total,
      passed,
      failed,
      skipped,
      durationMs,
      suites,
      environment: `${navigator.userAgent} · ${window.innerWidth}×${window.innerHeight}`
    };
  }
}
