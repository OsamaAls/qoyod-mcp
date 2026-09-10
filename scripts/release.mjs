#!/usr/bin/env node
// Builds the release files in release/ from an explicit allowlist:
//   qoyod-mcp-<version>.mcpb         desktop extension (Claude Desktop and other MCPB hosts)
//   qoyod-mcp-manual-<version>.zip   manual install (qoyod-mcp.cjs + install.ps1 + docs)
//   SHA256SUMS.txt
// Run "npm run release" (it builds dist/ first). The script refuses to finish if versions disagree, the manifest or
// notices are stale, an archive holds an unexpected file, or any archive contains a configured API key value.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(root, ...p);
// Optional: --bundle <file> (default dist/qoyod-mcp.cjs) and --out <dir> (default release/), e.g. for a trial run.
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
};
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const run = (args, label) => {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) fail(`${label} failed`);
};

const pkg = JSON.parse(fs.readFileSync(rel('package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(rel('manifest.json'), 'utf8'));
const version = pkg.version;
if (manifest.version !== version) fail(`manifest.json version ${manifest.version} != package.json ${version}`);
run([rel('scripts', 'sync-manifest.mjs'), '--check'], 'manifest check');
run([rel('scripts', 'notices.mjs'), '--check'], 'notices check');
const bundle = argValue('--bundle') ?? rel('dist', 'qoyod-mcp.cjs');
if (!fs.existsSync(bundle)) fail(`${bundle} is missing: run "npm run build" first`);
for (const f of ['icon.png', 'README.md', 'CAPABILITIES-AR.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'install.ps1', 'claude_desktop_config.example.json']) {
  if (!fs.existsSync(rel(f))) fail(`${f} is missing`);
}

// 1. The built bundle must start, report this version and expose exactly the manifest's tools.
{
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('QOYOD_')));
  Object.assign(env, {
    QOYOD_ENV_FILE: 'none',
    QOYOD_SETTINGS_FILE: path.join(os.tmpdir(), `qoyod-release-${process.pid}.json`),
    QOYOD_API_KEY_1: 'fake-aaaa1111', QOYOD_COMPANY_1_NAME: 'A', QOYOD_API_KEY_2: 'fake-bbbb2222', QOYOD_COMPANY_2_NAME: 'B',
  });
  const client = new Client({ name: 'release-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle], env, stderr: 'ignore' }));
  const { tools } = await client.listTools();
  const serverVersion = client.getServerVersion()?.version;
  await client.close();
  if (serverVersion !== version) fail(`bundle reports version ${serverVersion}, expected ${version} (rebuild dist)`);
  const names = tools.map((t) => t.name).sort().join(',');
  const expected = manifest.tools.map((t) => t.name).sort().join(',');
  if (names !== expected) fail('bundle tools differ from manifest.json tools (rebuild dist or sync the manifest)');
  console.log(`bundle ok: v${serverVersion}, ${tools.length} tools`);
}

// ---- minimal zip writer/reader (deflate), so the output is identical on every OS --------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function writeZip(file, entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, centralBuf, end]));
}
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) fail(`${path.basename(file)} is not a zip file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---- 2. stage and pack ------------------------------------------------------------------------------------
const releaseDir = argValue('--out') ?? rel('release');
fs.mkdirSync(releaseDir, { recursive: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'qoyod-mcp-release-'));
const mcpbFiles = ['manifest.json', 'icon.png', 'dist/qoyod-mcp.cjs', 'README.md', 'CAPABILITIES-AR.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md'];
for (const f of mcpbFiles) {
  fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
  fs.copyFileSync(f === 'dist/qoyod-mcp.cjs' ? bundle : rel(f), path.join(stage, f));
}
const mcpbCli = rel('node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
if (!fs.existsSync(mcpbCli)) fail('the mcpb CLI is missing: run "npm install"');
const mcpbOut = path.join(releaseDir, `qoyod-mcp-${version}.mcpb`);
run([mcpbCli, 'validate', path.join(stage, 'manifest.json')], 'mcpb validate');
run([mcpbCli, 'pack', stage, mcpbOut], 'mcpb pack');

const zipOut = path.join(releaseDir, `qoyod-mcp-manual-${version}.zip`);
const manualFiles = [
  ['qoyod-mcp.cjs', 'dist/qoyod-mcp.cjs'],
  ['install.ps1', 'install.ps1'],
  ['claude_desktop_config.example.json', 'claude_desktop_config.example.json'],
  ['README.md', 'README.md'],
  ['CAPABILITIES-AR.md', 'CAPABILITIES-AR.md'],
  ['LICENSE', 'LICENSE'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
];
writeZip(zipOut, manualFiles.map(([name, src]) => ({ name, data: fs.readFileSync(src === 'dist/qoyod-mcp.cjs' ? bundle : rel(src)) })));

// ---- 3. inspect both archives: allowlist + no key values -----------------------------------------------------
function keyValues() {
  const values = new Map();
  const add = (name, v) => {
    if (typeof v === 'string' && v.trim().length >= 8 && !/^\$\{/.test(v.trim())) values.set(v.trim(), name);
  };
  const files = [rel('.env'), rel('..', '.env'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'qoyod-mcp', '.env')].filter(Boolean);
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?(QOYOD_[A-Z0-9_]*(?:KEY|TOKEN)[A-Z0-9_]*)\s*=\s*["']?([^"'#\s]+)/.exec(line);
      if (m) add(m[1], m[2]);
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (/^QOYOD_.*(KEY|TOKEN)/.test(k)) add(k, v);
  return values;
}
const secrets = keyValues();
const expectedMcpb = new Set(mcpbFiles);
const expectedZip = new Set(manualFiles.map(([n]) => n));
for (const [file, expected] of [[mcpbOut, expectedMcpb], [zipOut, expectedZip]]) {
  const entries = readZip(file).filter((e) => !e.name.endsWith('/'));
  const names = entries.map((e) => e.name.replace(/\\/g, '/'));
  const unexpected = names.filter((n) => !expected.has(n));
  const missing = [...expected].filter((n) => !names.includes(n));
  if (unexpected.length || missing.length) fail(`${path.basename(file)}: unexpected ${JSON.stringify(unexpected)}, missing ${JSON.stringify(missing)}`);
  for (const e of entries) {
    for (const [value, name] of secrets) {
      if (e.data.includes(Buffer.from(value, 'utf8'))) fail(`${path.basename(file)}/${e.name} contains the value of ${name}`);
    }
  }
  console.log(`${path.basename(file)}: ${names.length} files, allowlist ok, ${secrets.size} key value(s) checked, none found`);
}

// ---- 4. checksums ---------------------------------------------------------------------------------------------
const sums = [mcpbOut, zipOut]
  .map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.basename(f)}`)
  .join('\n');
fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${sums}\n`);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`\nrelease ready in ${releaseDir}\n${sums}`);
