import {
  clear, el, fmtDate, matchesSearch, paginate, sortBy, uid
} from '../core/util.js';
import { AppError } from '../core/errors.js';
import { badge, confirmAction, emptyState, formModal, pagination, statCard, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, searchBox, selectFilter, toolbar } from '../ui/page.js';

const TYPES = ['single', 'EP', 'album', 'mixtape'];
const STATUSES = ['Planowane', 'W produkcji', 'Gotowe', 'Wydane'];

const STATUS_KIND = {
  'Planowane': '',
  'W produkcji': 'accent',
  'Gotowe': 'warn',
  'Wydane': 'ok'
};

export default {
  id: 'releases',
  title: 'Wydawnictwa',
  shortTitle: 'Wydania',
  icon: '◎',
  group: 'Praca',
  permission: 'releases:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('releases:write');
    const canDelete = ctx.session.can('releases:delete');
    const view = { query: '', status: 'all', page: 1 };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openEditor(null) } }, '+ Nowe wydawnictwo')
      : null;

    const search = searchBox({
      placeholder: 'Szukaj wydawnictwa…',
      label: 'Szukaj wydawnictw',
      onInput: (value) => { view.query = value; view.page = 1; draw(); }
    });

    const filter = selectFilter({
      label: 'Filtr statusu wydawnictw',
      value: view.status,
      options: [{ value: 'all', label: 'Wszystkie statusy' }, ...STATUSES.map((status) => ({ value: status, label: status }))],
      onChange: (value) => { view.status = value; view.page = 1; draw(); }
    });

    root.appendChild(pageHeader({
      title: 'Wydawnictwa',
      sub: 'Single, EP i albumy — planowanie, produkcja i dystrybucja.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      toolbar(search, filter),
      listHost
    ));

    function trackCount(releaseId) {
      return ctx.store.state.data.songs.filter((song) => song.releaseId === releaseId).length;
    }

    function draw() {
      const releases = ctx.store.state.data.releases;
      const released = releases.filter((release) => release.status === 'Wydane').length;
      const planned = releases.filter((release) => release.status === 'Planowane').length;
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = releases
        .filter((release) => release.date && release.date >= today && release.status !== 'Wydane')
        .sort((a, b) => (a.date > b.date ? 1 : -1))[0];

      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Wydawnictwa', value: releases.length, hint: `${released} wydanych` }),
        statCard({ label: 'W planach', value: planned, hint: 'status „Planowane”' }),
        statCard({ label: 'Utwory w wydaniach', value: releases.reduce((total, release) => total + trackCount(release.id), 0), hint: 'przypisane utwory' }),
        statCard({
          label: 'Najbliższa premiera',
          value: upcoming ? fmtDate(upcoming.date) : '—',
          hint: upcoming ? upcoming.title : 'brak zaplanowanej daty'
        })
      );

      let filtered = releases.filter((release) => matchesSearch(
        [release.title, release.distributor, release.upc, release.type].join(' '),
        view.query
      ));
      if (view.status !== 'all') filtered = filtered.filter((release) => release.status === view.status);
      filtered = sortBy(filtered, (release) => release.date || '9999-12-31', 'asc');

      const pageData = paginate(filtered, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!filtered.length) {
        listHost.appendChild(emptyState({
          title: releases.length ? 'Brak wyników' : 'Brak wydawnictw',
          hint: releases.length
            ? 'Zmień filtr lub frazę wyszukiwania.'
            : 'Zaplanuj pierwsze wydawnictwo i przypisz do niego utwory.',
          actionLabel: canWrite && !releases.length ? 'Dodaj wydawnictwo' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Tytuł'),
          el('th', {}, 'Typ'),
          el('th', {}, 'Data'),
          el('th', {}, 'Status'),
          el('th', { class: 'num' }, 'Utwory'),
          el('th', {}, 'Dystrybutor'),
          el('th', { class: 'right' }, 'Akcje')
        )),
        el('tbody', {}, pageData.items.map((release) => el('tr', {},
          el('td', {},
            el('div', { class: 'list__title', text: release.title }),
            release.upc ? el('div', { class: 'list__meta mono', text: `UPC ${release.upc}` }) : null
          ),
          el('td', { text: release.type }),
          el('td', { class: 'nowrap', text: fmtDate(release.date) }),
          el('td', {}, badge(release.status, STATUS_KIND[release.status] ?? '')),
          el('td', { class: 'num', text: trackCount(release.id) }),
          el('td', { class: 'truncate', text: release.distributor || '—' }),
          el('td', { class: 'right' },
            canWrite
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                attrs: { 'aria-label': `Edytuj wydawnictwo ${release.title}` },
                on: { click: () => openEditor(release) }
              }, 'Edytuj')
              : null,
            canDelete
              ? el('button', {
                class: 'btn btn--sm btn--danger',
                type: 'button',
                style: { marginLeft: '6px' },
                attrs: { 'aria-label': `Usuń wydawnictwo ${release.title}` },
                on: { click: () => removeRelease(release) }
              }, 'Usuń')
              : null
          )
        )))
      );

      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
      listHost.appendChild(pagination({
        ...pageData,
        label: 'wydawnictw',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function openEditor(release) {
      const fields = [
        { name: 'title', label: 'Tytuł', type: 'text', value: release?.title ?? '', required: true },
        { name: 'type', label: 'Typ', type: 'select', options: TYPES, value: release?.type ?? 'single' },
        { name: 'date', label: 'Data premiery', type: 'date', value: release?.date ?? '' },
        { name: 'status', label: 'Status', type: 'select', options: STATUSES, value: release?.status ?? 'Planowane' },
        { name: 'distributor', label: 'Dystrybutor', type: 'text', value: release?.distributor ?? '' },
        { name: 'upc', label: 'UPC / EAN', type: 'text', value: release?.upc ?? '' },
        { name: 'notes', label: 'Notatki', type: 'textarea', value: release?.notes ?? '', rows: 4 }
      ];

      formModal({
        title: release ? 'Edytuj wydawnictwo' : 'Nowe wydawnictwo',
        fields,
        wide: true,
        submitLabel: release ? 'Zapisz zmiany' : 'Dodaj wydawnictwo',
        onSubmit: async (raw) => {
          const title = validate.requireText(raw.title, 'Tytuł', { max: 120 });
          const type = validate.requireEnum(raw.type, TYPES, 'Typ');
          const date = validate.optionalDate(raw.date, 'Data premiery');
          const status = validate.requireEnum(raw.status, STATUSES, 'Status');
          const distributor = validate.optionalText(raw.distributor, 'Dystrybutor', { max: 120 });
          const upc = validate.optionalText(raw.upc, 'UPC', { max: 20 });
          const notes = validate.optionalText(raw.notes, 'Notatki', { max: 5000 });

          ctx.session.require('releases:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (release) {
              const target = state.data.releases.find((entry) => entry.id === release.id);
              if (!target) throw new AppError('Wydawnictwo nie istnieje.', 'release_missing');
              Object.assign(target, { title, type, date, status, distributor, upc, notes, updatedAt: timestamp });
              return;
            }
            state.data.releases.push({
              id: uid('release'),
              title,
              type,
              date,
              status,
              distributor,
              upc,
              notes,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.toast(release ? 'Wydawnictwo zaktualizowane.' : 'Dodano wydawnictwo.', 'ok');
          return true;
        }
      });
    }

    async function removeRelease(release) {
      const tracks = trackCount(release.id);
      const ok = await confirmAction({
        title: 'Usuń wydawnictwo',
        message: `Czy usunąć „${release.title}”?`,
        confirmLabel: 'Usuń',
        danger: true,
        note: tracks
          ? `${tracks} utworów zostanie odłączonych od tego wydawnictwa (nie zostaną usunięte).`
          : 'Wydawnictwo nie ma przypisanych utworów.'
      });
      if (!ok) return;
      try {
        ctx.session.require('releases:delete');
        ctx.store.commit((state) => {
          state.data.releases = state.data.releases.filter((entry) => entry.id !== release.id);
          for (const song of state.data.songs) {
            if (song.releaseId === release.id) song.releaseId = null;
          }
        }, { immediate: true });
        toast('Wydawnictwo usunięte.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć wydawnictwa.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const releases = store.state.data.releases;
    const invalid = releases.filter((release) => !release.id || !release.title);
    if (invalid.length) return { ok: false, message: `${invalid.length} wydawnictw bez tytułu` };
    const duplicated = releases.filter((release, index) => releases.findIndex((entry) => entry.id === release.id) !== index);
    if (duplicated.length) return { ok: false, message: 'Zduplikowane identyfikatory wydawnictw' };
    return { ok: true, message: `${releases.length} wydawnictw, dane spójne` };
  }
};
