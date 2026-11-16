/** Punkt wejścia: bootstrap, obsługa błędów, sesja, router, autotest. */

import { clear, debounce, el, nowMs } from './core/util.js';
import { toMessage } from './core/errors.js';
import { Logger } from './core/log.js';
import { Store, createLocalStorageDriver, createMemoryDriver } from './core/store.js';
import { SessionManager } from './core/session.js';
import { Diagnostics } from './core/diagnostics.js';
import { BackupService } from './core/backup.js';
import * as authz from './core/authz.js';
import * as validate from './core/validate.js';
import * as crypto from './core/crypto.js';
import * as ui from './core/ui.js';
import { Router } from './core/router.js';
import { APP_VERSION } from './core/version.js';
import { MODULE_REGISTRY } from './modules/registry.js';

const logger = new Logger();
const diagnostics = new Diagnostics({ logger });
const bootStartedAt = nowMs();

/* Leniwe ładowanie: kod modułu pobierany dopiero przy pierwszym otwarciu. */
const loadedModules = new Map();

const MODULES = MODULE_REGISTRY.map((meta) => ({
  ...meta,
  async load() {
    if (loadedModules.has(meta.id)) return loadedModules.get(meta.id);
    const loaded = (await meta.importModule()).default;
    if (!loaded || loaded.id !== meta.id || typeof loaded.mount !== 'function') {
      throw new Error(`Moduł „${meta.id}” nie ma oczekiwanego interfejsu.`);
    }
    loadedModules.set(meta.id, loaded);
    diagnostics.registerModule(loaded);
    return loaded;
  }
}));

/** Praca w tle nie może konkurować z pierwszym renderem. */
function runWhenIdle(task, timeout = 2500) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(task, { timeout });
    return;
  }
  setTimeout(task, 800);
}

/** Wstępne pobranie pulpitu, żeby pierwszy widok po logowaniu był natychmiast. */
function prefetchDashboard() {
  const definition = MODULES.find((module) => module.id === 'dashboard');
  if (!definition) return;
  definition.load().catch((err) => logger.warn('Nie udało się wstępnie wczytać pulpitu.', { error: err }));
}

/** Moduł wskazany przez użytkownika (hover/fokus) ładuje się od razu. */
function prefetchModule(id) {
  const definition = MODULES.find((module) => module.id === id);
  if (!definition) return;
  definition.load().catch((err) => logger.warn('Nie udało się wstępnie wczytać modułu.', { module: id, error: err }));
}

/**
 * Stary link z trasą w ścieżce (/mixing) zamieniamy na trasę w hashu —
 * aplikacja korzysta wyłącznie z routingu po hashu.
 */
function routeFromPath() {
  const segment = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  if (!segment) return null;
  return MODULES.some((module) => module.id === segment) ? segment : null;
}

/* Ekran logowania i szkielet aplikacji wczytywane dopiero, gdy są potrzebne. */
let shellRenderer = null;
let authRenderer = null;

async function loadShellRenderer() {
  if (!shellRenderer) shellRenderer = (await import('./ui/shell.js')).renderShell;
  return shellRenderer;
}

async function loadAuthRenderer() {
  if (!authRenderer) authRenderer = (await import('./ui/auth-screen.js')).renderAuth;
  return authRenderer;
}

let store = null;
let session = null;
let backup = null;
let router = null;
let shell = null;
let ctx = null;
let showingApp = false;
let fatalShown = false;

