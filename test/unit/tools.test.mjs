import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { connect, ok, ONE, TWO } from './helpers.mjs';

const INVOICES = { 'GET invoices': ok({ invoices: [{ id: 1, reference: 'INV1' }] }) };
const toolNames = async (env) => {
  const s = await connect({ env });
  const { tools } = await s.client.listTools();
  await s.close();
  return tools.map((t) => t.name);
};

test('tools come in read / write / delete groups with matching annotations', async () => {
  const s = await connect();
  const { tools } = await s.client.listTools();
  const names = tools.map((t) => t.name);
  assert.equal(names.filter((n) => n.startsWith('qoyod_read_')).length, 22);
  assert.equal(names.filter((n) => n.startsWith('qoyod_write_')).length, 20);
  assert.equal(names.filter((n) => n.startsWith('qoyod_delete_')).length, 7);
  assert.ok(names.includes('qoyod_settings'));
  assert.equal(tools.length, 50);
  for (const t of tools) {
    const props = Object.keys(t.inputSchema.properties ?? {});
    if (t.name.startsWith('qoyod_read_')) {
      assert.equal(t.annotations?.readOnlyHint, true, t.name);
      assert.ok(!props.includes('data') && !props.includes('body'), t.name);
    }
    if (t.name.startsWith('qoyod_write_')) {
      assert.equal(t.annotations?.readOnlyHint, false, t.name);
      assert.ok(!props.includes('q'), t.name);
    }
    if (t.name.startsWith('qoyod_delete_')) {
      assert.equal(t.annotations?.destructiveHint, true, t.name);
      assert.deepEqual(props.sort(), t.name === 'qoyod_delete_request' ? ['company', 'path'] : ['company', 'id'], t.name);
    }
  }
  const size = JSON.stringify(tools).length;
  assert.ok(size < 60_500, `tools/list is ${size} chars (v1 was 60.5k)`);
  assert.match(s.client.getInstructions() ?? '', /qoyod_read_\*/);
  await s.close();
});

test('switches remove whole groups before the client ever sees them', async () => {
  const ro = await toolNames({ ...TWO, QOYOD_READ_ONLY: '1' });
  assert.ok(ro.every((n) => !n.startsWith('qoyod_write_') && !n.startsWith('qoyod_delete_')));
  assert.equal(ro.length, 23);

  const noDeletes = await toolNames({ ...TWO, QOYOD_ALLOW_DELETES: 'false' });
  assert.equal(noDeletes.filter((n) => n.startsWith('qoyod_delete_')).length, 0);
  assert.equal(noDeletes.filter((n) => n.startsWith('qoyod_write_')).length, 20);

  const noSales = await toolNames({ ...TWO, QOYOD_BLOCK_SALES_WRITES: 'true' });
  assert.ok(noSales.includes('qoyod_read_invoices') && noSales.includes('qoyod_write_bills'));
  assert.ok(!noSales.includes('qoyod_write_invoices') && !noSales.includes('qoyod_delete_invoices'));
  assert.ok(!noSales.includes('qoyod_write_request') && !noSales.includes('qoyod_delete_request'));

  const purchases = await toolNames({ ...TWO, QOYOD_TOOLSETS: 'purchases' });
  assert.ok(purchases.includes('qoyod_read_bills') && !purchases.includes('qoyod_read_invoices'));
  assert.ok(!purchases.includes('qoyod_read_request'));
});

