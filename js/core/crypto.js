/** Kryptografia: PBKDF2-SHA256 (hasła), AES-GCM (kopie zapasowe), TOTP (MFA). */

import { AppError } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const PBKDF2_ITERATIONS = 600000;
export const PBKDF2_MIN_ITERATIONS = 100000;

export function hasSubtle() {
  return Boolean(globalThis.crypto && globalThis.crypto.subtle && typeof globalThis.crypto.getRandomValues === 'function');
}

export function assertCrypto() {
  if (!hasSubtle()) {
    throw new AppError(
      'Ta przeglądarka nie udostępnia Web Crypto. Otwórz aplikację przez HTTPS w aktualnej przeglądarce.',
      'crypto_unavailable'
    );
  }
}

export function randomBytes(length = 16) {
  assertCrypto();
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomHex(bytesLength = 16) {
  return Array.from(randomBytes(bytesLength))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function bytesToB64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function b64ToBytes(base64) {
  const binary = atob(String(base64));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function utf8ToB64(text) {
  return bytesToB64(encoder.encode(String(text)));
}

export function b64ToUtf8(base64) {
  return decoder.decode(b64ToBytes(base64));
}

export function timingSafeEqual(a, b) {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  const right = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function timingSafeEqualString(a, b) {
  const left = encoder.encode(String(a ?? ''));
  const right = encoder.encode(String(b ?? ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function sha256Hex(text) {
  assertCrypto();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(String(text)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function pbkdf2Bits(password, saltBytes, iterations) {
  assertCrypto();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

/** Hash hasła: PBKDF2-HMAC-SHA256, losowa sól, 600 000 iteracji. */
export async function hashPassword(password, { iterations = PBKDF2_ITERATIONS } = {}) {
  if (iterations < PBKDF2_MIN_ITERATIONS) {
    throw new AppError('Zbyt mała liczba iteracji PBKDF2.', 'crypto_policy');
  }
  const salt = randomBytes(16);
  const bits = await pbkdf2Bits(password, salt, iterations);
  return {
    algo: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToB64(salt),
    hash: bytesToB64(bits)
  };
}

export async function verifyPassword(password, record) {
  if (!record || record.algo !== 'PBKDF2-SHA256' || !record.salt || !record.hash) return false;
  const iterations = Number(record.iterations);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const bits = await pbkdf2Bits(password, b64ToBytes(record.salt), iterations);
    return timingSafeEqual(bits, b64ToBytes(record.hash));
  } catch (err) {
    // Błąd kryptografii oznacza nieudaną weryfikację — nigdy akceptację.
    return false;
  }
}

export function needsRehash(record) {
  return !record || record.algo !== 'PBKDF2-SHA256' || Number(record.iterations) < PBKDF2_ITERATIONS;
}

async function deriveAesKey(passphrase, saltBytes, iterations) {
  assertCrypto();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(String(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Szyfruje tekst hasłem (AES-GCM 256). Używane do kopii zapasowych i sekretu MFA. */
export async function encryptText(text, passphrase, { iterations = PBKDF2_ITERATIONS } = {}) {
  if (!passphrase || String(passphrase).length < 8) {
    throw new AppError('Hasło szyfrowania musi mieć co najmniej 8 znaków.', 'crypto_weak_passphrase');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAesKey(passphrase, salt, iterations);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(String(text))
  );
  return {
    v: 1,
    cipher: 'AES-GCM-256',
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: bytesToB64(salt) },
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(ciphertext))
  };
}

export async function decryptText(packageObject, passphrase) {
  if (!packageObject || packageObject.cipher !== 'AES-GCM-256' || !packageObject.data) {
    throw new AppError('Nieprawidłowy format zaszyfrowanych danych.', 'crypto_format');
  }
  const iterations = Number(packageObject.kdf?.iterations);
  if (!Number.isFinite(iterations) || iterations < 1000) {
    throw new AppError('Nieprawidłowe parametry szyfrowania.', 'crypto_format');
  }
  try {
    const key = await deriveAesKey(passphrase, b64ToBytes(packageObject.kdf.salt), iterations);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(packageObject.iv) },
      key,
      b64ToBytes(packageObject.data)
    );
    return decoder.decode(plaintext);
  } catch (err) {
    throw new AppError('Nie udało się odszyfrować — nieprawidłowe hasło lub uszkodzone dane.', 'crypto_decrypt');
  }
}

/* ---------------- TOTP (RFC 6238) ---------------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const normalized = String(input ?? '').toUpperCase().replace(/[\s=]/g, '');
  if (!normalized) return new Uint8Array(0);
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new AppError('Nieprawidłowy sekret MFA (base32).', 'crypto_base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export async function hotp(secretBytes, counter, { digits = 6, algorithm = 'SHA-1' } = {}) {
  assertCrypto();
  const buffer = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | (signature[offset + 1] << 16)
    | (signature[offset + 2] << 8)
    | signature[offset + 3];
  const code = binary % (10 ** digits);
  return String(code).padStart(digits, '0');
}

export async function totp(secretBase32, { timeMs = Date.now(), period = 30, digits = 6, algorithm = 'SHA-1' } = {}) {
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) throw new AppError('Brak sekretu MFA.', 'crypto_base32');
  const counter = Math.floor(timeMs / 1000 / period);
  return hotp(secret, counter, { digits, algorithm });
}

export async function verifyTotp(secretBase32, token, { window = 1, timeMs = Date.now(), period = 30, digits = 6 } = {}) {
  const code = String(token ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const counter = Math.floor(timeMs / 1000 / period);
  let matched = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await hotp(secret, counter + offset, { digits });
    if (timingSafeEqualString(candidate, code)) matched = true;
  }
  return matched;
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl({ secret, label = 'BSXS Manager', issuer = 'BSXS' }) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

export function generateRecoveryCode() {
  const raw = randomHex(10).toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

export function normalizeRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
