/** Komponenty interfejsu: toasty, modale, formularze, paginacja, wykresy. */

import { AppError, ValidationError, isAppError, toMessage } from './errors.js';
import { clamp, el, frag, fmtNumber } from './util.js';

let toastCounter = 0;

export function resolveAnimationLevel(preference) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (preference === 'off') return 'off';
  if (preference === 'limited') return 'limited';
  if (reduced) return 'limited';
  return 'on';
}

export function applyAnimationLevel(preference) {
  const effective = resolveAnimationLevel(preference);
  document.documentElement.dataset.anim = effective;
  return effective;
}

export function toast(message, kind = 'info', { duration = 4200 } = {}) {
  const container = document.getElementById('toasts');
  if (!container) return null;
  const id = `toast-${++toastCounter}`;
  const close = () => {
    node.remove();
  };
  const node = el('div', {
    class: `toast toast--${kind}`,
    attrs: { role: kind === 'error' ? 'alert' : 'status', id }
  },
    el('div', { class: 'toast__text', text: String(message ?? '') }),
    el('button', {
      class: 'toast__close',
      type: 'button',
      attrs: { 'aria-label': 'Zamknij powiadomienie' },
      on: { click: close }
    }, '×')
  );
  container.appendChild(node);
  if (duration > 0) setTimeout(close, duration);
  return { node, close };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openModals = new Set();

/** Zamyka wszystkie otwarte okna — wywoływane przy zmianie widoku. */
export function closeAllModals() {
  for (const close of Array.from(openModals)) {
    try {
      close();
    } catch (err) {
      console.warn('Nie udało się zamknąć okna modalnego', err);
    }
  }
}

export function modal({ title, content, footer = null, wide = false, dismissible = true, onClose = null }) {
  const container = document.getElementById('modal-root');
  if (!container) throw new AppError('Brak kontenera okien modalnych.', 'ui_modal');

  const previousFocus = document.activeElement;
  const titleId = `modal-title-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
  let closed = false;

  const body = el('div', { class: 'modal__body' }, content);
  const dialog = el('div', {
    class: `modal${wide ? ' modal--wide' : ''}`,
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1'
    }
  });

  const head = el('div', { class: 'modal__head' },
    el('h2', { class: 'modal__title', text: title, attrs: { id: titleId } }),
    dismissible ? el('button', {
      class: 'icon-btn',
      type: 'button',
      attrs: { 'aria-label': 'Zamknij okno' },
      on: { click: () => close() }
    }, '×') : null
  );

  dialog.appendChild(head);
  dialog.appendChild(body);
  if (footer) dialog.appendChild(el('div', { class: 'modal__foot' }, footer));

  const backdrop = el('div', { class: 'modal-backdrop' }, dialog);

  function onKeyDown(event) {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter(
      (node) => node.offsetParent !== null || node === dialog
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onBackdropClick(event) {
    if (event.target === backdrop && dismissible) close();
  }

  function close() {
    if (closed) return;
    closed = true;
    openModals.delete(close);
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.removeEventListener('mousedown', onBackdropClick);
    backdrop.remove();
    // Fokus po zamknięciu potrafi przewinąć stronę w poziomie (iOS/WebKit) —
    // przywracamy poziome przesunięcie do zera, zachowując pozycję pionową.
    try {
      document.documentElement.scrollLeft = 0;
      if (document.body) document.body.scrollLeft = 0;
      if (window.scrollX !== 0) window.scrollTo({ left: 0, top: window.scrollY, behavior: 'auto' });
      const scroller = document.querySelector('.main');
      if (scroller) scroller.scrollLeft = 0;
    } catch (err) {
      console.warn('Nie udało się zresetować przesunięcia po zamknięciu okna', err);
    }
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try {
        previousFocus.focus();
      } catch (err) {
        // Element mógł zniknąć z DOM — brak akcji.
      }
    }
    if (onClose) onClose();
  }

  document.addEventListener('keydown', onKeyDown, true);
  backdrop.addEventListener('mousedown', onBackdropClick);
  container.appendChild(backdrop);
  openModals.add(close);
  setTimeout(() => {
    try {
      dialog.focus({ preventScroll: true });
    } catch (err) {
      // Brak akcji — fokus pozostaje na poprzednim elemencie.
    }
  }, 20);

  return { close, dialog, body, backdrop };
}

export function confirmAction({
  title,
  message,
  confirmLabel = 'Potwierdź',
  cancelLabel = 'Anuluj',
  danger = false,
  note = null,
  requireText = null
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const input = requireText !== null
      ? el('input', { type: 'text', autocomplete: 'off', attrs: { 'aria-label': 'Pole potwierdzenia' } })
      : null;

    const confirmButton = el('button', {
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      type: 'button',
      disabled: Boolean(requireText)
    }, confirmLabel);

    const cancelButton = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      on: { click: () => instance.close() }
    }, cancelLabel);

    if (input) {
      input.addEventListener('input', () => {
        confirmButton.disabled = input.value.trim() !== requireText;
      });
    }

    const content = frag(
      el('p', { text: message }),
      note ? el('div', { class: 'notice notice--warn', text: note }) : null,
      requireText !== null
        ? el('div', { class: 'field' },
          el('label', { class: 'field__label', text: `Wpisz „${requireText}”, aby potwierdzić` }),
          input
        )
        : null
    );

    const instance = modal({
      title,
      content,
      footer: frag(cancelButton, confirmButton),
      onClose: () => finish(false)
    });

    confirmButton.addEventListener('click', () => {
      finish(true);
      instance.close();
    });

    if (input) setTimeout(() => input.focus(), 40);
  });
}

/**
 * Modalny formularz z walidacją i obsługą błędów.
 * onSubmit może być asynchroniczny; wyjątek ValidationError pokazujemy w oknie.
 */
export function formModal({
  title,
  fields,
  submitLabel = 'Zapisz',
  cancelLabel = 'Anuluj',
  danger = false,
  wide = false,
  description = null,
  onChange = null,
  onSubmit
}) {
  return new Promise((resolve) => {
    let settled = false;
    let instance = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    if (typeof onSubmit !== 'function') {
      finish(false);
      return;
    }

    const formId = `form-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const errorBox = el('div', { class: 'modal__error', attrs: { role: 'alert' } });
    errorBox.hidden = true;

    const form = el('form', { id: formId, attrs: { novalidate: 'novalidate', autocomplete: 'off' } });
    const controls = [];

    for (const field of fields) {
      const id = `field_${field.name}`;
      if (field.type === 'checkbox') {
        const control = el('input', {
          id,
          type: 'checkbox',
          name: field.name,
          checked: Boolean(field.value)
        });
        controls.push({ field, control });
        form.appendChild(el('label', { class: 'check' },
          control,
          el('span', { text: field.label })
        ));
        if (field.hint) form.appendChild(el('div', { class: 'field__hint', text: field.hint }));
        continue;
      }

      let control;
      if (field.type === 'select') {
        control = el('select', { id, name: field.name },
          (field.options || []).map((option) => {
            const value = typeof option === 'string' ? option : option.value;
            const label = typeof option === 'string' ? option : (option.label ?? option.value);
            return el('option', { value }, label);
          })
        );
        control.value = field.value ?? '';
      } else if (field.type === 'textarea') {
        control = el('textarea', {
          id,
          name: field.name,
          rows: String(field.rows ?? 4),
          placeholder: field.placeholder ?? ''
        });
        control.value = field.value ?? '';
      } else {
        control = el('input', {
          id,
          name: field.name,
          type: field.type || 'text',
          placeholder: field.placeholder ?? '',
          inputmode: field.type === 'number' ? 'decimal' : undefined,
          autocomplete: field.autocomplete ?? 'off'
        });
        control.value = field.value ?? '';
      }

      controls.push({ field, control });
      form.appendChild(el('div', { class: 'field' },
        el('label', { class: 'field__label', attrs: { for: id } },
          field.label,
          field.required ? el('span', { text: ' *' }) : null
        ),
        control,
        field.hint ? el('div', { class: 'field__hint', text: field.hint }) : null
      ));
    }

    function readValues() {
      const values = {};
      for (const { field, control } of controls) {
        values[field.name] = field.type === 'checkbox' ? control.checked : control.value;
      }
      return values;
    }

    // Przycisk jest w stopce modala (poza <form>), więc wiążemy go atrybutem form.
    const submitButton = el('button', {
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
      type: 'submit',
      attrs: { form: formId }
    }, submitLabel);

    const cancelButton = el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      on: { click: () => instance?.close() }
    }, cancelLabel);

    if (typeof onChange === 'function') {
      form.addEventListener('input', () => {
        try {
          onChange(readValues());
        } catch (err) {
          console.warn('formModal: błąd autozapisu szkicu', err);
        }
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const originalLabel = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.textContent = 'Zapisywanie…';
      try {
        const result = await onSubmit(readValues(), { form, close: () => instance?.close() });
        finish(result ?? true);
        instance?.close();
      } catch (err) {
        errorBox.textContent = toMessage(err);
        errorBox.hidden = false;
        if (!isAppError(err)) console.error(err);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    });

    instance = modal({
      title,
      content: frag(
        description ? el('p', { class: 'view__sub', text: description }) : null,
        errorBox,
        form
      ),
      footer: frag(cancelButton, submitButton),
      wide,
      onClose: () => finish(false)
    });

    setTimeout(() => {
      const firstText = controls.find(({ field }) => field.type !== 'checkbox');
      const target = firstText || controls[0];
      if (target) {
        try {
          target.control.focus({ preventScroll: true });
        } catch (err) {
          target.control.focus();
        }
      }
    }, 40);
  });
}

