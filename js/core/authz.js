/** Role i uprawnienia. Każda chroniona operacja woła assertCan(). */

import { AuthzError } from './errors.js';

export const ROLES = ['owner', 'admin', 'member', 'viewer'];

export const ROLE_LABELS = {
  owner: 'Właściciel',
  admin: 'Administrator',
  member: 'Członek',
  viewer: 'Obserwator'
};

export const ROLE_DESCRIPTIONS = {
  owner: 'Pełny dostęp, zarządzanie użytkownikami, kopiami i usuwaniem danych.',
  admin: 'Zarządza modułami i diagnostyką, bez zmiany ról i usuwania danych.',
  member: 'Praca na utworach, wydawnictwach, studiu i zadaniach.',
  viewer: 'Tylko podgląd treści.'
};

export const PERMISSIONS = [
  'songs:read', 'songs:write', 'songs:delete',
  'releases:read', 'releases:write', 'releases:delete',
  'studio:read', 'studio:write', 'studio:delete',
  'mixing:read',
  'finances:read', 'finances:write', 'finances:delete',
  'tasks:read', 'tasks:write', 'tasks:delete',
  'team:read', 'team:write', 'team:delete',
  'reaper:read', 'reaper:write',
  'diagnostics:read', 'diagnostics:manage',
  'security:read', 'security:manage',
  'users:manage',
  'privacy:read', 'privacy:export', 'privacy:delete',
  'settings:write',
  'data:restore'
];

const READ_ONLY_TEAM = [
  'songs:read', 'releases:read', 'studio:read', 'mixing:read', 'tasks:read', 'team:read', 'reaper:read'
];

const MATRIX = {
  owner: PERMISSIONS.slice(),
  admin: PERMISSIONS.filter((permission) => ![
    'users:manage', 'privacy:delete', 'data:restore', 'security:manage'
  ].includes(permission)),
  member: [
    ...READ_ONLY_TEAM,
    'songs:write', 'releases:write', 'studio:write', 'tasks:write',
    'privacy:read', 'security:read'
  ],
  viewer: [
    ...READ_ONLY_TEAM,
    'privacy:read', 'security:read'
  ]
};

const PERMISSION_LABELS = {
  'songs:read': 'podgląd utworów',
  'songs:write': 'edycja utworów',
  'songs:delete': 'usuwanie utworów',
  'releases:read': 'podgląd wydawnictw',
  'releases:write': 'edycja wydawnictw',
  'releases:delete': 'usuwanie wydawnictw',
  'studio:read': 'podgląd sesji studyjnych',
  'studio:write': 'edycja sesji studyjnych',
  'studio:delete': 'usuwanie sesji studyjnych',
  'mixing:read': 'podgląd planów miksu i masteringu',
  'finances:read': 'podgląd finansów',
  'finances:write': 'edycja finansów',
  'finances:delete': 'usuwanie wpisów finansowych',
  'tasks:read': 'podgląd zadań',
  'tasks:write': 'edycja zadań',
  'tasks:delete': 'usuwanie zadań',
  'team:read': 'podgląd kolektywu',
  'team:write': 'edycja kolektywu',
  'team:delete': 'usuwanie osób',
  'reaper:read': 'podgląd integracji REAPER',
  'reaper:write': 'konfiguracja integracji REAPER',
  'diagnostics:read': 'podgląd diagnostyki',
  'diagnostics:manage': 'zarządzanie diagnostyką',
  'security:read': 'podgląd bezpieczeństwa',
  'security:manage': 'zarządzanie bezpieczeństwem',
  'users:manage': 'zarządzanie użytkownikami',
  'privacy:read': 'podgląd danych',
  'privacy:export': 'eksport danych',
  'privacy:delete': 'usuwanie danych',
  'settings:write': 'zmiana ustawień',
  'data:restore': 'przywracanie danych'
};

export function rolePermissions(role) {
  return new Set(MATRIX[role] || []);
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

export function can(user, permission) {
  if (!user || !isValidRole(user.role)) return false;
  return rolePermissions(user.role).has(permission);
}

export function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission;
}

export function assertCan(user, permission) {
  if (!can(user, permission)) {
    throw new AuthzError(
      `Brak uprawnień: ${permissionLabel(permission)}. Zgłoś się do właściciela lub administratora.`,
      { permission }
    );
  }
  return true;
}

export function assertOwner(user) {
  if (!user || user.role !== 'owner') {
    throw new AuthzError('Ta operacja jest dostępna wyłącznie dla właściciela.');
  }
  return true;
}

export function canManageUsers(user) {
  return can(user, 'users:manage');
}

/**
 * Zmiana roli: blokuje samodzielną eskalację, odebranie ostatniego
 * właściciela i operacje na własnym koncie.
 */
export function assertRoleChangeAllowed(actor, targetUser, nextRole, allUsers) {
  assertOwner(actor);
  if (!isValidRole(nextRole)) throw new AuthzError('Nieznana rola.');
  if (!targetUser) throw new AuthzError('Nie znaleziono użytkownika.');
  if (actor.id === targetUser.id) {
    throw new AuthzError('Nie możesz zmienić własnej roli.');
  }
  if (targetUser.role === nextRole) return true;
  if (targetUser.role === 'owner' && nextRole !== 'owner') {
    const otherOwners = (allUsers || []).filter((user) => user.role === 'owner' && user.id !== targetUser.id);
    if (otherOwners.length === 0) {
      throw new AuthzError('W kolektywie musi pozostać co najmniej jeden właściciel.');
    }
  }
  return true;
}

export function assertUserRemovalAllowed(actor, targetUser, allUsers) {
  assertOwner(actor);
  if (!targetUser) throw new AuthzError('Nie znaleziono użytkownika.');
  if (actor.id === targetUser.id) {
    throw new AuthzError('Nie możesz usunąć własnego konta w tym miejscu — użyj modułu Prywatność.');
  }
  if (targetUser.role === 'owner') {
    const otherOwners = (allUsers || []).filter((user) => user.role === 'owner' && user.id !== targetUser.id);
    if (otherOwners.length === 0) {
      throw new AuthzError('Nie można usunąć ostatniego właściciela.');
    }
  }
  return true;
}

export function ownerCount(users) {
  return (users || []).filter((user) => user.role === 'owner').length;
}
