import { clear, el, fmtDate, fmtMoney, paginate, sortBy, sum, todayISO, uid } from '../core/util.js';
import { AppError } from '../core/errors.js';
import { badge, confirmAction, emptyState, formModal, pagination, statCard, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, toolbar } from '../ui/page.js';

const PLAY_STATUS = ['Zaplanowana', 'Zrealizowana', 'Odwołana'];
const STATUS_KIND = { 'Zaplanowana': 'accent', 'Zrealizowana': 'ok', 'Odwołana': 'danger' };

export default {
  id: 'studio',
  title: 'Studio',
  shortTitle: 'Studio',
  icon: '◍',
  group: 'Praca',
  permission: 'studio:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('studio:write');
    const canDelete = ctx.session.can('studio:delete');
    const view = { page: 1 };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openEditor(null) } }, '+ Nowa sesja')
      : null;

    root.appendChild(pageHeader({
      title: 'Studio',
      sub: 'Sesje nagraniowe, czas i koszty pracy w studiu.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      toolbar(el('span', { class: 'view__sub', text: 'Sortowanie: najnowsze sesje najpierw.' })),
      listHost
    ));

    function costOf(session) {
      return Math.round((Number(session.hours) || 0) * (Number(session.rate) || 0) * 100) / 100;
    }

    function draw() {
      const sessions = ctx.store.state.data.studioSessions;
      const currentMonth = todayISO().slice(0, 7);
      const hours = sum(sessions, (session) => session.hours);
      const totalCost = sum(sessions, (session) => costOf(session));
      const monthCost = sum(
        sessions.filter((session) => String(session.date || '').startsWith(currentMonth)),
        (session) => costOf(session)
      );

      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Sesje', value: sessions.length, hint: `${sessions.filter((s) => s.status === 'Zaplanowana').length} zaplanowanych` }),
        statCard({ label: 'Godziny', value: Math.round(hours * 10) / 10, hint: 'łącznie w studio' }),
        statCard({ label: 'Koszt sesji', value: fmtMoney(totalCost), hint: 'suma godzin × stawka' }),
        statCard({ label: 'Ten miesiąc', value: fmtMoney(monthCost), hint: currentMonth })
      );

      const sorted = sortBy(sessions, (session) => session.date || '', 'desc');
      const pageData = paginate(sorted, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!sorted.length) {
        listHost.appendChild(emptyState({
          title: 'Brak sesji studyjnych',
          hint: 'Zapisz pierwszą sesję, aby kontrolować czas i koszty nagrań.',
          actionLabel: canWrite ? 'Dodaj sesję' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Data'),
          el('th', {}, 'Sesja'),
          el('th', {}, 'Studio'),
          el('th', { class: 'num' }, 'Godz.'),
          el('th', { class: 'num' }, 'Stawka'),
          el('th', { class: 'num' }, 'Koszt'),
          el('th', {}, 'Status'),
          el('th', { class: 'right' }, 'Akcje')
        )),
        el('tbody', {}, pageData.items.map((session) => el('tr', {},
          el('td', { class: 'nowrap', text: fmtDate(session.date) }),
          el('td', {},
            el('div', { class: 'list__title', text: session.title }),
            session.notes ? el('div', { class: 'list__meta truncate', text: session.notes }) : null
          ),
          el('td', { class: 'truncate', text: session.studio || '—' }),
          el('td', { class: 'num', text: Number(session.hours || 0).toFixed(1) }),
          el('td', { class: 'num', text: fmtMoney(session.rate) }),
          el('td', { class: 'num', text: fmtMoney(costOf(session)) }),
          el('td', {}, badge(session.status || 'Zaplanowana', STATUS_KIND[session.status] ?? '')),
          el('td', { class: 'right' },
            canWrite
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                attrs: { 'aria-label': `Edytuj sesję ${session.title}` },
                on: { click: () => openEditor(session) }
              }, 'Edytuj')
              : null,
            canDelete
              ? el('button', {
                class: 'btn btn--sm btn--danger',
                type: 'button',
                style: { marginLeft: '6px' },
                attrs: { 'aria-label': `Usuń sesję ${session.title}` },
                on: { click: () => removeSession(session) }
              }, 'Usuń')
              : null
          )
        )))
      );

      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
      listHost.appendChild(pagination({
        ...pageData,
        label: 'sesji',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function openEditor(session) {
      const songs = ctx.store.state.data.songs;
      const fields = [
        { name: 'title', label: 'Nazwa sesji', type: 'text', value: session?.title ?? '', required: true },
        { name: 'date', label: 'Data', type: 'date', value: session?.date ?? todayISO(), required: true },
        { name: 'studio', label: 'Studio', type: 'text', value: session?.studio ?? '' },
        { name: 'hours', label: 'Godziny', type: 'number', value: session?.hours ?? '', hint: '0–24' },
        { name: 'rate', label: 'Stawka za godzinę', type: 'number', value: session?.rate ?? '', hint: 'Kwota w PLN' },
        { name: 'status', label: 'Status', type: 'select', options: PLAY_STATUS, value: session?.status ?? 'Zaplanowana' },
        {
          name: 'songId',
          label: 'Powiązany utwór',
          type: 'select',
          value: session?.songId ?? '',
          options: [{ value: '', label: '— brak —' }, ...songs.map((song) => ({ value: song.id, label: song.title }))]
        },
        { name: 'notes', label: 'Notatki', type: 'textarea', value: session?.notes ?? '', rows: 4 }
      ];

      formModal({
        title: session ? 'Edytuj sesję' : 'Nowa sesja studyjna',
        fields,
        wide: true,
        submitLabel: session ? 'Zapisz zmiany' : 'Dodaj sesję',
        onSubmit: async (raw) => {
          const title = validate.requireText(raw.title, 'Nazwa sesji', { max: 120 });
          const date = validate.requireDate(raw.date, 'Data');
          const studio = validate.optionalText(raw.studio, 'Studio', { max: 120 });
          const hours = String(raw.hours ?? '').trim() === ''
            ? 0
            : validate.requireNumber(raw.hours, 'Godziny', { min: 0, max: 24 });
          const rate = String(raw.rate ?? '').trim() === ''
            ? 0
            : validate.requireNumber(raw.rate, 'Stawka', { min: 0, max: 100000 });
          const status = validate.requireEnum(raw.status, PLAY_STATUS, 'Status');
          const notes = validate.optionalText(raw.notes, 'Notatki', { max: 3000 });
          const songId = raw.songId ? String(raw.songId) : null;
          if (songId && !songs.some((song) => song.id === songId)) {
            throw new AppError('Wybrany utwór nie istnieje.', 'song_missing');
          }

          ctx.session.require('studio:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (session) {
              const target = state.data.studioSessions.find((entry) => entry.id === session.id);
              if (!target) throw new AppError('Sesja nie istnieje.', 'studio_missing');
              Object.assign(target, { title, date, studio, hours, rate, status, songId, notes, updatedAt: timestamp });
              return;
            }
            state.data.studioSessions.push({
              id: uid('studio'),
              title,
              date,
              studio,
              hours,
              rate,
              status,
              songId,
              notes,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.toast(session ? 'Sesja zaktualizowana.' : 'Dodano sesję.', 'ok');
          return true;
        }
      });
    }

    async function removeSession(session) {
      const ok = await confirmAction({
        title: 'Usuń sesję',
        message: `Czy usunąć sesję „${session.title}” z ${fmtDate(session.date)}?`,
        confirmLabel: 'Usuń',
        danger: true
      });
      if (!ok) return;
      try {
        ctx.session.require('studio:delete');
        ctx.store.commit((state) => {
          state.data.studioSessions = state.data.studioSessions.filter((entry) => entry.id !== session.id);
        }, { immediate: true });
        toast('Sesja usunięta.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć sesji.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const sessions = store.state.data.studioSessions;
    const invalid = sessions.filter(
      (session) => !session.id || !session.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ''))
    );
    if (invalid.length) return { ok: false, message: `${invalid.length} sesji z nieprawidłową datą lub tytułem` };
    const badHours = sessions.filter((session) => Number(session.hours) < 0 || Number(session.hours) > 24);
    if (badHours.length) return { status: 'degraded', message: `${badHours.length} sesji poza zakresem 0–24 h` };
    return { ok: true, message: `${sessions.length} sesji, dane spójne` };
  }
};