export function pagination({ page, pages, total, from, to, onChange, label = 'rekordów' }) {
  return el('div', { class: 'pagination' },
    el('div', {
      text: total === 0
        ? 'Brak wyników'
        : `Pokazano ${fmtNumber(from)}–${fmtNumber(to)} z ${fmtNumber(total)} ${label}`
    }),
    el('div', { class: 'pagination__controls' },
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        disabled: page <= 1,
        attrs: { 'aria-label': 'Poprzednia strona' },
        on: { click: () => onChange(page - 1) }
      }, '← Poprzednia'),
      el('span', { class: 'num', text: `${page} / ${pages}` }),
      el('button', {
        class: 'btn btn--sm',
        type: 'button',
        disabled: page >= pages,
        attrs: { 'aria-label': 'Następna strona' },
        on: { click: () => onChange(page + 1) }
      }, 'Następna →')
    )
  );
}

export function emptyState({ title, hint = '', actionLabel = null, onAction = null }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty__title', text: title }),
    hint ? el('div', { class: 'empty__hint', text: hint }) : null,
    actionLabel && onAction
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: onAction } }, actionLabel)
      : null
  );
}

export function statCard({ label, value, hint = '' }) {
  return el('div', { class: 'card' },
    el('div', { class: 'stat__label', text: label }),
    el('div', { class: 'stat__value', text: String(value) }),
    hint ? el('div', { class: 'stat__hint', text: hint }) : null
  );
}

