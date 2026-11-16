import { clear, download, el, timestampForFilename } from '../core/util.js';
import { toMessage } from '../core/errors.js';
import { badge, confirmAction, formModal, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, pickFile } from '../ui/page.js';

const CONSENTS = [
  {
    key: 'externalAi',
    label: 'Przetwarzanie tekstów przez zewnętrzne modele AI',
    hint: 'Domyślnie wyłączone. Aplikacja nie wysyła tekstów, nagrań ani notatek bez tej zgody i bez Twojego działania.'
  },
  {
    key: 'externalServices',
    label: 'Integracje z zewnętrznymi usługami',
    hint: 'Brak skonfigurowanych usług zewnętrznych. Zgoda jest wymagana przed każdym przyszłym połączeniem.'
  },
  {
    key: 'reaperFolderAccess',
    label: 'Dostęp do wskazanych folderów projektów REAPER',
    hint: 'Wyłącznie walidacja ścieżek w manifestach. Aplikacja nie czyta plików audio ani projektów.'
  }
];

function sanitizedExport(state) {
  return {
    ...state,
    users: state.users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      disabled: Boolean(user.disabled),
      mfaEnabled: Boolean(user.mfa?.enabled)
    })),
    sessions: [],
    security: { failures: {} }
  };
}

export default {
  id: 'privacy',
  title: 'Prywatność',
  shortTitle: 'Prywatność',
  icon: '◐',
  group: 'System',
  permission: 'privacy:read',

  mount(root, ctx) {
    const host = el('div');
    root.appendChild(pageHeader({
      title: 'Prywatność i dane',
      sub: 'Pełna kontrola nad tym, co aplikacja przechowuje i komu udostępnia.'
    }));
    root.appendChild(host);

    function dataCounts() {
      const state = ctx.store.state;
      return [
        { label: 'Konta', value: state.users.length },
        { label: 'Utwory', value: state.data.songs.length },
        { label: 'Wydawnictwa', value: state.data.releases.length },
        { label: 'Sesje studyjne', value: state.data.studioSessions.length },
        { label: 'Wpisy finansowe', value: state.data.finances.length },
        { label: 'Zadania', value: state.data.tasks.length },
        { label: 'Osoby w kolektywie', value: state.data.members.length },
        { label: 'Logi w pamięci', value: ctx.logger.counts().logs }
      ];
    }

    async function exportPlain() {
      try {
        ctx.session.require('privacy:export');
        download(`${timestampForFilename('bsxs-dane')}.json`, sanitizedExport(ctx.store.snapshotState()), 'application/json');
        toast('Wyeksportowano dane (bez haseł i tokenów).', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    async function exportEncrypted() {
      let passphrase = '';
      const saved = await formModal({
        title: 'Zaszyfrowana kopia zapasowa',
        description: 'Plik AES-GCM 256 z hasłem. Bez hasła danych nie da się odzyskać.',
        fields: [
          { name: 'passphrase', label: 'Hasło kopii', type: 'password', autocomplete: 'new-password', hint: 'Minimum 10 znaków.' },
          { name: 'confirm', label: 'Powtórz hasło', type: 'password', autocomplete: 'new-password' }
        ],
        submitLabel: 'Utwórz kopię',
        onSubmit: async (raw) => {
          if (raw.passphrase !== raw.confirm) throw new validate.ValidationError('Hasła nie są identyczne.');
          passphrase = validate.requirePassword(raw.passphrase);
          ctx.session.require('privacy:export');
          const payload = await ctx.backup.exportEncrypted(passphrase);
          download(`${timestampForFilename('bsxs-backup')}.json`, payload, 'application/json');
          return true;
        }
      });
      if (saved) toast('Zaszyfrowana kopia zapisana.', 'ok');
    }

    async function importBackup() {
      try {
        ctx.session.require('data:restore');
        const file = await pickFile('.json,application/json');
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) throw new validate.ValidationError('Plik kopii jest za duży (limit 8 MB).');
        const text = await file.text();
        let envelope;
        try {
          envelope = JSON.parse(text);
        } catch (err) {
          throw new validate.ValidationError('Plik nie jest prawidłowym JSON-em.');
        }
        let passphrase = null;
        if (envelope.encrypted) {
          const saved = await formModal({
            title: 'Hasło kopii',
            fields: [{ name: 'passphrase', label: 'Hasło kopii', type: 'password', autocomplete: 'current-password' }],
            submitLabel: 'Odszyfruj',
            onSubmit: async (raw) => {
              passphrase = raw.passphrase;
              return true;
            }
          });
          if (!saved) return;
        }
        const ok = await confirmAction({
          title: 'Przywróć dane z kopii',
          message: 'Bieżące dane zostaną zastąpione zawartością kopii. Przed importem powstanie migawka.',
          confirmLabel: 'Importuj',
          danger: true
        });
        if (!ok) return;
        const result = envelope.encrypted
          ? await ctx.backup.importEncrypted(text, passphrase)
          : ctx.backup.importPlain(text);
        toast(`Import zakończony (${result.users} kont).`, 'ok');
        ctx.logger.warn('Zaimportowano dane z pliku.', { encrypted: Boolean(envelope.encrypted) });
        draw();
      } catch (err) {
        toast(toMessage(err), 'error');
        ctx.logger.error('Błąd importu kopii.', { error: err });
      }
    }

    async function deleteAccount() {
      const user = ctx.session.user;
      const passphrase = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        formModal({
          title: 'Usuń własne konto',
          description: 'Konto i jego sesje zostaną trwale usunięte. Dane kolektywu pozostaną.',
          fields: [{ name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' }],
          submitLabel: 'Przejdź do potwierdzenia',
          danger: true,
          onSubmit: async (raw) => {
            finish(raw.password);
            return true;
          }
        }).then((ok) => {
          if (!ok) finish(null);
        });
      });
      if (!passphrase) return;
      const ok = await confirmAction({
        title: 'Ostatnie potwierdzenie',
        message: 'Tej operacji nie można cofnąć.',
        confirmLabel: 'Usuń konto',
        danger: true,
        requireText: user.username
      });
      if (!ok) return;
      try {
        await ctx.session.deleteOwnAccount(passphrase);
        ctx.handleSignedOut('Konto zostało usunięte.');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    async function deleteAllData() {
      const password = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        formModal({
          title: 'Usuń wszystkie dane',
          description: 'Operacja nieodwracalna. Potwierdź hasłem, a następnie przepisaną frazą.',
          fields: [{ name: 'password', label: 'Hasło', type: 'password', autocomplete: 'current-password' }],
          submitLabel: 'Dalej',
          danger: true,
          onSubmit: async (raw) => {
            finish(raw.password);
            return true;
          }
        }).then((ok) => {
          if (!ok) finish(null);
        });
      });
      if (!password) return;

      try {
        await ctx.session.verifyPassword(password);
      } catch (err) {
        toast(toMessage(err), 'error');
        return;
      }

      const ok = await confirmAction({
        title: 'Usuń wszystkie dane',
        message: 'Wszystkie utwory, wydawnictwa, finanse, zadania i konta zostaną usunięte. Kopia migawkowa zostanie utworzona przed operacją.',
        confirmLabel: 'Usuń wszystko',
        danger: true,
        requireText: 'USUŃ WSZYSTKO'
      });
      if (!ok) return;
      try {
        ctx.session.require('privacy:delete');
        ctx.store.resetAll();
        ctx.logger.warn('Wszystkie dane aplikacji zostały usunięte.');
        ctx.session.logout();
        ctx.handleSignedOut('Dane zostały usunięte. Utwórz nowe konto właściciela.');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    function toggleConsent(key, value) {
      try {
        ctx.store.commit((state) => {
          state.data.consents = { ...state.data.consents, [key]: Boolean(value) };
        }, { immediate: true });
        ctx.logger.info('Zmieniono zgodę.', { consent: key, value: Boolean(value) });
        toast('Zgoda zaktualizowana.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    function draw() {
      clear(host);
      const state = ctx.store.state;
      const consents = state.data.consents;

      host.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card__head' }, el('h2', { text: 'Co aplikacja przechowuje' })),
        el('div', { class: 'grid grid--stats' }, dataCounts().map((item) => el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: item.label }),
          el('div', { class: 'stat__value', text: String(item.value) })
        )))
      ));

      host.appendChild(el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Twoje dane' })),
          el('div', { class: 'view__tools' },
            el('button', { class: 'btn btn--primary', type: 'button', on: { click: exportPlain } }, 'Eksportuj dane (JSON)'),
            el('button', { class: 'btn', type: 'button', on: { click: exportEncrypted } }, 'Eksportuj szyfrowaną kopię'),
            el('button', { class: 'btn', type: 'button', on: { click: importBackup } }, 'Importuj kopię')
          ),
          el('p', { class: 'view__sub', style: { marginTop: 'var(--space-3)' } },
            'Eksport jawny nie zawiera haseł, tokenów sesji ani sekretów MFA. Kopie szyfrowane używają AES-GCM 256 z kluczem wyprowadzonym z hasła.')
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Zgody na integracje' })),
          el('div', { class: 'list' }, CONSENTS.map((consent) => {
            const input = el('input', { type: 'checkbox', checked: Boolean(consents[consent.key]), attrs: { 'aria-label': consent.label } });
            input.addEventListener('change', () => toggleConsent(consent.key, input.checked));
            return el('label', { class: 'list__item', style: { cursor: 'pointer' } },
              input,
              el('div', { class: 'list__main' },
                el('div', { class: 'list__title', text: consent.label }),
                el('div', { class: 'list__meta', text: consent.hint })
              ),
              badge(consents[consent.key] ? 'Wyrażona' : 'Brak', consents[consent.key] ? 'ok' : '')
            );
          })),
          el('div', { class: 'notice', text: 'Aplikacja nie wysyła żadnych danych do usług zewnętrznych. Wszystko działa lokalnie w tej przeglądarce.' })
        )
      ));

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' }, el('h2', { text: 'Podgląd zapisanych danych' })),
        el('p', { class: 'view__sub', text: 'Widok bez danych uwierzytelniania. Pełny eksport zawiera całą bazę.' }),
        el('div', { class: 'view__tools' },
          el('button', {
            class: 'btn',
            type: 'button',
            on: {
              click: () => {
                const preview = el('pre', { class: 'code', text: JSON.stringify(sanitizedExport(ctx.store.state), null, 2) });
                const existing = host.querySelector('#privacy-preview');
                if (existing) existing.remove();
                else {
                  preview.id = 'privacy-preview';
                  host.appendChild(preview);
                }
              }
            }
          }, 'Pokaż / ukryj podgląd JSON')
        )
      ));

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' }, el('h2', { text: 'Sesje i konto' })),
        el('div', { class: 'view__tools' },
          el('button', {
            class: 'btn',
            type: 'button',
            on: {
              click: () => {
                try {
                  ctx.session.logoutAll();
                  ctx.handleSignedOut('Wylogowano ze wszystkich sesji.');
                } catch (err) {
                  toast(toMessage(err), 'error');
                }
              }
            }
          }, 'Wyloguj ze wszystkich sesji'),
          el('button', { class: 'btn btn--danger', type: 'button', on: { click: deleteAccount } }, 'Usuń moje konto'),
          ctx.session.can('privacy:delete')
            ? el('button', { class: 'btn btn--danger', type: 'button', on: { click: deleteAllData } }, 'Usuń wszystkie dane')
            : null
        ),
        el('p', { class: 'view__sub', style: { marginTop: 'var(--space-3)' } },
          'Zasada minimalizacji: aplikacja zbiera tylko dane potrzebne do prowadzenia kariery — bez analityki, bez reklam i bez profili behawioralnych.')
      ));
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const consents = store.state.data.consents;
    const enabled = Object.entries(consents).filter(([, value]) => value).map(([key]) => key);
    return {
      ok: true,
      message: enabled.length ? `Włączone zgody: ${enabled.join(', ')}` : 'Wszystkie zgody na integracje wyłączone'
    };
  }
};
