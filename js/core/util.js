/** Funkcje pomocnicze wspólne dla całej aplikacji. Bez zależności zewnętrznych. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * Tworzy element DOM. Treść użytkownika zawsze przez textContent —
 * nigdy przez innerHTML — co eliminuje wstrzykiwanie znaczników (XSS).
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  const settings = props || {};

  for (const key of Object.keys(settings)) {
    const value = settings[key];
    if (value === null || value === undefined || value === false) continue;

    switch (key) {
      case 'class':
        node.className = String(value);
        break;
      case 'text':
        node.textContent = String(value);
        break;
      case 'dataset':
        Object.assign(node.dataset, value);
        break;
      case 'style':
        Object.assign(node.style, value);
        break;
      case 'on': {
        for (const [eventName, handler] of Object.entries(value)) {
          if (typeof handler === 'function') node.addEventListener(eventName, handler);
        }
        break;
      }
      case 'attrs': {
        for (const [attr, attrValue] of Object.entries(value)) {
          if (attrValue === null || attrValue === undefined || attrValue === false) continue;
          node.setAttribute(attr, String(attrValue));
        }
        break;
      }
      case 'value':
        node.value = value;
        break;
      case 'checked':
      case 'disabled':
      case 'required':
      case 'readOnly':
      case 'multiple':
      case 'selected':
        node[key] = Boolean(value);
        break;
      default:
        node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
      continue;
    }
    if (child instanceof Node) {
      node.appendChild(child);
      continue;
    }
    node.appendChild(document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

let uidCounter = 0;

export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}`;
}

export function debounce(fn, ms = 250) {
  let timer = null;
  function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = (...args) => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn(...args);
  };
  return debounced;
}

export function throttle(fn, ms = 200) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return function throttled(...args) {
    const now = Date.now();
    const remaining = ms - (now - last);
    lastArgs = args;
    if (remaining <= 0) {
      last = now;
      fn(...args);
      return;
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...lastArgs);
      }, remaining);
    }
  };
}

export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Czas w milisekundach. Wywołanie performance.now() musi być metodą obiektu —
 * wyjęta funkcja rzuca w WebKit „Can only call Performance.now on instances of Performance”.
 */
export function nowMs() {
  if (globalThis.performance && typeof globalThis.performance.now === 'function') {
    return globalThis.performance.now();
  }
  return Date.now();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeNumber(value, fallback = 0) {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(num) ? num : fallback;
}

export function round2(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

export function sum(list, selector = (item) => item) {
  return (list || []).reduce((total, item) => total + safeNumber(selector(item)), 0);
}

export function groupBy(list, selector) {
  const map = new Map();
  for (const item of list || []) {
    const key = selector(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function sortBy(list, selector, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...(list || [])].sort((a, b) => {
    const av = selector(a);
    const bv = selector(b);
    if (av === bv) return 0;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return av > bv ? factor : -factor;
  });
}

export function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function nowISO() {
  return new Date().toISOString();
}

const dateFormatter = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function fmtDate(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

export function fmtMoney(amount, currency = 'PLN') {
  const value = safeNumber(amount, NaN);
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch (err) {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function fmtNumber(value) {
  const num = safeNumber(value, NaN);
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('pl-PL').format(num);
}

export function fmtPercent(value) {
  const num = safeNumber(value, NaN);
  if (!Number.isFinite(num)) return '—';
  return `${Math.round(num * 100)}%`;
}

export function formatBytes(bytes) {
  const size = safeNumber(bytes, 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export async function copyText(text, { onSuccess = null, onError = null } = {}) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      if (onSuccess) onSuccess();
      return true;
    }
  } catch (err) {
    // Safari w trybie prywatnym blokuje schowek — próbujemy metody awaryjnej.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const copied = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    area.remove();
    if (copied) {
      if (onSuccess) onSuccess();
    } else if (onError) {
      onError();
    }
    return copied;
  } catch (err) {
    if (onError) onError();
    return false;
  }
}

export function download(filename, content, mime = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function timestampForFilename(prefix = 'bsxs') {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Paginacja: zwraca wycinek i metadane, chroniąc przed wyjściem poza zakres. */
export function paginate(list, page, pageSize) {
  const items = Array.isArray(list) ? list : [];
  const size = Math.max(1, Math.floor(safeNumber(pageSize, 20)));
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = clamp(Math.floor(safeNumber(page, 1)), 1, pages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pages,
    pageSize: size,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: Math.min(items.length, start + size)
  };
}

export function normalizeSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

export function matchesSearch(haystack, query) {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return normalizeSearch(haystack).includes(needle);
}