test('read without a company, main company or pop-up support: the assistant is told to ask', async () => {
  const s = await connect({ routes: INVOICES });
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.ok(!r.isError);
  assert.match(r.text, /^ACTION NEEDED: nothing was read/);
  assert.match(r.text, /"Alpha Co", "Beta Co"/);
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('read pop-up: the chosen company is used and "use for all future reads" is saved', async () => {
  const s = await connect({ routes: INVOICES, elicit: () => ({ action: 'accept', content: { company: 'Beta Co', remember: true } }) });
  const r1 = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r1.json.company, 'Beta Co', r1.text);
  assert.equal(s.calls[0].headers['API-KEY'], 'fake-key-two-222');
  assert.deepEqual(s.elicitations[0].requestedSchema.properties.company.enum, ['Alpha Co', 'Beta Co']);
  assert.equal(JSON.parse(fs.readFileSync(s.settingsFile, 'utf8')).default_read_company, 'Beta Co');
  assert.equal(r1.json._company_note, undefined);
  const r2 = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r2.json.company, 'Beta Co');
  assert.match(r2.json._company_note, /main company "Beta Co"/);
  assert.equal(s.elicitations.length, 1, 'no second pop-up once a main company is saved');
  await s.close();
});

test('an empty elicitation capability object still counts as form support', async () => {
  const s = await connect({
    routes: INVOICES,
    clientCapabilities: { elicitation: { form: {} } },
    elicit: () => ({ action: 'accept', content: { company: 'Alpha Co' } }),
  });
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r.json.company, 'Alpha Co');
  await s.close();
});

test('declining the pop-up sends nothing', async () => {
  const s = await connect({ routes: INVOICES, elicit: () => ({ action: 'decline' }) });
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r.json.cancelled, true);
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('a change that names its company goes straight through, with no pop-up', async () => {
  const routes = { 'POST bills': () => ({ status: 201, body: { bill: { id: 77, reference: 'B-1', status: 'Draft' } } }) };
  const s = await connect({ routes, elicit: () => ({ action: 'accept', content: { company: 'Alpha Co' } }) });
  const r = await s.call('qoyod_write_bills', { action: 'create', company: 'beta co', data: { contact_id: 1 } });
  assert.ok(!r.isError, r.text);
  assert.equal(r.json.company, 'Beta Co');
  assert.deepEqual(r.json._created, { id: 77, reference: 'B-1', status: 'Draft' });
  assert.equal(s.elicitations.length, 0);
  assert.equal(s.calls[0].headers['API-KEY'], 'fake-key-two-222');
  await s.close();
});

test('a change without a company: pop-up; "use for all future changes" then makes the assistant name the company first', async () => {
  const routes = { 'POST bills': () => ({ status: 201, body: { bill: { id: 5 } } }) };
  const s = await connect({ routes, elicit: () => ({ action: 'accept', content: { company: 'Beta Co', remember: true } }) });
  s.ctx.settings.update({ default_read_company: 'Alpha Co' });
  const r1 = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.equal(r1.json.company, 'Beta Co', r1.text);
  assert.equal(s.elicitations.length, 1, 'the main READ company never applies to changes');
  assert.equal(s.elicitations[0].requestedSchema.properties.remember.title, 'Use this company for all future changes');
  assert.match(r1.json._settings, /main company for changes/);
  assert.equal(JSON.parse(fs.readFileSync(s.settingsFile, 'utf8')).default_write_company, 'Beta Co');

  const r2 = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.match(r2.text, /^CONFIRM COMPANY: nothing was changed yet/);
  assert.match(r2.text, /"Beta Co"/);
  assert.equal(s.calls.length, 1, 'nothing is sent before the user is told the company');
  assert.equal(s.elicitations.length, 1, 'no second pop-up');

  const r3 = await s.call('qoyod_write_bills', { action: 'create', company: 'Beta Co', data: { contact_id: 1 } });
  assert.ok(!r3.isError, r3.text);
  assert.equal(s.calls.length, 2);
  await s.close();
});

test('QOYOD_CONFIRM_WRITES=always shows the pop-up for every change, pre-selected to the named company', async () => {
  const s = await connect({
    env: { ...TWO, QOYOD_CONFIRM_WRITES: 'always' },
    routes: { 'DELETE bills/5': ok({ message: 'Bill destroyed successfully' }) },
    elicit: (p) => ({ action: 'accept', content: { company: p.requestedSchema.properties.company.default } }),
  });
  const r = await s.call('qoyod_delete_bills', { id: 5, company: 'Beta Co' });
  assert.ok(!r.isError, r.text);
  assert.equal(s.elicitations.length, 1);
  assert.equal(s.elicitations[0].requestedSchema.properties.company.default, 'Beta Co');
  assert.equal(s.calls[0].method, 'DELETE');
  assert.equal(s.calls[0].headers['API-KEY'], 'fake-key-two-222');
  await s.close();
});

test('without pop-up support a change needs a named company, then goes ahead', async () => {
  const s = await connect({ routes: { 'POST bills': () => ({ status: 201, body: { bill: { id: 5 } } }) } });
  const r1 = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.match(r1.text, /^ACTION NEEDED: nothing was changed/);
  assert.equal(s.calls.length, 0);
  const r2 = await s.call('qoyod_write_bills', { action: 'create', company: 'Alpha Co', data: { contact_id: 1 } });
  assert.ok(!r2.isError, r2.text);
  assert.equal(s.calls.length, 1);
  await s.close();
});

test('one company: a different company name is an error, never a silent write to the only key', async () => {
  const s = await connect({ env: ONE, routes: INVOICES });
  const w = await s.call('qoyod_write_invoices', { action: 'create', company: 'Beta Co', data: { contact_id: 1 } });
  assert.equal(w.isError, true);
  assert.match(w.json.error, /Only "Alpha Co" is configured/);
  assert.equal(s.calls.length, 0);
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r.json.company, 'Alpha Co');
  await s.close();
});

