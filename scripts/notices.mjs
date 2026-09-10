#!/usr/bin/env node
// Writes THIRD_PARTY_NOTICES.md for every package bundled into dist/qoyod-mcp.cjs, and fails on licenses that are
// not permissive. The MIT/ISC/BSD licenses require their notices to travel with the bundle.
//   node scripts/notices.mjs           write THIRD_PARTY_NOTICES.md
//   node scripts/notices.mjs --check   exit 1 if the file is out of date or a license is not allowed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', '(MIT OR Apache-2.0)', 'Unlicense', 'CC0-1.0']);

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  write: false,
  metafile: true,
  logLevel: 'silent',
  define: { __QOYOD_VERSION__: '"notices"' },
});

// package directory of each bundled input, e.g. node_modules/zod or node_modules/a/node_modules/@b/c
const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const norm = input.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('node_modules/');
  if (idx < 0) continue;
  const rest = norm.slice(idx + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  dirs.add(norm.slice(0, idx + 'node_modules/'.length) + name);
}

const LICENSE_FILES = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const entries = [];
const problems = [];
for (const dir of [...dirs].sort()) {
  const abs = path.join(root, dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN';
  if (!ALLOWED.has(license)) problems.push(`${pkg.name}@${pkg.version}: license "${license}" is not on the allowed list`);
  const files = fs.readdirSync(abs).filter((f) => LICENSE_FILES.test(f));
  const text = files.length ? fs.readFileSync(path.join(abs, files[0]), 'utf8').trim() : null;
  const notice = fs.readdirSync(abs).find((f) => /^notice(\.(md|txt))?$/i.test(f));
  entries.push({ name: pkg.name, version: pkg.version, license, text, notice: notice ? fs.readFileSync(path.join(abs, notice), 'utf8').trim() : null });
}
const unique = [...new Map(entries.map((e) => [`${e.name}@${e.version}`, e])).values()].sort((a, b) => a.name.localeCompare(b.name));

let md = '# Third-party notices\n\n';
md += 'The single-file server bundle (qoyod-mcp.cjs) includes the following open-source packages. ';
md += 'Their licenses and copyright notices are reproduced below as those licenses require.\n\n';
md += '| Package | Version | License |\n|---|---|---|\n';
for (const e of unique) md += `| ${e.name} | ${e.version} | ${e.license} |\n`;
for (const e of unique) {
  md += `\n## ${e.name}@${e.version} (${e.license})\n\n`;
  md += e.text ? `\`\`\`text\n${e.text}\n\`\`\`\n` : `The package does not ship a license file; its package.json declares the ${e.license} license.\n`;
  if (e.notice) md += `\nNOTICE:\n\n\`\`\`text\n${e.notice}\n\`\`\`\n`;
}

const out = path.join(root, 'THIRD_PARTY_NOTICES.md');
if (problems.length) {
  console.error(`License problems:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  const existing = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (existing !== md) {
    console.error('THIRD_PARTY_NOTICES.md is out of date: run "node scripts/notices.mjs".');
    process.exit(1);
  }
  console.log(`THIRD_PARTY_NOTICES.md is up to date (${unique.length} packages, all permissive).`);
} else {
  fs.writeFileSync(out, md);
  console.log(`wrote THIRD_PARTY_NOTICES.md (${unique.length} packages, all permissive)`);
}
