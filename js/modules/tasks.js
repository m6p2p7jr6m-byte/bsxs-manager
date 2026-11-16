import { clear, el, fmtDate, paginate, sortBy, todayISO, uid } from '../core/util.js';
import { AppError } from '../core/errors.js';
import { badge, confirmAction, emptyState, formModal, pagination, statCard, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, selectFilter, toolbar } from '../ui/page.js';

const PRIORITIES = ['Niski', 'Średni', 'Wysoki'];
const PRIORITY_KIND = { 'Niski': '', 'Średni': 'accent', 'Wysoki': 'danger' };

export default {
  id: 'tasks',
  title: 'Zadania',
  shortTitle: 'Zadania',
  icon: '✓',
  group: 'Praca',
  permission: 'tasks:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('tasks:write');
    const canDelete = ctx.session.can('tasks:delete');
    const view = { filter: 'open', page: 1 };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openEditor(null) } }, '+ Nowe zadanie')
      : null;

    const filter = selectFilter({
      label: 'Filtr zadań',
      value: view.filter,
      options: [
        { value: 'open', label: 'Do zrobienia' },
        { value: 'done', label: 'Zrobione' },
        { value: 'all', label: 'Wszystkie' },
        { value: 'overdue', label: 'Po terminie' }
      ],
      onChange: (value) => { view.filter = value; view.page = 1; draw(); }
    });

    const quickTitle = el('input', {
      type: 'text',
      placeholder: 'Szybkie dodanie zadania…',
      attrs: { 'aria-label': 'Tytuł nowego zadania', maxlength: '140' }
    });
    const quickSubmit = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Dodaj');

    const quickForm = el('form', {
      style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }
    },
      el('div', { style: { flex: '1 1 220px' } }, quickTitle),
      quickSubmit
    );
    quickForm.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const title = validate.requireText(quickTitle.value, 'Tytuł zadania', { max: 140 });
        ctx.session.require('tasks:write');
        const timestamp = new Date().toISOString();
        ctx.store.commit((state) => {
          state.data.tasks.push({
            id: uid('task'),
            title,
            due: '',
            priority: 'Średni',
            done: false,
            assignee: '',
            createdAt: timestamp,
            updatedAt: timestamp
          });
        }, { immediate: true });
        quickTitle.value = '';
        toast('Dodano zadanie.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się dodać zadania.', 'error');
      }
    });

    root.appendChild(pageHeader({
      title: 'Zadania',
      sub: 'Bieżąca praca nad karierą i projektami kolektywu.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      canWrite ? quickForm : null,
      toolbar(filter),
      listHost
    ));

    function isOverdue(task) {
      return !task.done && task.due && task.due < todayISO();
    }

    function draw() {
      const tasks = ctx.store.state.data.tasks;
      const open = tasks.filter((task) => !task.done);
      const overdue = tasks.filter(isOverdue);
      const doneToday = tasks.filter((task) => task.done && String(task.doneAt || '').startsWith(todayISO()));

      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Do zrobienia', value: open.length, hint: `${tasks.length} wszystkich` }),
        statCard({ label: 'Po terminie', value: overdue.length, hint: overdue.length ? 'wymaga uwagi' : 'wszystko na czas' }),
        statCard({ label: 'Zrobione dziś', value: doneToday.length, hint: fmtDate(todayISO()) }),
        statCard({ label: 'Wysoki priorytet', value: open.filter((task) => task.priority === 'Wysoki').length, hint: 'otwarte zadania' })
      );

      let filtered = tasks;
      if (view.filter === 'open') filtered = tasks.filter((task) => !task.done);
      else if (view.filter === 'done') filtered = tasks.filter((task) => task.done);
      else if (view.filter === 'overdue') filtered = tasks.filter(isOverdue);
      filtered = sortBy(
        filtered,
        (task) => `${task.done ? '1' : '0'}-${task.due || '9999-99-99'}-${task.priority}`,
        'asc'
      );

      const pageData = paginate(filtered, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!filtered.length) {
        listHost.appendChild(emptyState({
          title: tasks.length ? 'Nic tu nie ma' : 'Brak zadań',
          hint: tasks.length ? 'Zmień filtr, aby zobaczyć inne zadania.' : 'Dodaj pierwsze zadanie, aby zaplanować pracę.',
          actionLabel: canWrite && !tasks.length ? 'Dodaj zadanie' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const list = el('div', { class: 'list' });
      for (const task of pageData.items) {
        const checkbox = el('input', { type: 'checkbox', checked: Boolean(task.done), attrs: { 'aria-label': `Oznacz zadanie ${task.title} jako ${task.done ? 'niezrobione' : 'zrobione'}` } });
        if (canWrite) {
          checkbox.addEventListener('change', () => toggleDone(task, checkbox));
        } else {
          checkbox.disabled = true;
        }

        list.appendChild(el('div', { class: 'list__item' },
          checkbox,
          el('div', { class: 'list__main' },
            el('div', {
              class: 'list__title',
              text: task.title,
              style: task.done ? { textDecoration: 'line-through', color: 'var(--muted)' } : {}
            }),
            el('div', { class: 'list__meta' },
              [
                task.due ? `termin ${fmtDate(task.due)}` : 'bez terminu',
                task.assignee || null
              ].filter(Boolean).join(' · ')
            )
          ),
          isOverdue(task) ? badge('Po terminie', 'danger') : badge(task.priority, PRIORITY_KIND[task.priority] ?? ''),
          canWrite
            ? el('button', {
              class: 'btn btn--sm',
              type: 'button',
              attrs: { 'aria-label': `Edytuj zadanie ${task.title}` },
              on: { click: () => openEditor(task) }
            }, 'Edytuj')
            : null,
          canDelete
            ? el('button', {
              class: 'btn btn--sm btn--danger',
              type: 'button',
              attrs: { 'aria-label': `Usuń zadanie ${task.title}` },
              on: { click: () => removeTask(task) }
            }, 'Usuń')
            : null
        ));
      }

      listHost.appendChild(list);
      listHost.appendChild(pagination({
        ...pageData,
        label: 'zadań',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function toggleDone(task, checkbox) {
      try {
        ctx.session.require('tasks:write');
        const timestamp = new Date().toISOString();
        ctx.store.commit((state) => {
          const target = state.data.tasks.find((entry) => entry.id === task.id);
          if (!target) throw new AppError('Zadanie nie istnieje.', 'task_missing');
          target.done = !target.done;
          target.doneAt = target.done ? timestamp : null;
          target.updatedAt = timestamp;
        }, { immediate: true });
      } catch (err) {
        checkbox.checked = Boolean(task.done);
        toast(err.message ?? 'Nie udało się zaktualizować zadania.', 'error');
      }
    }

    function openEditor(task) {
      const fields = [
        { name: 'title', label: 'Zadanie', type: 'text', value: task?.title ?? '', required: true },
        { name: 'due', label: 'Termin', type: 'date', value: task?.due ?? '' },
        { name: 'priority', label: 'Priorytet', type: 'select', options: PRIORITIES, value: task?.priority ?? 'Średni' },
        { name: 'assignee', label: 'Odpowiedzialny', type: 'text', value: task?.assignee ?? '' },
        { name: 'done', label: 'Zrobione', type: 'checkbox', value: Boolean(task?.done) }
      ];

      formModal({
        title: task ? 'Edytuj zadanie' : 'Nowe zadanie',
        fields,
        submitLabel: task ? 'Zapisz zmiany' : 'Dodaj zadanie',
        onSubmit: async (raw) => {
          const title = validate.requireText(raw.title, 'Zadanie', { max: 140 });
          const due = validate.optionalDate(raw.due, 'Termin');
          const priority = validate.requireEnum(raw.priority, PRIORITIES, 'Priorytet');
          const assignee = validate.optionalText(raw.assignee, 'Odpowiedzialny', { max: 80 });
          const done = Boolean(raw.done);

          ctx.session.require('tasks:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (task) {
              const target = state.data.tasks.find((entry) => entry.id === task.id);
              if (!target) throw new AppError('Zadanie nie istnieje.', 'task_missing');
              Object.assign(target, {
                title, due, priority, assignee, done,
                doneAt: done ? (target.doneAt || timestamp) : null,
                updatedAt: timestamp
              });
              return;
            }
            state.data.tasks.push({
              id: uid('task'),
              title,
              due,
              priority,
              assignee,
              done,
              doneAt: done ? timestamp : null,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.toast(task ? 'Zadanie zaktualizowane.' : 'Dodano zadanie.', 'ok');
          return true;
        }
      });
    }

    async function removeTask(task) {
      const ok = await confirmAction({
        title: 'Usuń zadanie',
        message: `Czy usunąć zadanie „${task.title}”?`,
        confirmLabel: 'Usuń',
        danger: true
      });
      if (!ok) return;
      try {
        ctx.session.require('tasks:delete');
        ctx.store.commit((state) => {
          state.data.tasks = state.data.tasks.filter((entry) => entry.id !== task.id);
        }, { immediate: true });
        toast('Zadanie usunięte.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć zadania.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const tasks = store.state.data.tasks;
    const invalid = tasks.filter((task) => !task.id || !String(task.title || '').trim());
    if (invalid.length) return { ok: false, message: `${invalid.length} zadań bez tytułu` };
    return { ok: true, message: `${tasks.length} zadań, dane spójne` };
  }
};