test('receipt allocate takes exactly one allocation per call', async () => {
  const s = await connect({ env: ONE, routes: { 'POST receipts/9/allocations': () => ({ status: 201, body: { allocation: { id: 1 } } }) } });
  const item = (n) => ({ allocatee_type: 'Invoice', allocatee_id: n, amount: 1 });
  const two = await s.call('qoyod_write_receipts', { action: 'allocate', id: 9, data: [item(1), item(2)] });
  assert.equal(two.isError, true);
  assert.match(two.json.error, /exactly one allocation/);
  assert.equal(s.calls.length, 0);
  const one = await s.call('qoyod_write_receipts', { action: 'allocate', id: 9, data: [item(1)] });
  assert.ok(!one.isError, one.text);
  assert.deepEqual(s.calls[0].body, { allocation: item(1) });
  await s.close();
});

test('array data only where bulk create is documented', async () => {
  const s = await connect({ env: ONE, routes: { 'POST customers': () => ({ status: 201, body: { contacts: [{ id: 1 }, { id: 2 }] } }) } });
  const inv = await s.call('qoyod_write_invoices', { action: 'create', data: [{ contact_id: 1 }, { contact_id: 2 }] });
  assert.equal(inv.isError, true);
  assert.match(inv.json.error, /takes one object/);
  assert.equal(s.calls.length, 0);
  const cus = await s.call('qoyod_write_customers', { action: 'create', data: [{ name: 'a' }, { name: 'b' }] });
  assert.ok(!cus.isError, cus.text);
  assert.ok(Array.isArray(s.calls[0].body.contact));
  await s.close();
});

test('a write that fails with 5xx is not re-sent and says it may already be saved', async () => {
  const s = await connect({ env: ONE, routes: { 'POST bills': () => ({ status: 502, body: 'Bad gateway' }) } });
  const r = await s.call('qoyod_write_bills', { action: 'create', data: { contact_id: 1 } });
  assert.equal(r.isError, true);
  assert.equal(r.json.may_already_be_saved, true);
  assert.equal(s.calls.length, 1);
  await s.close();
});

test('receipt kind filters are mapped to Qoyod codes', async () => {
  const s = await connect({ env: ONE, routes: { 'GET receipts': ok({ receipts: [] }), 'GET bill_payments': ok({ receipts: [] }) } });
  await s.call('qoyod_read_receipts', { action: 'list', q: { kind_eq: 'paid' } });
  assert.equal(s.calls[0].query['q[kind_eq]'], '1');
  await s.call('qoyod_read_bill_payments', { action: 'list', q: { kind_in: ['received', 'paid'] } });
  assert.deepEqual(s.calls[1].params.getAll('q[kind_in][]'), ['0', '1']);
  await s.close();
});