export function badge(text, kind = '') {
  return el('span', { class: `badge${kind ? ` badge--${kind}` : ''}` },
    el('span', { class: 'badge__dot', attrs: { 'aria-hidden': 'true' } }),
    text
  );
}

export function chart(values, { alt = false, label = 'Wartości' } = {}) {
  const list = (values || []).map((value) => Number(value) || 0);
  const max = Math.max(1, ...list);
  const bars = list.map((value, index) => el('div', {
    class: `chart__bar${alt ? ' chart__bar--alt' : ''}`,
    style: { height: `${clamp(Math.round((value / max) * 100), 3, 100)}%` },
    attrs: {
      title: `${index + 1}: ${value}`,
      'aria-hidden': 'true'
    }
  }));
  return el('div', { class: 'chart', attrs: { role: 'img', 'aria-label': label } }, bars);
}

export async function withBusy(button, task) {
  if (!button) return task();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '';
  button.appendChild(el('span', { class: 'btn__spinner', attrs: { 'aria-hidden': 'true' } }));
  button.appendChild(document.createTextNode(' Proszę czekać…'));
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function createTabs({ items, active, onChange, labelledBy = null }) {
  const tablist = el('div', {
    class: 'tabs',
    attrs: { role: 'tablist', ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}) }
  });
  for (const item of items) {
    const selected = item.id === active;
    tablist.appendChild(el('button', {
      class: 'tab',
      type: 'button',
      attrs: {
        role: 'tab',
        'aria-selected': selected ? 'true' : 'false',
        'data-tab': item.id
      },
      on: { click: () => onChange(item.id) }
    }, item.label));
  }
  return tablist;
}

export function fieldLabel(text, forId) {
  return el('label', { class: 'field__label', attrs: { for: forId }, text });
}
