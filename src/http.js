// Optional Streamable HTTP transport, for self-hosting only (QOYOD_TRANSPORT=http).
// - refuses to start without QOYOD_HTTP_TOKEN (Authorization: Bearer <token>, constant-time check)
// - binds to 127.0.0.1 by default, with DNS-rebinding protection on loopback
// - one MCP session per client, so the company pop-up (elicitation) works over HTTP too
// Never expose one instance for other people's Qoyod accounts.
import crypto from 'node:crypto';
import http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { isSet } from './config.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function tokenMatches(authorization, token) {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1].trim()).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

export async function startHttp({ ctx, buildServer, log = () => {} }) {
  const env = ctx.env;
  const token = isSet(env.QOYOD_HTTP_TOKEN) ? env.QOYOD_HTTP_TOKEN.trim() : '';
  if (token.length < 16) {
    throw new Error('QOYOD_TRANSPORT=http needs QOYOD_HTTP_TOKEN with at least 16 characters. Refusing to start without it.');
  }
  const host = isSet(env.QOYOD_HTTP_HOST) ? env.QOYOD_HTTP_HOST.trim() : '127.0.0.1';
  const port = env.QOYOD_HTTP_PORT != null && env.QOYOD_HTTP_PORT !== '' ? Number(env.QOYOD_HTTP_PORT) : 8787;
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const sessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') return send(res, 200, { ok: true });
      if (url.pathname !== '/mcp') return send(res, 404, { error: 'not found' });
      if (!tokenMatches(req.headers.authorization, token)) {
        return send(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      }
      const sid = req.headers['mcp-session-id'];
      let entry = typeof sid === 'string' ? sessions.get(sid) : undefined;

      if (req.method === 'POST') {
        const body = await readJson(req);
        if (!entry) {
          if (sid) return send(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
          if (!isInitializeRequest(body)) {
            return send(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: start a session with initialize' }, id: null });
          }
          const actualPort = httpServer.address().port;
          const { server } = buildServer(ctx);
          const newEntry = { server, transport: null, lastSeen: Date.now() };
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => sessions.set(id, newEntry),
            enableDnsRebindingProtection: loopback,
            allowedHosts: loopback ? [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`] : undefined,
          });
          newEntry.transport = transport;
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
          return;
        }
        entry.lastSeen = Date.now();
        await entry.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!entry) return send(res, 404, { error: 'session not found' });
        entry.lastSeen = Date.now();
        await entry.transport.handleRequest(req, res);
        return;
      }
      return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, POST, DELETE' });
    } catch (err) {
      log(`http: ${err?.message ?? err}`);
      if (!res.headersSent) send(res, err?.statusCode ?? 500, { error: err?.statusCode ? err.message : 'internal error' });
    }
  });

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, e] of sessions) {
      if (now - e.lastSeen > SESSION_IDLE_MS) {
        sessions.delete(id);
        e.transport.close().catch(() => {});
      }
    }
  }, 60_000);
  sweeper.unref();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });
  const actual = httpServer.address();
  log(`HTTP transport listening on http://${host}:${actual.port}/mcp (bearer token required)`);
  if (!loopback) log('WARNING: listening beyond this computer. Put it behind HTTPS, and never serve other people\'s Qoyod accounts from one instance.');

  return {
    port: actual.port,
    sessions,
    close: async () => {
      clearInterval(sweeper);
      for (const e of sessions.values()) await e.transport.close().catch(() => {});
      sessions.clear();
      await new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}
