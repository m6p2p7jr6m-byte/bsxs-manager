/** Wspólne elementy widoków: nagłówek strony, wyszukiwarka, pasek narzędzi. */

import { el } from '../core/util.js';

export function pageHeader({ title, sub = '', tools = [] }) {
  return el('div', { class: 'view__head' },
    el('div', { class: 'view__head-main' },
      el('h1', { text: title }),
      sub ? el('div', { class: 'view__sub', text: sub }) : null
    ),
    tools.length ? el('div', { class: 'view__tools' }, tools.filter(Boolean)) : null
  );
}

export function searchBox({ placeholder = 'Szukaj…', label = 'Szukaj', onInput, delay = 200 }) {
  const input = el('input', {
    type: 'search',
    placeholder,
    attrs: { 'aria-label': label, autocomplete: 'off' }
  });
  let timer = null;
  const emit = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onInput(input.value);
    }, delay);
  };
  input.addEventListener('input', emit);
  input.addEventListener('search', emit);
  return el('div', { class: 'search' },
    el('span', { class: 'search__icon', attrs: { 'aria-hidden': 'true' }, text: '⌕' }),
    input
  );
}

export function selectFilter({ label, options, value, onChange }) {
  const select = el('select', { attrs: { 'aria-label': label } },
    options.map((option) => el('option', { value: option.value }, option.label))
  );
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function toolbar(...children) {
  return el('div', { class: 'view__tools', style: { marginBottom: 'var(--space-3)' } }, children.filter(Boolean));
}

export function muted(text) {
  return el('span', { class: 'view__sub', text });
}

/** Otwiera systemowy wybór pliku i zwraca wybrany plik (lub null). */
export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', attrs: { accept }, style: { display: 'none' } });
    const cleanup = () => {
      input.remove();
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      cleanup();
      resolve(file || null);
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function confirmNote(text) {
  return el('div', { class: 'notice', text });
}
