// Smoke test: spawns the MCP server over stdio like Claude does, asserts the 19
// tools, then exercises every tool's read actions against the live account.
// `--write` additionally runs a purchase-side create/update/delete cycle
// (vendor, bill, simple bill). Never touches sales-side records.
//
//   node test/smoke.test.js            # read-only
//   node test/smoke.test.js --write    # + purchase-side writes
//   SERVER=dist/qoyod-mcp.cjs node test/smoke.test.js   # test the bundle
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const WRITE = process.argv.includes('--write');
const SERVER = process.env.SERVER || 'src/index.js';
const EXPECTED_TOOLS = [
  'qoyod_accounts', 'qoyod_products', 'qoyod_inventories', 'qoyod_product_categories', 'qoyod_product_units',
  'qoyod_vendors', 'qoyod_purchase_orders', 'qoyod_bills', 'qoyod_bill_payments', 'qoyod_simple_bills',
  'qoyod_simple_bill_payments', 'qoyod_debit_notes', 'qoyod_customers', 'qoyod_quotes', 'qoyod_invoices',
  'qoyod_invoice_payments', 'qoyod_credit_notes', 'qoyod_receipts', 'qoyod_journal_entries',
];

let passed = 0, failed = 0;
const notes = [];
function ok(label, extra = '') { passed++; console.log(`  PASS  ${label}${extra ? '  ' + extra : ''}`); }
function bad(label, err) { failed++; console.log(`  FAIL  ${label}\n        ${String(err).split('\n').slice(0, 6).join('\n        ')}`); }

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.map((c) => c.text ?? '').join('\n') ?? '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* text result */ }
  return { isError: !!res.isError, text, json, status: res._meta?.httpStatus };
}

// Find the array of records in a list response regardless of the wrapper key.
function firstRecords(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const [k, v] of Object.entries(json)) if (k !== 'pagination' && Array.isArray(v)) return v;
  return [];
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(SERVER)],
    env: { ...process.env },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  const client = new Client({ name: 'qoyod-smoke-test', version: '1.0.0' });
  await client.connect(transport);

  console.log(`\n== tools/list (${SERVER}) ==`);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  if (names.length === 19 && EXPECTED_TOOLS.slice().sort().every((n, i) => n === names[i])) ok('19 tools registered');
  else bad('19 tools registered', `got ${names.length}: ${names.join(', ')}`);
  for (const t of tools) {
    const props = t.inputSchema?.properties ?? {};
    if (props.action?.enum?.length && props.data && props.q) ok(`schema ${t.name}`, `actions=[${props.action.enum.join(',')}]`);
    else bad(`schema ${t.name}`, JSON.stringify(t.inputSchema).slice(0, 300));
  }

  console.log('\n== live read tests (list + get) ==');
  const samples = {};
  for (const name of EXPECTED_TOOLS) {
    try {
      const r = await call(client, name, { action: 'list', per_page: 5 });
      if (r.isError) { bad(`${name} list`, r.text); continue; }
      const rows = firstRecords(r.json);
      const pag = r.json?.pagination ? ` pagination=${JSON.stringify(r.json.pagination)}` : ' (no pagination object)';
      ok(`${name} list`, `HTTP ${r.status}, ${rows.length} rows${pag}`);
      samples[name] = rows;
      if (rows[0]?.id != null) {
        const g = await call(client, name, { action: 'get', id: rows[0].id });
        if (g.isError) bad(`${name} get ${rows[0].id}`, g.text);
        else ok(`${name} get ${rows[0].id}`, `HTTP ${g.status}, keys=${Object.keys(g.json ?? {}).join(',')}`);
      }
    } catch (err) { bad(`${name} list`, err); }
  }

  // Ransack filter + sort on a safe endpoint
  try {
    const r = await call(client, 'qoyod_accounts', { action: 'list', sort: 'code desc', q: { code_start: '5' } });
    const rows = firstRecords(r.json);
    if (r.isError) bad('ransack filter/sort', r.text);
    else if (rows.length && rows.every((a) => String(a.code).startsWith('5'))) ok('ransack filter/sort (accounts code_start=5, code desc)', `${rows.length} rows, first code ${rows[0].code}`);
    else bad('ransack filter/sort', `filter not applied: ${rows.slice(0, 3).map((a) => a.code)}`);
    const empty = await call(client, 'qoyod_purchase_orders', { action: 'list' });
    if (!empty.isError && Array.isArray(empty.json?.orders)) ok('empty list returned as [] (not 404 error)', empty.json.message ?? '');
    else bad('empty list returned as []', empty.text);
  } catch (err) { bad('ransack filter/sort', err); }

  // Invoice PDF link (read-only)
  const inv = samples.qoyod_invoices?.[0];
  if (inv) {
    const r = await call(client, 'qoyod_invoices', { action: 'pdf', id: inv.id });
    if (r.isError) bad(`invoices pdf ${inv.id}`, r.text);
    else ok(`invoices pdf ${inv.id}`, r.json?.pdf_file ? 'got pdf_file link' : r.text.slice(0, 100));
  } else notes.push('No invoices in account: pdf action not exercised.');

  // Error surface: nonexistent id
  const e = await call(client, 'qoyod_accounts', { action: 'get', id: 999999999 });
  if (e.isError) ok('error surfaced for missing record', e.text.split('\n')[0].slice(0, 120));
  else bad('error surfaced for missing record', 'expected isError');

  if (WRITE) await writeTests(client, samples);
  else notes.push('Write tests skipped (run with --write).');

  await client.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const n of notes) console.log(`note: ${n}`);
  process.exit(failed ? 1 : 0);
}

