// Test helpers: a fake Qoyod API (no network) and an in-memory MCP client connected to the real server code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildServer, createContext } from '../../src/server.js';

export const ONE = { QOYOD_API_KEY_1: 'fake-key-one-111', QOYOD_COMPANY_1_NAME: 'Alpha Co' };
export const TWO = { ...ONE, QOYOD_API_KEY_2: 'fake-key-two-222', QOYOD_COMPANY_2_NAME: 'Beta Co' };

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qoyod-mcp-test-'));
}

export const ok = (body, status = 200) => () => ({ status, body });

/** routes: { 'GET invoices': (call) => ({ status, body, headers }) } ; 'GET *' matches any GET. */
export function fakeQoyod(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const call = {
      method,
      url,
      path: u.pathname.replace(/^\/2\.0\//, ''),
      query: Object.fromEntries(u.searchParams),
      params: u.searchParams,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers ?? {},
      redirect: init.redirect,
    };
    calls.push(call);
    const handler = routes[`${method} ${call.path}`] ?? routes[`${method} *`] ?? (() => ({ status: 200, body: {} }));
    const r = await handler(call);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(text, { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

export async function connect({ env = TWO, routes = {}, elicit = null, clientCapabilities, settingsFile } = {}) {
  const file = settingsFile ?? path.join(tmpDir(), 'settings.json');
  const { fetchImpl, calls } = fakeQoyod(routes);
  const logs = [];
  const ctx = createContext({
    processEnv: { ...env, QOYOD_SETTINGS_FILE: file },
    files: [],
    fetchImpl,
    log: (m) => logs.push(m),
    version: '9.9.9-test',
  });
  const { server } = buildServer(ctx);
  const caps = clientCapabilities ?? (elicit ? { elicitation: { form: {} } } : {});
  const client = new Client({ name: 'unit-test', version: '1.0.0' }, { capabilities: caps });
  const elicitations = [];
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      elicitations.push(req.params);
      return elicit(req.params);
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* plain text */
    }
    return { ...r, text, json };
  };
  return {
    client,
    server,
    ctx,
    calls,
    logs,
    call,
    elicitations,
    settingsFile: file,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
