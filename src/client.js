// Thin HTTP client for the Qoyod API v2.0 (https://apidoc.qoyod.com/).
// Handles auth header, Ransack query building, plain-text DELETE bodies,
// 200-vs-201 creates, retries on 429/5xx, and known doc typos.

export const DEFAULT_BASE_URL = 'https://api.qoyod.com/2.0';

// The Postman doc spells a few request keys two different ways; nobody knows
// which the server accepts, so when the caller gives one we send both.
const KEY_ALIASES = [
  ['receive_payments', 'recieve_payments'],
  ['quotation_number', 'quotation_no'],
  ['terms_conditions', 'term_conditions'],
  ['secondary_phone_number', 'secondary_contact_number'],
];

export class QoyodApiError extends Error {
  constructor(message, { status, method, url, body }) {
    super(message);
    this.name = 'QoyodApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.body = body;
  }
}

export function expandAliases(data) {
  if (Array.isArray(data)) return data.map(expandAliases);
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const [a, b] of KEY_ALIASES) {
    if (a in out && !(b in out)) out[b] = out[a];
    else if (b in out && !(a in out)) out[a] = out[b];
  }
  return out;
}

function parseBody(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { message: '(empty response body)' };
  try {
    return JSON.parse(trimmed);
  } catch {
    // DELETE endpoints answer with sentences like "Bill destroyed successfully".
    return { message: trimmed };
  }
}

export class QoyodClient {
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, timeoutMs = 60_000, maxRetries = 2 } = {}) {
    if (!apiKey) throw new Error('QoyodClient: apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  buildUrl(path, { page, per_page, q, sort } = {}) {
    const url = new URL(`${this.baseUrl}/${String(path).replace(/^\/+/, '')}`);
    if (page != null) url.searchParams.set('page', String(page));
    if (per_page != null) url.searchParams.set('per_page', String(per_page));
    if (q && typeof q === 'object') {
      for (const [k, v] of Object.entries(q)) {
        if (v == null) continue;
        const key = k.startsWith('q[') ? k : `q[${k}]`;
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(`${key}[]`, String(item)));
        else url.searchParams.set(key, String(v));
      }
    }
    if (sort) url.searchParams.set('q[s]', sort);
    return url.toString();
  }

  async request(method, path, { query, body } = {}) {
    const url = this.buildUrl(path, query);
    const headers = { 'API-KEY': this.apiKey, Accept: 'application/json' };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetch(url, { method, headers, body: payload, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < this.maxRetries) {
          await sleep(1000 * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new QoyodApiError(`Network error calling ${method} ${url}: ${err.message}`, { method, url });
      }
      clearTimeout(timer);

      const text = await res.text();
      const data = parseBody(text);

      if (res.ok) return { status: res.status, data };

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        attempt++;
        continue;
      }

      const summary = typeof data === 'object' ? JSON.stringify(data) : String(data);
      throw new QoyodApiError(`Qoyod API ${res.status} on ${method} ${url}: ${summary.slice(0, 2000)}`, {
        status: res.status, method, url, body: data,
      });
    }
  }

  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body) { return this.request('POST', path, { body }); }
  put(path, body) { return this.request('PUT', path, { body }); }
  patch(path, body) { return this.request('PATCH', path, { body }); }
  delete(path) { return this.request('DELETE', path); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
