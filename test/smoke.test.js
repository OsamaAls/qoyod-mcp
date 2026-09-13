// LIVE smoke test against real Qoyod books. Read-only unless --write.
//
//   node test/smoke.test.js [--server <bundle>] [--env-file <path to .env>]
//   node test/smoke.test.js --write --company "<name>" --vendor <test vendor id>
//
// Reads: every read tool for every configured company (small pages; journal entries limited to 60 days).
// --write: a purchases-side cycle only. The vendor's name must start with "MCP TEST VENDOR". It is re-activated,
// a Draft bill and a Draft simple bill are created, updated and deleted, and the vendor is set back to Inactive,
// with cleanup even when a step fails. Sales-side records are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const WRITE = argv.includes('--write');
const SERVER = path.resolve(opt('--server') ?? process.env.SERVER ?? 'dist/qoyod-mcp.cjs');
const ENV_FILE = opt('--env-file');
const WRITE_COMPANY = opt('--company');
const VENDOR_ID = opt('--vendor');
if (WRITE && (!WRITE_COMPANY || !VENDOR_ID)) {
  console.error('--write needs --company "<name>" and --vendor <test vendor id>');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const notes = [];
const ok = (label, extra = '') => {
  passed++;
  console.log(`  PASS  ${label}${extra ? `  ${extra}` : ''}`);
};
const bad = (label, err) => {
  failed++;
  console.log(`  FAIL  ${label}\n        ${String(err).split('\n').slice(0, 6).join('\n        ')}`);
};

function riyadhDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

const rowsOf = (json) => {
  if (!json || typeof json !== 'object') return [];
  for (const [k, v] of Object.entries(json)) if (!k.startsWith('_') && k !== 'pagination' && Array.isArray(v)) return v;
  return [];
};

async function main() {
  const env = { ...process.env, QOYOD_SETTINGS_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qoyod-smoke-')), 'settings.json') };
  if (ENV_FILE) env.QOYOD_ENV_FILE = path.resolve(ENV_FILE);
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env, stderr: 'pipe' });
  transport.stderr?.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  const client = new Client({ name: 'qoyod-smoke-test', version: '2.0.0' });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content?.[0]?.text ?? '';
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* plain text */
    }
    return { isError: !!r.isError, text, json };
  };

  try {
    console.log(`\n== ${SERVER} ==`);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const reads = names.filter((n) => n.startsWith('qoyod_read_') && !['qoyod_read_status', 'qoyod_read_request'].includes(n));
    if (reads.length === 20) ok('20 resource read tools', `${tools.length} tools in total`);
    else bad('20 resource read tools', names.join(', '));

    const status = await call('qoyod_read_status');
    if (status.isError || !status.json?.companies) throw new Error(`status failed: ${status.text}`);
    for (const c of status.json.companies) {
      if (c.connected) ok(`status "${c.company}"`, `${c.ms} ms, ${c.warehouses.length} warehouse(s)`);
      else bad(`status "${c.company}"`, c.error);
    }
    const companies = status.json.companies.filter((c) => c.connected).map((c) => c.company);

    for (const company of companies) {
      console.log(`\n== live reads: "${company}" ==`);
      const samples = {};
      for (const tool of reads) {
        const args = { action: 'list', company, per_page: 5 };
        if (tool === 'qoyod_read_journal_entries') Object.assign(args, { q: { date_gteq: riyadhDate(-60) }, sort: 'date desc' });
        const r = await call(tool, args);
        if (r.isError || !r.json) {
          bad(`${tool} list`, r.text.slice(0, 300));
          continue;
        }
        if (r.json.company !== company) {
          bad(`${tool} company label`, r.json.company);
          continue;
        }
        const rows = rowsOf(r.json);
        samples[tool] = rows;
        ok(`${tool} list`, `${rows.length} row(s)${r.json._page ? `, more: ${r.json._page.more}` : ''}${r.json._truncated ? ', truncated' : ''}`);
      }
      for (const tool of ['qoyod_read_accounts', 'qoyod_read_products', 'qoyod_read_customers', 'qoyod_read_invoices', 'qoyod_read_bills', 'qoyod_read_receipts']) {
        const id = samples[tool]?.[0]?.id;
        if (id == null) {
          notes.push(`"${company}": ${tool} returned no rows, so get was not checked.`);
          continue;
        }
        const g = await call(tool, { action: 'get', company, id });
        if (g.isError) bad(`${tool} get ${id}`, g.text.slice(0, 300));
        else ok(`${tool} get ${id}`);
      }
      const invoice = samples.qoyod_read_invoices?.[0];
      if (invoice) {
        const p = await call('qoyod_read_invoices', { action: 'pdf', company, id: invoice.id });
        if (p.isError) bad('invoice pdf', p.text.slice(0, 200));
        else ok('invoice pdf', p.json?.pdf_file ? 'link returned' : '');
      }
      const types = rowsOf((await call('qoyod_read_accounts', { action: 'list', company, fetch_all: true, fields: ['type'] })).json).map((a) => a.type);
      if (types[0]) {
        const t = await call('qoyod_read_accounts', { action: 'list', company, q: { type_eq: types[0] }, per_page: 500 });
        const rows = rowsOf(t.json);
        if (rows.length && rows.every((a) => a.type === types[0])) ok('accounts type filter (applied locally)', `${rows.length} x ${types[0]}`);
        else bad('accounts type filter', t.text.slice(0, 200));
      }
      const empty = await call('qoyod_read_accounts', { action: 'list', company, q: { id_eq: 0 } });
      if (!empty.isError && rowsOf(empty.json).length === 0) ok('a filter that matches nothing returns []');
      else bad('no-match filter', empty.text.slice(0, 200));
      const missing = await call('qoyod_read_accounts', { action: 'get', company, id: 999999999 });
      if (missing.isError && missing.json?.http_status === 404) ok('a missing record is reported as 404');
      else bad('missing record', missing.text.slice(0, 200));
      const raw = await call('qoyod_read_request', { company, path: 'product_unit_types' });
      if (raw.isError) bad('raw GET product_unit_types', raw.text.slice(0, 200));
      else ok('raw GET product_unit_types');
    }

    if (WRITE) await writeTests(call);
    else notes.push('Write tests skipped (run with --write --company "<name>" --vendor <id>).');
  } catch (err) {
    bad('smoke test', err?.message ?? err);
  } finally {
    await client.close().catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  for (const n of notes) console.log(`note: ${n}`);
  process.exit(failed ? 1 : 0);
}

