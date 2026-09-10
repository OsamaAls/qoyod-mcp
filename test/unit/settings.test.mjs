import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { defaultCompany, defaultReadCompany, Settings, settingsFile } from '../../src/settings.js';
import { tmpDir } from './helpers.mjs';

const companies = [{ name: 'Alpha Co' }, { name: 'Beta Co' }];

test('settings are written atomically and read back', () => {
  const file = path.join(tmpDir(), 'nested', 'settings.json');
  const s = new Settings(file);
  assert.deepEqual(s.read(), {});
  s.update({ default_read_company: 'Beta Co' });
  assert.deepEqual(s.read(), { default_read_company: 'Beta Co' });
  s.update({ default_read_company: undefined });
  assert.deepEqual(s.read(), {});
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), []);
});

test('a corrupt settings file is treated as empty', () => {
  const file = path.join(tmpDir(), 'settings.json');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(new Settings(file).read(), {});
});

test('main read company: saved choice first, then QOYOD_DEFAULT_COMPANY, unknown names ignored', () => {
  const s = new Settings(path.join(tmpDir(), 'settings.json'));
  assert.equal(defaultReadCompany(s, companies, {}), null);
  assert.equal(defaultReadCompany(s, companies, { QOYOD_DEFAULT_COMPANY: 'alpha co' }).name, 'Alpha Co');
  s.update({ default_read_company: 'Beta Co' });
  assert.equal(defaultReadCompany(s, companies, { QOYOD_DEFAULT_COMPANY: 'Alpha Co' }).name, 'Beta Co');
  s.update({ default_read_company: 'Gone Co' });
  assert.equal(defaultReadCompany(s, companies, {}), null);
});

test('the main company for changes is separate from the main read company', () => {
  const s = new Settings(path.join(tmpDir(), 'settings.json'));
  s.update({ default_read_company: 'Alpha Co' });
  assert.equal(defaultCompany(s, companies, {}, 'write'), null);
  assert.equal(defaultCompany(s, companies, { QOYOD_DEFAULT_WRITE_COMPANY: 'beta co' }, 'write').name, 'Beta Co');
  s.update({ default_write_company: 'Alpha Co' });
  assert.equal(defaultCompany(s, companies, {}, 'write').name, 'Alpha Co');
});

test('settings file location per platform', () => {
  assert.equal(settingsFile({ QOYOD_SETTINGS_FILE: 'X:/s.json' }), 'X:/s.json');
  assert.equal(settingsFile({ APPDATA: 'X:\\Profile\\Roaming' }, 'win32'), path.join('X:\\Profile\\Roaming', 'qoyod-mcp', 'settings.json'));
  assert.ok(settingsFile({}, 'darwin').endsWith(path.join('Library', 'Application Support', 'qoyod-mcp', 'settings.json')));
  assert.equal(settingsFile({ XDG_CONFIG_HOME: '/cfg' }, 'linux'), path.join('/cfg', 'qoyod-mcp', 'settings.json'));
});
