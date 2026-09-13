import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp, tokenMatches } from '../../src/http.js';
import { buildServer, createContext } from '../../src/server.js';
import { fakeQoyod, tmpDir, TWO } from './helpers.mjs';

const TOKEN = 'test-token-0123456789abcdef';

function ctxFor(extraEnv) {
  return createContext({
    processEnv: { ...TWO, QOYOD_SETTINGS_FILE: path.join(tmpDir(), 'settings.json'), ...extraEnv },
    files: [],
    fetchImpl: fakeQoyod().fetchImpl,
    version: '9.9.9-test',
  });
}

test('bearer token comparison', () => {
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(`bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches('Bearer wrong', TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});

test('HTTP transport refuses to start without a strong token', async () => {
  await assert.rejects(startHttp({ ctx: ctxFor({ QOYOD_HTTP_PORT: '0' }), buildServer }), /QOYOD_HTTP_TOKEN/);
  await assert.rejects(startHttp({ ctx: ctxFor({ QOYOD_HTTP_PORT: '0', QOYOD_HTTP_TOKEN: 'short' }), buildServer }), /QOYOD_HTTP_TOKEN/);
});

test('HTTP transport: 401 without the token, full MCP session with it', async () => {
  const h = await startHttp({ ctx: ctxFor({ QOYOD_HTTP_PORT: '0', QOYOD_HTTP_TOKEN: TOKEN }), buildServer });
  const base = `http://127.0.0.1:${h.port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const denied = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
    });
    assert.equal(denied.status, 401);

    const client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 48);
    await client.close();
  } finally {
    await h.close();
  }
});