test('accounts type filters are applied locally', async () => {
  const rows = [{ id: 1, type: 'Asset' }, { id: 2, type: 'Expense' }, { id: 3, type: 'Expense' }];
  const s = await connect({ env: ONE, routes: { 'GET accounts': ok({ accounts: rows }) } });
  const r = await s.call('qoyod_read_accounts', { action: 'list', q: { type_eq: 'expense' } });
  assert.deepEqual(r.json.accounts.map((a) => a.id), [2, 3]);
  assert.equal(r.json._page.total_rows, 2);
  assert.ok(!('q[type_eq]' in s.calls[0].query));
  await s.close();
});

test('an empty filter matches nothing and sends no request', async () => {
  const s = await connect({ env: ONE, routes: INVOICES });
  const r = await s.call('qoyod_read_invoices', { action: 'list', q: { id_in: [] } });
  assert.deepEqual(r.json.invoices, []);
  assert.match(r.json._note, /empty/);
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('only Qoyod\'s "found nothing" 404 becomes an empty list', async () => {
  const s = await connect({
    env: ONE,
    routes: {
      'GET quotes': () => ({ status: 404, body: '"We could not retrieve your Quotes, we found nothing."' }),
      'GET orders': () => ({ status: 404, body: { message: 'Invalid  ID. Please provide a valid  ID.' } }),
    },
  });
  const q = await s.call('qoyod_read_quotes', { action: 'list' });
  assert.ok(!q.isError, q.text);
  assert.deepEqual(q.json.quotes, []);
  const o = await s.call('qoyod_read_purchase_orders', { action: 'list' });
  assert.equal(o.isError, true);
  assert.equal(o.json.http_status, 404);
  await s.close();
});

test('a full page says more records probably exist; unpaged endpoints are paged locally', async () => {
  const inv = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
  const je = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
  const s = await connect({ env: ONE, routes: { 'GET invoices': ok({ invoices: inv }), 'GET journal_entries': ok({ journal_entries: je }) } });
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r.json._page.more, true);
  assert.match(r.json._page.next, /page=2/);
  assert.equal(s.calls[0].query.per_page, '20');
  const j = await s.call('qoyod_read_journal_entries', { action: 'list', page: 3 });
  assert.equal(j.json.journal_entries.length, 20);
  assert.equal(j.json.journal_entries[0].id, 101);
  assert.equal(j.json._page.total_rows, 120);
  assert.equal(j.json._page.more, false);
  assert.ok(!('per_page' in s.calls[1].query));
  await s.close();
});

test('fetch_all walks the pages and fields keeps output small', async () => {
  const routes = {
    'GET invoices': (c) => {
      const page = Number(c.query.page);
      const n = page === 1 ? 100 : 30;
      return { status: 200, body: { invoices: Array.from({ length: n }, (_, i) => ({ id: (page - 1) * 100 + i + 1, total: 1, contact: { big: 'x' } })) } };
    },
  };
  const s = await connect({ env: ONE, routes });
  const r = await s.call('qoyod_read_invoices', { action: 'list', fetch_all: true, fields: ['total'] });
  assert.equal(r.json._fetch_all.rows, 130);
  assert.equal(r.json._fetch_all.complete, true);
  assert.deepEqual(Object.keys(r.json.invoices[0]).sort(), ['id', 'total']);
  await s.close();
});

test('large output is cut at row boundaries and stays valid JSON', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, blob: 'x'.repeat(5000) }));
  const s = await connect({ env: ONE, routes: { 'GET products': ok({ products: rows }) } });
  const r = await s.call('qoyod_read_products', { action: 'list' });
  assert.ok(r.text.length <= 70_000);
  const j = JSON.parse(r.text);
  assert.ok(j._truncated.rows_shown < 50);
  assert.equal(j._truncated.rows_received, 50);
  assert.equal(j.products.length, j._truncated.rows_shown);
  await s.close();
});

