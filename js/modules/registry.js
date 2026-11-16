/**
 * Rejestr modułów: lekkie metadane nawigacji i leniwe ładowanie kodu.
 *
 * Start aplikacji pobiera wyłącznie rdzeń i ekran logowania — kod modułu
 * trafia do przeglądarki dopiero przy pierwszym otwarciu zakładki. Dzięki
 * temu pierwsze uruchomienie jest szybsze, a ciężkie widoki (np. Mix Master
 * z katalogiem wtyczek) nie obciążają startu.
 *
 * Metadane muszą się zgadzać z definicją w module — pilnuje tego test
 * regresyjny „Rejestr modułów”.
 */

export const MODULE_REGISTRY = [
  {
    id: 'dashboard',
    title: 'Pulpit',
    shortTitle: 'Pulpit',
    icon: '⊞',
    group: 'Praca',
    permission: null,
    importModule: () => import('./dashboard.js')
  },
  {
    id: 'songs',
    title: 'Utwory',
    shortTitle: 'Utwory',
    icon: '♪',
    group: 'Praca',
    permission: 'songs:read',
    importModule: () => import('./songs.js')
  },
  {
    id: 'releases',
    title: 'Wydawnictwa',
    shortTitle: 'Wydania',
    icon: '◎',
    group: 'Praca',
    permission: 'releases:read',
    importModule: () => import('./releases.js')
  },
  {
    id: 'studio',
    title: 'Studio',
    shortTitle: 'Studio',
    icon: '◍',
    group: 'Praca',
    permission: 'studio:read',
    importModule: () => import('./studio.js')
  },
  {
    id: 'mixing',
    title: 'Mix Master',
    shortTitle: 'Mix',
    icon: '≋',
    group: 'Praca',
    permission: 'mixing:read',
    importModule: () => import('./mixing.js')
  },
  {
    id: 'finances',
    title: 'Finanse',
    shortTitle: 'Finanse',
    icon: '◈',
    group: 'Praca',
    permission: 'finances:read',
    importModule: () => import('./finances.js')
  },
  {
    id: 'tasks',
    title: 'Zadania',
    shortTitle: 'Zadania',
    icon: '✓',
    group: 'Praca',
    permission: 'tasks:read',
    importModule: () => import('./tasks.js')
  },
  {
    id: 'team',
    title: 'Kolektyw',
    shortTitle: 'Kolektyw',
    icon: '◉',
    group: 'Zespół',
    permission: 'team:read',
    importModule: () => import('./team.js')
  },
  {
    id: 'reaper',
    title: 'REAPER',
    shortTitle: 'REAPER',
    icon: '⎔',
    group: 'System',
    permission: 'reaper:read',
    importModule: () => import('./reaper.js')
  },
  {
    id: 'diagnostics',
    title: 'Diagnostyka',
    shortTitle: 'Diagnostyka',
    icon: '⌂',
    group: 'System',
    permission: 'diagnostics:read',
    importModule: () => import('./diagnostics.js')
  },
  {
    id: 'security',
    title: 'Bezpieczeństwo',
    shortTitle: 'Ochrona',
    icon: '⛨',
    group: 'System',
    permission: 'security:read',
    importModule: () => import('./security.js')
  },
  {
    id: 'privacy',
    title: 'Prywatność',
    shortTitle: 'Prywatność',
    icon: '◐',
    group: 'System',
    permission: 'privacy:read',
    importModule: () => import('./privacy.js')
  },
  {
    id: 'settings',
    title: 'Ustawienia',
    shortTitle: 'Ustawienia',
    icon: '⚙',
    group: 'System',
    permission: null,
    importModule: () => import('./settings.js')
  }
];
