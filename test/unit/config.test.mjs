import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { envFileCandidates, isSet, loadCompanies, loadEnv, parseSwitches, readDotEnv, resolveBaseUrl } from '../../src/config.js';
import { tmpDir } from './helpers.mjs';

function envFile(text) {
  const f = path.join(tmpDir(), '.env');
  fs.writeFileSync(f, text, 'utf8');
  return f;
}

test('.env parsing: BOM, export, quotes and inline comments', () => {
  const f = envFile('﻿# comment\nexport QOYOD_API_KEY_1=abc123 # my key\nQOYOD_COMPANY_1_NAME="Branch #2"\nQOYOD_COMPANY_2_NAME=\'Beta\'\nBAD LINE\n');
  assert.deepEqual(readDotEnv(f), { QOYOD_API_KEY_1: 'abc123', QOYOD_COMPANY_1_NAME: 'Branch #2', QOYOD_COMPANY_2_NAME: 'Beta' });
  assert.equal(readDotEnv(path.join(tmpDir(), 'missing.env')), null);
});

test('placeholders count as unset', () => {
  assert.equal(isSet(''), false);
  assert.equal(isSet('   '), false);
  assert.equal(isSet('${user_config.api_key_2}'), false);
  assert.equal(isSet('PASTE-COMPANY-2-API-KEY-HERE'), false);
  assert.equal(isSet('real-key'), true);
});

test('a company slot comes from one source: .env never overrides a key the real environment owns', () => {
  const f = envFile('QOYOD_API_KEY=file-key-1111\nQOYOD_COMPANY_1_NAME=File Co\nQOYOD_API_KEY_2=file-key-2222\nQOYOD_BASE_URL=http://evil.example\nQOYOD_READ_ONLY=1\n');
  const { env, filesUsed } = loadEnv({ processEnv: { QOYOD_API_KEY_1: 'env-key-1111', QOYOD_COMPANY_1_NAME: 'Env Co' }, files: [f] });
  assert.equal(env.QOYOD_API_KEY, undefined);
  assert.equal(env.QOYOD_API_KEY_1, 'env-key-1111');
  assert.equal(env.QOYOD_COMPANY_1_NAME, 'Env Co');
  assert.equal(env.QOYOD_API_KEY_2, 'file-key-2222');
  assert.equal(env.QOYOD_BASE_URL, undefined, 'base URL is never read from a file');
  assert.equal(env.QOYOD_READ_ONLY, '1');
  assert.deepEqual(filesUsed, [f]);
});

test('a key variable present but empty in the environment (desktop extension) still owns its slot', () => {
  const f = envFile('QOYOD_API_KEY_2=file-key-2222\nQOYOD_COMPANY_2_NAME=File Two\n');
  const { env } = loadEnv({ processEnv: { QOYOD_API_KEY_1: 'env-key-1111', QOYOD_API_KEY_2: '' }, files: [f] });
  assert.equal(env.QOYOD_API_KEY_2, '');
  assert.equal(env.QOYOD_COMPANY_2_NAME, undefined);
});

test('.env candidates: bundle folder and its parent, never the working directory; QOYOD_ENV_FILE=none disables', () => {
  const list = envFileCandidates({ processEnv: {}, bundleDir: path.join('x', 'dist') });
  assert.deepEqual(list, [path.join('x', 'dist', '.env'), path.join('x', 'dist', '..', '.env')]);
  assert.ok(!list.includes(path.join(process.cwd(), '.env')));
  assert.deepEqual(envFileCandidates({ processEnv: { QOYOD_ENV_FILE: 'none' }, bundleDir: 'x' }), []);
});

test('companies: numbering, default names and clear problems', () => {
  const a = loadCompanies({ QOYOD_API_KEY: 'k1-aaaa', QOYOD_API_KEY_2: 'k2-bbbb', QOYOD_COMPANY_2_NAME: 'Beta', QOYOD_API_KEY_10: 'k10-cccc' });
  assert.deepEqual(a.companies.map((c) => [c.name, c.keyVar]), [['Company 1', 'QOYOD_API_KEY'], ['Beta', 'QOYOD_API_KEY_2'], ['Company 10', 'QOYOD_API_KEY_10']]);
  assert.deepEqual(a.problems, []);

  const conflict = loadCompanies({ QOYOD_API_KEY: 'k1-aaaa', QOYOD_API_KEY_1: 'k1-zzzz' });
  assert.match(conflict.problems[0], /both set/);

  const sameKey = loadCompanies({ QOYOD_API_KEY_1: 'k-same', QOYOD_COMPANY_1_NAME: 'A', QOYOD_API_KEY_2: 'k-same', QOYOD_COMPANY_2_NAME: 'B' });
  assert.equal(sameKey.companies.length, 1);
  assert.match(sameKey.problems[0], /same Qoyod API key/);
  assert.ok(!sameKey.problems[0].includes('k-same'), 'never prints the key');

  const malformed = loadCompanies({ QOYOD_API_KEY_1: 'abc # comment' });
  assert.match(malformed.problems[0], /malformed/);

  const stray = loadCompanies({ QOYOD_API_KEY_1: 'k1-aaaa', QOYOD_API_KEY_OLD: 'old-key' });
  assert.match(stray.warnings[0], /QOYOD_API_KEY_OLD/);
  assert.equal(stray.companies.length, 1);
});

test('base URL: only Qoyod over https unless explicitly allowed for local testing', () => {
  assert.equal(resolveBaseUrl({}).baseUrl, 'https://api.qoyod.com/2.0');
  assert.match(resolveBaseUrl({ QOYOD_BASE_URL: 'https://evil.example/2.0' }).error, /Refusing/);
  assert.match(resolveBaseUrl({ QOYOD_BASE_URL: 'http://127.0.0.1:9/2.0' }).error, /Refusing/);
  assert.equal(resolveBaseUrl({ QOYOD_BASE_URL: 'http://127.0.0.1:9/2.0', QOYOD_ALLOW_CUSTOM_BASE_URL: '1' }).baseUrl, 'http://127.0.0.1:9/2.0');
  assert.match(resolveBaseUrl({ QOYOD_BASE_URL: 'http://evil.example/2.0', QOYOD_ALLOW_CUSTOM_BASE_URL: '1' }).error, /plain http/);
});

test('switches', () => {
  const d = parseSwitches({});
  assert.equal(d.writes.size, 4);
  assert.equal(d.confirmWrites, 'when_missing');
  const ro = parseSwitches({ QOYOD_READ_ONLY: 'true', QOYOD_ALLOW_WRITES: 'all' });
  assert.equal(ro.writes.size, 0);
  assert.equal(ro.deletes.size, 0);
  const ext = parseSwitches({ QOYOD_ALLOW_WRITES: 'true', QOYOD_ALLOW_DELETES: 'false', QOYOD_BLOCK_SALES_WRITES: 'true' });
  assert.deepEqual([...ext.writes].sort(), ['accounting', 'inventory', 'purchases']);
  assert.equal(ext.deletes.size, 0);
  const warnings = [];
  const list = parseSwitches({ QOYOD_TOOLSETS: 'purchases, inventory, bogus', QOYOD_CONFIRM_WRITES: 'always' }, warnings);
  assert.deepEqual([...list.toolsets].sort(), ['inventory', 'purchases']);
  assert.equal(list.confirmWrites, 'always');
  assert.match(warnings[0], /bogus/);
});
