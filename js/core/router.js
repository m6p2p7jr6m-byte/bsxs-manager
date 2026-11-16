/** Router oparty na hashu, z ochroną uprawnień i granicą błędów. */

import { el, clear, nowMs } from './util.js';
import { closeAllModals } from './ui.js';
import { toMessage } from './errors.js';

const RELOAD_FLAG = 'bsxs.reload-on-import-failure';

function looksLikeImportProblem(err) {
  const message = String(err?.message ?? '');
  return /export named|does not provide|dynamically imported|importing a module|unexpected token|unexpected identifier|unexpected string|unexpected number/i.test(message);
}

/**
 * Po aktualizacji aplikacji przeglądarka może mieć w cache nowy moduł ze starym
 * silnikiem — import wtedy zawodzi. Jedno automatyczne przeładowanie (z
 * zabezpieczeniem przed pętlą) pobiera spójny zestaw plików.
 */
function reloadOnceForLoadFailure(err) {
  if (!looksLikeImportProblem(err)) return false;
  if (!navigator.onLine) return false;
  try {
    if (window.sessionStorage.getItem(RELOAD_FLAG) === '1') return false;
    window.sessionStorage.setItem(RELOAD_FLAG, '1');
  } catch (error) {
    return false;
  }
  location.reload();
  return true;
}

export class Router {
  constructor({ outlet, resolve, canVisit, onDenied, context, logger = null }) {
    this.outlet = outlet;
    this.resolveModule = resolve;
    this.canVisit = canVisit;
    this.onDenied = onDenied;
    this.context = context;
    this.logger = logger;
    this.currentId = null;
    this.cleanup = null;
    this.renderToken = 0;
    this.handleHashChange = this.handleHashChange.bind(this);
  }

  parse() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    const id = raw.split('?')[0].trim();
    return id || 'dashboard';
  }

  start() {
    window.addEventListener('hashchange', this.handleHashChange);
    return this.render(this.parse());
  }

  stop() {
    window.removeEventListener('hashchange', this.handleHashChange);
    this._cleanup();
  }

  navigate(id) {
    const target = `#/${id}`;
    if (location.hash === target) {
      this.render(id);
      return;
    }
    location.hash = target;
  }

  handleHashChange() {
    this.render(this.parse());
  }

  _cleanup() {
    if (typeof this.cleanup === 'function') {
      try {
        this.cleanup();
      } catch (err) {
        if (this.logger) this.logger.warn('Błąd sprzątania widoku.', { error: err });
      }
    }
    this.cleanup = null;
  }

  async render(id) {
    const definition = this.resolveModule(id);
    if (!definition) {
      if (id !== 'dashboard') {
        this.navigate('dashboard');
      }
      return;
    }
    if (!this.canVisit(definition)) {
      this.onDenied(definition);
      return;
    }

    const token = ++this.renderToken;
    closeAllModals();
    this._cleanup();
    clear(this.outlet);
    document.title = `${definition.title} — BSXS Manager`;
    this.currentId = definition.id;

    const container = el('div', { class: 'view screen-enter' });
    this.outlet.appendChild(container);
    this.outlet.dataset.route = definition.id;

    if (this.context.onRouteChange) {
      try {
        this.context.onRouteChange(definition);
      } catch (err) {
        if (this.logger) this.logger.warn('Błąd aktualizacji nagłówka.', { error: err });
      }
    }

    let module = definition;
    if (typeof definition.mount !== 'function') {
      // Leniwe ładowanie: szkielet widoku pojawia się od razu, kod modułu
      // dojeżdża w tle — interfejs nigdy nie czeka na ciężki import.
      container.appendChild(el('div', {
        class: 'card',
        attrs: { role: 'status', 'aria-live': 'polite' }
      },
        el('div', {
          class: 'skeleton',
          style: { height: '14px', width: '45%' },
          attrs: { 'aria-hidden': 'true' }
        }),
        el('div', {
          class: 'skeleton',
          style: { height: '14px', width: '70%', marginTop: '10px' },
          attrs: { 'aria-hidden': 'true' }
        }),
        el('div', {
          class: 'view__sub',
          style: { marginTop: '12px' },
          text: `Ładowanie widoku „${definition.title}”…`
        })
      ));

      try {
        module = await definition.load();
      } catch (err) {
        if (this.logger) this.logger.crash(err, { view: definition.id, phase: 'load' });
        if (reloadOnceForLoadFailure(err)) return;
        if (token !== this.renderToken) return;
        clear(container);
        container.appendChild(el('div', { class: 'card' },
          el('h2', { text: 'Nie udało się wczytać widoku' }),
          el('p', { class: 'view__sub', text: toMessage(err) }),
          el('p', {
            class: 'view__sub',
            text: 'Jeśli zdarzyło się to po aktualizacji aplikacji, odśwież stronę — przeglądarka mogła trzymać starszą wersję plików.'
          }),
          el('div', { class: 'view__tools' },
            el('button', {
              class: 'btn btn--primary',
              type: 'button',
              on: { click: () => this.render(definition.id) }
            }, 'Spróbuj ponownie'),
            el('button', {
              class: 'btn',
              type: 'button',
              on: { click: () => location.reload() }
            }, 'Odśwież aplikację')
          )
        ));
        return;
      }

      if (token !== this.renderToken) return;
      clear(container);
    }

    try {
      const start = nowMs();
      const result = await this.context.diagnostics.measure(`mount:${definition.id}`, () => module.mount(container, this.context));
      const elapsed = nowMs() - start;
      if (elapsed > 800 && this.logger) {
        this.logger.warn(`Widok „${definition.title}” otwierał się ${Math.round(elapsed)} ms.`);
      }
      if (token !== this.renderToken) {
        if (typeof result === 'function') result();
        return;
      }
      if (typeof result === 'function') this.cleanup = result;
      if (this.context.persistLastRoute) this.context.persistLastRoute(definition.id);
    } catch (err) {
      if (this.logger) this.logger.crash(err, { view: definition.id });
      clear(container);
      container.appendChild(el('div', { class: 'card' },
        el('h2', { text: 'Nie udało się otworzyć widoku' }),
        el('p', { class: 'view__sub', text: toMessage(err) }),
        el('button', {
          class: 'btn btn--primary',
          type: 'button',
          on: { click: () => this.render(definition.id) }
        }, 'Spróbuj ponownie')
      ));
    }
  }
}
