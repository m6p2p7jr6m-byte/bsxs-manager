/** Walidacja danych użytkownika. Każdy walidator rzuca ValidationError z komunikatem PL. */

import { ValidationError } from './errors.js';

export function requireText(value, label, { min = 1, max = 200 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < Math.max(1, min)) {
    throw new ValidationError(min <= 1
      ? `Pole „${label}” jest wymagane.`
      : `Pole „${label}” musi mieć co najmniej ${min} znaków.`);
  }
  if (text.length > max) {
    throw new ValidationError(`Pole „${label}” może mieć maksymalnie ${max} znaków.`);
  }
  return text;
}

export function optionalText(value, label, { max = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > max) {
    throw new ValidationError(`Pole „${label}” może mieć maksymalnie ${max} znaków.`);
  }
  return text;
}

export function requireUsername(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(text)) {
    throw new ValidationError(
      'Nazwa użytkownika: 3–32 znaki, dozwolone małe litery bez polskich znaków, cyfry, kropka, myślnik i podkreślenie.'
    );
  }
  return text;
}

export function requireDisplayName(value) {
  return requireText(value, 'Imię / nazwa', { min: 2, max: 60 });
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'haslo123', 'qwerty123', 'qwerty12345',
  '123456789', '12345678', 'iloveyou', 'admin123', 'bsxs12345', 'xaro12345'
]);

export function requirePassword(value) {
  const password = String(value ?? '');
  if (password.length < 10) {
    throw new ValidationError('Hasło musi mieć co najmniej 10 znaków.');
  }
  if (password.length > 200) {
    throw new ValidationError('Hasło może mieć maksymalnie 200 znaków.');
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new ValidationError('Hasło musi zawierać co najmniej jedną literę i jedną cyfrę.');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new ValidationError('To hasło jest zbyt popularne. Wybierz inne.');
  }
  return password;
}

export function requireEmail(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(text) || text.length > 160) {
    throw new ValidationError('Podaj prawidłowy adres e-mail.');
  }
  return text;
}

export function optionalEmail(value) {
  const text = String(value ?? '').trim();
  return text ? requireEmail(text) : '';
}

export function requirePhone(value) {
  const text = String(value ?? '').trim();
  if (text && !/^[+0-9 ()-]{6,24}$/.test(text)) {
    throw new ValidationError('Numer telefonu zawiera niedozwolone znaki.');
  }
  return text;
}

export function requireDate(value, label = 'Data') {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ValidationError(`Pole „${label}” wymaga daty w formacie RRRR-MM-DD.`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || year < 1900
    || year > 2200
  ) {
    throw new ValidationError(`Pole „${label}” zawiera nieistniejącą datę.`);
  }
  return text;
}

export function optionalDate(value, label = 'Data') {
  const text = String(value ?? '').trim();
  return text ? requireDate(text, label) : '';
}

export function requireNumber(value, label, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) throw new ValidationError(`Pole „${label}” jest wymagane.`);
  const number = Number(raw);
  if (!Number.isFinite(number)) {
    throw new ValidationError(`Pole „${label}” musi być liczbą.`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new ValidationError(`Pole „${label}” musi być liczbą całkowitą.`);
  }
  if (number < min) throw new ValidationError(`Pole „${label}” nie może być mniejsze niż ${min}.`);
  if (number > max) throw new ValidationError(`Pole „${label}” nie może być większe niż ${max}.`);
  return number;
}

export function optionalNumber(value, label, options = {}) {
  const raw = String(value ?? '').trim();
  return raw ? requireNumber(raw, label, options) : null;
}

export function requireMoney(value, label = 'Kwota') {
  return requireNumber(value, label, { min: 0, max: 100000000 });
}

export function requireEnum(value, allowed, label) {
  const text = String(value ?? '').trim();
  if (!allowed.includes(text)) {
    throw new ValidationError(`Pole „${label}” ma nieprawidłową wartość.`);
  }
  return text;
}

export function requireIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean).slice(0, 500);
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:/;

/**
 * Walidacja ścieżki względnej do projektów REAPER.
 * Odrzuca ścieżki absolutne, `..`, znaki kontrolne i puste segmenty.
 */
export function safeRelativePath(value, label = 'Ścieżka') {
  const raw = String(value ?? '').trim();
  if (!raw) throw new ValidationError(`Pole „${label}” jest wymagane.`);
  if (raw.length > 400) throw new ValidationError(`Pole „${label}” jest za długie.`);
  if (CONTROL_CHARS.test(raw)) throw new ValidationError(`Pole „${label}” zawiera niedozwolone znaki sterujące.`);
  if (raw.startsWith('/') || raw.startsWith('\\') || WINDOWS_ABSOLUTE.test(raw)) {
    throw new ValidationError(`Pole „${label}” musi być ścieżką względną (bez dysku i wiodącego ukośnika).`);
  }
  if (raw.startsWith('~')) {
    throw new ValidationError(`Pole „${label}” nie może używać skrótu domowego katalogu.`);
  }
  const segments = raw.replace(/\\/g, '/').split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ValidationError(`Pole „${label}” zawiera niedozwolony segment ścieżki.`);
    }
  }
  return segments.join('/');
}

export function sanitizeFilename(name, fallback = 'plik') {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function requireOtpCode(value) {
  const code = String(value ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) {
    throw new ValidationError('Kod weryfikacyjny musi mieć 6 cyfr.');
  }
  return code;
}

export function requireRecoveryCode(value) {
  const code = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{20}$/.test(code)) {
    throw new ValidationError('Kod odzyskiwania ma 20 znaków (litery i cyfry).');
  }
  return code;
}

export function requireConfirmation(value, expected, label = 'potwierdzenie') {
  if (String(value ?? '').trim() !== expected) {
    throw new ValidationError(`Aby kontynuować, wpisz dokładnie: ${expected}`);
  }
  return expected;
}

export function requireLevel(value, allowed, label = 'Poziom') {
  return requireEnum(value, allowed, label);
}
