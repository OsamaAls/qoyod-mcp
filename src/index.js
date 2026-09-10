#!/usr/bin/env node
// Qoyod MCP server — exposes all 19 Qoyod API resource types to Claude over stdio.
// Supports several Qoyod companies at once: each company has its own API key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { QoyodClient, DEFAULT_BASE_URL } from './client.js';
import { registerTools } from './tools.js';

const VERSION = '1.1.0';

function scriptDir() {
  // __dirname exists in the esbuild CJS bundle; import.meta.url in ESM source.
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(fileURLToPath(import.meta.url));
}

function readDotEnv(file) {
  try {
    const out = {};
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      out[key] = val;
    }
    return out;
  } catch {
    return null;
  }
}

// Empty strings and un-substituted "${user_config.x}" placeholders count as unset.
function isSet(v) {
  return typeof v === 'string' && v.trim() !== '' && !/^\$\{[^}]*\}$/.test(v.trim());
}

// Real environment variables win; a .env file fills in whatever is missing.
function loadEnv() {
  const env = { ...process.env };
  const here = scriptDir();
  const candidates = [
    env.QOYOD_ENV_FILE,
    path.join(here, '.env'),
    path.join(here, '..', '.env'),
    path.join(process.cwd(), '.env'),
  ].filter(Boolean);
  for (const file of candidates) {
    const parsed = readDotEnv(file);
    if (!parsed) continue;
    let used = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!k.startsWith('QOYOD_')) continue;
      if (!isSet(env[k]) && isSet(v)) { env[k] = v; used = true; }
    }
    if (used) { env.QOYOD_ENV_FILE_USED = file; break; }
  }
  return env;
}

/**
 * Company/API-key layout (any mix works):
 *   QOYOD_API_KEY            key of company 1   (QOYOD_COMPANY_NAME or QOYOD_COMPANY_1_NAME = its name)
 *   QOYOD_API_KEY_1          same as above
 *   QOYOD_API_KEY_2 ... _9   key of company N   (QOYOD_COMPANY_N_NAME = its name)
 *   QOYOD_API_KEY_RIYADH     key of a company named "RIYADH" (any word after the underscore)
 *   QOYOD_COMPANIES          "Name One=key1;Name Two=key2"   (one-line form)
 */
export function loadCompanies(env) {
  const companies = [];
  const add = (name, apiKey) => {
    if (!isSet(apiKey)) return;
    const key = apiKey.trim();
    if (companies.some((c) => c.apiKey === key)) return; // same key listed twice
    let label = (name || '').trim() || `Company ${companies.length + 1}`;
    while (companies.some((c) => c.name.toLowerCase() === label.toLowerCase())) label += ' (2)';
    companies.push({ name: label, apiKey: key });
  };

  add(env.QOYOD_COMPANY_1_NAME || env.QOYOD_COMPANY_NAME, env.QOYOD_API_KEY || env.QOYOD_API_KEY_1);
  for (let n = 2; n <= 9; n++) add(env[`QOYOD_COMPANY_${n}_NAME`], env[`QOYOD_API_KEY_${n}`]);
  for (const [k, v] of Object.entries(env)) {
    const m = /^QOYOD_API_KEY_([A-Za-z][A-Za-z0-9_]*)$/.exec(k);
    if (m) add(env[`QOYOD_COMPANY_${m[1]}_NAME`] || m[1].replace(/_/g, ' '), v);
  }
  if (isSet(env.QOYOD_COMPANIES)) {
    for (const part of env.QOYOD_COMPANIES.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) add(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  return companies;
}

async function main() {
  const env = loadEnv();
  const baseUrl = isSet(env.QOYOD_BASE_URL) ? env.QOYOD_BASE_URL.trim() : DEFAULT_BASE_URL;
  const companies = loadCompanies(env);
  if (companies.length === 0) {
    console.error(
      '[qoyod-mcp] No API key found. Set QOYOD_API_KEY (and QOYOD_API_KEY_2 for a second company) as environment variables, ' +
        'or put them in a .env file next to the server. ' +
        'Generate a key in Qoyod: Settings > General Settings > API key, then click Save.',
    );
    process.exit(1);
  }
  for (const c of companies) c.client = new QoyodClient({ apiKey: c.apiKey, baseUrl });

  const server = new McpServer({ name: 'qoyod', version: VERSION });
  const count = registerTools(server, companies);
  await server.connect(new StdioServerTransport());
  console.error(
    `[qoyod-mcp] v${VERSION} ready — ${count} tools, companies: ${companies.map((c) => c.name).join(', ')}` +
      (env.QOYOD_ENV_FILE_USED ? ` (keys from ${env.QOYOD_ENV_FILE_USED})` : ''),
  );
}

main().catch((err) => {
  console.error('[qoyod-mcp] fatal:', err);
  process.exit(1);
});
