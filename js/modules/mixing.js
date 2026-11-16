/**
 * Mix Master — plan miksu i masteringu (lokalny silnik reguł), katalog wtyczek
 * premium używanych w rapie oraz gotowe łańcuchy FX do REAPERa.
 *
 * Wszystko liczy się na urządzeniu. Pobieranie generuje pliki w pamięci
 * (Blob / ZIP) — żaden plik nie jest wysyłany na serwer, nie ma tu modelu
 * językowego ani żadnej usługi zewnętrznej.
 */

import { clear, copyText, download, el, matchesSearch, paginate } from '../core/util.js';
import { toMessage } from '../core/errors.js';
import { badge, pagination, statCard } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader, searchBox } from '../ui/page.js';
// `?v=2` celowo: wymusza pobranie aktualnego silnika i zapisu ZIP także wtedy,
// gdy przeglądarka trzyma starszą kopię w cache (spójność wersji modułów).
import { createZip } from '../core/zip.js?v=2';
import {
  CHAIN_DEFINITIONS, CHAIN_VARIANTS, PLATFORMS, PLUGIN_CATALOG, PLUGIN_PACKS, STYLES,
  buildPlan, bundleFileName, bundleFiles, catalogFileName, catalogMarkdown, chainFileName,
  chainPack, packFileName, planFileName, recipeMarkdown, rfxChainText, validateCatalog
} from '../core/mix-engine.js?v=2';

const DEFAULT_REQUEST = { bpm: 140, style: 'trap', platform: 'streaming', keySig: '', title: '' };

const TABS = [
  { id: 'plan', label: 'Plan AI' },
  { id: 'plugins', label: 'Wtyczki premium' },
  { id: 'chains', label: 'Łańcuchy FX' },
  { id: 'download', label: 'Pobieranie' }
];

function fieldRow(label, control, hint = '') {
  const id = control.id || '';
  return el('div', { class: 'field' },
    el('label', { class: 'field__label', attrs: id ? { for: id } : {}, text: label }),
    control,
    hint ? el('div', { class: 'field__hint', text: hint }) : null
  );
}

function settingsList(settings) {
  return el('ul', { style: { margin: '0', paddingLeft: '18px' } },
    (settings || []).map((setting) => el('li', {
      class: 'list__meta',
      text: `${setting.param}: ${setting.value}`
    }))
  );
}

