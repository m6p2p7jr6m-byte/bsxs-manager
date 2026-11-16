import { clear, copyText, el, fmtDateTime } from '../core/util.js';
import { AuthError, isAppError, toMessage } from '../core/errors.js';
import {
  badge, confirmAction, formModal, modal, toast
} from '../core/ui.js';
import * as validate from '../core/validate.js';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from '../core/authz.js';
import { pageHeader } from '../ui/page.js';

export default {
  id: 'security',
  title: 'Bezpieczeństwo',
  shortTitle: 'Ochrona',
  icon: '⛨',
  group: 'System',
  permission: 'security:read',

  mount(root, ctx) {
    const host = el('div');
    root.appendChild(pageHeader({
      title: 'Bezpieczeństwo',
      sub: 'Hasła, MFA, sesje, użytkownicy i polityka dostępu.'
    }));
    root.appendChild(host);

    async function openChangePassword() {
      const saved = await formModal({
        title: 'Zmiana hasła',
        description: 'Po zmianie hasła wszystkie pozostałe sesje zostaną unieważnione.',
        fields: [
          { name: 'current', label: 'Obecne hasło', type: 'password', autocomplete: 'current-password' },
          { name: 'next', label: 'Nowe hasło', type: 'password', autocomplete: 'new-password', hint: 'Minimum 10 znaków, litera i cyfra.' },
          { name: 'confirm', label: 'Powtórz nowe hasło', type: 'password', autocomplete: 'new-password' }
        ],
        submitLabel: 'Zmień hasło',
        onSubmit: async (raw) => {
          if (raw.next !== raw.confirm) throw new validate.ValidationError('Nowe hasła nie są identyczne.');
          await ctx.session.changePassword(raw.current, raw.next);
          ctx.toast('Hasło zmienione.', 'ok');
          return true;
        }
      });
      if (saved) draw();
    }

    async function startMfa() {
      const stepOne = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        formModal({
          title: 'Włącz MFA — krok 1',
          description: 'Potwierdź hasło, aby wygenerować sekret TOTP.',
          fields: [{ name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' }],
          submitLabel: 'Generuj sekret',
          onSubmit: async (raw) => {
            try {
              const result = await ctx.session.startMfaSetup(raw.password);
              finish(result);
              return true;
            } catch (err) {
              if (err instanceof AuthError) throw err;
              throw err;
            }
          }
        }).then((ok) => {
          if (!ok) finish(null);
        });
      });
      if (!stepOne) return;

      await formModal({
        title: 'Włącz MFA — krok 2',
        description: `Sekret TOTP: ${stepOne.secret} · URI: ${stepOne.otpauth}`,
        fields: [
          { name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' },
          { name: 'code', label: 'Kod z aplikacji (6 cyfr)', type: 'text', inputmode: 'numeric', hint: 'Sekret dodaj w aplikacji uwierzytelniającej.' }
        ],
        submitLabel: 'Włącz MFA',
        onSubmit: async (raw) => {
          await ctx.session.confirmMfa({ password: raw.password, code: raw.code });
          ctx.toast('MFA włączone.', 'ok');
          return true;
        }
      });
      draw();
    }

    async function disableMfa() {
      const saved = await formModal({
        title: 'Wyłącz MFA',
        description: 'Wymagane jest hasło oraz aktualny kod TOTP.',
        fields: [
          { name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' },
          { name: 'code', label: 'Kod z aplikacji', type: 'text', inputmode: 'numeric' }
        ],
        submitLabel: 'Wyłącz MFA',
        danger: true,
        onSubmit: async (raw) => {
          await ctx.session.disableMfa({ password: raw.password, code: raw.code });
          ctx.toast('MFA wyłączone.', 'warn');
          return true;
        }
      });
      if (saved) draw();
    }

    async function regenerateRecovery() {
      let code = null;
      const saved = await formModal({
        title: 'Nowy kod odzyskiwania',
        description: 'Poprzedni kod przestanie działać.',
        fields: [{ name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' }],
        submitLabel: 'Generuj kod',
        onSubmit: async (raw) => {
          code = await ctx.session.regenerateRecoveryCode(raw.password);
          return true;
        }
      });
      if (!saved || !code) return;
      showCodeModal('Nowy kod odzyskiwania', code);
      draw();
    }

    function showCodeModal(title, code) {
      const instance = modal({
        title,
        content: el('div', {},
          el('div', { class: 'notice notice--warn', text: 'Zapisz kod w bezpiecznym miejscu. Zobaczysz go tylko raz.' }),
          el('div', { class: 'code', text: code }),
          el('button', {
            class: 'btn btn--block',
            type: 'button',
            style: { marginTop: 'var(--space-3)' },
            on: {
              click: () => copyText(code, {
                onSuccess: () => toast('Kod skopiowany.', 'ok'),
                onError: () => toast('Nie udało się skopiować kodu.', 'error')
              })
            }
          }, 'Kopiuj kod')
        ),
        footer: [el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => instance.close() } }, 'Zamknij')]
      });
    }

    async function addUser() {
      let recoveryCode = null;
      const saved = await formModal({
        title: 'Nowe konto',
        description: 'Konta zakłada właściciel. Nowa osoba otrzyma kod odzyskiwania.',
        fields: [
          { name: 'displayName', label: 'Imię / nazwa', type: 'text' },
          { name: 'username', label: 'Nazwa użytkownika', type: 'text', autocomplete: 'off' },
          { name: 'password', label: 'Hasło tymczasowe', type: 'password', hint: 'Minimum 10 znaków, litera i cyfra.' },
          { name: 'role', label: 'Rola', type: 'select', options: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })), value: 'member' }
        ],
        submitLabel: 'Utwórz konto',
        onSubmit: async (raw) => {
          const result = await ctx.session.register({
            username: raw.username,
            displayName: raw.displayName,
            password: raw.password,
            role: raw.role,
            actor: ctx.session.user
          });
          recoveryCode = result.recoveryCode;
          return true;
        }
      });
      if (!saved) return;
      if (recoveryCode) showCodeModal('Kod odzyskiwania nowego konta', recoveryCode);
      draw();
    }

    async function changeRole(user, nextRole) {
      try {
        ctx.session.setUserRole(user.id, nextRole);
        ctx.toast('Rola zaktualizowana; sesje użytkownika unieważnione.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
      draw();
    }

    async function toggleDisabled(user) {
      const ok = await confirmAction({
        title: user.disabled ? 'Włącz konto' : 'Wyłącz konto',
        message: user.disabled
          ? `Czy ponownie włączyć konto „${user.username}”?`
          : `Czy wyłączyć konto „${user.username}”? Sesje zostaną unieważnione.`,
        confirmLabel: user.disabled ? 'Włącz' : 'Wyłącz',
        danger: !user.disabled
      });
      if (!ok) return;
      try {
        ctx.session.setUserDisabled(user.id, !user.disabled);
        ctx.toast('Konto zaktualizowane.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
      draw();
    }

    async function removeUser(user) {
      const ok = await confirmAction({
        title: 'Usuń konto',
        message: `Trwale usunąć konto „${user.username}”?`,
        confirmLabel: 'Usuń konto',
        danger: true,
        requireText: user.username
      });
      if (!ok) return;
      try {
        ctx.session.removeUser(user.id);
        ctx.toast('Konto usunięte.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
      draw();
    }

    async function clearFailures() {
      const ok = await confirmAction({
        title: 'Wyczyść licznik prób',
        message: 'Usunąć wszystkie zapisane nieudane próby logowania i blokady?',
        confirmLabel: 'Wyczyść',
        danger: true
      });
      if (!ok) return;
      try {
        ctx.session.require('users:manage');
        ctx.store.commit((state) => {
          state.security = { failures: {} };
        }, { immediate: true });
        toast('Licznik wyczyszczony.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
      draw();
    }

    function draw() {
      clear(host);
      const user = ctx.session.user;
      if (!user) return;
      const policy = ctx.session.securityPolicy();
      const sessions = ctx.session.sessionsList();
      const failures = Object.entries(ctx.store.state.security?.failures ?? {});
      const canManageUsers = ctx.session.can('users:manage');

      host.appendChild(el('div', { class: 'grid grid--two' },
        el('div', { class: 'card' },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Twoje konto' }),
            badge(ROLE_LABELS[user.role] || user.role, 'accent')
          ),
          el('div', { class: 'list' },
            infoRow('Nazwa użytkownika', user.username),
            infoRow('MFA', user.mfaEnabled ? 'Włączone (TOTP)' : 'Wyłączone', user.mfaEnabled ? 'ok' : 'warn'),
            infoRow('Ostatnie logowanie', user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : '—')
          ),
          el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
            el('button', { class: 'btn btn--primary', type: 'button', on: { click: openChangePassword } }, 'Zmień hasło'),
            user.mfaEnabled
              ? el('button', { class: 'btn', type: 'button', on: { click: disableMfa } }, 'Wyłącz MFA')
              : el('button', { class: 'btn', type: 'button', on: { click: startMfa } }, 'Włącz MFA'),
            el('button', { class: 'btn', type: 'button', on: { click: regenerateRecovery } }, 'Nowy kod odzyskiwania')
          )
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Sesje' }),
            el('span', { class: 'view__sub', text: `${sessions.length} aktywnych` })
          ),
          el('p', { class: 'view__sub', text: `Bezczynność: ${Math.round(policy.idleTimeoutMs / 60000)} min · maksymalny czas: ${Math.round(policy.absoluteTimeoutMs / 3600000)} h` }),
          el('div', { class: 'list' }, sessions.map((session) => el('div', { class: 'list__item' },
            el('div', { class: 'list__main' },
              el('div', { class: 'list__title', text: session.current ? 'Ta sesja' : 'Inna sesja' }),
              el('div', { class: 'list__meta', text: `utworzona ${fmtDateTime(session.createdAt)} · aktywna ${fmtDateTime(new Date(session.lastSeenAt).toISOString())}` })
            ),
            session.current ? badge('Aktywna', 'ok') : badge('Zdalna', '')
          ))),
          el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
            el('button', {
              class: 'btn',
              type: 'button',
              on: {
                click: async () => {
                  try {
                    const removed = ctx.session.revokeOtherSessions();
                    toast(`Unieważniono ${removed} sesji.`, 'ok');
                    draw();
                  } catch (err) {
                    toast(toMessage(err), 'error');
                  }
                }
              }
            }, 'Wyloguj inne sesje'),
            el('button', {
              class: 'btn btn--danger',
              type: 'button',
              on: {
                click: async () => {
                  const ok = await confirmAction({
                    title: 'Wyloguj ze wszystkich sesji',
                    message: 'Unieważnić wszystkie sesje, w tym tę?',
                    confirmLabel: 'Wyloguj wszędzie',
                    danger: true
                  });
                  if (!ok) return;
                  try {
                    ctx.session.logoutAll();
                    ctx.handleSignedOut('Wylogowano ze wszystkich sesji.');
                  } catch (err) {
                    toast(toMessage(err), 'error');
                  }
                }
              }
            }, 'Wyloguj wszędzie')
          )
        )
      ));

      if (canManageUsers) {
        const users = ctx.session.usersPublic();
        const userTable = el('table', {},
          el('thead', {}, el('tr', {},
            el('th', {}, 'Osoba'),
            el('th', {}, 'Rola'),
            el('th', {}, 'Stan'),
            el('th', {}, 'Ostatnie logowanie'),
            el('th', { class: 'right' }, 'Akcje')
          )),
          el('tbody', {}, users.map((entry) => {
            const select = el('select', { attrs: { 'aria-label': `Rola użytkownika ${entry.username}` } },
              ROLES.map((role) => el('option', { value: role }, ROLE_LABELS[role]))
            );
            select.value = entry.role;
            select.disabled = entry.id === user.id;
            select.addEventListener('change', () => changeRole(entry, select.value));

            return el('tr', {},
              el('td', {},
                el('div', { class: 'list__title', text: entry.displayName }),
                el('div', { class: 'list__meta', text: entry.username })
              ),
              el('td', {}, select),
              el('td', {}, badge(entry.disabled ? 'Wyłączone' : 'Aktywne', entry.disabled ? 'danger' : 'ok')),
              el('td', { class: 'nowrap', text: entry.lastLoginAt ? fmtDateTime(entry.lastLoginAt) : '—' }),
              el('td', { class: 'right' },
                entry.id === user.id
                  ? el('span', { class: 'view__sub', text: 'to Ty' })
                  : el('button', {
                    class: 'btn btn--sm',
                    type: 'button',
                    on: { click: () => toggleDisabled(entry) }
                  }, entry.disabled ? 'Włącz' : 'Wyłącz'),
                entry.id === user.id
                  ? null
                  : el('button', {
                    class: 'btn btn--sm btn--danger',
                    type: 'button',
                    style: { marginLeft: '6px' },
                    on: { click: () => removeUser(entry) }
                  }, 'Usuń')
              )
            );
          }))
        );

        host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Użytkownicy i role' }),
            el('button', { class: 'btn btn--sm btn--primary', type: 'button', on: { click: addUser } }, '+ Nowe konto')
          ),
          el('p', { class: 'view__sub' },
            Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => `${ROLE_LABELS[role]}: ${description}`).join(' ')),
          el('div', { class: 'table-wrap' }, userTable)
        ));
      }

      if (canManageUsers) {
        host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Nieudane logowania' }),
            failures.length
              ? el('button', { class: 'btn btn--sm btn--danger', type: 'button', on: { click: clearFailures } }, 'Wyczyść')
              : null
          ),
          failures.length
            ? el('div', { class: 'list' }, failures.map(([username, entry]) => el('div', { class: 'list__item' },
              el('div', { class: 'list__main' },
                el('div', { class: 'list__title', text: username }),
                el('div', { class: 'list__meta', text: `próby: ${entry.count ?? 0} · ostatnia ${entry.lastAt ? fmtDateTime(new Date(entry.lastAt).toISOString()) : '—'}` })
              ),
              entry.lockedUntil && entry.lockedUntil > Date.now()
                ? badge('Zablokowane', 'danger')
                : badge('OK', '')
            )))
            : el('div', { class: 'view__sub', text: 'Brak nieudanych prób.' })
        ));
      }

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' }, el('h2', { text: 'Polityka bezpieczeństwa' })),
        el('div', { class: 'list' },
          infoRow('Hashowanie haseł', `${policy.hashing}, ${policy.iterations} iteracji`),
          infoRow('Sól', `${policy.saltBits} bitów`),
          infoRow('Szyfrowanie kopii', policy.cipher),
          infoRow('MFA', policy.mfa),
          infoRow('Blokada konta', `${policy.maxFailures} prób / ${Math.round(policy.lockMs / 60000)} min`),
          infoRow('Transmisja', policy.transmission),
          infoRow('Web Crypto', policy.cryptoAvailable ? 'Dostępne' : 'Niedostępne'),
          infoRow('Magazyn', policy.storage)
        )
      ));
    }

    function infoRow(label, value, kind = '') {
      return el('div', { class: 'list__item' },
        el('div', { class: 'list__main' },
          el('div', { class: 'list__meta', text: label }),
          el('div', { class: 'list__title', text: String(value) })
        ),
        kind ? badge('', kind) : null
      );
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const session = ctx?.session;
    if (!session) return { ok: true, message: 'Moduł gotowy' };
    if (!globalThis.crypto?.subtle) {
      return { status: 'degraded', message: 'Brak Web Crypto — hasła wymagają HTTPS' };
    }
    const users = session.usersPublic();
    const owners = users.filter((user) => user.role === 'owner');
    if (!owners.length) return { ok: false, message: 'Brak konta właściciela w systemie' };
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      return { status: 'degraded', message: 'Połączenie bez HTTPS' };
    }
    return { ok: true, message: `${users.length} kont, ${owners.length} właścicieli` };
  }
};
