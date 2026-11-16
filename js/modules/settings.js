import { clear, download, el, fmtDateTime, fmtNumber, timestampForFilename } from '../core/util.js';
import { toMessage } from '../core/errors.js';
import {
  applyAnimationLevel, badge, confirmAction, formModal, resolveAnimationLevel, toast, withBusy
} from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, pickFile } from '../ui/page.js';
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from '../core/version.js';

const PAGE_SIZES = [10, 20, 50];
const AUTOSAVE_DELAYS = [
  { value: 400, label: '0,4 s (najszybciej)' },
  { value: 900, label: '0,9 s (zalecane)' },
  { value: 2000, label: '2 s (oszczędnie)' }
];

export default {
  id: 'settings',
  title: 'Ustawienia',
  shortTitle: 'Ustawienia',
  icon: '⚙',
  group: 'System',
  permission: null,

  mount(root, ctx) {
    const host = el('div');
    const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

    root.appendChild(pageHeader({
      title: 'Ustawienia',
      sub: 'Wydajność, animacje, autozapis i kopie bezpieczeństwa.'
    }));
    root.appendChild(host);

    function updateAnimations(value) {
      try {
        ctx.store.commit((state) => {
          state.data.settings.animations = value;
        }, { immediate: true });
        applyAnimationLevel(value);
        ctx.logger.info('Zmieniono ustawienie animacji.', { value });
        toast('Ustawienie animacji zapisane.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    function updateSetting(key, value) {
      try {
        ctx.store.commit((state) => {
          state.data.settings[key] = value;
        }, { immediate: true });
        toast('Ustawienie zapisane.', 'ok');
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    async function createSnapshot() {
      try {
        const result = ctx.backup.createSnapshot('ręczna');
        if (!result) throw new Error('Nie udało się utworzyć migawki (limit rozmiaru lub pamięci).');
        toast(`Migawka zapisana: ${fmtDateTime(result.savedAt)}.`, 'ok');
        draw();
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    async function restoreSnapshot(snapshot) {
      const ok = await confirmAction({
        title: 'Przywróć migawkę',
        message: `Przywrócić dane z ${fmtDateTime(snapshot.savedAt)}? Bieżący stan zostanie zapisany jako nowa migawka.`,
        confirmLabel: 'Przywróć',
        danger: true
      });
      if (!ok) return;
      try {
        ctx.session.require('data:restore');
        ctx.backup.restoreSnapshot(snapshot.index);
        toast('Dane przywrócone z migawki.', 'ok');
        draw();
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    async function exportBackup() {
      let passphrase = '';
      const saved = await formModal({
        title: 'Kopia zapasowa (szyfrowana)',
        description: 'AES-GCM 256 z hasłem. Zapisz hasło — bez niego kopia jest bezużyteczna.',
        fields: [
          { name: 'passphrase', label: 'Hasło kopii', type: 'password', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Powtórz hasło', type: 'password', autocomplete: 'new-password' }
        ],
        submitLabel: 'Zapisz kopię',
        onSubmit: async (raw) => {
          if (raw.passphrase !== raw.confirm) throw new validate.ValidationError('Hasła nie są identyczne.');
          passphrase = validate.requirePassword(raw.passphrase);
          ctx.session.require('privacy:export');
          const payload = await ctx.backup.exportEncrypted(passphrase);
          download(`${timestampForFilename('bsxs-backup')}.json`, payload, 'application/json');
          return true;
        }
      });
      if (saved) toast('Kopia zapisana.', 'ok');
    }

    async function importBackup() {
      try {
        ctx.session.require('data:restore');
        const file = await pickFile('.json,application/json');
        if (!file) return;
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
            fields: [{ name: 'passphrase', label: 'Hasło kopii', type: 'password' }],
            submitLabel: 'Odszyfruj',
            onSubmit: async (raw) => {
              passphrase = raw.passphrase;
              return true;
            }
          });
          if (!saved) return;
        }
        const ok = await confirmAction({
          title: 'Przywróć dane',
          message: 'Bieżące dane zostaną zastąpione zawartością kopii.',
          confirmLabel: 'Importuj',
          danger: true
        });
        if (!ok) return;
        const result = envelope.encrypted
          ? await ctx.backup.importEncrypted(text, passphrase)
          : ctx.backup.importPlain(text);
        toast(`Import zakończony (${result.users} kont).`, 'ok');
        draw();
      } catch (err) {
        toast(toMessage(err), 'error');
      }
    }

    function draw() {
      clear(host);
      const settings = ctx.store.state.data.settings;
      const stats = ctx.store.storageStats();
      const effective = resolveAnimationLevel(settings.animations);

      const animSegmented = el('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': 'Tryb animacji' } });
      for (const option of [
        { value: 'on', label: 'Animacje włączone' },
        { value: 'limited', label: 'Ograniczone' },
        { value: 'off', label: 'Wyłączone' }
      ]) {
        animSegmented.appendChild(el('button', {
          type: 'button',
          attrs: { 'aria-pressed': settings.animations === option.value ? 'true' : 'false' },
          on: { click: () => updateAnimations(option.value) }
        }, option.label));
      }

      host.appendChild(el('div', { class: 'grid grid--two' },
        el('div', { class: 'card' },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Animacje' }),
            badge(`Aktywne: ${effective}`, effective === 'off' ? 'warn' : 'ok')
          ),
          el('p', { class: 'view__sub', text: `Preferencja systemowa „ograniczenie ruchu”: ${systemReduced ? 'włączona' : 'wyłączona'}. Tryb „ograniczone” respektuje ją automatycznie.` }),
          animSegmented,
          el('div', { class: 'field', style: { marginTop: 'var(--space-4)' } },
            el('label', { class: 'field__label', attrs: { for: 'page-size' }, text: 'Liczba rekordów na stronę' }),
            (() => {
              const select = el('select', { id: 'page-size' }, PAGE_SIZES.map((size) => el('option', { value: String(size) }, `${size} rekordów`)));
              select.value = String(settings.pageSize);
              select.addEventListener('change', () => updateSetting('pageSize', Number(select.value)));
              return select;
            })()
          ),
          el('div', { class: 'field' },
            el('label', { class: 'field__label', attrs: { for: 'autosave-delay' }, text: 'Opóźnienie autozapisu' }),
            (() => {
              const select = el('select', { id: 'autosave-delay' }, AUTOSAVE_DELAYS.map((option) => el('option', { value: String(option.value) }, option.label)));
              select.value = String(settings.autosaveMs);
              select.addEventListener('change', () => updateSetting('autosaveMs', Number(select.value)));
              return select;
            })()
          ),
          el('div', { class: 'view__tools' },
            el('button', {
              class: 'btn',
              type: 'button',
              on: {
                click: () => {
                  try {
                    ctx.store.flush();
                    toast('Dane zapisane natychmiast.', 'ok');
                    draw();
                  } catch (err) {
                    toast(toMessage(err), 'error');
                  }
                }
              }
            }, 'Zapisz teraz')
          )
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Magazyn danych' })),
          el('div', { class: 'list' },
            infoRow('Sterownik', stats.driver),
            infoRow('Rozmiar', `${Math.round(stats.bytes / 102.4) / 10} KB`),
            infoRow('Ostatni zapis', stats.lastSavedAt ? fmtDateTime(stats.lastSavedAt) : '—'),
            infoRow('Niezapisane zmiany', stats.dirty ? 'Tak' : 'Nie', stats.dirty ? 'warn' : 'ok'),
            infoRow('Stan wczytania', stats.loadReport?.source ?? '—'),
            infoRow('Wersja schematu', String(SCHEMA_VERSION)),
            infoRow('Wersja aplikacji', APP_VERSION)
          ),
          stats.lastError ? el('div', { class: 'notice notice--danger', text: stats.lastError }) : null,
          stats.loadReport?.issues?.length
            ? el('div', { class: 'notice notice--warn' }, stats.loadReport.issues.slice(0, 3).join(' '))
            : null
        )
      ));

      const snapshots = ctx.backup.listSnapshots();
      const snapshotCard = el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Kopie zapasowe i migawki' }),
          el('button', { class: 'btn btn--sm btn--primary', type: 'button', on: { click: createSnapshot } }, 'Utwórz migawkę')
        ),
        el('p', { class: 'view__sub', text: 'Trzy ostatnie migawki zapisywane automatycznie i na żądanie. Autozapis tworzy kopię dzienną.' }),
        snapshots.length
          ? el('div', { class: 'list' }, snapshots.map((snapshot) => el('div', { class: 'list__item' },
            el('div', { class: 'list__main' },
              el('div', { class: 'list__title', text: snapshot.savedAt ? fmtDateTime(snapshot.savedAt) : 'Migawka uszkodzona' }),
              el('div', { class: 'list__meta', text: [snapshot.reason, `${fmtNumber(snapshot.size)} B`].filter(Boolean).join(' · ') })
            ),
            snapshot.valid
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                disabled: !ctx.session.can('data:restore'),
                on: { click: () => restoreSnapshot(snapshot) }
              }, 'Przywróć')
              : badge('Uszkodzona', 'danger')
          )))
          : el('div', { class: 'view__sub', text: 'Brak migawek.' }),
        el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
          el('button', { class: 'btn', type: 'button', on: { click: exportBackup } }, 'Eksportuj szyfrowaną kopię'),
          el('button', {
            class: 'btn',
            type: 'button',
            disabled: !ctx.session.can('data:restore'),
            on: { click: importBackup }
          }, 'Importuj kopię')
        )
      );
      host.appendChild(snapshotCard);

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' }, el('h2', { text: 'O aplikacji' })),
        el('p', { class: 'view__sub' },
          `${APP_NAME} ${APP_VERSION} · schemat danych ${SCHEMA_VERSION} · dane przechowywane lokalnie w tej przeglądarce.`),
        el('p', { class: 'view__sub' },
          'Aplikacja działa bez serwera, bez analityki i bez zewnętrznych usług. Kopie zapasowe są szyfrowane AES-GCM 256.')
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
    const settings = ctx?.store?.state?.data?.settings;
    if (!settings) return { ok: true, message: 'Moduł gotowy' };
    if (!['on', 'limited', 'off'].includes(settings.animations)) {
      return { ok: false, message: 'Nieprawidłowe ustawienie animacji' };
    }
    if (!Number.isFinite(Number(settings.autosaveMs)) || settings.autosaveMs < 200) {
      return { ok: false, message: 'Nieprawidłowe opóźnienie autozapisu' };
    }
    return { ok: true, message: `Animacje: ${settings.animations}, autozapis: ${settings.autosaveMs} ms` };
  }
};
