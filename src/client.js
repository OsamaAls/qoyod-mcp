// HTTP client for the Qoyod API v2.0 (https://apidoc.qoyod.com/).
// Safety rules: writes (POST/PUT/PATCH/DELETE) are never re-sent after the request may have reached
// Qoyod; the whole call stays under a total deadline; redirects are never followed; MCP cancellation
// stops the call.
import { DEFAULT_BASE_URL } from './config.js';

export { DEFAULT_BASE_URL };

// The Postman doc spells a few request keys two different ways, so when the caller gives one we send both.
const KEY_ALIASES = [
  ['receive_payments', 'recieve_payments'],
  ['quotation_number', 'quotation_no'],
  ['terms_conditions', 'term_conditions'],
  ['secondary_phone_number', 'secondary_contact_number'],
];

// Connection errors that prove the request never reached the server, so even a write may be retried.
const PRE_SEND_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);
const RETRY_AFTER_MAX_MS = 10_000;
const MAYBE_SAVED =
  'The record MAY ALREADY BE SAVED in Qoyod. Do not send it again: first check with a read (for example list by reference or date).';

export class QoyodApiError extends Error {
  constructor(message, { status, method, url, path, body, maybeSaved = false, requestId, code, cancelled = false } = {}) {
    super(message);
    this.name = 'QoyodApiError';
    Object.assign(this, { status, method, url, path, body, maybeSaved, requestId, code, cancelled });
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

export function parseBody(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { message: '(empty response body)' };
  try {
    return JSON.parse(trimmed);
  } catch {
    // DELETE endpoints answer with sentences like "Bill destroyed successfully".
    return { message: trimmed };
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return NaN;
  if (/^\s*\d+\s*$/.test(value)) return Number(value) * 1000;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t - now : NaN;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class QoyodClient {
  constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 45_000,
    totalTimeoutMs = 50_000,
    maxRetries = 2,
    userAgent = 'qoyod-mcp',
    label = '',
    log = null,
    debug = false,
    backoffMs = 1000,
  } = {}) {
    this.backoffMs = backoffMs;
    if (!apiKey) throw new Error('QoyodClient: apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.totalTimeoutMs = totalTimeoutMs;
    this.maxRetries = maxRetries;
    this.userAgent = userAgent;
    this.label = label;
    this.log = log;
    this.debug = debug;
  }

  buildUrl(path, { page, per_page, q, sort, params } = {}) {
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
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        if (v == null) continue;
        if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
        else url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  logAttempt(method, path, outcome, ms, attempt, failed, requestId) {
    if (!this.log) return;
    if (method === 'GET' && !failed && !this.debug) return;
    const who = this.label ? `${this.label} ` : '';
    this.log(`${who}${method} ${path} -> ${outcome} in ${ms} ms (attempt ${attempt + 1})${requestId ? ` request-id ${requestId}` : ''}`);
  }

  async request(method, path, { query, body, signal } = {}) {
    const url = this.buildUrl(path, query);
    const shortPath = new URL(url).pathname;
    const isWrite = method !== 'GET';
    const headers = { 'API-KEY': this.apiKey, Accept: 'application/json', 'User-Agent': this.userAgent };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const deadline = Date.now() + this.totalTimeoutMs;
    const cancelled = (sent) =>
      new QoyodApiError(
        `${method} ${shortPath}: cancelled by the client.${isWrite && sent ? ` ${MAYBE_SAVED}` : ''}`,
        { method, url, path: shortPath, cancelled: true, maybeSaved: isWrite && sent },
      );

    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw cancelled(attempt > 0);
      const budget = Math.min(this.timeoutMs, deadline - Date.now());
      if (budget <= 0) {
        throw new QoyodApiError(`${method} ${shortPath}: no answer from Qoyod in time.${isWrite && attempt > 0 ? ` ${MAYBE_SAVED}` : ''}`, {
          method, url, path: shortPath, code: 'TIMEOUT', maybeSaved: isWrite && attempt > 0,
        });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budget);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const started = Date.now();
      let res;
      let text;
      let netErr;
      try {
        res = await this.fetch(url, { method, headers, body: payload, signal: controller.signal, redirect: 'manual' });
        text = await res.text(); // read the body under the same timeout
      } catch (err) {
        netErr = err;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      const ms = Date.now() - started;

      if (netErr) {
        if (signal?.aborted) {
          this.logAttempt(method, shortPath, 'CANCELLED', ms, attempt, true);
          throw cancelled(true);
        }
        const timedOut = controller.signal.aborted;
        const code = timedOut ? 'TIMEOUT' : netErr?.cause?.code || netErr?.code || netErr?.name || 'ERROR';
        const preSend = !timedOut && PRE_SEND_CODES.has(code);
        this.logAttempt(method, shortPath, code, ms, attempt, true);
        const wait = this.backoffMs * 2 ** attempt;
        if (attempt < this.maxRetries && (!isWrite || preSend) && Date.now() + wait < deadline) {
          try {
            await sleep(wait, signal);
          } catch {
            throw cancelled(false);
          }
          continue;
        }
        const what = timedOut ? `no answer from Qoyod within ${Math.round(budget / 1000)} s` : `network error (${code})`;
        if (isWrite && !preSend) {
          throw new QoyodApiError(`${method} ${shortPath}: ${what}. ${MAYBE_SAVED}`, { method, url, path: shortPath, code, maybeSaved: true });
        }
        throw new QoyodApiError(`${method} ${shortPath}: ${what}.`, { method, url, path: shortPath, code });
      }

      const requestId = res.headers.get('x-request-id') || undefined;
      this.logAttempt(method, shortPath, res.status, ms, attempt, !res.ok, requestId);

      if (res.status >= 300 && res.status < 400) {
        throw new QoyodApiError(
          `Qoyod answered ${res.status} (redirect) on ${method} ${shortPath}; the redirect was not followed. Check the base URL.`,
          { status: res.status, method, url, path: shortPath },
        );
      }
      const data = parseBody(text);
      if (res.ok) return { status: res.status, data };

      if (res.status === 429 && attempt < this.maxRetries) {
        let waitMs = parseRetryAfter(res.headers.get('retry-after'));
        if (!Number.isFinite(waitMs) || waitMs < 0) waitMs = this.backoffMs * 2 ** attempt;
        if (waitMs > RETRY_AFTER_MAX_MS || Date.now() + waitMs >= deadline) {
          throw new QoyodApiError(`Qoyod rate limit reached; try again in about ${Math.ceil(waitMs / 1000)} s.`, {
            status: 429, method, url, path: shortPath, body: data,
          });
        }
        try {
          await sleep(waitMs, signal);
        } catch {
          throw cancelled(false);
        }
        continue;
      }
      if (!isWrite && res.status >= 500 && attempt < this.maxRetries) {
        const wait = this.backoffMs * 2 ** attempt;
        if (Date.now() + wait < deadline) {
          try {
            await sleep(wait, signal);
          } catch {
            throw cancelled(false);
          }
          continue;
        }
      }
      const maybeSaved = isWrite && res.status >= 500;
      throw new QoyodApiError(
        `Qoyod API ${res.status} on ${method} ${shortPath}${requestId ? ` (request id ${requestId})` : ''}.${maybeSaved ? ` ${MAYBE_SAVED}` : ''}`,
        { status: res.status, method, url, path: shortPath, body: data, maybeSaved, requestId },
      );
    }
  }

  get(path, query, opts = {}) { return this.request('GET', path, { query, ...opts }); }
  post(path, body, opts = {}) { return this.request('POST', path, { body, ...opts }); }
  put(path, body, opts = {}) { return this.request('PUT', path, { body, ...opts }); }
  patch(path, body, opts = {}) { return this.request('PATCH', path, { body, ...opts }); }
  delete(path, opts = {}) { return this.request('DELETE', path, opts); }
}
