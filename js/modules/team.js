import { clear, el, fmtDate, matchesSearch, paginate, sortBy, uid } from '../core/util.js';
import { AppError } from '../core/errors.js';
import { badge, confirmAction, emptyState, formModal, pagination, statCard, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, searchBox, toolbar } from '../ui/page.js';

export default {
  id: 'team',
  title: 'Kolektyw',
  shortTitle: 'Kolektyw',
  icon: '◉',
  group: 'Zespół',
  permission: 'team:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('team:write');
    const canDelete = ctx.session.can('team:delete');
    const view = { query: '', page: 1 };

    const summaryHost = el('div', { class: 'grid grid--stats' });
    const listHost = el('div');

    const addButton = canWrite
      ? el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => openEditor(null) } }, '+ Nowa osoba')
      : null;

    const search = searchBox({
      placeholder: 'Szukaj osoby lub roli…',
      label: 'Szukaj w kolektywie',
      onInput: (value) => { view.query = value; view.page = 1; draw(); }
    });

    root.appendChild(pageHeader({
      title: 'Kolektyw',
      sub: 'Osoby tworzące BSXS — role, kontakt i zgody.',
      tools: [addButton]
    }));
    root.appendChild(summaryHost);
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      toolbar(search),
      listHost
    ));

    function draw() {
      const members = ctx.store.state.data.members;
      clear(summaryHost);
      summaryHost.append(
        statCard({ label: 'Osoby', value: members.length, hint: 'w kolektywie' }),
        statCard({
          label: 'Role',
          value: new Set(members.map((member) => (member.role || '').trim().toLowerCase()).filter(Boolean)).size,
          hint: 'unikalne funkcje'
        }),
        statCard({ label: 'Zgody marketingowe', value: members.filter((member) => member.consentMarketing).length, hint: 'wyrażone' }),
        statCard({ label: 'Bez kontaktu', value: members.filter((member) => !member.email && !member.phone).length, hint: 'brak e-maila i telefonu' })
      );

      let filtered = members.filter((member) => matchesSearch(
        [member.name, member.role, member.email, member.notes].join(' '),
        view.query
      ));
      filtered = sortBy(filtered, (member) => member.name || '', 'asc');

      const pageData = paginate(filtered, view.page, ctx.store.state.data.settings.pageSize);
      view.page = pageData.page;
      clear(listHost);

      if (!filtered.length) {
        listHost.appendChild(emptyState({
          title: members.length ? 'Brak wyników' : 'Kolektyw jest pusty',
          hint: members.length ? 'Zmień frazę wyszukiwania.' : 'Dodaj osoby współtworzące BSXS.',
          actionLabel: canWrite && !members.length ? 'Dodaj osobę' : null,
          onAction: canWrite ? () => openEditor(null) : null
        }));
        return;
      }

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Osoba'),
          el('th', {}, 'Rola'),
          el('th', {}, 'Kontakt'),
          el('th', {}, 'Zgoda marketingowa'),
          el('th', {}, 'Dodano'),
          el('th', { class: 'right' }, 'Akcje')
        )),
        el('tbody', {}, pageData.items.map((member) => el('tr', {},
          el('td', {},
            el('div', { class: 'list__title', text: member.name }),
            member.notes ? el('div', { class: 'list__meta truncate', text: member.notes }) : null
          ),
          el('td', { text: member.role || '—' }),
          el('td', {},
            member.email ? el('div', { text: member.email }) : null,
            member.phone ? el('div', { class: 'list__meta', text: member.phone }) : null,
            !member.email && !member.phone ? el('span', { class: 'view__sub', text: '—' }) : null
          ),
          el('td', {}, badge(member.consentMarketing ? 'Tak' : 'Nie', member.consentMarketing ? 'ok' : '')),
          el('td', { class: 'nowrap', text: fmtDate(member.createdAt) }),
          el('td', { class: 'right' },
            canWrite
              ? el('button', {
                class: 'btn btn--sm',
                type: 'button',
                attrs: { 'aria-label': `Edytuj osobę ${member.name}` },
                on: { click: () => openEditor(member) }
              }, 'Edytuj')
              : null,
            canDelete
              ? el('button', {
                class: 'btn btn--sm btn--danger',
                type: 'button',
                style: { marginLeft: '6px' },
                attrs: { 'aria-label': `Usuń osobę ${member.name}` },
                on: { click: () => removeMember(member) }
              }, 'Usuń')
              : null
          )
        )))
      );

      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
      listHost.appendChild(pagination({
        ...pageData,
        label: 'osób',
        onChange: (nextPage) => { view.page = nextPage; draw(); }
      }));
    }

    function openEditor(member) {
      const fields = [
        { name: 'name', label: 'Imię i nazwisko / pseudonim', type: 'text', value: member?.name ?? '', required: true },
        { name: 'role', label: 'Rola w kolektywie', type: 'text', value: member?.role ?? '' },
        { name: 'email', label: 'E-mail', type: 'email', value: member?.email ?? '' },
        { name: 'phone', label: 'Telefon', type: 'tel', value: member?.phone ?? '' },
        { name: 'consentMarketing', label: 'Zgoda na kontakt marketingowy', type: 'checkbox', value: Boolean(member?.consentMarketing) },
        { name: 'notes', label: 'Notatki', type: 'textarea', value: member?.notes ?? '', rows: 3 }
      ];

      formModal({
        title: member ? 'Edytuj osobę' : 'Nowa osoba',
        fields,
        wide: true,
        submitLabel: member ? 'Zapisz zmiany' : 'Dodaj osobę',
        onSubmit: async (raw) => {
          const name = validate.requireText(raw.name, 'Imię i nazwisko', { max: 100 });
          const role = validate.optionalText(raw.role, 'Rola', { max: 60 });
          const email = validate.optionalEmail(raw.email);
          const phone = validate.requirePhone(raw.phone);
          const notes = validate.optionalText(raw.notes, 'Notatki', { max: 2000 });
          const consentMarketing = Boolean(raw.consentMarketing);

          ctx.session.require('team:write');
          const timestamp = new Date().toISOString();
          ctx.store.commit((state) => {
            if (member) {
              const target = state.data.members.find((entry) => entry.id === member.id);
              if (!target) throw new AppError('Osoba nie istnieje.', 'member_missing');
              Object.assign(target, { name, role, email, phone, notes, consentMarketing, updatedAt: timestamp });
              return;
            }
            state.data.members.push({
              id: uid('member'),
              name,
              role,
              email,
              phone,
              notes,
              consentMarketing,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }, { immediate: true });

          ctx.toast(member ? 'Dane osoby zaktualizowane.' : 'Dodano osobę.', 'ok');
          return true;
        }
      });
    }

    async function removeMember(member) {
      const ok = await confirmAction({
        title: 'Usuń osobę',
        message: `Czy usunąć „${member.name}” z kolektywu?`,
        confirmLabel: 'Usuń',
        danger: true,
        note: 'Dane kontaktowe zostaną usunięte zgodnie z zasadą minimalizacji danych.'
      });
      if (!ok) return;
      try {
        ctx.session.require('team:delete');
        ctx.store.commit((state) => {
          state.data.members = state.data.members.filter((entry) => entry.id !== member.id);
        }, { immediate: true });
        toast('Osoba usunięta.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć osoby.', 'error');
      }
    }

    const unsubscribe = ctx.store.subscribe(() => draw());
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const members = store.state.data.members;
    const invalidEmail = members.filter(
      (member) => member.email && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(member.email)
    );
    if (invalidEmail.length) return { status: 'degraded', message: `${invalidEmail.length} nieprawidłowych adresów e-mail` };
    const invalidName = members.filter((member) => !member.id || !String(member.name || '').trim());
    if (invalidName.length) return { ok: false, message: `${invalidName.length} osób bez nazwy` };
    return { ok: true, message: `${members.length} osób, dane spójne` };
  }
};
