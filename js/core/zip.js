/**
 * Minimalny zapis ZIP (metoda 0 — bez kompresji), bez zależności zewnętrznych.
 *
 * Używany do paczki „pobierz wszystko” w module Mix Master: jeden plik ZIP
 * z łańcuchami .RfxChain, receptą, pakietami JSON i instrukcją. Metoda 0 jest
 * celowa — pliki są małe (kilka KB), więc brak kompresji nic nie kosztuje,
 * a usuwa całą klasę błędów i nie wymaga biblioteki z zewnątrz.
 *
 * Format: lokalny nagłówek + dane + katalog centralny + EOCD (PKWARE APPNOTE).
 * Nazwy plików przechodzą walidację (bez „/”, „..” i znaków kontrolnych), więc
 * archiwum nie może wyjść poza katalog po rozpakowaniu (ochrona przed zip-slip).
 */

import { ValidationError } from './errors.js';

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const MAX_ENTRIES = 65535;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const SAFE_ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,149}$/;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new ValidationError('Nieprawidłowe dane do zapisu ZIP.');
}

function encodeUtf8(text) {
  const value = String(text ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value);
  // Awaryjnie tylko ASCII — lepiej jawny błąd niż uszkodzone znaki.
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) {
      throw new ValidationError('Tekst zawiera znaki spoza ASCII, a przeglądarka nie udostępnia UTF-8.');
    }
    bytes[index] = code;
  }
  return bytes;
}

/** CRC32 (polinom 0xEDB88320) — wymagany przez format ZIP. */
export function crc32(value) {
  const bytes = toBytes(value);
  let crc = 0xffffffff;
  for (let index = 0; index < dataLength(bytes); index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dataLength(bytes) {
  return bytes.length;
}

function dosDateTime(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  const time = ((value.getHours() & 0x1f) << 11)
    | ((value.getMinutes() & 0x3f) << 5)
    | (Math.floor(value.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9)
    | (((value.getMonth() + 1) & 0x0f) << 5)
    | (value.getDate() & 0x1f);
  return { time: time & 0xffff, date: day & 0xffff };
}

function sanitizeEntryName(name) {
  const text = String(name ?? '').trim();
  if (!text) throw new ValidationError('Plik w paczce nie ma nazwy.');
  if (text.length > 150) {
    throw new ValidationError(`Nazwa pliku w paczce jest za długa: ${text.slice(0, 40)}…`);
  }
  if (text.includes('..') || /[\\/\u0000-\u001f]/.test(text)) {
    throw new ValidationError(`Niedozwolona nazwa pliku w paczce: ${text}.`);
  }
  if (!SAFE_ENTRY_NAME.test(text)) {
    throw new ValidationError(`Nazwa pliku w paczce zawiera niedozwolone znaki: ${text}.`);
  }
  return text;
}

function normalizeEntries(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError('Paczka ZIP musi zawierać co najmniej jeden plik.');
  }
  if (files.length > MAX_ENTRIES) {
    throw new ValidationError(`Paczka ZIP może zawierać maksymalnie ${MAX_ENTRIES} plików.`);
  }
  const names = new Set();
  return files.map((file) => {
    const name = sanitizeEntryName(file?.name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new ValidationError(`Zduplikowana nazwa w paczce: ${name}.`);
    names.add(key);
    const data = file?.bytes instanceof Uint8Array ? file.bytes : encodeUtf8(file?.text ?? '');
    return { name, nameBytes: encodeUtf8(name), data, crc: crc32(data), offset: 0 };
  });
}

class ByteWriter {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }

  u16(value) {
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
  }

  u32(value) {
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  raw(chunk) {
    this.bytes.set(chunk, this.offset);
    this.offset += chunk.length;
  }

  finish() {
    if (this.offset !== this.bytes.length) {
      throw new ValidationError('Nieprawidłowy rozmiar archiwum ZIP.');
    }
    return this.bytes;
  }
}

/**
 * Buduje archiwum ZIP w pamięci.
 * @param {Array<{name: string, text?: string, bytes?: Uint8Array}>} files
 * @param {{date?: Date}} options data modyfikacji wpisów
 * @returns {Uint8Array}
 */
export function createZip(files, { date = new Date() } = {}) {
  const entries = normalizeEntries(files);
  const { time, date: dosDate } = dosDateTime(date);

  let total = EOCD_SIZE;
  for (const entry of entries) {
    total += LOCAL_HEADER_SIZE + entry.nameBytes.length + entry.data.length;
    total += CENTRAL_HEADER_SIZE + entry.nameBytes.length;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new ValidationError('Paczka ZIP jest za duża, aby ją pobrać na tym urządzeniu.');
  }

  const writer = new ByteWriter(total);

  for (const entry of entries) {
    entry.offset = writer.offset;
    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(0x0800); // nazwy w UTF-8
    writer.u16(0); // metoda 0 — bez kompresji
    writer.u16(time);
    writer.u16(dosDate);
    writer.u32(entry.crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.nameBytes.length);
    writer.u16(0);
    writer.raw(entry.nameBytes);
    writer.raw(entry.data);
  }

  const centralStart = writer.offset;
  for (const entry of entries) {
    writer.u32(0x02014b50);
    writer.u16(20); // wersja twórcy
    writer.u16(20); // wersja potrzebna do odczytu
    writer.u16(0x0800);
    writer.u16(0);
    writer.u16(time);
    writer.u16(dosDate);
    writer.u32(entry.crc);
    writer.u32(entry.data.length);
    writer.u32(entry.data.length);
    writer.u16(entry.nameBytes.length);
    writer.u16(0); // extra
    writer.u16(0); // komentarz
    writer.u16(0); // dysk
    writer.u16(0); // atrybuty wewnętrzne
    writer.u32(0); // atrybuty zewnętrzne
    writer.u32(entry.offset);
    writer.raw(entry.nameBytes);
  }

  const centralEnd = writer.offset;
  writer.u32(0x06054b50);
  writer.u16(0);
  writer.u16(0);
  writer.u16(entries.length);
  writer.u16(entries.length);
  writer.u32(centralEnd - centralStart);
  writer.u32(centralStart);
  writer.u16(0);

  return writer.finish();
}