function mimeFor(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

export default {
  id: 'mixing',
  title: 'Mix Master',
  shortTitle: 'Mix',
  icon: '≋',
  group: 'Praca',
  permission: 'mixing:read',

  mount(root, ctx) {
    const songs = Array.isArray(ctx.store.state.data.songs) ? ctx.store.state.data.songs : [];
    const state = {
      tab: 'plan',
      variant: 'premium',
      category: 'all',
      tier: 'all',
      query: '',
      page: 1,
      form: { songId: '', bpm: '140', style: 'trap', platform: 'streaming', keySig: '' },
      plan: null,
      planError: ''
    };

    root.appendChild(pageHeader({
      title: 'Mix Master',
      sub: 'Plan miksu i masteringu, wtyczki premium używane przez raperów oraz gotowe łańcuchy FX (.RfxChain) do wstawienia w REAPERze.'
    }));

    root.appendChild(el('div', { class: 'notice' },
      el('strong', { text: 'Asystent AI działa lokalnie. ' }),
      'Plan liczy silnik reguł na urządzeniu — żadne nagranie, tekst ani notatka nie są wysyłane do zewnętrznego modelu. '
      + 'Katalog prowadzi wyłącznie do oficjalnych stron producentów; aplikacja nie pobiera i nie instaluje wtyczek.'
    ));

    const tabsHost = el('div');
    const bodyHost = el('div', {
      attrs: { id: 'mixmaster-panel', role: 'tabpanel', 'aria-label': TABS[0].label }
    });
    root.appendChild(tabsHost);
    root.appendChild(bodyHost);

    /* ---------- wspólne ---------- */

    function requestFromForm() {
      const song = songs.find((entry) => entry.id === state.form.songId) || null;
      return {
        bpm: validate.requireNumber(state.form.bpm, 'BPM', { min: 20, max: 400, integer: true }),
        keySig: validate.optionalText(state.form.keySig, 'Tonacja', { max: 20 }),
        style: validate.requireEnum(state.form.style, Object.keys(STYLES), 'Styl'),
        platform: validate.requireEnum(state.form.platform, Object.keys(PLATFORMS), 'Platforma'),
        title: song ? song.title : ''
      };
    }

    function safeRequest() {
      try {
        return requestFromForm();
      } catch (err) {
        ctx.logger.warn('Mix Master: formularz niepełny — użyto wartości domyślnych.', { error: err });
        return { ...DEFAULT_REQUEST };
      }
    }

    function saveFile(fileName, content, mime = null) {
      try {
        download(fileName, content, mime || mimeFor(fileName));
        ctx.logger.info('Mix Master: plik pobrany.', { fileName });
        ctx.toast(`Pobrano ${fileName}.`, 'ok');
        return true;
      } catch (err) {
        ctx.logger.error('Mix Master: pobieranie pliku nie powiodło się.', { error: err, fileName });
        ctx.toast(toMessage(err, 'Nie udało się pobrać pliku.'), 'error');
        return false;
      }
    }

    function saveZip() {
      try {
        const request = safeRequest();
        const createdAt = new Date().toISOString();
        const files = bundleFiles(request, { createdAt });
        const bytes = createZip(files, { date: new Date() });
        const plan = buildPlan(request, { variant: 'premium' });
        if (saveFile(bundleFileName(plan), new Blob([bytes], { type: 'application/zip' }), 'application/zip')) {
          ctx.toast(`Paczka gotowa: ${files.length} plików (łańcuchy premium i stock).`, 'ok');
        }
      } catch (err) {
        ctx.logger.error('Mix Master: budowa paczki ZIP nie powiodła się.', { error: err });
        ctx.toast(toMessage(err, 'Nie udało się zbudować paczki ZIP.'), 'error');
      }
    }

    function copyChain(text, label) {
      copyText(text, {
        onSuccess: () => ctx.toast(`Skopiowano ${label} do schowka.`, 'ok'),
        onError: () => ctx.toast('Nie udało się skopiować — użyj pobierania pliku.', 'error')
      });
    }

    function fileList(files) {
      return el('div', { class: 'list' },
        files.map((file) => el('div', { class: 'list__item' },
          el('div', { class: 'list__main' },
            el('div', { class: 'list__title mono', text: file.name }),
            el('div', { class: 'list__meta', text: mimeFor(file.name) })
          ),
          el('button', {
            class: 'btn btn--sm',
            type: 'button',
            attrs: { 'aria-label': `Pobierz ${file.name}` },
            on: { click: () => saveFile(file.name, file.text, mimeFor(file.name)) }
          }, 'Pobierz')
        ))
      );
    }

    function guideCard() {
      return el('div', { class: 'card', style: { marginTop: 'var(--space-3)' } },
        el('h2', { text: 'Jak wstawić łańcuch do REAPERa' }),
        el('ol', { style: { margin: 'var(--space-2) 0 0', paddingLeft: '20px', color: 'var(--muted)', fontSize: '0.88rem' } },
          el('li', { text: 'Pobierz plik .RfxChain dla wybranego etapu (wokal, beat, bus, master, sends) albo całą paczkę ZIP.' }),
          el('li', { text: 'Przeciągnij plik na ścieżkę w REAPERze albo użyj: FX → Add FX → Import FX chain.' }),
          el('li', { text: 'Zainstalowane wtyczki wczytają się w kolejności z pliku; brakujące REAPER pokaże jako niedostępne.' }),
          el('li', { text: 'Ustaw parametry według planu lub recepty .md — plik przenosi kolejność wtyczek, nie ich ustawienia.' }),
          el('li', { text: 'Zapisz gotowy łańcuch w REAPERze jako własny preset (FX → Save FX chain).' })
        ),
        el('div', { class: 'notice notice--warn', style: { marginTop: 'var(--space-3)' } },
          'Bezpieczeństwo: pliki zawierają tylko nazwy wtyczek i kolejność. Aplikacja nie uruchamia skryptów, '
          + 'nie czyta ani nie usuwa plików audio i nie prosi o dane logowania do żadnego sklepu.'
        )
      );
    }

    function variantSegmented() {
      return el('div', { class: 'segmented', attrs: { role: 'group', 'aria-label': 'Wariant łańcuchów' } },
        CHAIN_VARIANTS.map((variant) => el('button', {
          type: 'button',
          attrs: { 'aria-pressed': state.variant === variant ? 'true' : 'false', 'data-variant': variant },
          on: {
            click: () => {
              if (state.variant === variant) return;
              state.variant = variant;
              state.plan = null;
              state.planError = '';
              drawBody();
            }
          }
        }, variant === 'premium' ? 'Premium' : 'Stock REAPERa'))
      );
    }

    /* ---------- zakładki ---------- */

    function drawTabs() {
      clear(tabsHost);
      tabsHost.appendChild(el('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Sekcje Mix Master' } },
        TABS.map((tab) => el('button', {
          class: 'tab',
          type: 'button',
          attrs: {
            role: 'tab',
            'aria-selected': state.tab === tab.id ? 'true' : 'false',
            'aria-controls': 'mixmaster-panel',
            'data-tab': tab.id
          },
          on: { click: () => selectTab(tab.id) }
        }, tab.label))
      ));
    }

    function selectTab(id) {
      if (state.tab === id) return;
      state.tab = id;
      drawTabs();
      drawBody();
    }

    function drawBody() {
      const tab = TABS.find((entry) => entry.id === state.tab) || TABS[0];
      bodyHost.setAttribute('aria-label', tab.label);
      clear(bodyHost);
      if (state.tab === 'plugins') renderPluginsTab(bodyHost);
      else if (state.tab === 'chains') renderChainsTab(bodyHost);
      else if (state.tab === 'download') renderDownloadTab(bodyHost);
      else renderPlanTab(bodyHost);
    }

    /* ---------- Plan AI ---------- */

    function stageCard(plan, stage) {
      const fileName = chainFileName(plan, stage.id);
      let text = '';
      let textError = '';
      try {
        text = rfxChainText(stage);
      } catch (err) {
        textError = toMessage(err, 'Nie udało się zbudować pliku łańcucha.');
        ctx.logger.error('Mix Master: budowa pliku łańcucha nie powiodła się.', { error: err, stage: stage.id });
      }

      const preview = el('pre', {
        class: 'code',
        style: { marginTop: 'var(--space-2)', display: 'none' }
      }, text || textError);
      const toggle = el('button', {
        class: 'btn btn--sm',
        type: 'button',
        attrs: { 'aria-expanded': 'false' },
        on: {
          click: () => {
            const visible = preview.style.display === 'none';
            preview.style.display = visible ? '' : 'none';
            toggle.setAttribute('aria-expanded', String(visible));
            toggle.textContent = visible ? 'Ukryj plik' : 'Pokaż plik';
          }
        }
      }, 'Pokaż plik');

      const table = el('div', { class: 'table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {},
            el('th', {}, 'Wtyczka'),
            el('th', {}, 'Ustawienia startowe')
          )),
          el('tbody', {}, stage.steps.map((entry) => el('tr', {},
            el('td', {},
              el('div', { class: 'list__title', text: entry.plugin.name }),
              el('div', { class: 'list__meta', text: `${entry.plugin.vendor} · ${entry.plugin.format}` })
            ),
            el('td', {}, settingsList(entry.settings))
          )))
        )
      );

      return el('div', { class: 'card', style: { marginTop: 'var(--space-3)' } },
        el('div', { class: 'card__head' },
          el('h3', { text: stage.label }),
          badge(`${stage.steps.length} wtyczek`, plan.variant === 'premium' ? 'accent' : 'ok')
        ),
        el('p', { class: 'view__sub', text: stage.purpose }),
        stage.placement ? el('div', { class: 'list__meta', text: stage.placement }) : null,
        table,
        el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
          textError
            ? el('span', { class: 'list__meta', text: textError })
            : el('button', {
              class: 'btn btn--sm btn--primary',
              type: 'button',
              attrs: { 'aria-label': `Pobierz plik ${fileName}` },
              on: { click: () => saveFile(fileName, text, 'text/plain') }
            }, 'Pobierz .RfxChain'),
          textError
            ? null
            : el('button', {
              class: 'btn btn--sm',
              type: 'button',
              on: { click: () => copyChain(text, fileName) }
            }, 'Kopiuj plik'),
          toggle
        ),
        el('div', { class: 'list__meta mono', style: { marginTop: 'var(--space-2)' }, text: fileName }),
        preview
      );
    }

    function renderPlanTab(host) {
      const statusLine = el('div', { class: 'view__sub', attrs: { 'aria-live': 'polite' } });
      const resultHost = el('div');

      if (!songs.some((song) => song.id === state.form.songId)) state.form.songId = '';

      const songSelect = el('select', {
        id: 'mixmaster-song',
        attrs: { 'aria-label': 'Utwór z katalogu (opcjonalnie)' }
      },
        el('option', { value: '' }, '— bez utworu (wpisz BPM ręcznie) —'),
        songs.map((song) => el('option', { value: song.id },
          `${song.title}${song.bpm ? ` · ${song.bpm} BPM` : ''}${song.keySig ? ` · ${song.keySig}` : ''}`
        ))
      );
      songSelect.value = state.form.songId;

      const bpmInput = el('input', {
        id: 'mixmaster-bpm',
        type: 'number',
        value: state.form.bpm,
        attrs: { min: '20', max: '400', step: '1', inputmode: 'numeric', autocomplete: 'off' }
      });
      bpmInput.addEventListener('input', () => { state.form.bpm = bpmInput.value; });

      const keyInput = el('input', {
        id: 'mixmaster-key',
        type: 'text',
        value: state.form.keySig,
        placeholder: 'np. Am',
        attrs: { maxlength: '20', autocomplete: 'off' }
      });
      keyInput.addEventListener('input', () => { state.form.keySig = keyInput.value; });

      const styleSelect = el('select', { id: 'mixmaster-style', attrs: { 'aria-label': 'Styl utworu' } },
        Object.entries(STYLES).map(([id, style]) => el('option', { value: id }, style.label))
      );
      styleSelect.value = state.form.style;
      styleSelect.addEventListener('change', () => { state.form.style = styleSelect.value; });

      const platformSelect = el('select', { id: 'mixmaster-platform', attrs: { 'aria-label': 'Platforma docelowa' } },
        Object.entries(PLATFORMS).map(([id, platform]) => el('option', { value: id }, platform.label))
      );
      platformSelect.value = state.form.platform;
      platformSelect.addEventListener('change', () => { state.form.platform = platformSelect.value; });

      songSelect.addEventListener('change', () => {
        state.form.songId = songSelect.value;
        const song = songs.find((entry) => entry.id === state.form.songId);
        if (!song) return;
        if (song.bpm) {
          state.form.bpm = String(song.bpm);
          bpmInput.value = String(song.bpm);
        }
        if (song.keySig) {
          state.form.keySig = song.keySig;
          keyInput.value = song.keySig;
        }
      });

      function drawPlanResult() {
        clear(resultHost);

        if (state.planError) {
          resultHost.appendChild(el('div', {
            class: 'notice notice--warn',
            style: { marginTop: 'var(--space-3)' },
            text: state.planError
          }));
          return;
        }

        const plan = state.plan;
        if (!plan) {
          resultHost.appendChild(el('div', {
            class: 'notice',
            style: { marginTop: 'var(--space-3)' },
            text: 'Wpisz BPM i naciśnij „Przygotuj plan AI”. Plan zawiera kolejność wtyczek, ustawienia startowe i cel głośności.'
          }));
          return;
        }

        const steps = plan.stages.reduce((total, stage) => total + stage.steps.length, 0);
        resultHost.appendChild(el('div', { class: 'grid grid--stats', style: { marginTop: 'var(--space-3)' } },
          statCard({ label: 'Cel głośności', value: `${plan.target.lufs} LUFS`, hint: plan.platformLabel }),
          statCard({ label: 'True Peak', value: `${plan.target.truePeak} dBTP`, hint: 'bez przesterów' }),
          statCard({ label: 'BPM', value: plan.bpm, hint: plan.keySig || 'bez tonacji' }),
          statCard({ label: 'Styl', value: plan.styleLabel, hint: `${plan.stages.length} etapów · ${steps} kroków` })
        ));

        resultHost.appendChild(el('ul', {
          style: { margin: 'var(--space-3) 0 0', paddingLeft: '20px', color: 'var(--muted)', fontSize: '0.88rem' }
        }, plan.notes.map((note) => el('li', { text: note }))));

        plan.stages.forEach((stage) => {
          resultHost.appendChild(stageCard(plan, stage));
        });

        resultHost.appendChild(el('div', { class: 'view__tools', style: { marginTop: 'var(--space-4)' } },
          el('button', {
            class: 'btn btn--primary',
            type: 'button',
            on: { click: saveZip }
          }, 'Pobierz wszystko (ZIP)'),
          el('button', {
            class: 'btn',
            type: 'button',
            on: {
              click: () => saveFile(planFileName(plan, '.md'), recipeMarkdown(plan), 'text/markdown')
            }
          }, 'Pobierz receptę (.md)'),
          el('button', {
            class: 'btn',
            type: 'button',
            on: {
              click: () => saveFile(
                packFileName(plan),
                chainPack(plan, { createdAt: new Date().toISOString() }),
                'application/json'
              )
            }
          }, 'Pobierz pakiet (.json)'),
          el('button', {
            class: 'btn btn--ghost',
            type: 'button',
            on: { click: () => copyChain(recipeMarkdown(plan), 'receptę') }
          }, 'Kopiuj receptę')
        ));
      }

      function generate() {
        try {
          const plan = buildPlan(requestFromForm(), { variant: state.variant });
          state.plan = plan;
          state.planError = '';
          drawPlanResult();
          statusLine.textContent = `Plan gotowy: ${plan.stages.reduce((total, stage) => total + stage.steps.length, 0)} kroków w ${plan.stages.length} etapach.`;
          ctx.logger.info('Mix Master: wygenerowano plan.', {
            style: plan.style,
            platform: plan.platform,
            variant: plan.variant,
            bpm: plan.bpm,
            stages: plan.stages.length
          });
        } catch (err) {
          state.plan = null;
          state.planError = toMessage(err, 'Nie udało się przygotować planu.');
          statusLine.textContent = '';
          drawPlanResult();
          ctx.logger.warn('Mix Master: plan odrzucony.', { error: err });
          ctx.toast(state.planError, 'error');
        }
      }

      host.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Plan miksu — asystent AI' }),
          badge('lokalnie', 'ok')
        ),
        el('p', {
          class: 'view__sub',
          text: 'Wybierz utwór albo wpisz BPM i tonację. Plan zawiera kolejność wtyczek, ustawienia startowe i cel głośności.'
        }),
        el('div', { class: 'grid grid--two' },
          fieldRow('Utwór (opcjonalnie)', songSelect),
          fieldRow('Styl', styleSelect),
          fieldRow('BPM', bpmInput, '20–400'),
          fieldRow('Tonacja', keyInput, 'Opcjonalnie — dopasowanie Auto-Tune'),
          fieldRow('Platforma docelowa', platformSelect)
        ),
        el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
          el('button', { class: 'btn btn--primary', type: 'button', on: { click: generate } }, 'Przygotuj plan AI'),
          el('span', { class: 'list__meta', text: 'Wariant:' }),
          variantSegmented()
        ),
        statusLine
      ));

      host.appendChild(resultHost);
      drawPlanResult();
    }

    /* ---------- Wtyczki ---------- */

    function renderPluginsTab(host) {
      const categories = Array.from(new Set(PLUGIN_CATALOG.map((plugin) => plugin.category)))
        .sort((left, right) => left.localeCompare(right, 'pl'));

      const listHost = el('div');
      const countLine = el('div', { class: 'view__sub', attrs: { 'aria-live': 'polite' } });

      if (state.category !== 'all' && !categories.includes(state.category)) state.category = 'all';

      const categorySelect = el('select', {
        id: 'mixmaster-category',
        attrs: { 'aria-label': 'Filtr kategorii wtyczek' }
      },
        el('option', { value: 'all' }, 'Wszystkie kategorie'),
        categories.map((category) => el('option', { value: category }, category))
      );
      categorySelect.value = state.category;
      categorySelect.addEventListener('change', () => {
        state.category = categorySelect.value;
        state.page = 1;
        drawList();
      });

      const tierSelect = el('select', {
        id: 'mixmaster-tier',
        attrs: { 'aria-label': 'Filtr typu wtyczki' }
      },
        el('option', { value: 'all' }, 'Premium i wbudowane'),
        el('option', { value: 'premium' }, 'Tylko premium'),
        el('option', { value: 'stock' }, 'Tylko wbudowane REAPERa')
      );
      tierSelect.value = state.tier;
      tierSelect.addEventListener('change', () => {
        state.tier = tierSelect.value;
        state.page = 1;
        drawList();
      });

      function drawList() {
        const items = PLUGIN_CATALOG.filter((plugin) => {
          const tier = plugin.tier === 'stock' ? 'stock' : 'premium';
          if (state.tier !== 'all' && state.tier !== tier) return false;
          if (state.category !== 'all' && plugin.category !== state.category) return false;
          return matchesSearch(`${plugin.name} ${plugin.vendor} ${plugin.category} ${plugin.why}`, state.query);
        });
        const pageData = paginate(items, state.page, ctx.store.state.data.settings.pageSize);
        state.page = pageData.page;

        clear(listHost);
        countLine.textContent = `${items.length} z ${PLUGIN_CATALOG.length} wtyczek`;

        if (!items.length) {
          listHost.appendChild(el('div', { class: 'empty' },
            el('div', { class: 'empty__title', text: 'Brak wtyczek dla tych filtrów' }),
            el('div', { class: 'empty__hint', text: 'Zmień kategorię albo wyczyść wyszukiwanie.' })
          ));
          return;
        }

        listHost.appendChild(el('div', { class: 'list' },
          pageData.items.map((plugin) => el('div', { class: 'list__item' },
            el('div', { class: 'list__main' },
              el('div', { class: 'list__title', text: plugin.name }),
              el('div', { class: 'list__meta', text: `${plugin.vendor} · ${plugin.category} · ${plugin.format}` }),
              el('div', { class: 'list__meta', text: plugin.why })
            ),
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
              badge(plugin.tier === 'stock' ? 'wbudowana' : 'premium', plugin.tier === 'stock' ? 'ok' : 'accent'),
              el('a', {
                class: 'btn btn--sm',
                href: plugin.url,
                attrs: {
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  'aria-label': `Strona producenta: ${plugin.name}`
                }
              }, 'Pobierz u producenta')
            )
          ))
        ));

        listHost.appendChild(pagination({
          ...pageData,
          label: 'wtyczek',
          onChange: (nextPage) => { state.page = nextPage; drawList(); }
        }));
      }

      host.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Zestawy, których używają raperzy' }),
          badge(`${PLUGIN_PACKS.length} zestawów`, 'accent')
        ),
        el('p', {
          class: 'view__sub',
          text: 'Kliknij nazwę, aby przejść do oficjalnej strony producenta — tam pobierzesz wersję trial albo kupisz licencję.'
        }),
        el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-3)' } },
          PLUGIN_PACKS.map((pack) => el('div', { class: 'card' },
            el('div', { class: 'card__head' },
              el('h3', { text: pack.label }),
              badge(`${pack.ids.length} wtyczek`, 'accent')
            ),
            el('p', { class: 'view__sub', text: pack.note || '' }),
            el('ul', { style: { margin: '0', paddingLeft: '18px' } },
              pack.ids.map((id) => {
                const plugin = PLUGIN_CATALOG.find((entry) => entry.id === id);
                if (!plugin) {
                  return el('li', { class: 'list__meta', text: `Brak w katalogu: ${id}` });
                }
                return el('li', { class: 'list__meta' },
                  el('a', {
                    href: plugin.url,
                    attrs: { target: '_blank', rel: 'noopener noreferrer' },
                    text: `${plugin.name} — ${plugin.vendor}`
                  })
                );
              })
            )
          ))
        )
      ));

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Katalog wtyczek premium' }),
          badge(`${PLUGIN_CATALOG.length} pozycji`, 'ok')
        ),
        el('div', { class: 'view__tools' },
          searchBox({
            placeholder: 'Szukaj wtyczki, producenta lub kategorii…',
            label: 'Szukaj w katalogu wtyczek',
            onInput: (value) => { state.query = value; state.page = 1; drawList(); }
          }),
          fieldRow('Kategoria', categorySelect),
          fieldRow('Typ', tierSelect)
        ),
        countLine,
        listHost
      ));

      drawList();
    }

    /* ---------- Łańcuchy FX ---------- */

    function renderChainsTab(host) {
      let request = null;
      let fallback = false;
      try {
        request = requestFromForm();
      } catch (err) {
        request = { ...DEFAULT_REQUEST };
        fallback = true;
      }

      let premium = null;
      let stock = null;
      try {
        premium = buildPlan(request, { variant: 'premium' });
        stock = buildPlan(request, { variant: 'stock' });
      } catch (err) {
        ctx.logger.error('Mix Master: nie udało się zbudować gotowych łańcuchów.', { error: err });
        host.appendChild(el('div', { class: 'notice notice--warn', text: toMessage(err, 'Brak gotowych łańcuchów.') }));
        return;
      }

      host.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Gotowe łańcuchy FX (.RfxChain)' }),
          badge(`${CHAIN_DEFINITIONS.length * CHAIN_VARIANTS.length} plików`, 'accent')
        ),
        el('p', {
          class: 'view__sub',
          text: 'Pliki do przeciągnięcia na ścieżkę w REAPERze. Wariant „stock” używa wyłącznie wtyczek wbudowanych, więc działa od razu.'
        }),
        fallback
          ? el('div', {
            class: 'notice notice--warn',
            text: 'Formularz w zakładce „Plan AI” ma niepełne dane — pokazano łańcuchy dla 140 BPM / trap / streaming.'
          })
          : null,
        el('div', { class: 'view__tools', style: { marginTop: 'var(--space-3)' } },
          el('button', { class: 'btn btn--primary', type: 'button', on: { click: saveZip } }, 'Pobierz wszystkie (ZIP)'),
          el('span', {
            class: 'list__meta',
            text: `${request.title || 'bez tytułu'} · ${premium.bpm} BPM · ${premium.styleLabel}`
          })
        )
      ));

      const grid = el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-3)' } });
      for (const definition of CHAIN_DEFINITIONS) {
        for (const variant of CHAIN_VARIANTS) {
          const plan = variant === 'premium' ? premium : stock;
          const stage = plan.stages.find((entry) => entry.id === definition.id);
          if (!stage) continue;
          grid.appendChild(stageCard(plan, stage));
        }
      }
      host.appendChild(grid);
      host.appendChild(guideCard());
    }

    /* ---------- Pobieranie ---------- */

    function renderDownloadTab(host) {
      const request = safeRequest();
      let files = [];
      try {
        files = bundleFiles(request, { createdAt: new Date().toISOString() });
      } catch (err) {
        ctx.logger.error('Mix Master: nie udało się przygotować listy plików paczki.', { error: err });
        host.appendChild(el('div', { class: 'notice notice--warn', text: toMessage(err, 'Nie udało się przygotować paczki.') }));
        return;
      }
      const plan = buildPlan(request, { variant: 'premium' });

      host.appendChild(el('div', { class: 'card' },
        el('div', { class: 'card__head' },
          el('h2', { text: 'Pobierz wszystko' }),
          badge(`${files.length} plików`, 'accent')
        ),
        el('p', {
          class: 'view__sub',
          text: 'Jedna paczka ZIP z łańcuchami obu wariantów, receptą, pakietami JSON i instrukcją dla REAPERa. Wszystko powstaje na urządzeniu.'
        }),
        el('div', { class: 'view__tools' },
          el('button', { class: 'btn btn--primary', type: 'button', on: { click: saveZip } },
            `Pobierz paczkę ZIP (${files.length} plików)`),
          el('button', {
            class: 'btn',
            type: 'button',
            on: { click: () => saveFile(planFileName(plan, '.md'), recipeMarkdown(plan), 'text/markdown') }
          }, 'Recepta (.md)'),
          el('button', {
            class: 'btn',
            type: 'button',
            on: {
              click: () => saveFile(
                packFileName(plan),
                chainPack(plan, { createdAt: new Date().toISOString() }),
                'application/json'
              )
            }
          }, 'Pakiet planu (.json)'),
          el('button', {
            class: 'btn',
            type: 'button',
            on: { click: () => saveFile(catalogFileName(), catalogMarkdown(), 'text/markdown') }
          }, 'Lista wtyczek (.md)')
        ),
        el('div', { class: 'list__meta mono', style: { marginTop: 'var(--space-2)' }, text: bundleFileName(plan) })
      ));

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('h2', { text: 'Pliki w paczce' }),
        el('p', { class: 'view__sub', text: 'Możesz też pobrać każdy plik osobno.' }),
        fileList(files)
      ));

      host.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
        el('h2', { text: 'Instalacja wtyczek' }),
        el('p', {
          class: 'view__sub',
          text: 'BSXS Manager nie pobiera, nie instaluje i nie licencjonuje wtyczek. Pobierz je wyłącznie od producenta, '
            + 'zainstaluj jako VST3 i uruchom w REAPERze skanowanie wtyczek.'
        }),
        el('div', { class: 'view__tools' },
          el('button', {
            class: 'btn',
            type: 'button',
            on: { click: () => saveFile(catalogFileName(), catalogMarkdown(), 'text/markdown') }
          }, 'Pobierz listę z linkami')
        )
      ));

      host.appendChild(guideCard());
    }

    /* ---------- start ---------- */

    drawTabs();
    drawBody();

    const problems = validateCatalog();
    if (problems.length) {
      ctx.logger.warn('Mix Master: katalog wtyczek ma problemy.', { problems: problems.slice(0, 5) });
    }

    return () => {};
  },

  selfCheck() {
    const issues = validateCatalog();
    if (issues.length) {
      return { ok: false, message: `${issues.length} problemów w katalogu: ${issues[0]}` };
    }
    return {
      ok: true,
      message: `${PLUGIN_CATALOG.length} wtyczek, ${PLUGIN_PACKS.length} zestawów, `
        + `${CHAIN_DEFINITIONS.length * CHAIN_VARIANTS.length} łańcuchów gotowych`
    };
  }
};
