#!/usr/bin/env node
// Runs the offline unit tests (no network, no API keys) on every platform and Node >= 18.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'unit');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
const env = { ...process.env };
for (const k of Object.keys(env)) if (k.startsWith('QOYOD_')) delete env[k];
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
