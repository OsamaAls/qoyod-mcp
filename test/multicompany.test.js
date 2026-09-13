// Offline, process-level check of the BUILT server over stdio (like a real client) against a local fake Qoyod.
// No real keys and no network: every QOYOD_* variable from your shell is removed and .env loading is disabled.
//   node test/multicompany.test.js [--server path/to/qoyod-mcp.cjs]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMockQoyod } from './mock-qoyod.mjs';

const opt = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const SERVER = path.resolve(opt('--server') ?? process.env.SERVER ?? 'dist/qoyod-mcp.cjs');

let failed = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (!cond) failed++;
};

const mock = await startMockQoyod({ keys: { 'fake-key-one-111': 'Alpha', 'fake-key-two-222': 'Beta' } });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('QOYOD_')));
Object.assign(env, {
  QOYOD_ENV_FILE: 'none',
  QOYOD_BASE_URL: mock.base,
  QOYOD_ALLOW_CUSTOM_BASE_URL: '1',
  QOYOD_RAW_TOOLS: '1', // so the raw change tools are covered by the "never sent without a company" checks
  QOYOD_SETTINGS_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qoyod-multi-')), 'settings.json'),
  QOYOD_API_KEY_1: 'fake-key-one-111',
  QOYOD_COMPANY_1_NAME: 'Alpha Co',
  QOYOD_API_KEY_2: 'fake-key-two-222',
  QOYOD_COMPANY_2_NAME: 'Beta Co',
});

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (d) => {
  stderr += d;
});
const client = new Client({ name: 'multicompany-test', version: '1.0.0' });
const call = async (name, args) => {
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* plain text */
    }
    return { isError: !!r.isError, text, json };
  } catch (err) {
    return { isError: true, text: String(err?.message ?? err), json: null };
  }
};

console.log(`\n== ${SERVER} (offline, fake Qoyod at ${mock.base}) ==`);
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  check('50 tools with two companies and raw tools on', tools.length === 50, String(tools.length));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  check('server version matches package.json', client.getServerVersion()?.version === pkg.version, client.getServerVersion()?.version);

  const a = await call('qoyod_read_accounts', { action: 'list', company: 'Alpha Co' });
  check('read "Alpha Co" uses key 1', a.json?.company === 'Alpha Co' && mock.log.at(-1)?.key === 'fake-key-one-111');
  const b = await call('qoyod_read_accounts', { action: 'list', company: 'beta co' });
  check('read "beta co" (any case) uses key 2', b.json?.company === 'Beta Co' && mock.log.at(-1)?.key === 'fake-key-two-222');

  let before = mock.log.length;
  const ask = await call('qoyod_read_invoices', { action: 'list' });
  check('read without a company asks the user (no pop-up support) and sends nothing', /^ACTION NEEDED/.test(ask.text) && mock.log.length === before);

  const changes = [
    ['qoyod_write_vendors', { action: 'create', data: { name: 'x' } }],
    ['qoyod_write_products', { action: 'update', id: 1, data: { sku: 'x' } }],
    ['qoyod_write_bills', { action: 'allocate', id: 1, data: { source_type: 'Receipt', source_id: 1, amount: 1, date: '2026-01-01' } }],
    ['qoyod_write_inventories', { action: 'adjust', data: { inventory_id: 1 } }],
    ['qoyod_write_inventories', { action: 'transfer', data: { from_location: 1 } }],
    ['qoyod_delete_bills', { id: 1 }],
    ['qoyod_write_request', { method: 'POST', path: 'vendors', body: { contact: { name: 'x' } } }],
    ['qoyod_delete_request', { path: 'bills/1' }],
  ];
  for (const [name, args] of changes) {
    before = mock.log.length;
    const r = await call(name, args);
    check(`${name}${args.action ? ` ${args.action}` : ''} without a company is not sent`, /^ACTION NEEDED: nothing was changed/.test(r.text) && mock.log.length === before);
  }

  const unknown = await call('qoyod_read_accounts', { action: 'list', company: 'Gamma Co' });
  check('unknown company is rejected', unknown.isError);
  check('no change ever reached the API', mock.log.every((x) => x.method === 'GET'), `${mock.log.length} GET requests`);
} catch (err) {
  failed++;
  console.log(`  FAIL  crashed: ${err?.message ?? err}\n${stderr.slice(-2000)}`);
} finally {
  await client.close().catch(() => {});
  await mock.close();
}
console.log(failed ? `\n${failed} FAILED` : '\nall multi-company checks passed');
process.exit(failed ? 1 : 0);