/* Globalna obsługa błędów — instalowana przed startem. */
window.addEventListener('error', (event) => {
  logger.crash(event.error || new Error(event.message || 'Błąd skryptu'), {
    source: 'window.error',
    file: event.filename,
    line: event.lineno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  logger.crash(event.reason || new Error('Odrzucona obietnica'), { source: 'unhandledrejection' });
});

function hideBoot() {
  const boot = document.getElementById('boot');
  if (boot) boot.hidden = true;
}

function resolveDriver() {
  try {
    const probe = '__bsxs_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return createLocalStorageDriver(globalThis.localStorage);
  } catch (err) {
    logger.error('Pamięć trwała jest niedostępna — dane tylko w pamięci karty.', { error: err });
    return createMemoryDriver();
  }
}

function showFatal(title, message) {
  if (fatalShown) return;
  fatalShown = true;
  const appEl = document.getElementById('app');
  if (!appEl) return;
  appEl.className = '';
  appEl.hidden = false;
  clear(appEl);
  appEl.appendChild(el('div', { class: 'auth' },
    el('div', { class: 'auth__card' },
      el('h1', { text: title }),
      el('p', { class: 'view__sub', text: message }),
      el('p', { class: 'view__sub', text: 'Jeśli problem się powtarza, wyeksportuj dane z innej karty lub odśwież aplikację.' }),
      el('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        on: { click: () => location.reload() }
      }, 'Odśwież aplikację')
    )
  ));
  hideBoot();
}

async function showAuthAsync(notice = '') {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  showingApp = false;
  if (router) {
    try {
      router.stop();
    } catch (err) {
      logger.warn('Nie udało się zatrzymać routera.', { error: err });
    }
  }
  router = null;
  shell = null;
  appEl.className = '';
  const renderAuth = await loadAuthRenderer();
  renderAuth({
    root: appEl,
    ctx,
    notice,
    onAuthenticated: () => showApp()
  });
  document.title = 'Zaloguj się — BSXS Manager';
}

function showAuth(notice = '') {
  showAuthAsync(notice).catch((err) => {
    logger.crash(err, { phase: 'showAuth' });
    showFatal('Nie udało się otworzyć ekranu logowania', toMessage(err));
  });
}

function showDenied(definition) {
  if (!shell) return;
  clear(shell.outlet);
  shell.setActive(null);
  shell.setTitle('Brak uprawnień');
  shell.outlet.appendChild(el('div', { class: 'view screen-enter' },
    el('div', { class: 'card' },
      el('h1', { text: 'Brak uprawnień' }),
      el('p', { class: 'view__sub', text: `Twoja rola nie pozwala otworzyć modułu „${definition.title}”.` }),
      el('button', {
        class: 'btn btn--primary',
        type: 'button',
        on: { click: () => router?.navigate('dashboard') }
      }, 'Wróć do pulpitu')
    )
  ));
}

async function showAppAsync() {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  showingApp = true;
  appEl.className = 'app';
  const renderShell = await loadShellRenderer();
  shell = renderShell({
    root: appEl,
    ctx,
    modules: MODULES,
    onLogout: () => showAuth('Wylogowano.')
  });

  ctx.onRouteChange = (definition) => {
    shell.setTitle(definition.title);
    shell.setActive(definition.id);
    shell.resetScroll();
  };

  router = new Router({
    outlet: shell.outlet,
    resolve: (id) => MODULES.find((module) => module.id === id) || null,
    canVisit: (definition) => !definition.permission || session.can(definition.permission),
    onDenied: showDenied,
    context: ctx,
    logger
  });

  router.start();
}

function showApp() {
  showAppAsync().catch((err) => {
    logger.crash(err, { phase: 'showApp' });
    showFatal('Nie udało się otworzyć aplikacji', toMessage(err));
  });
}

function showAutotestOverlay(summary) {
  const container = document.getElementById('modal-root');
  if (!container) return;
  const status = summary.failed ? 'failed' : 'passed';
  document.body.dataset.autotest = summary.error ? 'error' : status;

  const suitesText = (summary.suites || []).map((suite) => {
    const failed = suite.tests.filter((test) => test.status === 'failed');
    const skipped = suite.tests.filter((test) => test.status === 'skipped');
    const lines = [`${suite.name}: ${suite.passed}/${suite.total}`];
    for (const test of failed) lines.push(`  ✗ ${test.name}: ${test.message}`);
    for (const test of skipped) lines.push(`  – ${test.name}: ${test.message}`);
    return lines.join('\n');
  }).join('\n');

  container.appendChild(el('div', { class: 'modal-backdrop' },
    el('div', { class: 'modal modal--wide' },
      el('div', { class: 'modal__head' },
        el('h2', {
          class: 'modal__title',
          text: summary.error
            ? 'Autotest nie uruchomił się'
            : `Autotest: ${summary.passed}/${summary.total} zaliczone`
        })
      ),
      el('div', { class: 'modal__body' },
        summary.failed
          ? el('div', { class: 'modal__error', text: `${summary.failed} testów niezaliczonych` })
          : el('div', { class: 'notice notice--ok', text: 'Wszystkie testy zaliczone.' }),
        summary.skipped ? el('div', { class: 'notice notice--warn', text: `${summary.skipped} testów pominiętych (środowisko).` }) : null,
        summary.durationMs ? el('p', { class: 'view__sub', text: `Czas: ${Math.round(summary.durationMs)} ms · ${summary.finishedAt}` }) : null,
        el('pre', { class: 'code', text: summary.error || suitesText || 'Brak wyników.' })
      )
    )
  ));
}

async function runAutotest() {
  try {
    const { runAllTests } = await import('./tests/suites.js');
    const summary = await runAllTests({ logger, ctx });
    if (store) store.setLastTestRun(summary);
    showAutotestOverlay(summary);
  } catch (err) {
    logger.crash(err, { phase: 'autotest' });
    showAutotestOverlay({ total: 0, passed: 0, failed: 0, skipped: 0, suites: [], error: toMessage(err) });
  }
}

async function start() {
  // Trasa podana w ścieżce (np. /mixing) — przenosimy ją do hasha, bo router
  // czyta wyłącznie location.hash.
  const pathRoute = routeFromPath();
  if (pathRoute && !location.hash) {
    location.replace(`${location.pathname}${location.search}#/${pathRoute}`);
    return;
  }

  const bootReport = { recovered: false, source: 'fresh' };
  try {
    store = new Store({ driver: resolveDriver(), prefix: 'bsxs', logger });
    const report = store.init();
    bootReport.recovered = report.recovered;
    bootReport.source = report.source;
  } catch (err) {
    logger.crash(err, { phase: 'store.init' });
    showFatal('Nie można odczytać danych', toMessage(err));
    return;
  }

  logger.restore(store.state.diagnostics);
  logger.setPersist(debounce((snapshot) => {
    try {
      if (store && store.state) store.setDiagnostics(snapshot);
    } catch (err) {
      console.warn('Nie udało się zapisać logów', err);
    }
  }, 1500));

  ui.applyAnimationLevel(store.state.data.settings.animations);
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', () => ui.applyAnimationLevel(store.state.data.settings.animations));
  }

  MODULES.forEach((module) => diagnostics.registerModule(module));

  // Pulpit pobieramy równolegle z odtwarzaniem sesji — pierwszy widok po
  // zalogowaniu jest gotowy od razu, bez szkieletu.
  prefetchDashboard();

  session = new SessionManager({ store, logger });
  backup = new BackupService({ store, logger });

  ctx = {
    store,
    session,
    logger,
    diagnostics,
    backup,
    authz,
    validate,
    crypto,
    ui,
    toast: ui.toast,
    formModal: ui.formModal,
    confirmAction: ui.confirmAction,
    navigate: (id) => router?.navigate(id),
    prefetch: (id) => prefetchModule(id),
    onRouteChange: null,
    persistLastRoute: (id) => { store.writeAux('lastRoute', id); },
    appVersion: APP_VERSION,
    handleSignedOut: (message = '') => showAuth(message)
  };

  let restored = null;
  try {
    restored = await session.bootstrap();
  } catch (err) {
    logger.error('Nie udało się przywrócić sesji.', { error: err });
  }

  if (restored) {
    await showAppAsync();
  } else {
    await showAuthAsync(bootReport.recovered
      ? `Dane odzyskane z kopii (${bootReport.source}). Sprawdź zawartość.`
      : '');
  }
  hideBoot();
  const bootMs = Math.round(nowMs() - bootStartedAt);
  diagnostics.record('boot:aplikacja', bootMs);
  logger.info('Interfejs gotowy.', {
    bootMs,
    source: bootReport.source,
    recovered: bootReport.recovered
  });

  // Ciężka praca po pierwszym malowaniu: pulpitu nie pobieramy blokująco,
  // a sprawdzenie modułów i migawka dzienna nie konkurują z interfejsem.
  // Pozostałe moduły wczytują się dopiero przy otwarciu zakładki (albo po
  // najechaniu na link) — dzięki temu start wysyła minimum zapytań.
  runWhenIdle(() => {
    prefetchDashboard();
    if (store) store.runMaintenance();
    if (!restored) return;
    diagnostics.runChecks(ctx).then(
      (results) => logger.info('Automatyczne sprawdzenie modułów zakończone.', {
        modules: results.length,
        errors: results.filter((entry) => entry.status === 'error').length
      }),
      (err) => logger.warn('Nie udało się sprawdzić modułów.', { error: err })
    );
  });

  setInterval(() => {
    if (!showingApp || !session) return;
    if (!session.isAuthenticated()) return;
    if (!session.checkValidity()) {
      logger.info('Sesja wygasła — wylogowano.');
      showAuth('Sesja wygasła z powodu bezczynności. Zaloguj się ponownie.');
      return;
    }
    session.touch();
  }, 60000);

  for (const eventName of ['pointerdown', 'keydown']) {
    document.addEventListener(eventName, () => {
      if (showingApp && session?.isAuthenticated()) session.touch();
    }, { passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    try {
      store.flush();
    } catch (err) {
      logger.warn('Nie udało się zapisać danych przy ukryciu karty.', { error: err });
    }
  });

  window.addEventListener('pagehide', () => {
    try {
      store.flush();
    } catch (err) {
      logger.warn('Nie udało się zapisać danych przy zamykaniu.', { error: err });
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (store && store.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = '';
      return '';
    }
    return undefined;
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').then(
      () => logger.info('Service worker zarejestrowany — tryb offline dostępny.'),
      (err) => logger.warn('Rejestracja service workera nie powiodła się.', { error: err })
    );
  }

  const wantsAutotest = new URLSearchParams(location.search).has('autotest')
    || /autotest/i.test(location.hash);
  if (wantsAutotest) {
    setTimeout(() => { runAutotest(); }, 350);
  }
}

/* Publiczny interfejs do diagnostyki i weryfikacji (np. z konsoli). */
globalThis.BSXS = {
  version: APP_VERSION,
  logger,
  diagnostics,
  get store() { return store; },
  get session() { return session; },
  get ctx() { return ctx; },
  get router() { return router; },
  runTests: async () => {
    const { runAllTests } = await import('./tests/suites.js');
    const summary = await runAllTests({ logger, ctx });
    if (store) store.setLastTestRun(summary);
    return summary;
  },
  navigate: (id) => router?.navigate(id),
  showApp
};

start().catch((err) => {
  logger.crash(err, { phase: 'start' });
  showFatal('Nie udało się uruchomić aplikacji', toMessage(err));
});
