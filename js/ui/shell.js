/** Szkielet aplikacji: nawigacja, nagłówek, wylogowanie. */

import { clear, el } from '../core/util.js';
import { ROLE_LABELS } from '../core/authz.js';
import { modal } from '../core/ui.js';

const GROUP_ORDER = ['Praca', 'Zespół', 'System'];

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

export function renderShell({ root, ctx, modules, onLogout }) {
  clear(root);
  root.hidden = false;

  const user = ctx.session.user;
  if (!user) throw new Error('Nie można zbudować interfejsu bez zalogowanego użytkownika.');

  const allowed = modules.filter(
    (module) => !module.permission || ctx.session.can(module.permission)
  );
  const linkRegistry = new Map();

  const registerLink = (id, node) => {
    if (!linkRegistry.has(id)) linkRegistry.set(id, []);
    linkRegistry.get(id).push(node);
    return node;
  };

  function navLink(module, { mobile = false } = {}) {
    const node = el('a', {
      class: mobile ? 'mobile-nav__link' : 'nav__link',
      href: `#/${module.id}`,
      attrs: { 'data-route': module.id },
      on: {
        pointerenter: () => ctx.prefetch?.(module.id),
        focus: () => ctx.prefetch?.(module.id)
      }
    },
      mobile
        ? el('span', { class: 'mobile-nav__icon', attrs: { 'aria-hidden': 'true' }, text: module.icon })
        : el('span', { class: 'nav__icon', attrs: { 'aria-hidden': 'true' }, text: module.icon }),
      el('span', { text: mobile ? module.shortTitle || module.title : module.title })
    );
    return registerLink(module.id, node);
  }

  const navGroups = GROUP_ORDER.map((group) => {
    const items = allowed.filter((module) => (module.group || 'Praca') === group);
    if (!items.length) return null;
    return el('div', {},
      el('div', { class: 'nav__group', text: group }),
      items.map((module) => navLink(module))
    );
  }).filter(Boolean);

  const logoutButton = el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    on: {
      click: () => {
        try {
          ctx.session.logout();
        } finally {
          onLogout();
        }
      }
    }
  }, 'Wyloguj');

  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand__dot', attrs: { 'aria-hidden': 'true' } }, 'BS'),
      el('div', {},
        el('div', { class: 'brand__name', text: 'BSXS Manager' }),
        el('div', { class: 'brand__sub', text: 'XARO / BSXS' })
      )
    ),
    el('nav', { class: 'nav', attrs: { 'aria-label': 'Nawigacja główna' } }, navGroups),
    el('div', { class: 'sidebar__foot' },
      el('div', { class: 'list__item', style: { background: 'var(--surface)', padding: '8px' } },
        el('div', { class: 'brand__dot', style: { width: '30px', height: '30px', fontSize: '0.65rem' }, attrs: { 'aria-hidden': 'true' } }, initials(user.displayName)),
        el('div', { class: 'list__main' },
          el('div', { class: 'list__title', text: user.displayName }),
          el('div', { class: 'list__meta', text: ROLE_LABELS[user.role] || user.role })
        )
      ),
      logoutButton
    )
  );

  const titleElement = el('div', { class: 'topbar__title', attrs: { 'aria-live': 'polite' }, text: '' });
  const outlet = el('main', {
    id: 'main',
    class: 'outlet',
    attrs: { tabindex: '-1' }
  });

  const topbar = el('header', { class: 'topbar' },
    titleElement,
    el('div', { class: 'topbar__spacer' }),
    el('div', { class: 'topbar__actions' },
      el('span', { class: 'badge badge--accent', text: ROLE_LABELS[user.role] || user.role })
    )
  );

  const main = el('div', { class: 'main' }, topbar, outlet);

  const mobileNav = el('nav', {
    class: 'mobile-nav',
    attrs: { 'aria-label': 'Nawigacja mobilna' }
  },
    allowed.slice(0, 4).map((module) => navLink(module, { mobile: true })),
    el('button', {
      class: 'mobile-nav__link',
      type: 'button',
      attrs: { 'aria-label': 'Otwórz pełne menu' },
      on: { click: () => openMobileMenu() }
    },
      el('span', { class: 'mobile-nav__icon', attrs: { 'aria-hidden': 'true' }, text: '≡' }),
      el('span', { text: 'Menu' })
    )
  );

  function openMobileMenu() {
    const instance = modal({
      title: 'Menu',
      content: el('div', { class: 'list' }, allowed.map((module) => el('button', {
        class: 'list__item',
        type: 'button',
        style: { width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' },
        on: {
          click: () => {
            instance.close();
            ctx.navigate(module.id);
          }
        }
      },
        el('span', { class: 'nav__icon', attrs: { 'aria-hidden': 'true' }, text: module.icon }),
        el('span', { class: 'list__main', style: { display: 'grid', gap: '2px', textAlign: 'left' } },
          el('span', { class: 'list__title', text: module.title }),
          module.group ? el('span', { class: 'list__meta', text: module.group }) : null
        )
      )))
    });
  }

  root.appendChild(sidebar);
  root.appendChild(main);
  root.appendChild(mobileNav);

  const skipLink = document.querySelector('.skip-link');
  if (skipLink) {
    skipLink.addEventListener('click', (event) => {
      event.preventDefault();
      outlet.focus();
    });
  }

  function setActive(routeId) {
    for (const [id, nodes] of linkRegistry.entries()) {
      for (const node of nodes) {
        if (id === routeId) node.setAttribute('aria-current', 'page');
        else node.removeAttribute('aria-current');
      }
    }
  }

  function setTitle(title) {
    titleElement.textContent = title;
  }

  function resetScroll() {
    main.scrollTop = 0;
  }

  return { outlet, setActive, setTitle, resetScroll };
}
