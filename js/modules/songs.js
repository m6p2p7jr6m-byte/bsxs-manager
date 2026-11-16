import {
  clear, debounce, el, fmtDate, matchesSearch, paginate, sortBy, uid
} from '../core/util.js';
import { AppError, ValidationError } from '../core/errors.js';
import {
  badge, confirmAction, emptyState, formModal, pagination, statCard, toast
} from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, searchBox, selectFilter, toolbar } from '../ui/page.js';

const STATUSES = ['Pomysł', 'Demo', 'Nagranie', 'Miks', 'Master', 'Wydany'];

const STATUS_KIND = {
  'Pomysł': '',
  'Demo': 'accent',
  'Nagranie': 'accent',
  'Miks': 'warn',
  'Master': 'warn',
  'Wydany': 'ok'
};

const DRAFT_KEY = 'draft.song';

export default {
  id: 'songs',
  title: 'Utwory',
  shortTitle: 'Utwory',
  icon: '♪',
  group: 'Praca',
  permission: 'songs:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('songs:write');
    const canDelete = ctx.session.can('songs:delete');
    const view = { query: '', status: 'all', page: 1, sortKey: 'updatedAt', sortDir: 'desc' };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', {
        class: 'btn btn--primary',
        type: 'button',
        on: { click: () => openEditor(null) }
      }, '+ Nowy utwór')
      : null;

    const search = searchBox({
      placeholder: 'Szukaj tytułu, tagu, ISRC…',
      label: 'Szukaj utworów',
      onInput: (value) => { view.query = value; view.page = 1; draw(); }
    });

    const filter = selectFilter({
      label: 'Filtr statusu',
      value: view.status,
      options: [{ value: 'all', label: 'Wszystkie statusy' }, ...STATUSES.map((status) => ({ value: status, label: status }))],
      onChange: (value) => { view.status = value; view.page = 1; draw(); }
    });

    root.appendChild(pageHeader({
      title: 'Utwory',
      sub: 'Katalog utworów XARO i kolektywu BSXS — od pomysłu do wydania.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      toolbar(search, filter),
      listHost
    ));

    function releaseTitle(releaseId) {
      if (!releaseId) return '—';
      const release = ctx.store.state.data.releases.find((entry) => entry.id === releaseId);
      return release ? release.title : '—';
    }

    function draw() {
      const songs = ctx.store.state.data.songs;
      const published = songs.filter((song) => song.status === 'Wydany').length;
      const inProgress = songs.filter((song) => ['Nagranie', 'Miks', 'Master'].includes(song.status)).length;
      const withoutRelease = songs.filter((song) => !song.releaseId).length;
      const bpms = songs.map((song) => Number(song.bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
      const avgBpm = bpms.length ? Math.round(bpms.reduce((total, bpm) => total + bpm, 0) / bpms.length) : 0;

      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Utwory', value: songs.length, hint: `${published} wydanych` }),
        statCard({ label: 'W produkcji', value: inProgress, hint: 'nagranie, miks, master' }),
        statCard({ label: 'Bez wydawnictwa', value: withoutRelease, hint: 'poza single/EP/albumem' }),
        statCard({ label: 'Średni BPM', value: avgBpm || '—', hint: 'z wypełnionych pól' })
      );

      let filtered = songs.filter((song) => matchesSearch(
        [song.title, song.artist, song.isrc, (song.tags || []).join(' ')].join(' '),
        view.query
      ));
      if (view.status !== 'all') filtered = filtered.filter((song) => song.status === view.status);
      filtered = sortBy(filtered, (song) => song[view.sortKey] ?? '', view.sortDir);

      const pageData = paginate(filtered, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!filtered.length) {
        listHost.appendChild(emptyState({
          title: songs.length ? 'Brak wyników' : 'Katalog jest pusty',
          hint: songs.length
            ? 'Zmień frazę wyszukiwania lub filtr statusu.'
            : 'Dodaj pierwszy utwór, aby zacząć prowadzić katalog.',
          actionLabel: canWrite && !songs.length ? 'Dodaj utwór' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const header = (label, key, className = '') => el('th', {
        class: className,
        style: { cursor: key ? 'pointer' : 'default' },
        attrs: key ? { title: 'Kliknij, aby sortować' } : {},
        on: key
          ? {
            click: () => {
              if (view.sortKey === key) view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
              else { view.sortKey = key; view.sortDir = 'asc'; }
              draw();
            }
          }
          : {}
      }, label);

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          header('Tytuł', 'title'),
          header('Status', 'status'),
          header('BPM', 'bpm', 'num'),
          header('Tonacja', 'keySig'),
          header('Wydawnictwo', null),
          header('Aktualizacja', 'updatedAt'),
          el('th', { class: 'right' }, 'Akcje')
        )),
        el('tbody', {}, pageData.items.map((song) => el('tr', {},
          el('td', {},
            el('div', { class: 'list__title', text: song.title }),
            el('div', {
              class: 'list__meta',
              text: [song.artist, ...(song.tags || []).map((tag) => `#${tag}`)].filter(Boolean).join(' · ')
            })
          ),
          el('td', {}, badge(song.status, STATUS_KIND[song.status] ?? '')),
          el('td', { class: 'num', text: song.bpm ?? '—' }),
          el('td', { text: song.keySig || '—' }),
          el('td', { class: 'truncate', text: releaseTitle(song.releaseId) }),
          el('td', { class: 'nowrap', text: fmtDate(song.updatedAt) }),
          el('td', { class: 'right' },
            canWrite
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                attrs: { 'aria-label': `Edytuj utwór ${song.title}` },
                on: { click: () => openEditor(song) }
              }, 'Edytuj')
              : null,
            canDelete
              ? el('button', {
                class: 'btn btn--sm btn--danger',
                type: 'button',
                style: { marginLeft: '6px' },
                attrs: { 'aria-label': `Usuń utwór ${song.title}` },
                on: { click: () => removeSong(song) }
              }, 'Usuń')
              : null
          )
        )))
      );

      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
      listHost.appendChild(pagination({
        ...pageData,
        label: 'utworów',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function openEditor(song) {
      const releases = ctx.store.state.data.releases;
      const restoredDraft = !song ? readDraft() : null;
      // Szkic pokazujemy tylko wtedy, gdy zawiera realną treść.
      const draftValues = restoredDraft && String(restoredDraft.title ?? '').trim() ? restoredDraft : null;
      const base = song || draftValues || {};
      const saveDraft = debounce((values) => {
        try {
          ctx.store.writeAux(DRAFT_KEY, JSON.stringify(values));
        } catch (err) {
          ctx.logger.warn('Nie udało się zapisać szkicu utworu.', { error: err });
        }
      }, 700);

      const fields = [
        { name: 'title', label: 'Tytuł', type: 'text', value: base.title ?? '', required: true },
        { name: 'artist', label: 'Wykonawca', type: 'text', value: base.artist ?? 'XARO' },
        { name: 'status', label: 'Status', type: 'select', options: STATUSES, value: base.status ?? 'Pomysł' },
        { name: 'bpm', label: 'BPM', type: 'number', value: base.bpm ?? '', hint: '20–400, opcjonalnie' },
        { name: 'keySig', label: 'Tonacja', type: 'text', value: base.keySig ?? '', hint: 'np. Am, F#m' },
        { name: 'isrc', label: 'ISRC', type: 'text', value: base.isrc ?? '', hint: 'Kod nagrania, jeśli nadany' },
        { name: 'tags', label: 'Tagi', type: 'text', value: (base.tags || []).join(', '), hint: 'Oddziel przecinkami, maks. 12' },
        {
          name: 'releaseId',
          label: 'Wydawnictwo',
          type: 'select',
          value: base.releaseId ?? '',
          options: [{ value: '', label: '— brak —' }, ...releases.map((release) => ({ value: release.id, label: release.title }))]
        },
        { name: 'notes', label: 'Notatki', type: 'textarea', value: base.notes ?? '', rows: 5, hint: 'Autozapis szkicu działa przy nowym utworze.' }
      ];

      formModal({
        title: song ? 'Edytuj utwór' : 'Nowy utwór',
        description: !song && draftValues ? 'Przywrócono szkic zapisany automatycznie.' : null,
        fields,
        submitLabel: song ? 'Zapisz zmiany' : 'Dodaj utwór',
        wide: true,
        onChange: song ? null : saveDraft,
        onSubmit: async (raw) => {
          const title = validate.requireText(raw.title, 'Tytuł', { max: 120 });
          const artist = validate.optionalText(raw.artist, 'Wykonawca', { max: 120 }) || 'XARO';
          const status = validate.requireEnum(raw.status, STATUSES, 'Status');
          const bpm = String(raw.bpm ?? '').trim() === ''
            ? null
            : validate.requireNumber(raw.bpm, 'BPM', { min: 20, max: 400, integer: true });
          const keySig = validate.optionalText(raw.keySig, 'Tonacja', { max: 20 });
          const isrc = validate.optionalText(raw.isrc, 'ISRC', { max: 20 });
          const tagsText = validate.optionalText(raw.tags, 'Tagi', { max: 200 });
          const tags = tagsText
            ? tagsText.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
            : [];
          const notes = validate.optionalText(raw.notes, 'Notatki', { max: 5000 });
          const releaseId = raw.releaseId ? String(raw.releaseId) : null;
          if (releaseId && !releases.some((release) => release.id === releaseId)) {
            throw new ValidationError('Wybrane wydawnictwo nie istnieje.');
          }

          ctx.session.require('songs:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (song) {
              const target = state.data.songs.find((entry) => entry.id === song.id);
              if (!target) throw new AppError('Utwór nie istnieje — mógł zostać usunięty.', 'song_missing');
              Object.assign(target, {
                title, artist, status, bpm, keySig, isrc, tags, notes, releaseId, updatedAt: timestamp
              });
              return;
            }
            state.data.songs.push({
              id: uid('song'),
              title,
              artist,
              status,
              bpm,
              keySig,
              isrc,
              tags,
              notes,
              releaseId,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.store.removeAux(DRAFT_KEY);
          if (typeof saveDraft.cancel === 'function') saveDraft.cancel();
          ctx.toast(song ? 'Utwór zaktualizowany.' : 'Dodano utwór.', 'ok');
          return true;
        }
      });
    }

    function readDraft() {
      const raw = ctx.store.readAux(DRAFT_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (err) {
        ctx.store.removeAux(DRAFT_KEY);
        ctx.logger.warn('Usunięto nieczytelny szkic utworu.');
        return null;
      }
    }

    async function removeSong(song) {
      const ok = await confirmAction({
        title: 'Usuń utwór',
        message: `Czy usunąć „${song.title}”? Tej operacji nie można cofnąć poza przywróceniem migawki.`,
        confirmLabel: 'Usuń',
        danger: true,
        note: song.releaseId ? 'Utwór jest przypisany do wydawnictwa — zostanie z niego odłączony.' : null
      });
      if (!ok) return;
      try {
        ctx.session.require('songs:delete');
        ctx.store.commit((state) => {
          state.data.songs = state.data.songs.filter((entry) => entry.id !== song.id);
        }, { immediate: true });
        toast('Utwór usunięty.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć utworu.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const songs = store.state.data.songs;
    const invalid = songs.filter((song) => !song.id || typeof song.title !== 'string' || !song.title.trim());
    if (invalid.length) {
      return { ok: false, message: `${invalid.length} utworów bez tytułu lub identyfikatora` };
    }
    const releases = store.state.data.releases.map((release) => release.id);
    const dangling = songs.filter((song) => song.releaseId && !releases.includes(song.releaseId));
    if (dangling.length) {
      return { status: 'degraded', message: `${dangling.length} utworów wskazuje nieistniejące wydawnictwo` };
    }
    return { ok: true, message: `${songs.length} utworów, dane spójne` };
  }
};
