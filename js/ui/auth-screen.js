/** Ekran logowania, rejestracji, resetu hasła i kodu odzyskiwania. */

import { clear, copyText, el, frag } from '../core/util.js';
import { AuthError, toMessage } from '../core/errors.js';
import { badge, modal } from '../core/ui.js';

function authField({ id, label, type = 'text', value = '', autocomplete = 'off', hint = '', inputmode = null }) {
  const input = el('input', {
    id,
    type,
    autocomplete,
    inputmode: inputmode ?? undefined
  });
  input.value = value;
  return {
    input,
    node: el('div', { class: 'field' },
      el('label', { class: 'field__label', attrs: { for: id }, text: label }),
      input,
      hint ? el('div', { class: 'field__hint', text: hint }) : null
    )
  };
}

function errorBox() {
  const box = el('div', { class: 'modal__error', attrs: { role: 'alert' } });
  box.hidden = true;
  return box;
}

function showError(box, message) {
  box.textContent = message;
  box.hidden = false;
}

export function renderAuth({ root, ctx, onAuthenticated, notice = '' }) {
  clear(root);
  root.hidden = false;

  const container = el('div', { class: 'auth' });
  root.appendChild(container);

  const hasUsers = ctx.store.state.users.length > 0;
  const state = {
    mode: hasUsers ? 'login' : 'register',
    mfaRequired: false,
    lastUsername: '',
    banner: notice,
    recovery: null
  };

  function brand() {
    return el('div', { class: 'auth__brand' },
      el('div', { class: 'brand__dot', attrs: { 'aria-hidden': 'true' } }, 'BS'),
      el('div', {},
        el('div', { class: 'brand__name', text: 'BSXS Manager' }),
        el('div', { class: 'brand__sub', text: 'XARO / BSXS' })
      )
    );
  }

  function card(title, subtitle, content, foot) {
    return el('div', { class: 'auth__card' },
      brand(),
      el('h1', { class: 'auth__title', text: title }),
      el('p', { class: 'auth__sub', text: subtitle }),
      state.banner ? el('div', { class: 'notice notice--ok', text: state.banner }) : null,
      content,
      foot
    );
  }

  function loginView() {
    const box = errorBox();
    const username = authField({
      id: 'login-username',
      label: 'Nazwa użytkownika',
      value: state.lastUsername,
      autocomplete: 'username'
    });
    const password = authField({
      id: 'login-password',
      label: 'Hasło',
      type: 'password',
      autocomplete: 'current-password'
    });
    const code = state.mfaRequired
      ? authField({
        id: 'login-code',
        label: 'Kod MFA',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        hint: '6 cyfr z aplikacji uwierzytelniającej.'
      })
      : null;

    const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Zaloguj się');

    const form = el('form', { attrs: { novalidate: 'novalidate' } },
      box,
      username.node,
      password.node,
      code ? code.node : null,
      submit
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      box.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Logowanie…';
      try {
        const user = await ctx.session.login({
          username: username.input.value,
          password: password.input.value,
          code: code ? code.input.value : ''
        });
        ctx.toast(`Witaj, ${user.displayName}.`, 'ok');
        onAuthenticated();
      } catch (err) {
        if (err instanceof AuthError && err.kind === 'mfa' && !state.mfaRequired) {
          state.mfaRequired = true;
          state.lastUsername = username.input.value;
          state.banner = '';
          render('To konto jest chronione kodem MFA.');
          return;
        }
        showError(box, toMessage(err));
        if (err instanceof AuthError && err.kind === 'credentials') {
          password.input.value = '';
          password.input.focus();
        }
      } finally {
        submit.disabled = false;
        submit.textContent = 'Zaloguj się';
      }
    });

    const foot = el('div', { class: 'auth__foot' },
      el('button', {
        class: 'link-btn',
        type: 'button',
        on: { click: () => { state.mode = 'reset'; state.banner = ''; render(); } }
      }, 'Nie pamiętam hasła'),
      hasUsers
        ? el('span', { class: 'view__sub', text: 'Nowe konta zakłada właściciel w module Bezpieczeństwo.' })
        : null
    );

    return card(
      'Zaloguj się',
      'Centrum zarządzania karierą XARO i kolektywu BSXS.',
      form,
      foot
    );
  }

  function registerView() {
    const box = errorBox();
    const displayName = authField({ id: 'reg-display', label: 'Imię / nazwa', autocomplete: 'nickname' });
    const username = authField({
      id: 'reg-username',
      label: 'Nazwa użytkownika',
      autocomplete: 'username',
      hint: '3–32 znaki: małe litery, cyfry, kropka, myślnik, podkreślenie.'
    });
    const password = authField({
      id: 'reg-password',
      label: 'Hasło',
      type: 'password',
      autocomplete: 'new-password',
      hint: 'Minimum 10 znaków, litera i cyfra.'
    });
    const confirm = authField({
      id: 'reg-confirm',
      label: 'Powtórz hasło',
      type: 'password',
      autocomplete: 'new-password'
    });
    const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Utwórz konto właściciela');

    const form = el('form', { attrs: { novalidate: 'novalidate' } },
      box,
      el('div', { class: 'notice', text: 'To pierwsze uruchomienie — tworzysz konto właściciela z pełnym dostępem.' }),
      displayName.node,
      username.node,
      password.node,
      confirm.node,
      submit
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      box.hidden = true;
      if (password.input.value !== confirm.input.value) {
        showError(box, 'Hasła nie są identyczne.');
        confirm.input.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Tworzenie konta…';
      try {
        const result = await ctx.session.register({
          displayName: displayName.input.value,
          username: username.input.value,
          password: password.input.value
        });
        state.lastUsername = result.user.username;
        await ctx.session.login({
          username: username.input.value,
          password: password.input.value
        });
        state.recovery = { code: result.recoveryCode, next: 'app' };
        state.mode = 'recovery';
        state.banner = '';
        render();
      } catch (err) {
        showError(box, toMessage(err));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Utwórz konto właściciela';
      }
    });

    return card(
      'Pierwsze uruchomienie',
      'Utwórz konto właściciela BSXS Manager.',
      form,
      el('div', { class: 'auth__foot' },
        el('span', { class: 'view__sub', text: 'Hasła są przechowywane jako PBKDF2-SHA256 z losową solą.' })
      )
    );
  }

  function resetView() {
    const box = errorBox();
    const username = authField({
      id: 'reset-username',
      label: 'Nazwa użytkownika',
      value: state.lastUsername,
      autocomplete: 'username'
    });
    const recovery = authField({
      id: 'reset-code',
      label: 'Kod odzyskiwania',
      hint: 'Format XXXXX-XXXXX-XXXXX-XXXXX.'
    });
    const password = authField({
      id: 'reset-password',
      label: 'Nowe hasło',
      type: 'password',
      autocomplete: 'new-password',
      hint: 'Minimum 10 znaków, litera i cyfra.'
    });
    const confirm = authField({
      id: 'reset-confirm',
      label: 'Powtórz nowe hasło',
      type: 'password',
      autocomplete: 'new-password'
    });
    const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Zresetuj hasło');

    const form = el('form', { attrs: { novalidate: 'novalidate' } },
      box,
      el('div', { class: 'notice notice--warn', text: 'Reset unieważni wszystkie sesje i wyłączy MFA. Kod odzyskiwania zostanie zastąpiony nowym.' }),
      username.node,
      recovery.node,
      password.node,
      confirm.node,
      submit
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      box.hidden = true;
      if (password.input.value !== confirm.input.value) {
        showError(box, 'Hasła nie są identyczne.');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Resetowanie…';
      try {
        const result = await ctx.session.resetWithRecoveryCode({
          username: username.input.value,
          recoveryCode: recovery.input.value,
          newPassword: password.input.value
        });
        state.recovery = { code: result.recoveryCode, next: 'login' };
        state.lastUsername = username.input.value.trim().toLowerCase();
        state.mode = 'recovery';
        state.banner = '';
        render();
      } catch (err) {
        showError(box, toMessage(err));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Zresetuj hasło';
      }
    });

    return card(
      'Reset hasła',
      'Użyj jednorazowego kodu odzyskiwania.',
      form,
      el('div', { class: 'auth__foot' },
        el('button', {
          class: 'link-btn',
          type: 'button',
          on: { click: () => { state.mode = 'login'; state.banner = ''; render(); } }
        }, 'Wróć do logowania')
      )
    );
  }

  function recoveryView() {
    const code = state.recovery?.code ?? '';
    const box = el('div', { class: 'code', text: code });
    const acknowledged = el('input', { type: 'checkbox', id: 'recovery-ack' });
    const continueButton = el('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      disabled: true
    }, 'Kontynuuj');

    acknowledged.addEventListener('change', () => {
      continueButton.disabled = !acknowledged.checked;
    });

    continueButton.addEventListener('click', () => {
      const next = state.recovery?.next ?? 'login';
      state.recovery = null;
      state.banner = '';
      if (next === 'app') {
        onAuthenticated();
        return;
      }
      state.mode = 'login';
      state.mfaRequired = false;
      state.banner = 'Hasło zostało zmienione. Zaloguj się nowym hasłem.';
      render();
    });

    const content = frag(
      el('div', { class: 'notice notice--warn', text: 'Ten kod zobaczysz tylko raz. Zapisz go w bezpiecznym miejscu — pozwala odzyskać konto.' }),
      box,
      el('button', {
        class: 'btn btn--block',
        type: 'button',
        style: { marginTop: 'var(--space-3)' },
        on: {
          click: () => copyText(code, {
            onSuccess: () => ctx.toast('Kod skopiowany do schowka.', 'ok'),
            onError: () => ctx.toast('Nie udało się skopiować — zapisz kod ręcznie.', 'error')
          })
        }
      }, 'Kopiuj kod'),
      el('label', { class: 'check' },
        acknowledged,
        el('span', { text: 'Zapisałem kod w bezpiecznym miejscu.' })
      ),
      continueButton
    );

    return card('Kod odzyskiwania', 'Jednorazowy klucz do resetu hasła.', content, null);
  }

  function runSelfTests() {
    const instance = modal({
      title: 'Testy systemowe',
      wide: true,
      content: el('p', { class: 'view__sub', text: 'Uruchamianie testów… Może to potrwać kilka sekund.' })
    });
    import('../tests/suites.js').then(async ({ runAllTests }) => {
      const summary = await runAllTests({ logger: ctx.logger, ctx });
      clear(instance.body);
      const failures = summary.suites.flatMap((suite) => suite.tests
        .filter((test) => test.status === 'failed')
        .map((test) => `✗ ${suite.name}: ${test.name} — ${test.message}`));
      const skips = summary.suites.flatMap((suite) => suite.tests
        .filter((test) => test.status === 'skipped')
        .map((test) => `– ${suite.name}: ${test.name} — ${test.message}`));
      instance.body.append(
        summary.failed
          ? el('div', { class: 'modal__error', text: `${summary.failed} testów niezaliczonych` })
          : el('div', { class: 'notice notice--ok', text: `Wszystkie ${summary.passed} testów zaliczone.` }),
        el('p', {
          class: 'view__sub',
          text: `${summary.passed}/${summary.total} zaliczonych · ${summary.skipped} pominiętych · ${Math.round(summary.durationMs)} ms`
        }),
        el('pre', { class: 'code', text: [...failures, ...skips].join('\n') || 'Brak błędów i pominięć.' })
      );
    }).catch((err) => {
      clear(instance.body);
      instance.body.append(el('div', { class: 'modal__error', text: toMessage(err) }));
    });
  }

  function render(message = '') {
    clear(container);
    if (message) state.banner = message;
    let view;
    if (state.mode === 'register') view = registerView();
    else if (state.mode === 'reset') view = resetView();
    else if (state.mode === 'recovery') view = recoveryView();
    else view = loginView();

    container.appendChild(view);
    container.appendChild(el('div', {
      class: 'auth__foot',
      style: { justifyContent: 'center', marginTop: 'var(--space-4)' }
    },
      badge(`BSXS Manager`, 'accent'),
      el('span', { class: 'view__sub', text: location.protocol === 'https:' ? 'Połączenie HTTPS' : 'Uwaga: połączenie bez HTTPS' }),
      el('button', {
        class: 'link-btn',
        type: 'button',
        on: { click: runSelfTests }
      }, 'Testy systemowe')
    ));
    state.banner = '';
  }

  render();
}
