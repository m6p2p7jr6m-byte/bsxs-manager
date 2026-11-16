import {
  clear, el, fmtDate, fmtMoney, matchesSearch, paginate, sortBy, sum, todayISO, uid
} from '../core/util.js';
import { AppError } from '../core/errors.js';
import {
  badge, chart, confirmAction, emptyState, formModal, pagination, statCard, toast
} from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, searchBox, selectFilter, toolbar } from '../ui/page.js';

const KINDS = ['Przychód', 'Koszt'];
const CURRENCIES = ['PLN', 'EUR', 'USD', 'GBP'];
const CATEGORIES = ['Wydawnictwo', 'Studio', 'Sprzęt', 'Promocja', 'Marketing', 'Honoraria', 'Transport', 'Inne'];

export default {
  id: 'finances',
  title: 'Finanse',
  shortTitle: 'Finanse',
  icon: '◈',
  group: 'Praca',
  permission: 'finances:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('finances:write');
    const canDelete = ctx.session.can('finances:delete');
    const view = { query: '', kind: 'all', page: 1 };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const chartHost = el('div', { class: 'card' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openEditor(null) } }, '+ Nowy wpis')
      : null;

    const search = searchBox({
      placeholder: 'Szukaj opisu lub kategorii…',
      label: 'Szukaj wpisów finansowych',
      onInput: (value) => { view.query = value; view.page = 1; draw(); }
    });

    const filter = selectFilter({
      label: 'Filtr typu wpisu',
      value: view.kind,
      options: [{ value: 'all', label: 'Wszystkie wpisy' }, ...KINDS.map((kind) => ({ value: kind, label: kind }))],
      onChange: (value) => { view.kind = value; view.page = 1; draw(); }
    });

    root.appendChild(pageHeader({
      title: 'Finanse',
      sub: 'Przychody i koszty kariery oraz kolektywu.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { style: { marginTop: 'var(--space-4)' } }, chartHost));
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      toolbar(search, filter),
      listHost
    ));

    function lastSixMonths() {
      const months = [];
      const now = new Date();
      for (let index = 5; index >= 0; index -= 1) {
        const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
      return months;
    }

    function draw() {
      const entries = ctx.store.state.data.finances;
      const income = sum(entries.filter((entry) => entry.kind === 'Przychód'), (entry) => entry.amount);
      const expenses = sum(entries.filter((entry) => entry.kind === 'Koszt'), (entry) => entry.amount);
      const balance = income - expenses;
      const unsettled = entries.filter((entry) => !entry.settled).length;

      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Przychody', value: fmtMoney(income), hint: 'wszystkie wpisy' }),
        statCard({ label: 'Koszty', value: fmtMoney(expenses), hint: 'wszystkie wpisy' }),
        statCard({ label: 'Bilans', value: fmtMoney(balance), hint: balance >= 0 ? 'na plusie' : 'na minusie' }),
        statCard({ label: 'Nierozliczone', value: unsettled, hint: 'wpisy bez potwierdzenia' })
      );

      const months = lastSixMonths();
      const monthValues = months.map((month) => sum(
        entries.filter((entry) => entry.kind === 'Przychód' && String(entry.date || '').startsWith(month)),
        (entry) => entry.amount
      ));
      clear(chartHost);
      chartHost.append(
        el('div', { class: 'card__head' },
          el('h2', { text: 'Przychody — ostatnie 6 miesięcy' }),
          el('span', { class: 'view__sub', text: months[months.length - 1] })
        ),
        chart(monthValues, { label: 'Przychody w ostatnich sześciu miesiącach' }),
        el('div', { class: 'chart__legend' }, months.map((month, index) => el('span', {
          text: `${month.slice(5)}: ${Math.round(monthValues[index])}`
        })))
      );

      let filtered = entries.filter((entry) => matchesSearch(
        [entry.description, entry.category, entry.kind, entry.date].join(' '),
        view.query
      ));
      if (view.kind !== 'all') filtered = filtered.filter((entry) => entry.kind === view.kind);
      filtered = sortBy(filtered, (entry) => entry.date || '', 'desc');

      const pageData = paginate(filtered, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!filtered.length) {
        listHost.appendChild(emptyState({
          title: entries.length ? 'Brak wyników' : 'Brak wpisów finansowych',
          hint: entries.length
            ? 'Zmień filtr lub frazę wyszukiwania.'
            : 'Dodaj przychód lub koszt, aby śledzić bilans kariery.',
          actionLabel: canWrite && !entries.length ? 'Dodaj wpis' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Data'),
          el('th', {}, 'Typ'),
          el('th', {}, 'Kategoria'),
          el('th', {}, 'Opis'),
          el('th', { class: 'num' }, 'Kwota'),
          el('th', {}, 'Rozliczenie'),
          el('th', { class: 'right' }, 'Akcje')
        )),
        el('tbody', {}, pageData.items.map((entry) => el('tr', {},
          el('td', { class: 'nowrap', text: fmtDate(entry.date) }),
          el('td', {}, badge(entry.kind, entry.kind === 'Przychód' ? 'ok' : 'danger')),
          el('td', { text: entry.category || '—' }),
          el('td', { class: 'truncate', text: entry.description || '—' }),
          el('td', {
            class: 'num',
            text: `${entry.kind === 'Koszt' ? '−' : '+'}${fmtMoney(entry.amount, entry.currency || 'PLN')}`
          }),
          el('td', {}, badge(entry.settled ? 'Rozliczone' : 'Oczekuje', entry.settled ? 'ok' : 'warn')),
          el('td', { class: 'right' },
            canWrite
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                attrs: { 'aria-label': `Edytuj wpis ${entry.description || entry.category}` },
                on: { click: () => openEditor(entry) }
              }, 'Edytuj')
              : null,
            canDelete
              ? el('button', {
                class: 'btn btn--sm btn--danger',
                type: 'button',
                style: { marginLeft: '6px' },
                attrs: { 'aria-label': `Usuń wpis ${entry.description || entry.category}` },
                on: { click: () => removeEntry(entry) }
              }, 'Usuń')
              : null
          )
        )))
      );

      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
      listHost.appendChild(pagination({
        ...pageData,
        label: 'wpisów',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function openEditor(entry) {
      const fields = [
        { name: 'kind', label: 'Typ', type: 'select', options: KINDS, value: entry?.kind ?? 'Przychód' },
        { name: 'amount', label: 'Kwota', type: 'number', value: entry?.amount ?? '', required: true },
        { name: 'currency', label: 'Waluta', type: 'select', options: CURRENCIES, value: entry?.currency ?? 'PLN' },
        { name: 'category', label: 'Kategoria', type: 'select', options: CATEGORIES, value: entry?.category ?? 'Inne' },
        { name: 'date', label: 'Data', type: 'date', value: entry?.date ?? todayISO(), required: true },
        { name: 'description', label: 'Opis', type: 'text', value: entry?.description ?? '' },
        { name: 'settled', label: 'Rozliczone', type: 'checkbox', value: Boolean(entry?.settled) }
      ];

      formModal({
        title: entry ? 'Edytuj wpis' : 'Nowy wpis finansowy',
        fields,
        wide: true,
        submitLabel: entry ? 'Zapisz zmiany' : 'Dodaj wpis',
        onSubmit: async (raw) => {
          const kind = validate.requireEnum(raw.kind, KINDS, 'Typ');
          const amount = validate.requireMoney(raw.amount, 'Kwota');
          const currency = validate.requireEnum(raw.currency, CURRENCIES, 'Waluta');
          const category = validate.requireEnum(raw.category, CATEGORIES, 'Kategoria');
          const date = validate.requireDate(raw.date, 'Data');
          const description = validate.optionalText(raw.description, 'Opis', { max: 200 });
          const settled = Boolean(raw.settled);

          ctx.session.require('finances:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (entry) {
              const target = state.data.finances.find((item) => item.id === entry.id);
              if (!target) throw new AppError('Wpis nie istnieje.', 'finance_missing');
              Object.assign(target, { kind, amount, currency, category, date, description, settled, updatedAt: timestamp });
              return;
            }
            state.data.finances.push({
              id: uid('fin'),
              kind,
              amount,
              currency,
              category,
              date,
              description,
              settled,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.toast(entry ? 'Wpis zaktualizowany.' : 'Dodano wpis.', 'ok');
          return true;
        }
      });
    }

    async function removeEntry(entry) {
      const ok = await confirmAction({
        title: 'Usuń wpis finansowy',
        message: `Czy usunąć wpis „${entry.description || entry.category}” na ${fmtMoney(entry.amount, entry.currency)}?`,
        confirmLabel: 'Usuń',
        danger: true
      });
      if (!ok) return;
      try {
        ctx.session.require('finances:delete');
        ctx.store.commit((state) => {
          state.data.finances = state.data.finances.filter((item) => item.id !== entry.id);
        }, { immediate: true });
        toast('Wpis usunięty.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć wpisu.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const entries = store.state.data.finances;
    const invalid = entries.filter(
      (entry) => !entry.id || !KINDS.includes(entry.kind) || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) < 0
    );
    if (invalid.length) return { ok: false, message: `${invalid.length} wpisów z nieprawidłową kwotą lub typem` };
    return { ok: true, message: `${entries.length} wpisów, dane spójne` };
  }
};
