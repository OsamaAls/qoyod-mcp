// Regression tests for the problems found in the v2 self-review.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Settings } from '../../src/settings.js';
import { connect, ok, ONE, tmpDir, TWO } from './helpers.mjs';

const bigRows = (n, size) => Array.from({ length: n }, (_, i) => ({ id: i + 1, blob: 'a"b\\c'.repeat(size) }));

test('strict mode never sends a change when the pop-up fails', async () => {
  const s = await connect({
    env: { ...TWO, QOYOD_CONFIRM_WRITES: 'always' },
    routes: { 'POST bills': () => ({ status: 201, body: { bill: { id: 1 } } }) },
    elicit: () => {
      throw new Error('client cannot show the pop-up');
    },
  });
  const r = await s.call('qoyod_write_bills', { action: 'create', company: 'Beta Co', data: { contact_id: 1 } });
  assert.equal(s.calls.length, 0, 'nothing may be sent without the confirmation');
  assert.match(r.text, /pop-up could not be shown/);
  await s.close();
});

test('strict mode falls back to the named company only where pop-ups do not exist', async () => {
  const s = await connect({ env: { ...TWO, QOYOD_CONFIRM_WRITES: 'always' }, routes: { 'POST bills': () => ({ status: 201, body: { bill: { id: 1 } } }) } });
  const r = await s.call('qoyod_write_bills', { action: 'create', company: 'Beta Co', data: { contact_id: 1 } });
  assert.ok(!r.isError, r.text);
  assert.equal(s.calls.length, 1);
  const missing = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.match(missing.text, /^ACTION NEEDED/);
  assert.equal(s.calls.length, 1);
  await s.close();
});

test('a single record that is too large stays inside the limit and keeps its notes', async () => {
  const s = await connect({
    routes: { 'GET bills/1': ok({ bill: { id: 1, notes: 'a"b\\c'.repeat(30_000) } }) },
    elicit: () => ({ action: 'accept', content: { company: 'Beta Co', remember: true } }),
  });
  await s.call('qoyod_read_bills', { action: 'list' }).catch(() => {});
  const r = await s.call('qoyod_read_bills', { action: 'get', id: 1 });
  assert.ok(r.text.length <= 70_000, `result is ${r.text.length} chars`);
  const j = JSON.parse(r.text);
  assert.equal(j.company, 'Beta Co');
  assert.match(j._company_note, /main company/);
  assert.ok(j._truncated.chars_total > j._truncated.chars_shown);
  await s.close();
});

test('truncation cuts the data rows, not another list in the result', async () => {
  const env = { QOYOD_API_KEY: 'key-one-1111', QOYOD_API_KEY_1: 'key-two-2222', QOYOD_COMPANY_1_NAME: 'Alpha Co' };
  const s = await connect({ env, routes: { 'GET journal_entries': ok({ journal_entries: bigRows(60, 3000) }) } });
  const r = await s.call('qoyod_read_journal_entries', { action: 'list' });
  const j = JSON.parse(r.text);
  assert.ok(Array.isArray(j.config_problems) && j.config_problems.length, 'the config problem is still reported');
  assert.ok(Array.isArray(j.journal_entries) && j.journal_entries.length > 0, 'rows are kept');
  assert.equal(j.journal_entries.length, j._truncated.rows_shown);
  assert.ok(!('preview' in j));
  await s.close();
});

test('a cut result never claims to be complete', async () => {
  const routes = { 'GET invoices': (c) => ({ status: 200, body: { invoices: bigRows(Number(c.query.page) === 1 ? 100 : 20, 1200) } }) };
  const s = await connect({ env: ONE, routes });
  const all = await s.call('qoyod_read_invoices', { action: 'list', fetch_all: true });
  const j1 = JSON.parse(all.text);
  assert.equal(j1._fetch_all.complete, false);
  assert.match(j1._fetch_all.note, /cut/);
  const page = await s.call('qoyod_read_invoices', { action: 'list', per_page: 100 });
  const j2 = JSON.parse(page.text);
  assert.equal(j2._page.more, true);
  assert.match(j2._page.next, /smaller per_page/);
  await s.close();
});

test('an unsupported account type filter is refused instead of ignored', async () => {
  const s = await connect({ env: ONE, routes: { 'GET accounts': ok({ accounts: [{ id: 1, type: 'Asset' }] }) } });
  const r = await s.call('qoyod_read_accounts', { action: 'list', q: { type_null: true } });
  assert.equal(r.isError, true);
  assert.match(r.json.error, /not supported/);
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('a record id must be a plain token', async () => {
  const s = await connect({ env: ONE, routes: { 'DELETE bills/1': ok({ message: 'ok' }) } });
  for (const id of ['..', '.', 'bills/1']) {
    const r = await s.call('qoyod_delete_bills', { id });
    assert.equal(r.isError, true, `id ${id}`);
    assert.match(r.json.error, /plain record id/);
  }
  assert.equal(s.calls.length, 0);
  const good = await s.call('qoyod_delete_bills', { id: 1 });
  assert.ok(!good.isError, good.text);
  await s.close();
});

test('a redirect answer to a write warns that the record may already be saved', async () => {
  const s = await connect({ env: ONE, routes: { 'POST bills': () => ({ status: 302, body: '', headers: { location: 'https://elsewhere.example/' } }) } });
  const r = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.equal(r.isError, true);
  assert.equal(r.json.may_already_be_saved, true);
  await s.close();
});

test('clearing the main company mentions an environment preset that still applies', async () => {
  const s = await connect({ env: { ...TWO, QOYOD_DEFAULT_WRITE_COMPANY: 'Beta Co' } });
  const r = await s.call('qoyod_settings', { action: 'clear_main_company', applies_to: 'changes' });
  assert.match(r.json.note, /QOYOD_DEFAULT_WRITE_COMPANY/);
  await s.close();
});

test('a stale settings lock does not block saving', () => {
  const file = path.join(tmpDir(), 'settings.json');
  fs.writeFileSync(`${file}.lock`, '');
  fs.utimesSync(`${file}.lock`, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const s = new Settings(file);
  s.update({ default_read_company: 'Alpha Co' });
  assert.equal(s.read().default_read_company, 'Alpha Co');
  assert.equal(fs.existsSync(`${file}.lock`), false);
});
