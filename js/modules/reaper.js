import { clear, download, el, fmtDate, timestampForFilename, todayISO, uid } from '../core/util.js';
import { ValidationError } from '../core/errors.js';
import { badge, confirmAction, emptyState, formModal, modal, toast } from '../core/ui.js';
import * as validate from '../core/validate.js';
import { pageHeader } from '../ui/page.js';

const MANIFEST_FORMAT = 'bsxs.reaper.manifest';
const MANIFEST_VERSION = 1;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_PROJECTS = 500;

export function parseManifest(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ValidationError('Plik nie jest prawidłowym JSON-em.');
  }
  if (!data || data.format !== MANIFEST_FORMAT) {
    throw new ValidationError(`Oczekiwano manifestu „${MANIFEST_FORMAT}”.`);
  }
  if (Number(data.version) !== MANIFEST_VERSION) {
    throw new ValidationError(`Nieobsługiwana wersja manifestu (${data.version}).`);
  }
  if (!Array.isArray(data.projects) || !data.projects.length) {
    throw new ValidationError('Manifest nie zawiera projektów.');
  }
  if (data.projects.length > MAX_PROJECTS) {
    throw new ValidationError(`Manifest może zawierać maksymalnie ${MAX_PROJECTS} projektów.`);
  }
  return data.projects.map((project, index) => {
    const label = `Projekt #${index + 1}`;
    if (!project || typeof project !== 'object') throw new ValidationError(`${label}: nieprawidłowy wpis.`);
    const name = validate.requireText(project.name, `${label}: nazwa`, { max: 120 });
    const path = validate.safeRelativePath(project.path, `${label}: ścieżka`);
    const bpm = String(project.bpm ?? '').trim() === ''
      ? null
      : validate.requireNumber(project.bpm, `${label}: BPM`, { min: 20, max: 400, integer: true });
    const key = validate.optionalText(project.key, `${label}: tonacja`, { max: 20 });
    const tracks = String(project.tracks ?? '').trim() === ''
      ? null
      : validate.requireNumber(project.tracks, `${label}: liczba ścieżek`, { min: 0, max: 512, integer: true });
    const notes = validate.optionalText(project.notes, `${label}: notatki`, { max: 2000 });
    return { name, path, bpm, key, tracks, notes };
  });
}

export function folderAllows(path, allowedFolders) {
  const normalized = String(path).replace(/\\/g, '/');
  return (allowedFolders || []).some((folder) => {
    const base = String(folder).replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized === base || normalized.startsWith(`${base}/`);
  });
}

