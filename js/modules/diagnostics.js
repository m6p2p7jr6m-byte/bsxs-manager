import { clear, download, el, fmtDateTime, fmtTime, timestampForFilename } from '../core/util.js';
import { badge, confirmAction, emptyState, toast, withBusy } from '../core/ui.js';
import { pageHeader } from '../ui/page.js';

const TABS = [
  { id: 'overview', label: 'Przegląd' },
  { id: 'logs', label: 'Logi' },
  { id: 'errors', label: 'Błędy' },
  { id: 'crashes', label: 'Awarie' },
  { id: 'latency', label: 'Czasy' },
  { id: 'tests', label: 'Testy' },
  { id: 'report', label: 'Raport' }
];

export default {
  id: 'diagnostics',
  title: 'Diagnostyka',
  shortTitle: 'Diagnostyka',
  icon: '⌂',
  group: 'System',
  permission: 'diagnostics:read',

  mount(root, ctx) {
    let tab = 'overview';
    let report = null;
    let busy = false;

    const tabsHost = el('div');
    const contentHost = el('div');

    const actions = el('div', { class: 'view__tools' });

    root.appendChild(pageHeader({
      title: 'Diagnostyka',
      sub: 'Logi, błędy, historia awarii, czasy odpowiedzi, stan modułów i raport.',
      tools: [actions]
    }));
    root.appendChild(tabsHost);
    root.appendChild(contentHost);

    function drawTabs() {
      clear(tabsHost);
      const tabs = el('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Sekcje diagnostyki' } });
      for (const item of TABS) {
        tabs.appendChild(el('button', {
          class: 'tab',
          type: 'button',
          attrs: {
            role: 'tab',
            'aria-selected': item.id === tab ? 'true' : 'false'
          },
          on: { click: () => { tab = item.id; draw(); } }
        }, item.label));
      }
      tabsHost.appendChild(tabs);
    }

    function drawActions() {
      clear(actions);
      const testsButton = el('button', { class: 'btn btn--primary', type: 'button' }, 'Uruchom testy');
      testsButton.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        await withBusy(testsButton, async () => {
          try {
            // Testy wczytywane dopiero po naciśnięciu — awaria zestawu testów
            // nie może zablokować całej diagnostyki ani startu aplikacji.
            const { runAllTests } = await import('../tests/suites.js');
            const summary = await runAllTests({ logger: ctx.logger, ctx });
            ctx.store.setLastTestRun(summary);
            ctx.logger.info('Uruchomiono testy aplikacji.', {
              passed: summary.passed, failed: summary.failed, total: summary.total
            });
            toast(`Testy: ${summary.passed}/${summary.total} zaliczone, ${summary.failed} niezaliczone.`,
              summary.failed ? 'error' : 'ok', { duration: 6000 });
            tab = 'tests';
            draw();
          } catch (err) {
            ctx.logger.crash(err, { phase: 'tests' });
            toast(`Nie udało się uruchomić testów: ${err.message}`, 'error');
          }
        });
        busy = false;
      });

      const checksButton = el('button', { class: 'btn', type: 'button' }, 'Sprawdź moduły');
      checksButton.addEventListener('click', async () => {
        await withBusy(checksButton, async () => {
          try {
            await ctx.diagnostics.runChecks(ctx);
            ctx.logger.info('Wykonano sprawdzenie stanu modułów.');
            toast('Sprawdzono moduły.', 'ok');
            draw();
          } catch (err) {
            toast(err.message ?? 'Nie udało się sprawdzić modułów.', 'error');
          }
        });
      });

      const exportButton = el('button', { class: 'btn', type: 'button' }, 'Eksportuj logi');
      exportButton.addEventListener('click', () => exportLogs());

      actions.append(testsButton, checksButton, exportButton);
      if (ctx.session.can('diagnostics:manage')) {
        const clearButton = el('button', { class: 'btn btn--danger', type: 'button' }, 'Wyczyść logi');
        clearButton.addEventListener('click', async () => {
          const ok = await confirmAction({
            title: 'Wyczyść logi',
            message: 'Usunąć wszystkie logi, błędy i historię awarii z tej sesji?',
            confirmLabel: 'Wyczyść',
            danger: true
          });
          if (!ok) return;
          ctx.logger.clear();
          toast('Logi wyczyszczone.', 'ok');
          draw();
        });
        actions.appendChild(clearButton);
      }
    }

    async function exportLogs() {
      try {
        const diagnosticsReport = await ctx.diagnostics.report({
          store: ctx.store,
          session: ctx.session,
          tests: ctx.store.state.diagnostics.lastTestRun
        });
        const payload = ctx.logger.exportObject({ diagnostics: diagnosticsReport });
        download(`${timestampForFilename('bsxs-logs')}.json`, JSON.stringify(payload, null, 2), 'application/json');
        ctx.logger.info('Wyeksportowano logi diagnostyczne.');
        toast('Logi wyeksportowane (dane poufne zredagowane).', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się wyeksportować logów.', 'error');
      }
    }

    function logList(entries, emptyMessage) {
      if (!entries.length) return emptyState({ title: emptyMessage, hint: 'Brak wpisów.' });
      const list = el('div', { class: 'logs' });
      for (const entry of [...entries].reverse()) {
        list.appendChild(el('div', { class: `log log--${entry.level === 'crash' ? 'crash' : entry.level}` },
          el('div', { class: 'log__head' },
            el('span', { text: fmtTime(entry.ts) }),
            el('span', { text: entry.level.toUpperCase() }),
            el('span', { text: entry.id })
          ),
          el('div', { class: 'log__msg', text: entry.message }),
          entry.context
            ? el('pre', { text: JSON.stringify(entry.context, null, 2) })
            : null
        ));
      }
      return list;
    }

    function overviewView() {
      const modules = ctx.diagnostics.moduleStatus();
      const counts = ctx.logger.counts();
      const stats = ctx.store.storageStats();
      const failed = modules.filter((module) => module.status === 'error').length;
      const degraded = modules.filter((module) => module.status === 'degraded').length;

      const wrapper = el('div', {});
      wrapper.appendChild(el('div', { class: 'grid grid--stats' },
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Moduły' }),
          el('div', { class: 'stat__value', text: `${modules.length - failed}/${modules.length}` }),
          el('div', { class: 'stat__hint', text: `${failed} błędów · ${degraded} ostrzeżeń` })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Logi / błędy / awarie' }),
          el('div', { class: 'stat__value', text: `${counts.logs}/${counts.errors}/${counts.crashes}` }),
          el('div', { class: 'stat__hint', text: 'od uruchomienia aplikacji' })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Zapis danych' }),
          el('div', { class: 'stat__value', text: stats.lastSavedAt ? fmtTime(stats.lastSavedAt) : '—' }),
          el('div', { class: 'stat__hint', text: stats.dirty ? 'trwa zapis…' : 'dane zapisane' })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Pamięć' }),
          el('div', { class: 'stat__value', text: `${Math.round(stats.bytes / 102.4) / 10} KB` }),
          el('div', { class: 'stat__hint', text: stats.driver })
        )
      ));

      const table = el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'Moduł'),
          el('th', {}, 'Stan'),
          el('th', {}, 'Komunikat'),
          el('th', {}, 'Sprawdzono')
        )),
        el('tbody', {}, modules.map((module) => el('tr', {},
          el('td', { text: module.title }),
          el('td', {},
            badge(
              module.status === 'ok' ? 'OK' : module.status === 'error' ? 'Błąd' : module.status === 'degraded' ? 'Ostrzeżenie' : 'Nie sprawdzono',
              module.status === 'ok' ? 'ok' : module.status === 'error' ? 'danger' : 'warn'
            )
          ),
          el('td', { text: module.message }),
          el('td', { class: 'nowrap', text: module.checkedAt ? fmtDateTime(module.checkedAt) : '—' })
        )))
      );

      wrapper.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Stan modułów' }),
          el('span', { class: 'view__sub', text: `${modules.length} zarejestrowanych` })
        ),
        el('div', { class: 'table-wrap' }, table)
      ));

      return wrapper;
    }

    function latencyView() {
      const stats = ctx.diagnostics.stats();
      if (!stats.length) return emptyState({ title: 'Brak pomiarów', hint: 'Czasy pojawią się po użyciu aplikacji.' });
      return el('div', { class: 'card' },
        el('div', { class: 'card__head' }, el('h2', { text: 'Czasy odpowiedzi operacji' })),
        el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {},
            el('th', {}, 'Operacja'),
            el('th', { class: 'num' }, 'Średnia'),
            el('th', { class: 'num' }, 'p95'),
            el('th', { class: 'num' }, 'Maks.'),
            el('th', { class: 'num' }, 'Próbki'),
            el('th', { class: 'num' }, 'Błędy')
          )),
          el('tbody', {}, stats.map((row) => el('tr', {},
            el('td', { class: 'mono', text: row.name }),
            el('td', { class: 'num', text: `${row.avg.toFixed(1)} ms` }),
            el('td', { class: 'num', text: `${row.p95.toFixed(1)} ms` }),
            el('td', { class: 'num', text: `${row.max.toFixed(1)} ms` }),
            el('td', { class: 'num', text: row.count }),
            el('td', { class: 'num', text: row.failures })
          )))
        ))
      );
    }

    function testsView() {
      const lastRun = ctx.store.state.diagnostics.lastTestRun;
      if (!lastRun) {
        return emptyState({
          title: 'Testy nie zostały uruchomione w tej instalacji',
          hint: 'Kliknij „Uruchom testy”, aby sprawdzić moduły. Wynik zostanie zapisany wraz ze znacznikiem czasu.',
          actionLabel: 'Uruchom testy',
          onAction: () => {
            tab = 'tests';
            actions.querySelector('button')?.click();
          }
        });
      }
      const summary = el('div', { class: 'grid grid--stats' },
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Zaliczone' }),
          el('div', { class: 'stat__value', text: `${lastRun.passed}/${lastRun.total}` }),
          el('div', { class: 'stat__hint', text: fmtDateTime(lastRun.finishedAt) })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Niezaliczone' }),
          el('div', { class: 'stat__value', text: String(lastRun.failed) }),
          el('div', { class: 'stat__hint', text: lastRun.failed ? 'wymaga naprawy' : 'brak błędów' })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Pominięte' }),
          el('div', { class: 'stat__value', text: String(lastRun.skipped || 0) }),
          el('div', { class: 'stat__hint', text: 'ze względu na środowisko' })
        ),
        el('div', { class: 'card' },
          el('div', { class: 'stat__label', text: 'Czas' }),
          el('div', { class: 'stat__value', text: `${Math.round(lastRun.durationMs)} ms` }),
          el('div', { class: 'stat__hint', text: `${lastRun.suites.length} zestawów` })
        )
      );

      const suites = el('div', { class: 'list' });
      for (const suite of lastRun.suites) {
        const failedTests = suite.tests.filter((test) => test.status === 'failed');
        const skippedTests = suite.tests.filter((test) => test.status === 'skipped');
        suites.appendChild(el('div', { class: 'list__item', style: { alignItems: 'flex-start' } },
          el('div', { class: 'list__main' },
            el('div', { class: 'list__title', text: `${suite.name} — ${suite.passed}/${suite.total}` }),
            el('div', { class: 'list__meta' },
              failedTests.map((test) => el('div', { text: `✗ ${test.name}: ${test.message || 'błąd'}` })),
              skippedTests.map((test) => el('div', { text: `– ${test.name}: ${test.message}` })),
              !failedTests.length && !skippedTests.length
                ? el('div', { text: 'wszystkie testy zaliczone' })
                : null
            )
          ),
          badge(
            suite.failed ? 'Błąd' : suite.skipped ? 'Częściowo' : 'OK',
            suite.failed ? 'danger' : suite.skipped ? 'warn' : 'ok'
          )
        ));
      }

      return el('div', {},
        summary,
        el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
          el('div', { class: 'card__head' },
            el('h2', { text: 'Wyniki zestawów' }),
            el('span', { class: 'view__sub', text: lastRun.environment || '' })
          ),
          suites
        )
      );
    }

    async function reportView() {
      if (!report) {
        try {
          report = await ctx.diagnostics.report({
            store: ctx.store,
            session: ctx.session,
            tests: ctx.store.state.diagnostics.lastTestRun
          });
        } catch (err) {
          return el('div', { class: 'notice notice--danger', text: `Nie udało się zbudować raportu: ${err.message}` });
        }
      }
      const text = ctx.diagnostics.reportText(report);
      return el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Raport diagnostyczny' }),
          el('button', {
            class: 'btn btn--sm',
            type: 'button',
            on: {
              click: () => download(`${timestampForFilename('bsxs-raport')}.txt`, text, 'text/plain')
            }
          }, 'Pobierz .txt'),
          el('button', {
            class: 'btn btn--sm',
            type: 'button',
            on: {
              click: () => download(`${timestampForFilename('bsxs-raport')}.json`, JSON.stringify(report, null, 2), 'application/json')
            }
          }, 'Pobierz .json'),
          el('button', {
            class: 'btn btn--sm',
            type: 'button',
            on: { click: () => { report = null; draw(); } }
          }, 'Odśwież')
        ),
        el('pre', { class: 'code', text })
      );
    }

    function draw() {
      drawActions();
      drawTabs();
      clear(contentHost);

      if (tab === 'logs') {
        contentHost.appendChild(el('div', { class: 'card' },
          el('h2', { text: 'Logi aplikacji' }),
          logList(ctx.logger.logs, 'Brak logów')
        ));
      } else if (tab === 'errors') {
        contentHost.appendChild(el('div', { class: 'card' },
          el('h2', { text: 'Logi błędów' }),
          logList(ctx.logger.errors, 'Brak błędów')
        ));
      } else if (tab === 'crashes') {
        contentHost.appendChild(el('div', { class: 'card' },
          el('h2', { text: 'Historia awarii' }),
          el('p', { class: 'view__sub', text: 'Nieoczekiwane wyjątki i odrzucone obietnice. Dane poufne są redagowane.' }),
          logList(ctx.logger.crashes, 'Brak awarii')
        ));
      } else if (tab === 'latency') {
        contentHost.appendChild(latencyView());
      } else if (tab === 'tests') {
        contentHost.appendChild(testsView());
      } else if (tab === 'report') {
        contentHost.appendChild(el('div', { class: 'card' }, el('div', { class: 'stat__label', text: 'Generowanie raportu…' })));
        reportView().then((node) => {
          if (tab !== 'report') return;
          clear(contentHost);
          contentHost.appendChild(node);
        });
      } else {
        contentHost.appendChild(overviewView());
      }
    }

    const unsubscribe = ctx.logger.subscribe(() => {
      if (tab === 'logs' || tab === 'errors' || tab === 'crashes' || tab === 'overview') draw();
    });
    draw();
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const loggerFailed = ctx?.logger ? ctx.logger.counts().crashes > 0 : false;
    if (loggerFailed) {
      return { status: 'degraded', message: 'W sesji zapisano co najmniej jedną awarię' };
    }
    return { ok: true, message: 'Logowanie i pomiary działają' };
  }
};
