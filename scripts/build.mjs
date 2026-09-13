#!/usr/bin/env node
// Builds the single-file server bundle (CommonJS, Node 18+).
//   node scripts/build.mjs                      -> dist/qoyod-mcp.cjs
//   node scripts/build.mjs --outfile <path>     -> a test bundle somewhere else
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const i = process.argv.indexOf('--outfile');
const outfile = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : path.join(root, 'dist', 'qoyod-mcp.cjs');

await build({
  entryPoints: [path.join(root, 'src', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile,
  define: { __QOYOD_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'eof',
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' },
});

const kb = Math.round(fs.statSync(outfile).size / 1024);
console.log(`built ${outfile} (${kb} KB, v${pkg.version})`);
