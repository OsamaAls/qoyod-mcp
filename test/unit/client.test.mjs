import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRetryAfter, QoyodClient } from '../../src/client.js';

const res = (status, body = {}, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

function scripted(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return step(url, init);
  };
  return { fetchImpl, calls };
}

const client = (fetchImpl, extra = {}) => new QoyodClient({ apiKey: 'k-123456789', fetchImpl, backoffMs: 1, ...extra });
const netError = (code) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const hang = (url, init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

test('GET is retried on 5xx', async () => {
  const { fetchImpl, calls } = scripted([() => res(503), () => res(200, { ok: 1 })]);
  const r = await client(fetchImpl).get('accounts');
  assert.deepEqual(r.data, { ok: 1 });
  assert.equal(calls.length, 2);
});

test('POST, PUT, PATCH and DELETE are never re-sent after a 5xx', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { fetchImpl, calls } = scripted([() => res(502, 'Bad gateway')]);
    await assert.rejects(client(fetchImpl).request(method, 'bills', { body: method === 'DELETE' ? undefined : { a: 1 } }), (err) => {
      assert.equal(err.maybeSaved, true);
      assert.match(err.message, /MAY ALREADY BE SAVED/);
      return true;
    });
    assert.equal(calls.length, 1, method);
  }
});

test('a write whose connection dropped is not re-sent', async () => {
  const { fetchImpl, calls } = scripted([() => { throw netError('ECONNRESET'); }, () => res(201, {})]);
  await assert.rejects(client(fetchImpl).post('bills', { a: 1 }), (err) => err.maybeSaved === true);
  assert.equal(calls.length, 1);
});

test('a write that provably never reached Qoyod is retried', async () => {
  const { fetchImpl, calls } = scripted([() => { throw netError('ECONNREFUSED'); }, () => res(201, { bill: { id: 1 } })]);
  const r = await client(fetchImpl).post('bills', { a: 1 });
  assert.equal(r.status, 201);
  assert.equal(calls.length, 2);
});

test('429 honours a short Retry-After and fails fast on a long one', async () => {
  const a = scripted([() => res(429, {}, { 'retry-after': '0' }), () => res(200, {})]);
  await client(a.fetchImpl).post('bills', {});
  assert.equal(a.calls.length, 2);
  const b = scripted([() => res(429, {}, { 'retry-after': '3600' })]);
  await assert.rejects(client(b.fetchImpl).get('bills'), /rate limit/);
  assert.equal(b.calls.length, 1);
});

test('redirects are not followed', async () => {
  const { fetchImpl, calls } = scripted([() => res(302, '', { location: 'https://elsewhere.example/' })]);
  await assert.rejects(client(fetchImpl).post('bills', { a: 1 }), /redirect/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('timeouts: GET is retried within the deadline, a write is not', async () => {
  const g = scripted([hang]);
  await assert.rejects(client(g.fetchImpl, { timeoutMs: 30, totalTimeoutMs: 2000 }).get('bills'), /no answer/);
  assert.equal(g.calls.length, 3);
  const p = scripted([hang]);
  await assert.rejects(client(p.fetchImpl, { timeoutMs: 30, totalTimeoutMs: 2000 }).post('bills', {}), (err) => err.maybeSaved === true);
  assert.equal(p.calls.length, 1);
});

test('a body that stalls after the headers still times out', async () => {
  const fetchImpl = async (url, init) => ({
    status: 200,
    ok: true,
    headers: new Headers(),
    text: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
  });
  await assert.rejects(client(fetchImpl, { timeoutMs: 30, totalTimeoutMs: 100, maxRetries: 0 }).get('bills'), /no answer/);
});

test('MCP cancellation stops the request', async () => {
  const controller = new AbortController();
  const { fetchImpl, calls } = scripted([hang]);
  const p = client(fetchImpl).post('bills', { a: 1 }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(p, (err) => err.cancelled === true && err.maybeSaved === true);
  assert.equal(calls.length, 1);
});

test('Retry-After accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now), 10_000);
  assert.ok(Number.isNaN(parseRetryAfter(null)));
});

test('URLs: Ransack arrays, sort, raw params; identifying User-Agent', async () => {
  const c = client(async () => res(200));
  const url = new URL(c.buildUrl('invoices', { page: 2, per_page: 10, q: { id_in: [1, 2], status_eq: 'Draft' }, sort: 'id desc', params: { 'q[x]': 'y' } }));
  assert.deepEqual(url.searchParams.getAll('q[id_in][]'), ['1', '2']);
  assert.equal(url.searchParams.get('q[s]'), 'id desc');
  assert.equal(url.searchParams.get('q[x]'), 'y');
  const { fetchImpl, calls } = scripted([() => res(200)]);
  await new QoyodClient({ apiKey: 'k-123456789', fetchImpl, userAgent: 'qoyod-mcp/test' }).get('accounts');
  assert.equal(calls[0].init.headers['User-Agent'], 'qoyod-mcp/test');
});