test('q sent as a JSON string is accepted', async () => {
  const s = await connect({ env: ONE, routes: INVOICES });
  const r = await s.call('qoyod_read_invoices', { action: 'list', q: '{"status_eq":"Draft"}' });
  assert.ok(!r.isError, r.text);
  assert.equal(s.calls[0].query['q[status_eq]'], 'Draft');
  await s.close();
});

test('raw request tools accept only Qoyod API paths', async () => {
  const s = await connect({ env: ONE, routes: { 'GET projects': ok({ projects: [] }) } });
  assert.equal((await s.call('qoyod_read_request', { path: 'https://evil.example/x' })).isError, true);
  assert.equal((await s.call('qoyod_read_request', { path: 'invoices/../accounts' })).isError, true);
  const good = await s.call('qoyod_read_request', { path: '/2.0/projects', query: { 'q[name_cont]': 'a', page: 2 } });
  assert.ok(!good.isError, good.text);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].method, 'GET');
  assert.equal(s.calls[0].query['q[name_cont]'], 'a');
  await s.close();
});

test('configuration problems block changes but not reads', async () => {
  const env = { QOYOD_API_KEY_1: 'same-key-12345', QOYOD_COMPANY_1_NAME: 'Alpha Co', QOYOD_API_KEY_2: 'same-key-12345', QOYOD_COMPANY_2_NAME: 'Beta Co' };
  const s = await connect({ env, routes: INVOICES });
  const w = await s.call('qoyod_write_bills', { action: 'create', data: { a: 1 } });
  assert.equal(w.isError, true);
  assert.match(w.json.error, /same Qoyod API key/);
  assert.equal(s.calls.length, 0);
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.ok(!r.isError, r.text);
  assert.ok(r.json.config_problems.length > 0);
  await s.close();
});

test('without keys the server stays connected in setup mode and explains what to do', async () => {
  const s = await connect({ env: {} });
  const { tools } = await s.client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['qoyod_read_status', 'qoyod_settings']);
  const r = await s.call('qoyod_read_status');
  assert.equal(r.isError, true);
  assert.match(r.json.help, /API key/);
  await s.close();
});

test('status checks every company and never shows keys', async () => {
  const routes = {
    'GET inventories': (c) =>
      c.headers['API-KEY'] === 'fake-key-two-222' ? { status: 401, body: { message: 'unauthorized' } } : { status: 200, body: { inventories: [{ id: 1, name: 'Main' }] } },
  };
  const s = await connect({ routes });
  const r = await s.call('qoyod_read_status');
  assert.equal(r.json.companies[0].connected, true);
  assert.deepEqual(r.json.companies[0].warehouses, ['Main']);
  assert.equal(r.json.companies[1].connected, false);
  assert.match(r.json.companies[1].error, /401/);
  assert.ok(!r.text.includes('fake-key'));
  await s.close();
});

test('settings tool sets and clears the main read company', async () => {
  const s = await connect({ routes: INVOICES });
  const set = await s.call('qoyod_settings', { action: 'set_main_company', company: 'beta co', applies_to: 'all' });
  assert.equal(set.json.main_company, 'Beta Co');
  const show = await s.call('qoyod_settings', { action: 'show' });
  assert.equal(show.json.main_read_company, 'Beta Co');
  assert.equal(show.json.main_company_for_changes, 'Beta Co');
  const r = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.equal(r.json.company, 'Beta Co');
  await s.call('qoyod_settings', { action: 'clear_main_company', applies_to: 'all' });
  const again = await s.call('qoyod_read_invoices', { action: 'list' });
  assert.match(again.text, /^ACTION NEEDED/);
  await s.close();
});
