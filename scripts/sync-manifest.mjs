#!/usr/bin/env node
// Keeps manifest.json in step with the server: version from package.json and the tool list from tools/list.
//   node scripts/sync-manifest.mjs           update manifest.json
//   node scripts/sync-manifest.mjs --check   exit 1 if manifest.json is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, createContext } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const current = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(current);

const ctx = createContext({
  processEnv: { QOYOD_API_KEY_1: 'fake-aaaa1111', QOYOD_COMPANY_1_NAME: 'A', QOYOD_API_KEY_2: 'fake-bbbb2222', QOYOD_COMPANY_2_NAME: 'B', QOYOD_SETTINGS_FILE: 'unused.json' },
  files: [],
  version: pkg.version,
});
const { server } = buildServer(ctx);
const client = new Client({ name: 'sync-manifest', version: '1' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const { tools } = await client.listTools();
await client.close();

manifest.version = pkg.version;
manifest.tools = tools.map((t) => ({ name: t.name, description: t.title }));
const next = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (next !== current.replace(/\r\n/g, '\n')) {
    console.error('manifest.json is out of date: run "node scripts/sync-manifest.mjs".');
    process.exit(1);
  }
  console.log(`manifest.json is up to date (${tools.length} tools, v${pkg.version}).`);
} else {
  fs.writeFileSync(manifestPath, next);
  console.log(`manifest.json updated (${tools.length} tools, v${pkg.version}).`);
}
