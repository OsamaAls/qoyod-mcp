#!/usr/bin/env node
// Prints how many characters the tools/list payload costs (what every conversation pays), with the biggest tools.
//   node scripts/tool-size.mjs [--companies 1|2] [--schema <tool name>]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, createContext } from '../src/server.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const env = { QOYOD_API_KEY_1: 'fake-aaaa1111', QOYOD_COMPANY_1_NAME: 'Alpha Co', QOYOD_SETTINGS_FILE: 'unused-settings.json' };
if (arg('--companies') !== '1') Object.assign(env, { QOYOD_API_KEY_2: 'fake-bbbb2222', QOYOD_COMPANY_2_NAME: 'Beta Co' });

const ctx = createContext({ processEnv: env, files: [], version: 'size-check' });
const { server } = buildServer(ctx);
const client = new Client({ name: 'size', version: '1' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const { tools } = await client.listTools();

let descriptions = 0;
let schemas = 0;
const rows = tools.map((t) => {
  const d = t.description?.length ?? 0;
  const s = JSON.stringify(t.inputSchema).length;
  descriptions += d;
  schemas += s;
  return { name: t.name, description: d, schema: s, total: JSON.stringify(t).length };
});
rows.sort((x, y) => y.total - x.total);
console.log(`tools: ${tools.length}  total chars: ${JSON.stringify(tools).length}  descriptions: ${descriptions}  schemas: ${schemas}  instructions: ${(client.getInstructions() ?? '').length}`);
for (const r of rows.slice(0, 10)) console.log(`${String(r.total).padStart(6)}  desc ${String(r.description).padStart(5)}  schema ${String(r.schema).padStart(5)}  ${r.name}`);
const show = arg('--schema');
if (show) console.log(JSON.stringify(tools.find((t) => t.name === show)?.inputSchema, null, 1));
await client.close();