async function writeTests(call) {
  const company = WRITE_COMPANY;
  console.log(`\n== live write cycle, purchases side only: "${company}" ==`);
  const today = riyadhDate();
  const stamp = Date.now().toString(36);
  const v = await call('qoyod_read_vendors', { action: 'get', company, id: VENDOR_ID });
  const vendor = v.json?.contact ?? v.json?.vendor;
  if (v.isError || !vendor) return bad('test vendor lookup', v.text.slice(0, 300));
  if (!String(vendor.name ?? '').startsWith('MCP TEST VENDOR')) {
    return bad('test vendor safety check', `vendor ${VENDOR_ID} is not an "MCP TEST VENDOR": refusing to write`);
  }
  const wasInactive = vendor.status !== 'Active';
  const created = [];
  try {
    if (wasInactive) {
      const u = await call('qoyod_write_vendors', { action: 'update', company, id: VENDOR_ID, data: { status: 'Active' } });
      if (u.isError) throw new Error(`vendor -> Active: ${u.text}`);
      ok('test vendor -> Active');
    }
    const inventory = rowsOf((await call('qoyod_read_inventories', { action: 'list', company })).json)[0];
    const product = rowsOf((await call('qoyod_read_products', { action: 'list', company, fetch_all: true, fields: ['is_bought'] })).json).find((p) => p.is_bought);
    const expense = rowsOf((await call('qoyod_read_accounts', { action: 'list', company, q: { type_eq: 'Expense' }, per_page: 500 })).json)[0];

    if (inventory && product) {
      const b = await call('qoyod_write_bills', {
        action: 'create',
        company,
        data: {
          contact_id: Number(VENDOR_ID), status: 'Draft', issue_date: today, due_date: today, inventory_id: inventory.id, reference: `MCPTEST-${stamp}`,
          line_items: [{ product_id: product.id, quantity: 1, unit_price: 1, tax_percent: 15, description: 'MCP test line' }],
        },
      });
      if (b.isError) bad('bill create (Draft)', b.text.slice(0, 400));
      else {
        created.push(['qoyod_delete_bills', b.json._created?.id]);
        ok('bill create (Draft)', `id ${b.json._created?.id}`);
      }
    } else notes.push('Bill cycle skipped: no warehouse or purchasable product.');

    if (inventory && expense) {
      const sb = await call('qoyod_write_simple_bills', {
        action: 'create',
        company,
        data: {
          contact_id: Number(VENDOR_ID), status: 'Draft', issue_date: today, inventory_id: inventory.id, reference: `MCPTESTSB-${stamp}`,
          simple_bill_items_attributes: [{ expense_category_id: expense.id, total_amount: 1, tax_id: 1, description: 'MCP test expense' }],
        },
      });
      if (sb.isError) bad('simple bill create (Draft)', sb.text.slice(0, 400));
      else {
        const id = sb.json._created?.id;
        created.push(['qoyod_delete_simple_bills', id]);
        ok('simple bill create (Draft)', `id ${id}`);
        const u = await call('qoyod_write_simple_bills', { action: 'update', company, id, data: { issue_date: today } });
        if (u.isError) bad('simple bill update', u.text.slice(0, 300));
        else ok('simple bill update');
      }
    } else notes.push('Simple bill cycle skipped: no warehouse or expense account.');
  } catch (err) {
    bad('write cycle', err?.message ?? err);
  } finally {
    for (const [tool, id] of created.reverse()) {
      if (id == null) {
        notes.push(`A Draft record from ${tool} has no id in the response: check Qoyod for references starting with MCPTEST-${stamp}.`);
        continue;
      }
      const d = await call(tool, { company, id });
      if (d.isError) {
        bad(`${tool} ${id}`, d.text.slice(0, 300));
        notes.push(`Please delete Draft record ${id} (${tool.replace('qoyod_delete_', '')}) in Qoyod.`);
      } else ok(`${tool} ${id}`);
    }
    if (wasInactive) {
      const off = await call('qoyod_write_vendors', { action: 'update', company, id: VENDOR_ID, data: { status: 'Inactive' } });
      if (off.isError) {
        bad('test vendor -> Inactive', off.text.slice(0, 300));
        notes.push(`Set test vendor ${VENDOR_ID} back to Inactive in Qoyod.`);
      } else ok('test vendor -> Inactive');
    }
  }
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(2);
});