export default {
  id: 'reaper',
  title: 'REAPER',
  shortTitle: 'REAPER',
  icon: '⎔',
  group: 'System',
  permission: 'reaper:read',

  mount(root, ctx) {
    const canWrite = ctx.session.can('reaper:write');
    const foldersHost = el('div');
    const manifestHost = el('div');
    const fileInput = el('input', {
      type: 'file',
      attrs: { accept: '.json,application/json' },
      style: { display: 'none' }
    });

    root.appendChild(pageHeader({
      title: 'REAPER',
      sub: 'Bezpieczna wymiana metadanych projektów — bez uruchamiania poleceń i bez dostępu do plików audio.'
    }));

    root.appendChild(el('div', { class: 'notice notice--warn' },
      'Aplikacja nie uruchamia żadnych poleceń systemowych ani skryptów REAPER. Import obejmuje wyłącznie metadane z manifestu JSON i wymaga akceptacji.'
    ));

    const foldersCard = el('div', { class: 'card' },
      el('div', { class: 'card__head' },
        el('h2', { text: 'Dozwolone foldery projektów' }),
        canWrite ? el('button', {
          class: 'btn btn--sm',
          type: 'button',
          on: { click: () => addFolder() }
        }, '+ Dodaj folder') : null
      ),
      el('p', { class: 'view__sub', text: 'Tylko ścieżki wewnątrz tych folderów (względne) mogą być zaimportowane. Brak dostępu do systemu plików — walidacja dotyczy zapisu w manifeście.' }),
      foldersHost
    );

    const manifestCard = el('div', { class: 'card' },
      el('div', { class: 'card__head' }, el('h2', { text: 'Manifesty projektów' })),
      el('p', { class: 'view__sub', text: `Format: ${MANIFEST_FORMAT} v${MANIFEST_VERSION}. Import tworzy wpisy w katalogu utworów na podstawie metadanych.` }),
      canWrite ? el('div', { class: 'view__tools', style: { marginBottom: 'var(--space-3)' } },
        el('button', { class: 'btn btn--primary', type: 'button', on: { click: () => fileInput.click() } }, 'Importuj manifest…'),
        el('button', { class: 'btn', type: 'button', on: { click: () => exportManifest() } }, 'Eksportuj manifest utworów'),
        fileInput
      ) : el('div', { class: 'notice', text: 'Brak uprawnień do importu i eksportu manifestów.' }),
      manifestHost
    );

    root.appendChild(el('div', { class: 'grid grid--two', style: { marginTop: 'var(--space-4)' } }, foldersCard, manifestCard));
    root.appendChild(el('div', { class: 'card', style: { marginTop: 'var(--space-4)' } },
      el('h2', { text: 'Zasady bezpieczeństwa integracji' }),
      el('ul', { style: { margin: 'var(--space-2) 0 0', paddingLeft: '20px', color: 'var(--muted)', fontSize: '0.88rem' } },
        el('li', { text: 'Brak uruchamiania poleceń systemowych i skryptów z niezaufanych danych.' }),
        el('li', { text: 'Ścieżki są walidowane: odrzucane są ścieżki absolutne, „..” i znaki kontrolne.' }),
        el('li', { text: 'Import wymaga co najmniej jednego dozwolonego folderu i potwierdzenia użytkownika.' }),
        el('li', { text: 'Aplikacja nigdy nie usuwa projektów ani plików audio.' }),
        el('li', { text: 'Rozmiar manifestu jest ograniczony do 2 MB, liczba projektów do 500.' })
      )
    ));

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      handleFile(file);
    });

    function drawFolders() {
      const folders = ctx.store.state.data.reaper.allowedFolders;
      clear(foldersHost);
      if (!folders.length) {
        foldersHost.appendChild(emptyState({
          title: 'Brak dozwolonych folderów',
          hint: 'Dodaj folder (ścieżkę względną, np. „XARO/2025”), aby umożliwić import manifestów.',
          actionLabel: canWrite ? 'Dodaj folder' : null,
          onAction: canWrite ? () => addFolder() : null
        }));
        return;
      }
      const list = el('div', { class: 'list' });
      for (const folder of folders) {
        list.appendChild(el('div', { class: 'list__item' },
          el('div', { class: 'list__main' },
            el('div', { class: 'list__title mono', text: folder }),
            el('div', { class: 'list__meta', text: 'folder dozwolony' })
          ),
          canWrite
            ? el('button', {
              class: 'btn btn--sm btn--danger',
              type: 'button',
              attrs: { 'aria-label': `Usuń folder ${folder}` },
              on: { click: () => removeFolder(folder) }
            }, 'Usuń')
            : null
        ));
      }
      foldersHost.appendChild(list);
    }

    function drawManifestInfo() {
      clear(manifestHost);
      const songs = ctx.store.state.data.songs;
      manifestHost.appendChild(el('div', { class: 'list' },
        el('div', { class: 'list__item' },
          el('div', { class: 'list__main' },
            el('div', { class: 'list__title', text: 'Manifest wyjściowy' }),
            el('div', { class: 'list__meta', text: `${songs.length} utworów gotowych do eksportu metadanych` })
          ),
          badge('bez plików audio', 'accent')
        )
      ));
    }

    function addFolder() {
      formModal({
        title: 'Dodaj dozwolony folder',
        description: 'Ścieżka względna do katalogu projektów. Ścieżki absolutne i „..” są odrzucane.',
        fields: [{ name: 'path', label: 'Ścieżka folderu', type: 'text', value: '', required: true, placeholder: 'XARO/2025' }],
        submitLabel: 'Dodaj folder',
        onSubmit: async (raw) => {
          const path = validate.safeRelativePath(raw.path, 'Ścieżka folderu');
          ctx.session.require('reaper:write');
          const exists = ctx.store.state.data.reaper.allowedFolders.includes(path);
          if (exists) throw new ValidationError('Ten folder jest już na liście.');
          ctx.store.commit((state) => {
            state.data.reaper.allowedFolders = [...state.data.reaper.allowedFolders, path].slice(0, 50);
          }, { immediate: true });
          ctx.logger.info('Dodano dozwolony folder REAPER.', { path });
          ctx.toast('Folder dodany.', 'ok');
          return true;
        }
      });
    }

    async function removeFolder(folder) {
      const ok = await confirmAction({
        title: 'Usuń folder',
        message: `Czy usunąć folder „${folder}” z listy dozwolonych?`,
        confirmLabel: 'Usuń',
        danger: true,
        note: 'Manifesty z tego folderu nie będą już importowane.'
      });
      if (!ok) return;
      try {
        ctx.session.require('reaper:write');
        ctx.store.commit((state) => {
          state.data.reaper.allowedFolders = state.data.reaper.allowedFolders.filter((entry) => entry !== folder);
        }, { immediate: true });
        toast('Folder usunięty.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się usunąć folderu.', 'error');
      }
    }

    async function handleFile(file) {
      try {
        if (file.size > MAX_MANIFEST_BYTES) {
          throw new ValidationError('Plik manifestu jest za duży (limit 2 MB).');
        }
        const text = await file.text();
        const projects = parseManifest(text);
        const allowed = ctx.store.state.data.reaper.allowedFolders;
        if (!allowed.length) {
          throw new ValidationError('Najpierw dodaj co najmniej jeden dozwolony folder projektów.');
        }
        const outside = projects.filter((project) => !folderAllows(project.path, allowed));
        if (outside.length) {
          throw new ValidationError(
            `Poza dozwolonymi folderami: ${outside.slice(0, 3).map((project) => project.path).join(', ')}${outside.length > 3 ? '…' : ''}`
          );
        }

        const preview = el('div', {},
          el('p', { text: `Znaleziono ${projects.length} projektów. Zostaną dodane jako utwory (metadane), bez dotykania plików.` }),
          el('div', { class: 'code', text: projects.slice(0, 12).map((project) => `${project.name} — ${project.path}`).join('\n') + (projects.length > 12 ? '\n…' : '') })
        );

        const confirmed = await confirmImport(preview);
        if (!confirmed) return;

        ctx.session.require('songs:write');
        const timestamp = new Date().toISOString();
        ctx.store.commit((state) => {
          for (const project of projects) {
            state.data.songs.push({
              id: uid('song'),
              title: project.name,
              artist: 'XARO',
              status: project.bpm ? 'Miks' : 'Demo',
              bpm: project.bpm,
              keySig: project.key,
              isrc: '',
              tags: ['reaper'],
              notes: [project.path, project.tracks ? `${project.tracks} ścieżek` : '', project.notes]
                .filter(Boolean).join(' · ').slice(0, 5000),
              releaseId: null,
              createdAt: timestamp,
              updatedAt: timestamp
            });
          }
        }, { immediate: true });

        ctx.logger.info('Zaimportowano manifest REAPER.', { projects: projects.length });
        ctx.toast(`Zaimportowano ${projects.length} projektów jako utwory.`, 'ok');
        drawManifestInfo();
      } catch (err) {
        if (err instanceof ValidationError) {
          ctx.toast(err.message, 'error');
        } else {
          ctx.logger.error('Błąd importu manifestu REAPER.', { error: err });
          ctx.toast(err.message ?? 'Nie udało się zaimportować manifestu.', 'error');
        }
      }
    }

    function confirmImport(preview) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const instance = modal({
          title: 'Potwierdź import manifestu',
          content: preview,
          footer: [
            el('button', { class: 'btn btn--ghost', type: 'button', on: { click: () => instance.close() } }, 'Anuluj'),
            el('button', {
              class: 'btn btn--primary',
              type: 'button',
              on: { click: () => { finish(true); instance.close(); } }
            }, 'Importuj')
          ],
          wide: true,
          onClose: () => finish(false)
        });
      });
    }

    function exportManifest() {
      try {
        ctx.session.require('reaper:read');
        const songs = ctx.store.state.data.songs;
        const manifest = {
          format: MANIFEST_FORMAT,
          version: MANIFEST_VERSION,
          exportedAt: new Date().toISOString(),
          note: 'Eksport metadanych utworów. Aplikacja nie modyfikuje plików projektu.',
          projects: songs.map((song) => ({
            name: song.title,
            path: `XARO/${String(song.title).replace(/[\\/:*?"<>|]/g, '-')}.rpp`,
            bpm: song.bpm ?? null,
            key: song.keySig || '',
            tracks: null,
            notes: [song.status, ...(song.tags || [])].filter(Boolean).join(', ')
          }))
        };
        download(`${timestampForFilename('bsxs-reaper')}.json`, JSON.stringify(manifest, null, 2), 'application/json');
        ctx.toast('Manifest wyeksportowany.', 'ok');
      } catch (err) {
        toast(err.message ?? 'Nie udało się wyeksportować manifestu.', 'error');
      }
    }

    drawFolders();
    drawManifestInfo();
    const unsubscribe = ctx.store.subscribe(() => { drawFolders(); drawManifestInfo(); });
    return () => unsubscribe();
  },

  selfCheck(ctx) {
    const store = ctx?.store ?? null;
    if (!store) return { ok: true, message: 'Moduł gotowy' };
    const folders = store.state.data.reaper.allowedFolders;
    const invalid = folders.filter((folder) => {
      try {
        validate.safeRelativePath(folder, 'folder');
        return false;
      } catch (err) {
        return true;
      }
    });
    if (invalid.length) return { ok: false, message: `${invalid.length} niedozwolonych ścieżek w konfiguracji` };
    return { ok: true, message: `${folders.length} dozwolonych folderów, konfiguracja poprawna` };
  }
};

export const manifestMeta = {
  format: MANIFEST_FORMAT,
  version: MANIFEST_VERSION,
  maxBytes: MAX_MANIFEST_BYTES,
  maxProjects: MAX_PROJECTS,
  today: todayISO,
  fmtDate
};