async function writeTests(client, samples) {
  console.log('\n== live write tests (purchases side only) ==');
  const today = new Date().toISOString().slice(0, 10);
  const stamp = Date.now().toString(36);

  // 1. vendor: reuse an earlier "MCP TEST VENDOR" if present (re-activate it), else create.
  //    Vendors cannot be deleted through the API, so it is set back to Inactive at the end.
  let vendorId;
  try {
    const existing = firstRecords((await call(client, 'qoyod_vendors', { action: 'list' })).json)
      .find((v) => String(v.name).startsWith('MCP TEST VENDOR'));
    if (existing) {
      const u = await call(client, 'qoyod_vendors', { action: 'update', id: existing.id, data: { status: 'Active' } });
      if (u.isError) throw new Error(u.text);
      vendorId = existing.id;
      ok('vendors update -> Active (reusing test vendor)', `HTTP ${u.status}, id=${vendorId}`);
    } else {
      const r = await call(client, 'qoyod_vendors', { action: 'create', data: { name: `MCP TEST VENDOR ${stamp}`, organization: 'MCP test - safe to ignore', status: 'Active' } });
      if (r.isError) throw new Error(r.text);
      vendorId = r.json?.contact?.id ?? r.json?.id ?? r.json?.contacts?.[0]?.id;
      ok('vendors create', `HTTP ${r.status}, id=${vendorId}`);
    }
  } catch (err) { bad('vendors create/update', err); }
  if (!vendorId) return;

  const inventoryId = samples.qoyod_inventories?.[0]?.id;
  let product = (samples.qoyod_products ?? []).find((p) => p.is_bought);
  if (!product) {
    const all = firstRecords((await call(client, 'qoyod_products', { action: 'list', per_page: 500 })).json);
    product = all.find((p) => p.is_bought);
  }
  const expenseAcct = await findAccount(client, ['Expense', 'DirectCost', 'Overhead']);

  // 2. bill create (Draft) -> delete
  if (inventoryId && product) {
    let billId;
    try {
      const r = await call(client, 'qoyod_bills', {
        action: 'create',
        data: {
          contact_id: vendorId, status: 'Draft', issue_date: today, due_date: today, inventory_id: inventoryId,
          reference: `MCPTEST-${stamp}`,
          line_items: [{ product_id: product.id, quantity: 1, unit_price: 1, tax_percent: 15, description: 'MCP test line' }],
        },
      });
      if (r.isError) throw new Error(r.text);
      billId = r.json?.bill?.id ?? r.json?.id;
      ok('bills create (Draft)', `HTTP ${r.status}, id=${billId}, status=${r.json?.bill?.status}`);
    } catch (err) { bad('bills create', err); }
    if (billId) {
      const d = await call(client, 'qoyod_bills', { action: 'delete', id: billId });
      if (d.isError) { bad('bills delete', d.text); notes.push(`Draft bill ${billId} could not be deleted - please remove it in Qoyod.`); }
      else ok('bills delete', `HTTP ${d.status}: ${d.text.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
  } else notes.push('Skipped bill test: no inventory or product found.');

  // 3. simple bill create (Draft) -> update -> delete
  if (inventoryId && expenseAcct) {
    let sbId;
    try {
      const r = await call(client, 'qoyod_simple_bills', {
        action: 'create',
        data: {
          contact_id: vendorId, status: 'Draft', issue_date: today, inventory_id: inventoryId, reference: `MCPTESTSB-${stamp}`,
          simple_bill_items_attributes: [{ expense_category_id: expenseAcct.id, total_amount: 1, tax_id: 1, description: 'MCP test expense' }],
        },
      });
      if (r.isError) throw new Error(r.text);
      sbId = r.json?.simple_bill?.id ?? r.json?.id;
      ok('simple_bills create (Draft)', `HTTP ${r.status}, id=${sbId}`);
      const u = await call(client, 'qoyod_simple_bills', { action: 'update', id: sbId, data: { issue_date: today } });
      if (u.isError) throw new Error(u.text);
      ok('simple_bills update', `HTTP ${u.status}`);
    } catch (err) { bad('simple_bills create/update', err); }
    if (sbId) {
      const d = await call(client, 'qoyod_simple_bills', { action: 'delete', id: sbId });
      if (d.isError) { bad('simple_bills delete', d.text); notes.push(`Draft simple bill ${sbId} could not be deleted - please remove it in Qoyod.`); }
      else ok('simple_bills delete', `HTTP ${d.status}: ${d.text.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
  } else notes.push('Skipped simple bill test: no inventory or expense account found.');

  // 4. deactivate the test vendor again
  const off = await call(client, 'qoyod_vendors', { action: 'update', id: vendorId, data: { status: 'Inactive' } });
  if (off.isError) bad('vendors update -> Inactive', off.text);
  else ok('vendors update -> Inactive', `HTTP ${off.status}, status=${off.json?.contact?.status ?? off.json?.status}`);
  notes.push(`Test vendor id ${vendorId} ("MCP TEST VENDOR ...") remains in Qoyod as Inactive - the API has no vendor delete.`);
}

async function findAccount(client, types) {
  for (const t of types) {
    const r = await call(client, 'qoyod_accounts', { action: 'list', per_page: 1, q: { type_eq: t } });
    const rows = firstRecords(r.json);
    if (rows[0]) return rows[0];
  }
  const r = await call(client, 'qoyod_accounts', { action: 'list', per_page: 200 });
  return firstRecords(r.json).find((a) => types.includes(a.type));
}

main().catch((err) => { console.error('smoke test crashed:', err); process.exit(2); });
