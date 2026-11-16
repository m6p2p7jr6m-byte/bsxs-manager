import {
  clear, el, fmtDate, fmtMoney, sortBy, sum, todayISO, uid
} from '../core/util.js';
import { badge, chart, confirmAction, emptyState, statCard, toast } from '../core/ui.js';
import { pageHeader } from '../ui/page.js';
import { ROLE_LABELS } from '../core/authz.js';

export default {
  id: 'dashboard',
  title: 'Pulpit',
  shortTitle: 'Pulpit',
  icon: '⊞',
  group: 'Praca',
  permission: null,

  mount(root, ctx) {
    const user = ctx.session.user;
    const host = el('div');
    root.appendChild(pageHeader({
      title: `Cześć, ${user.displayName}`,
      sub: `${fmtDate(todayISO())} · ${ROLE_LABELS[user.role] || user.role} · przegląd kariery XARO i BSXS`
    }));
    root.appendChild(host);

    function seedDemoIfPossible() {
      return ctx.session.can('songs:write') && ctx.session.can('tasks:write');
    }

    function draw() {
      const state = ctx.store.state;
      const songs = state.data.songs;
      const releases = state.data.releases;
      const tasks = state.data.tasks;
      const finances = state.data.finances;
      const studio = state.data.studioSessions;

      const income = sum(finances.filter((entry) => entry.kind === 'Przychód'), (entry) => entry.amount);
      const expenses = sum(finances.filter((entry) => entry.kind === 'Koszt'), (entry) => entry.amount);
      const openTasks = tasks.filter((task) => !task.done);
      const overdue = openTasks.filter((task) => task.due && task.due < todayISO());
      const today = todayISO();
      const upcomingRelease = releases
        .filter((release) => release.date && release.date >= today && release.status !== 'Wydane')
        .sort((a, b) => (a.date > b.date ? 1 : -1))[0];
      const empty = songs.length === 0 && releases.length === 0 && tasks.length === 0 && finances.length === 0;

      clear(host);

      if (state.loadReport?.recovered) {
        host.appendChild(el('div', { class: 'notice notice--warn' },
          `Dane zostały odzyskane z kopii awaryjnej (${state.loadReport.source}). Sprawdź zawartość i utwórz kopię zapasową.`
        ));
      }
      if (ctx.store.driver.kind === 'memory') {
        host.appendChild(el('div', { class: 'notice notice--danger' },
          'Pamięć trwała jest niedostępna — dane znikną po zamknięciu karty. Wyeksportuj kopię zapasową.'
        ));
      }
      if (ctx.store.hasUnsavedChanges()) {
        host.appendChild(el('div', { class: 'notice' },
          'Trwa autozapis zmian… Jeśli chcesz wymusić zapis, otwórz Ustawienia i użyj „Zapisz teraz”.'
        ));
      }
      if (ctx.store.lastError) {
        host.appendChild(el('div', { class: 'notice notice--danger', text: ctx.store.lastError.message || 'Problem z zapisem danych.' }));
      }

      host.appendChild(el('div', { class: 'grid grid--stats' },
        statCard({ label: 'Utwory', value: songs.length, hint: `${songs.filter((song) => song.status === 'Wydany').length} wydanych` }),
        statCard({ label: 'Wydawnictwa', value: releases.length, hint: upcomingRelease ? `premiera ${fmtDate(upcomingRelease.date)}` : 'brak zaplanowanej premiery' }),
        statCard({ label: 'Zadania otwarte', value: openTasks.length, hint: overdue.length ? `${overdue.length} po terminie` : 'wszystko na czas' }),
        statCard({
          label: 'Bilans',
          value: fmtMoney(income - expenses),
          hint: `przychody ${fmtMoney(income)}`
        })
      ));

      const songsByStatus = ['Pomysł', 'Demo', 'Nagranie', 'Miks', 'Master', 'Wydany']
        .map((status) => songs.filter((song) => song.status === status).length);

      const months = [];
      const now = new Date();
      for (let index = 5; index >= 0; index -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
      const monthIncome = months.map((month) => sum(
        finances.filter((entry) => entry.kind === 'Przychód' && String(entry.date || '').startsWith(month)),
        (entry) => entry.amount
      ));

      host.appendChild(el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Utwory wg statusu' })),
          songs.length
            ? chart(songsByStatus, { label: 'Liczba utworów w każdym statusie' })
            : el('div', { class: 'view__sub', text: 'Brak danych.' }),
          el('div', { class: 'chart__legend' }, ['Pomysł', 'Demo', 'Nagranie', 'Miks', 'Master', 'Wydany'].map(
            (label, index) => el('span', { text: `${label}: ${songsByStatus[index]}` })
          ))
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Przychody (6 mies.)' })),
          monthIncome.some((value) => value > 0)
            ? chart(monthIncome, { alt: true, label: 'Przychody w ostatnich sześciu miesiącach' })
            : el('div', { class: 'view__sub', text: 'Brak przychodów w tym okresie.' }),
          el('div', { class: 'chart__legend' }, months.map((month, index) => el('span', {
            text: `${month.slice(5)}: ${Math.round(monthIncome[index])}`
          })))
        )
      ));

      const nextTasks = sortBy(openTasks, (task) => task.due || '9999-99-99', 'asc').slice(0, 5);
      host.appendChild(el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card' },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Najbliższe zadania' }),
            el('button', { class: 'btn btn--sm', type: 'button', on: { click: () => ctx.navigate('tasks') } }, 'Wszystkie')
          ),
          nextTasks.length
            ? el('div', { class: 'list' }, nextTasks.map((task) => el('div', { class: 'list__item' },
              el('div', { class: 'list__main' },
                el('div', { class: 'list__title', text: task.title }),
                el('div', { class: 'list__meta', text: [task.due ? fmtDate(task.due) : 'bez terminu', task.priority].join(' · ') })
              ),
              task.due && task.due < today ? badge('Po terminie', 'danger') : null
            )))
            : el('div', { class: 'view__sub', text: 'Brak otwartych zadań.' })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'card__head' }, el('h2', { text: 'Szybkie działania' })),
          el('div', { class: 'list' },
            quickAction('Dodaj utwór', 'songs', ctx, ctx.session.can('songs:write')),
            quickAction('Zaplanuj wydawnictwo', 'releases', ctx, ctx.session.can('releases:write')),
            quickAction('Zapisz sesję studyjną', 'studio', ctx, ctx.session.can('studio:write')),
            quickAction('Ustawienia i kopie zapasowe', 'settings', ctx, true),
            quickAction('Diagnostyka i testy', 'diagnostics', ctx, ctx.session.can('diagnostics:read'))
          ),
          el('div', { class: 'view__sub', style: { marginTop: 'var(--space-3)' } },
            `Sesje studyjne: ${studio.length} · osoby w kolektywie: ${state.data.members.length}`)
        )
      ));

      if (empty) {
        host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
          emptyState({
            title: 'Pusty pulpit',
            hint: 'Możesz zacząć od własnych danych lub wczytać przykład, aby zobaczyć, jak działają moduły.',
            actionLabel: seedDemoIfPossible() ? 'Wczytaj dane demonstracyjne' : null,
            onAction: () => seedDemo()
          })
        ));
      }
    }

    function quickAction(label, route, ctxRef, allowed) {
      return el('button', {
        class: 'btn',
        type: 'button',
        style: { justifyContent: 'flex-start', width: '100%' },
        disabled: !allowed,
        on: { click: () => ctxRef.navigate(route) }
      }, label);
    }

    async function seedDemo() {
      const ok = await confirmAction({
        title: 'Dane demonstracyjne',
        message: 'Dodać przykładowe utwory, wydawnictwo, sesję, zadania i wpisy finansowe?',
        confirmLabel: 'Dodaj przykład',
        note: 'Dane można później usunąć ręcznie lub przywrócić migawkę.'
      });
      if (!ok) return;
      try {
        ctx.session.require('songs:write');
        ctx.session.require('tasks:write');
        const timestamp = new Date().toISOString();
        const releaseId = uid('release');
        const songId = uid('song');
        const day = (offset) => {
          const date = new Date();
          date.setDate(date.getDate() + offset);
          return date.toISOString().slice(0, 10);
        };
        ctx.store.commit((state) => {
          state.data.releases.push({
            id: releaseId,
            title: 'Noc nad Wisłą',
            type: 'single',
            date: day(21),
            status: 'W produkcji',
            distributor: '',
            upc: '',
            notes: 'Przykładowe wydawnictwo.',
            createdAt: timestamp,
            updatedAt: timestamp
          });
          state.data.songs.push(
            {
              id: songId,
              title: 'Noc nad Wisłą',
              artist: 'XARO',
              status: 'Miks',
              bpm: 128,
              keySig: 'Am',
              isrc: '',
              tags: ['bsxs', 'single'],
              notes: 'Przykładowy utwór — możesz go edytować lub usunąć.',
              releaseId,
              createdAt: timestamp,
              updatedAt: timestamp
            },
            {
              id: uid('song'),
              title: 'Szkic bez tytułu',
              artist: 'XARO',
              status: 'Pomysł',
              bpm: null,
              keySig: '',
              isrc: '',
              tags: [],
              notes: '',
              releaseId: null,
              createdAt: timestamp,
              updatedAt: timestamp
            }
          );
          state.data.studioSessions.push({
            id: uid('studio'),
            title: 'Sesja miksowa — Noc nad Wisłą',
            date: day(-3),
            studio: 'Studio BSXS',
            hours: 4,
            rate: 120,
            status: 'Zrealizowana',
            songId,
            notes: 'Przykładowa sesja.',
            createdAt: timestamp,
            updatedAt: timestamp
          });
          state.data.tasks.push(
            {
              id: uid('task'),
              title: 'Zatwierdzić okładkę singla',
              due: day(5),
              priority: 'Wysoki',
              done: false,
              assignee: user.displayName,
              createdAt: timestamp,
              updatedAt: timestamp
            },
            {
              id: uid('task'),
              title: 'Wysłać master do dystrybucji',
              due: day(12),
              priority: 'Średni',
              done: false,
              assignee: '',
              createdAt: timestamp,
              updatedAt: timestamp
            }
          );
          if (ctx.session.can('finances:write')) {
            state.data.finances.push(
              {
                id: uid('fin'),
                kind: 'Przychód',
                amount: 1500,
                currency: 'PLN',
                category: 'Wydawnictwo',
                date: day(-20),
                description: 'Zaliczka za koncert',
                settled: true,
                createdAt: timestamp,
                updatedAt: timestamp
              },
              {
                id: uid('fin'),
                kind: 'Koszt',
                amount: 480,
                currency: 'PLN',
                category: 'Studio',
                date: day(-3),
                description: 'Sesja miksowa',
                settled: true,
                createdAt: timestamp,
                updatedAt: timestamp
              }
            );
          }
          state.data.meta.demoSeeded = true;
        }, { immediate: true });
        toast('Dodano dane demonstracyjne.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się dodać danych.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const state = store.state;
    const counts = {
      songs: state.data.songs.length,
      releases: state.data.releases.length,
      tasks: state.data.tasks.length,
      finances: state.data.finances.length
    };
    if (state.loadReport?.recovered) {
      return { status: 'degraded', message: `Dane odzyskane z kopii: ${state.loadReport.source}` };
    }
    return { ok: true, message: `Dane: ${counts.songs} utworów, ${counts.releases} wydawnictw, ${counts.tasks} zadań` };
  }
};
