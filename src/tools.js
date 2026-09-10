// MCP tools. Each Qoyod resource becomes up to three tools so that clients can approve or block whole groups:
//   qoyod_read_<resource>    list / get / pdf              readOnlyHint: true
//   qoyod_write_<resource>   create / update / allocate ... changes the live books
//   qoyod_delete_<resource>  delete by id                   destructiveHint: true
// plus qoyod_read_status, qoyod_read_request / qoyod_write_request / qoyod_delete_request (raw API access)
// and qoyod_settings (the saved main company for reads).
import { z } from 'zod';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLSETS } from './config.js';
import { expandAliases } from './client.js';
import { RESOURCES } from './resources.js';
import { defaultCompany, findCompany } from './settings.js';

export const MAX_OUTPUT_CHARS = 70_000;
export const WRITE_ACTIONS = new Set(['create', 'update', 'allocate', 'adjust', 'transfer']);
const FETCH_ALL_PER_PAGE = 100;
const FETCH_ALL_MAX_PAGES = 10;
const FETCH_ALL_MAX_ROWS = 1000;
const KIND_CODES = { received: 0, paid: 1 };
const ELICIT_TIMEOUT_MS = 10 * 60 * 1000;

// ---- small helpers ---------------------------------------------------------

function userError(message) {
  return Object.assign(new Error(message), { user: true });
}

const enc = (id) => encodeURIComponent(String(id));

// Models sometimes send objects as JSON strings; accept them without changing the advertised schema.
const jsonish = (v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export function rowsKey(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return Object.keys(data).find((k) => k !== 'pagination' && Array.isArray(data[k])) ?? null;
}

function textResult(obj, isError = false) {
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function isFoundNothing(err) {
  if (err?.status !== 404) return false;
  const msg = typeof err.body === 'string' ? err.body : String(err.body?.message ?? '');
  return /found nothing/i.test(msg);
}

function normaliseKind(q) {
  const out = { ...q };
  const map = (v) => (typeof v === 'string' && v.trim().toLowerCase() in KIND_CODES ? KIND_CODES[v.trim().toLowerCase()] : v);
  for (const k of Object.keys(out)) {
    if (/^kind_(eq|not_eq|in|not_in)$/.test(k)) out[k] = Array.isArray(out[k]) ? out[k].map(map) : map(out[k]);
  }
  return out;
}

function applyTypeFilter(rows, filters) {
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  return rows.filter((row) =>
    Object.entries(filters).every(([k, v]) => {
      const t = norm(row?.type);
      const list = (Array.isArray(v) ? v : [v]).map(norm);
      switch (k) {
        case 'type_eq': return t === list[0];
        case 'type_not_eq': return t !== list[0];
        case 'type_in': return list.includes(t);
        case 'type_not_in': return !list.includes(t);
        case 'type_cont': return t.includes(list[0]);
        case 'type_start': return t.startsWith(list[0]);
        default: return true;
      }
    }),
  );
}

function projectRecord(record, keep) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => keep.has(k)));
}

function projectRows(rows, fields) {
  if (!Array.isArray(fields) || !fields.length) return rows;
  const keep = new Set(['id', ...fields]);
  return rows.map((r) => projectRecord(r, keep));
}

function projectGet(data, fields) {
  if (!Array.isArray(fields) || !fields.length || !data || typeof data !== 'object') return data;
  const keep = new Set(['id', ...fields]);
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, projectRecord(v, keep)]));
}

function createdSummary(data, res) {
  const pick = (o) => (o && typeof o === 'object' ? { id: o.id, reference: o.reference ?? o.quotation_number, status: o.status } : undefined);
  const env = data?.[res.envelope];
  if (Array.isArray(env)) return env.map(pick);
  if (env && typeof env === 'object') return pick(env);
  const key = rowsKey(data);
  if (key) return data[key].map(pick);
  if (data && typeof data === 'object' && 'id' in data) return pick(data);
  return undefined;
}

// ---- output ------------------------------------------------------------------

function truncateToFit(payload, max) {
  const key = rowsKey(payload);
  if (key) {
    const { [key]: rows, ...rest } = payload;
    const build = (k) =>
      JSON.stringify({
        ...rest,
        _truncated: {
          rows_shown: k,
          rows_received: rows.length,
          hint: 'Output limit reached: use page/per_page, fields, or q filters (for example a date range) to see the rest.',
        },
        [key]: rows.slice(0, k),
      });
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (build(mid).length <= max) lo = mid;
      else hi = mid - 1;
    }
    const text = build(lo);
    if (text.length <= max) return text;
  }
  const full = JSON.stringify(payload);
  return JSON.stringify({
    company: payload.company,
    _truncated: { chars_shown: max - 1000, chars_total: full.length, hint: 'The record is too large to show in full: use fields to pick the parts you need.' },
    preview: full.slice(0, max - 1000),
  });
}

export function formatResult({ company, data, meta = {}, problems = [], maxChars = MAX_OUTPUT_CHARS }) {
  const payload = {};
  if (company) payload.company = company.name;
  if (problems.length) payload.config_problems = problems;
  if (meta.companyNote) payload._company_note = meta.companyNote;
  if (meta.remembered) payload._settings = `"${company.name}" is now the main company for ${meta.remembered}.`;
  if (meta.note) payload._note = meta.note;
  if (meta.page) payload._page = meta.page;
  if (meta.fetchAll) payload._fetch_all = meta.fetchAll;
  if (meta.created !== undefined) payload._created = meta.created;
  const body = data && typeof data === 'object' && !Array.isArray(data) ? data : { result: data };
  for (const [k, v] of Object.entries(body)) if (!(k in payload)) payload[k] = v;
  let text = JSON.stringify(payload);
  if (text.length > maxChars) text = truncateToFit(payload, maxChars);
  return { content: [{ type: 'text', text }] };
}

export function errorResult(err, company) {
  const payload = {};
  if (company) payload.company = company.name;
  payload.error = err?.message ?? String(err);
  if (err?.status) payload.http_status = err.status;
  if (err?.maybeSaved) payload.may_already_be_saved = true;
  if (err?.status === 401 && company) payload.hint = `Qoyod rejected the API key for "${company.name}". Check that key in the server settings.`;
  if (err?.body != null) {
    const s = typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
    payload.qoyod_response = s.length <= 2000 && typeof err.body === 'object' ? err.body : s.length > 2000 ? `${s.slice(0, 2000)}...` : s;
  }
  return textResult(payload, true);
}

// ---- company choice ------------------------------------------------------------

function supportsFormElicitation(server) {
  const e = server?.server?.getClientCapabilities?.()?.elicitation;
  if (!e || typeof e !== 'object') return false;
  if ('form' in e) return true;
  return !('url' in e); // an empty object means form mode (backwards compatible)
}

async function elicitCompany(ctx, group, extra, preselect, actionText) {
  const names = ctx.companies.map((c) => c.name);
  const properties = {
    company: {
      type: 'string',
      title: 'Company',
      description: group === 'read' ? 'Which Qoyod company should be read?' : 'Which Qoyod company should be changed?',
      enum: names,
      ...(preselect ? { default: preselect.name } : {}),
    },
  };
  properties.remember = {
    type: 'boolean',
    title: group === 'read' ? 'Use this company for all future reads' : 'Use this company for all future changes',
    description:
      group === 'read'
        ? 'Saved on this computer. You will be told which company each answer is for.'
        : 'Saved on this computer. You will still be told the company before each change.',
    default: false,
  };
  const message =
    group === 'read'
      ? `Qoyod: which company should I read from? (${actionText})`
      : `Qoyod: which company is this change for? (${actionText}) Nothing is sent until you choose.`;
  let result;
  try {
    result = await extra.sendRequest(
      { method: 'elicitation/create', params: { message, requestedSchema: { type: 'object', properties, required: ['company'] } } },
      ElicitResultSchema,
      { timeout: ELICIT_TIMEOUT_MS },
    );
  } catch (err) {
    ctx.log?.(`company pop-up failed (${err?.message ?? err}); asking through the assistant instead`);
    return null;
  }
  if (result.action !== 'accept') return { cancelled: result.action };
  const company = findCompany(ctx.companies, result.content?.company);
  if (!company) return { cancelled: 'no-company' };
  let remembered = false;
  if (result.content?.remember === true) {
    try {
      ctx.settings.update({ [group === 'read' ? 'default_read_company' : 'default_write_company']: company.name });
      remembered = group === 'read' ? 'reads' : 'changes';
    } catch (err) {
      ctx.log?.(`could not save the main company: ${err.message}`);
    }
  }
  return { company, remembered };
}

function askUserResult(ctx, group) {
  const names = ctx.companies.map((c) => `"${c.name}"`).join(', ');
  const text =
    group === 'read'
      ? 'ACTION NEEDED: nothing was read. Ask the user which Qoyod company to read from, as one single-choice question with these options: ' +
        `${names}. Use your app's question or choice tool if it has one; otherwise ask in the chat. ` +
        'In the same question, ask whether that company should become the main company for future reads; if yes, call qoyod_settings with action "set_main_company" and applies_to "reads". ' +
        'Then call this tool again with "company" set to the chosen name.'
      : 'ACTION NEEDED: nothing was changed. Ask the user which Qoyod company this change is for, as one single-choice question with these options: ' +
        `${names}. Use your app's question or choice tool if it has one; otherwise ask in the chat. Never choose the company yourself. ` +
        'In the same question, ask whether that company should become the main company for future changes; if yes, call qoyod_settings with action "set_main_company" and applies_to "changes". ' +
        'Then call this tool again with "company" set to the chosen name.';
  return { content: [{ type: 'text', text }] };
}

function confirmMainResult(main) {
  const text =
    `CONFIRM COMPANY: nothing was changed yet. No company was named, so this change would go to the main company for changes, "${main.name}". ` +
    `Tell the user in one short sentence that you are making this change in "${main.name}" (they can name another company instead), ` +
    `then call this tool again with the same arguments plus "company": "${main.name}".`;
  return { content: [{ type: 'text', text }] };
}

function cancelledResult(group, how) {
  const what = group === 'read' ? 'Nothing was read' : 'Nothing was changed';
  return textResult({ cancelled: true, message: `${what}: the user did not choose a company (${how}).` });
}

/**
 * Picks the company for a call. Returns one of:
 *   { company, usedMain?, remembered? }   go ahead
 *   { confirm: result }                   tell the user the main company for changes first, then call again with it
 *   { ask: result }                       the assistant must ask the user (client has no pop-up)
 *   { cancelled }                         the user closed or declined the pop-up
 * The pop-up appears only when no company was named (or always for changes with QOYOD_CONFIRM_WRITES=always).
 */
export async function resolveCompany(ctx, group, args, extra, actionText) {
  const { companies } = ctx;
  if (companies.length === 1) {
    if (args.company && !findCompany(companies, args.company)) {
      throw userError(`Only "${companies[0].name}" is configured; there is no API key for "${args.company}".`);
    }
    return { company: companies[0] };
  }
  let explicit = null;
  if (args.company) {
    explicit = findCompany(companies, args.company);
    if (!explicit) throw userError(`Unknown company "${args.company}". Configured: ${companies.map((c) => `"${c.name}"`).join(', ')}.`);
  }
  const strict = group !== 'read' && ctx.switches.confirmWrites === 'always';
  if (explicit && !strict) return { company: explicit };
  let preselect = explicit;
  if (!explicit) {
    const main = defaultCompany(ctx.settings, companies, ctx.env, group === 'read' ? 'read' : 'write');
    if (main && group === 'read') return { company: main, usedMain: true };
    if (main && !strict) return { confirm: confirmMainResult(main) };
    preselect = main;
  }
  if (supportsFormElicitation(ctx.server) && extra?.sendRequest) {
    const r = await elicitCompany(ctx, group, extra, preselect, actionText);
    if (r?.cancelled) return { cancelled: r.cancelled };
    if (r) return r;
  }
  // No pop-up available. A change that already names its company goes ahead: the client's own approval
  // prompt (keep write/delete tools on "ask") is the confirmation in that case.
  if (group !== 'read' && explicit) return { company: explicit };
  return { ask: askUserResult(ctx, group) };
}

// ---- schemas -----------------------------------------------------------------------

const idSchema = () => z.union([z.number(), z.string()]);
const recordSchema = z.record(z.string(), z.unknown());

// Filter/query values must be scalars or lists of scalars (checked here to keep the advertised schema small).
function checkScalars(obj, name) {
  const scalar = (x) => ['string', 'number', 'boolean'].includes(typeof x);
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (!(scalar(v) || (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')))) {
      throw userError(`"${name}.${k}" must be a string, number, boolean or a list of strings/numbers.`);
    }
  }
}

function companySchema(ctx, group) {
  const names = ctx.companies.map((c) => c.name);
  if (names.length <= 1) {
    return z.string().optional().describe(`Only "${names[0]}" is configured`);
  }
  const desc = group === 'read' ? 'Omit to use the main company or ask the user' : 'The user confirms the company';
  const canonical = (v) => (typeof v === 'string' ? findCompany(ctx.companies, v)?.name ?? v : v);
  return z.preprocess(canonical, z.enum(names)).optional().describe(desc);
}

function readSchema(ctx, res) {
  const listOnly = res.readActions.length === 1;
  return {
    action: z.enum(res.readActions),
    company: companySchema(ctx, 'read'),
    ...(listOnly ? {} : { id: idSchema().optional() }),
    page: z.number().min(1).optional(),
    per_page: z.number().min(1).max(500).optional(),
    q: z.preprocess(jsonish, recordSchema).optional().describe('Ransack filters, e.g. {"issue_date_gteq":"2026-01-01"}'),
    sort: z.string().optional(),
    fetch_all: z.boolean().optional(),
    fields: z.preprocess(jsonish, z.array(z.string())).optional(),
  };
}

function writeSchema(ctx, res) {
  const allowArray = Boolean(res.bulkCreate || res.allocate);
  return {
    action: z.enum(res.writeActions),
    company: companySchema(ctx, 'write'),
    ...(res.writeActions.some((a) => a === 'update' || a === 'allocate') ? { id: idSchema().optional().describe('For update / allocate') } : {}),
    data: z.preprocess(jsonish, allowArray ? z.union([recordSchema, z.array(recordSchema)]) : recordSchema).describe('See the tool description'),
  };
}

// ---- handlers ------------------------------------------------------------------------

async function listRecords(res, client, args, signal) {
  checkScalars(args.q, 'q');
  let q = args.q && Object.keys(args.q).length ? { ...args.q } : undefined;
  if (q) {
    const emptyKey = Object.entries(q).find(([, v]) => (Array.isArray(v) && v.length === 0) || v === '')?.[0];
    if (emptyKey) {
      return { data: { [res.path]: [] }, meta: { note: `Filter "${emptyKey}" is empty, so nothing matches. No request was sent.` } };
    }
    if (res.kindFilter) q = normaliseKind(q);
  }
  let typeFilters = null;
  if (res.localTypeFilter && q) {
    for (const k of Object.keys(q)) {
      if (k.startsWith('type_')) {
        typeFilters = { ...typeFilters, [k]: q[k] };
        delete q[k];
      }
    }
    if (!Object.keys(q).length) q = undefined;
  }

  const fetchPage = async (page, perPage) => {
    const query = { q, sort: args.sort };
    if (res.paging !== 'none' && page != null) Object.assign(query, { page, per_page: perPage });
    try {
      return (await client.get(res.path, query, { signal })).data;
    } catch (err) {
      if (isFoundNothing(err)) return { [res.path]: [] };
      throw err;
    }
  };

  if (args.fetch_all) {
    if (res.paging === 'none') {
      const data = await fetchPage();
      const key = rowsKey(data) ?? res.path;
      let rows = Array.isArray(data[key]) ? data[key] : [];
      if (typeFilters) rows = applyTypeFilter(rows, typeFilters);
      const complete = rows.length <= FETCH_ALL_MAX_ROWS;
      rows = rows.slice(0, FETCH_ALL_MAX_ROWS);
      return {
        data: { [key]: projectRows(rows, args.fields) },
        meta: { fetchAll: { pages_fetched: 1, rows: rows.length, complete, ...(complete ? {} : { note: `Stopped at ${FETCH_ALL_MAX_ROWS} rows: narrow with q for a complete answer.` }) } },
      };
    }
    const all = [];
    const firstIds = new Set();
    let key = null;
    let pages = 0;
    let complete = false;
    let note;
    for (let page = 1; page <= FETCH_ALL_MAX_PAGES; page++) {
      const data = await fetchPage(page, FETCH_ALL_PER_PAGE);
      pages++;
      key = key ?? rowsKey(data);
      const rows = key && Array.isArray(data[key]) ? data[key] : [];
      if (rows.length > FETCH_ALL_PER_PAGE) {
        all.push(...rows); // Qoyod ignored paging and returned everything
        complete = true;
        break;
      }
      const first = rows[0]?.id;
      if (first != null && firstIds.has(first)) {
        note = 'Qoyod ignored the page number, so only the first page could be read: narrow with q.';
        break;
      }
      if (first != null) firstIds.add(first);
      all.push(...rows);
      if (rows.length < FETCH_ALL_PER_PAGE) {
        complete = true;
        break;
      }
      if (all.length >= FETCH_ALL_MAX_ROWS) break;
    }
    let rows = typeFilters ? applyTypeFilter(all, typeFilters) : all;
    if (rows.length > FETCH_ALL_MAX_ROWS) {
      rows = rows.slice(0, FETCH_ALL_MAX_ROWS);
      complete = false;
    }
    if (!complete && !note) note = `Stopped at ${FETCH_ALL_MAX_ROWS} rows / ${FETCH_ALL_MAX_PAGES} pages: narrow with q (for example a date range) for a complete answer.`;
    return {
      data: { [key ?? res.path]: projectRows(rows, args.fields) },
      meta: { fetchAll: { pages_fetched: pages, rows: rows.length, complete, ...(note ? { note } : {}) } },
    };
  }

  const perPage = args.per_page ?? res.perPage;
  const page = args.page ?? 1;
  let data = await fetchPage(page, perPage);
  const key = rowsKey(data);
  if (!key) return { data, meta: {} };
  let rows = data[key];
  if (typeFilters) rows = applyTypeFilter(rows, typeFilters);
  let pageMeta;
  if (res.paging === 'none' || typeFilters || rows.length > perPage) {
    const total = rows.length;
    const start = (page - 1) * perPage;
    rows = rows.slice(start, start + perPage);
    const more = start + perPage < total;
    pageMeta = { page, per_page: perPage, returned: rows.length, total_rows: total, total_pages: Math.max(1, Math.ceil(total / perPage)), more };
    if (more) pageMeta.next = `Call again with page=${page + 1} for more.`;
  } else {
    const pg = data.pagination && typeof data.pagination === 'object' ? data.pagination : null;
    const totalPages = Number(pg?.totalPages ?? pg?.total_pages);
    const total = Number(pg?.total ?? pg?.total_count ?? pg?.count);
    const current = Number(pg?.currentPage ?? pg?.current_page ?? page);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      const more = current < totalPages;
      pageMeta = { page: current, per_page: perPage, returned: rows.length, ...(Number.isFinite(total) ? { total_rows: total } : {}), total_pages: totalPages, more };
      if (more) pageMeta.next = `Call again with page=${current + 1} for more.`;
    } else {
      const more = rows.length >= perPage;
      pageMeta = { page, per_page: perPage, returned: rows.length, more };
      if (more) {
        pageMeta.next =
          `This page is full, so more records probably exist: call again with page=${page + 1} (same q and sort) until a page has fewer than ${perPage} rows, or use fetch_all. ` +
          'Do not total amounts or conclude that a record is missing from one page.';
      }
    }
  }
  const { pagination, ...rest } = data;
  data = { ...rest, [key]: projectRows(rows, args.fields) };
  return { data, meta: { page: pageMeta } };
}

function blockedByProblems(ctx) {
  return userError(`Qoyod is not configured correctly, so changes are blocked until this is fixed:\n- ${ctx.problems.join('\n- ')}`);
}

async function handleRead(ctx, res, args, extra) {
  let company;
  try {
    const action = args.action;
    if (action !== 'list' && (args.id == null || args.id === '')) throw userError(`"id" is required for action "${action}".`);
    const r = await resolveCompany(ctx, 'read', args, extra, `${action} ${res.title.toLowerCase()}`);
    if (r.ask) return r.ask;
    if (r.confirm) return r.confirm;
    if (r.cancelled) return cancelledResult('read', r.cancelled);
    company = r.company;
    const signal = extra?.signal;
    let data;
    let meta = {};
    if (action === 'get') data = projectGet((await company.client.get(`${res.path}/${enc(args.id)}`, undefined, { signal })).data, args.fields);
    else if (action === 'pdf') data = (await company.client.get(`${res.path}/${enc(args.id)}/pdf`, undefined, { signal })).data;
    else ({ data, meta } = await listRecords(res, company.client, args, signal));
    const companyNote = r.usedMain
      ? `No company was named, so the main company "${company.name}" was used: tell the user this answer is for "${company.name}".`
      : undefined;
    return formatResult({ company, data, meta: { ...meta, remembered: r.remembered, companyNote }, problems: ctx.problems });
  } catch (err) {
    return errorResult(err, company);
  }
}

async function handleWrite(ctx, res, args, extra) {
  let company;
  try {
    const { action } = args;
    if (ctx.problems.length) throw blockedByProblems(ctx);
    const needsId = action === 'update' || action === 'allocate';
    if (needsId && (args.id == null || args.id === '')) throw userError(`"id" is required for action "${action}".`);
    const data = args.data;
    if (data == null || typeof data !== 'object') throw userError('"data" must be an object (see the tool description).');
    if (Array.isArray(data)) {
      if (!data.length) throw userError('"data" is an empty array.');
      if (action === 'create' && !res.bulkCreate) {
        throw userError(`qoyod_write_${res.key} create takes one object: call it once per record (bulk create is only documented for products, product categories, vendors and customers).`);
      }
      if (action !== 'create' && action !== 'allocate') throw userError(`Action "${action}" takes one object, not an array.`);
      if (action === 'allocate' && res.allocate?.style === 'single' && data.length !== 1) {
        throw userError(`qoyod_write_${res.key} allocate takes exactly one allocation per call (got ${data.length}): call it once per document.`);
      }
    }
    const what = `${action} ${res.singular}${needsId ? ` #${args.id}` : ''}`;
    const r = await resolveCompany(ctx, 'write', args, extra, what);
    if (r.ask) return r.ask;
    if (r.confirm) return r.confirm;
    if (r.cancelled) return cancelledResult('write', r.cancelled);
    company = r.company;
    const client = company.client;
    const opts = { signal: extra?.signal };
    const body = expandAliases(data);
    let result;
    switch (action) {
      case 'create':
        result = await client.post(res.path, { [res.envelope]: body }, opts);
        break;
      case 'update': {
        const path = `${res.path}/${enc(args.id)}`;
        const payload = { [res.envelope]: body };
        result = res.updateMethod === 'PATCH' ? await client.patch(path, payload, opts) : await client.put(path, payload, opts);
        break;
      }
      case 'allocate': {
        if (!res.allocate) throw userError(`${res.title} cannot be allocated.`);
        const path = `${res.path}/${enc(args.id)}/allocations`;
        const payload =
          res.allocate.style === 'single'
            ? { [res.allocate.envelope]: Array.isArray(body) ? body[0] : body }
            : { [res.allocate.envelope]: { allocations_attributes: Array.isArray(body) ? body : [body] } };
        result = await client.post(path, payload, opts);
        break;
      }
      case 'adjust':
      case 'transfer': {
        const c = res.custom?.[action];
        if (!c) throw userError(`Unsupported action "${action}".`);
        result = await client.post(c.path, { [c.envelope]: body }, opts);
        break;
      }
      default:
        throw userError(`Unsupported action "${action}".`);
    }
    return formatResult({ company, data: result.data, meta: { remembered: r.remembered, created: action === 'create' ? createdSummary(result.data, res) : undefined } });
  } catch (err) {
    return errorResult(err, company);
  }
}

async function handleDelete(ctx, res, args, extra) {
  let company;
  try {
    if (ctx.problems.length) throw blockedByProblems(ctx);
    if (args.id == null || args.id === '') throw userError('"id" is required.');
    const r = await resolveCompany(ctx, 'delete', args, extra, `delete ${res.singular} #${args.id}`);
    if (r.ask) return r.ask;
    if (r.confirm) return r.confirm;
    if (r.cancelled) return cancelledResult('delete', r.cancelled);
    company = r.company;
    const result = await company.client.delete(`${res.path}/${enc(args.id)}`, { signal: extra?.signal });
    return formatResult({ company, data: result.data, meta: { remembered: r.remembered } });
  } catch (err) {
    return errorResult(err, company);
  }
}

export function normaliseApiPath(p) {
  if (typeof p !== 'string' || !p.trim()) throw userError('"path" is required.');
  const s = p.trim().replace(/^\/+/, '').replace(/^(api\/)?2\.0\//, '');
  const ok = /^[A-Za-z0-9_]+(\/[A-Za-z0-9_.-]+)*$/.test(s) && !s.split('/').some((seg) => seg === '.' || seg === '..');
  if (!ok) {
    throw userError('"path" must be a Qoyod API path such as "invoices" or "invoices/12/pdf": no host, no leading "/2.0", no query string (put parameters in "query").');
  }
  return s;
}

async function handleRequest(ctx, group, args, extra) {
  let company;
  try {
    const path = normaliseApiPath(args.path);
    if (group === 'read') checkScalars(args.query, 'query');
    if (group !== 'read' && ctx.problems.length) throw blockedByProblems(ctx);
    const method = group === 'read' ? 'GET' : group === 'delete' ? 'DELETE' : args.method;
    if (group === 'write' && (!args.body || typeof args.body !== 'object' || Array.isArray(args.body))) throw userError('"body" must be a JSON object including its envelope, e.g. {"bill": {...}}.');
    const r = await resolveCompany(ctx, group, args, extra, `${method} /${path}`);
    if (r.ask) return r.ask;
    if (r.confirm) return r.confirm;
    if (r.cancelled) return cancelledResult(group, r.cancelled);
    company = r.company;
    const opts = { signal: extra?.signal };
    const result =
      group === 'read'
        ? await company.client.request('GET', path, { query: { params: args.query }, ...opts })
        : group === 'delete'
          ? await company.client.request('DELETE', path, opts)
          : await company.client.request(method, path, { body: args.body, ...opts });
    return formatResult({ company, data: result.data, meta: { remembered: r.remembered } });
  } catch (err) {
    return errorResult(err, company);
  }
}

async function handleStatus(ctx, args, extra) {
  if (ctx.setup) return textResult({ configured: false, version: ctx.version, problems: ctx.setup, help: ctx.setupHelp }, true);
  const targets = args.company ? [findCompany(ctx.companies, args.company)] : ctx.companies;
  if (targets.some((t) => !t)) return textResult({ error: `Unknown company "${args.company}".` }, true);
  const companies = await Promise.all(
    targets.map(async (c) => {
      const started = Date.now();
      try {
        const data = (await c.client.get('inventories', undefined, { signal: extra?.signal })).data;
        const key = rowsKey(data);
        const rows = key ? data[key] : [];
        return { company: c.name, key_variable: c.keyVar, connected: true, warehouses: rows.slice(0, 5).map((w) => w?.name ?? w?.ar_name).filter(Boolean), ms: Date.now() - started };
      } catch (err) {
        if (isFoundNothing(err)) return { company: c.name, key_variable: c.keyVar, connected: true, warehouses: [], ms: Date.now() - started };
        return { company: c.name, key_variable: c.keyVar, connected: false, error: err.status === 401 ? 'Qoyod rejected this API key (401).' : err.message, ms: Date.now() - started };
      }
    }),
  );
  return textResult({
    version: ctx.version,
    companies,
    main_read_company: defaultCompany(ctx.settings, ctx.companies, ctx.env, 'read')?.name ?? null,
    main_company_for_changes: defaultCompany(ctx.settings, ctx.companies, ctx.env, 'write')?.name ?? null,
    hint: 'Warehouse names help confirm that each API key opens the right company\'s books.',
    ...(ctx.problems.length ? { config_problems: ctx.problems } : {}),
    ...(ctx.warnings.length ? { warnings: ctx.warnings } : {}),
  });
}

function handleSettings(ctx, args) {
  try {
    const scope = args.applies_to ?? 'reads';
    const keys =
      scope === 'all' ? ['default_read_company', 'default_write_company'] : scope === 'changes' ? ['default_write_company'] : ['default_read_company'];
    if (args.action === 'set_main_company') {
      const c = findCompany(ctx.companies, args.company);
      if (!c) throw userError(`Unknown company "${args.company ?? ''}". Configured: ${ctx.companies.map((x) => `"${x.name}"`).join(', ')}.`);
      ctx.settings.update(Object.fromEntries(keys.map((k) => [k, c.name])));
      return textResult({
        ok: true,
        main_company: c.name,
        applies_to: scope,
        note: 'Reads without a company use it and say which company; changes without a company first tell the user the company.',
      });
    }
    if (args.action === 'clear_main_company') {
      ctx.settings.update(Object.fromEntries(keys.map((k) => [k, undefined])));
      return textResult({ ok: true, cleared: scope, note: 'Calls without a company will ask the user again.' });
    }
    const sw = ctx.switches;
    return textResult({
      companies: ctx.companies.map((c) => c.name),
      main_read_company: defaultCompany(ctx.settings, ctx.companies, ctx.env, 'read')?.name ?? null,
      main_company_for_changes: defaultCompany(ctx.settings, ctx.companies, ctx.env, 'write')?.name ?? null,
      confirm_company_for_changes: sw.confirmWrites,
      toolsets: [...sw.toolsets],
      writes_allowed_for: [...sw.writes],
      deletes_allowed_for: [...sw.deletes],
      settings_file: ctx.settings.file,
      ...(ctx.problems.length ? { config_problems: ctx.problems } : {}),
      ...(ctx.setup ? { setup_problems: ctx.setup } : {}),
    });
  } catch (err) {
    return errorResult(err);
  }
}

// ---- descriptions and registration -----------------------------------------------------

function readDescription(res) {
  const list = res.readActions.includes('list')
    ? ` list returns one page and a "_page" summary; options: per_page (default ${res.perPage}), sort ("field asc|desc"), q, fetch_all (all pages, max ${FETCH_ALL_MAX_ROWS} rows), fields (keep only these fields).`
    : '';
  return `Read-only. ${res.title} in Qoyod. Actions: ${res.readActions.join(', ')}.${list} ${res.readNotes}`.trim();
}

function writeDescription(res) {
  return `Changes the live Qoyod books. ${res.title}. Actions: ${res.writeActions.join(', ')}. Fields marked * are required. ${res.writeDoc}`;
}

function deleteDescription(res) {
  const sales = res.toolset === 'sales' ? ' Sales documents may already be reported to ZATCA.' : '';
  return `Deletes one ${res.singular} by id from the live Qoyod books. This cannot be undone. Qoyod decides whether the record can still be deleted.${sales}`;
}

export function buildInstructions(ctx) {
  if (ctx.setup) return `Qoyod accounting (unofficial MCP server) is NOT set up yet. Call qoyod_read_status and show the user its "help" text. ${ctx.setupHelp}`;
  const names = ctx.companies.map((c) => `"${c.name}"`).join(', ');
  const sw = ctx.switches;
  const lines = [
    'Qoyod accounting (unofficial MCP server). Tool groups: qoyod_read_* (read-only), qoyod_write_* (create, update, allocate: changes the live books), qoyod_delete_* (deletes).',
    ctx.companies.length > 1
      ? `Companies: ${names}. Every call targets one company and record ids belong to one company: never reuse an id read from another company. ` +
        'Pass "company" whenever the user named one. Without it, reads use the saved main company (tell the user which company the answer is for) or the user is asked; ' +
        'changes make you tell the user the main company for changes first, or the user is asked. ' +
        'If a tool answers "ACTION NEEDED" or "CONFIRM COMPANY", do exactly what it says and never choose a company yourself.'
      : `Company: ${names}.`,
    'Filters (q, Ransack): _eq _not_eq _cont _start _end _gt _gteq _lt _lteq _in _null, e.g. {"issue_date_gteq":"2026-01-01","status_eq":"Approved"}. ' +
      'name_cont works on customers and vendors (search before creating a contact); products and accounts cannot be filtered by name (use sku_cont / code_start). ' +
      'Receipts and payment lists accept kind_eq "paid" or "received".',
    'Paging: a list returns one page and a "_page" summary. Never total amounts or conclude that a record is missing from one page: follow "_page.next", use fetch_all, or narrow with q. ' +
      'Journal entries: always filter by date.',
    'Dates are yyyy-mm-dd. Use status "Draft" for new documents unless the user asked to approve. If a write fails with "may_already_be_saved", do not resend it: check with a read first. ' +
      'Sales invoices, credit notes and receipts feed ZATCA e-invoicing. The Qoyod API cannot edit invoices, bills, payments or journal entries after creation, and cannot delete customers, vendors, products or accounts.',
  ];
  const restricted = [];
  if (sw.toolsets.size < TOOLSETS.length) restricted.push(`only these toolsets are enabled: ${[...sw.toolsets].join(', ') || 'none'}`);
  if (sw.writes.size < TOOLSETS.length) restricted.push(`writes are allowed only for: ${[...sw.writes].join(', ') || 'nothing'}`);
  if (sw.deletes.size < TOOLSETS.length) restricted.push(`deletes are allowed only for: ${[...sw.deletes].join(', ') || 'nothing'}`);
  if (restricted.length) lines.push(`The owner restricted this server: ${restricted.join('; ')}.`);
  if (ctx.problems.length) lines.push(`Configuration problems (changes are blocked): ${ctx.problems.join(' ')}`);
  return lines.join('\n');
}

export function registerTools(server, baseCtx) {
  const ctx = { ...baseCtx, server };
  const names = [];
  const reg = (name, config, handler) => {
    server.registerTool(name, config, handler);
    names.push(name);
  };
  const READ = { readOnlyHint: true };

  reg(
    'qoyod_read_status',
    {
      title: 'Read: connection status',
      description: 'Read-only. Checks each configured Qoyod company (one small request each): is the API key accepted, and which warehouses does it see. Also reports setup or configuration problems.',
      inputSchema: ctx.companies.length > 1 ? { company: companySchema(ctx, 'read') } : {},
      annotations: READ,
    },
    (args, extra) => handleStatus(ctx, args ?? {}, extra),
  );
  const registerSettings = () => reg(
    'qoyod_settings',
    {
      title: 'Settings: main company',
      description:
        'Local setting on this computer (no Qoyod request); change it only when the user asks. show: companies, main companies and enabled tool groups. ' +
        'set_main_company (company, applies_to "reads" | "changes" | "all"): calls without a company then use it (reads say which company; changes first tell the user). ' +
        'clear_main_company (applies_to): ask the user again.',
      inputSchema: {
        action: z.enum(['show', 'set_main_company', 'clear_main_company']),
        company: z.string().optional(),
        applies_to: z.enum(['reads', 'changes', 'all']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => handleSettings(ctx, args ?? {}),
  );
  if (ctx.setup) {
    registerSettings();
    return names;
  }

  const sw = ctx.switches;
  const active = RESOURCES.filter((r) => sw.toolsets.has(r.toolset));
  const allToolsets = TOOLSETS.every((t) => sw.toolsets.has(t));

  for (const res of active) {
    reg(
      `qoyod_read_${res.key}`,
      { title: `Read: ${res.title}`, description: readDescription(res), inputSchema: readSchema(ctx, res), annotations: READ },
      (args, extra) => handleRead(ctx, res, args, extra),
    );
  }
  if (allToolsets) {
    reg(
      'qoyod_read_request',
      {
        title: 'Read: raw API request (GET)',
        description:
          'Read-only. Sends a GET to any Qoyod API path, for anything the other read tools do not cover. path: e.g. "projects" or "invoices/12". ' +
          'query: parameters exactly as Qoyod expects them, e.g. {"q[date_gteq]":"2026-01-01","page":2}. Prefer the specific qoyod_read_* tools.',
        inputSchema: {
          company: companySchema(ctx, 'read'),
          path: z.string().describe('API path after /2.0/, e.g. "invoices/12/pdf"'),
          query: z.preprocess(jsonish, recordSchema).optional(),
        },
        annotations: READ,
      },
      (args, extra) => handleRequest(ctx, 'read', args, extra),
    );
  }

  for (const res of active) {
    if (!res.writeActions?.length || !sw.writes.has(res.toolset)) continue;
    reg(
      `qoyod_write_${res.key}`,
      {
        title: `Write: ${res.title}`,
        description: writeDescription(res),
        inputSchema: writeSchema(ctx, res),
        annotations: { readOnlyHint: false, destructiveHint: res.writeActions.some((a) => ['update', 'adjust', 'allocate'].includes(a)), idempotentHint: false },
      },
      (args, extra) => handleWrite(ctx, res, args, extra),
    );
  }
  if (allToolsets && TOOLSETS.every((t) => sw.writes.has(t))) {
    reg(
      'qoyod_write_request',
      {
        title: 'Write: raw API request (POST/PUT/PATCH)',
        description:
          'Changes the live Qoyod books. Sends a POST, PUT or PATCH to any Qoyod API path, for anything the qoyod_write_* tools do not cover. ' +
          'body must include the envelope, e.g. {"bill": {...}}. Prefer the specific qoyod_write_* tools.',
        inputSchema: {
          company: companySchema(ctx, 'write'),
          method: z.enum(['POST', 'PUT', 'PATCH']),
          path: z.string().describe('API path after /2.0/'),
          body: z.preprocess(jsonish, recordSchema).describe('JSON body including its envelope'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      (args, extra) => handleRequest(ctx, 'write', args, extra),
    );
  }

  for (const res of active) {
    if (!res.canDelete || !sw.deletes.has(res.toolset)) continue;
    reg(
      `qoyod_delete_${res.key}`,
      {
        title: `Delete: ${res.title}`,
        description: deleteDescription(res),
        inputSchema: { company: companySchema(ctx, 'delete'), id: idSchema() },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      (args, extra) => handleDelete(ctx, res, args, extra),
    );
  }
  if (allToolsets && TOOLSETS.every((t) => sw.deletes.has(t))) {
    reg(
      'qoyod_delete_request',
      {
        title: 'Delete: raw API request (DELETE)',
        description: 'Deletes through any Qoyod API path, for anything the qoyod_delete_* tools do not cover. This cannot be undone. Prefer the specific qoyod_delete_* tools.',
        inputSchema: { company: companySchema(ctx, 'delete'), path: z.string().describe('API path after /2.0/, e.g. "bills/12"') },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      (args, extra) => handleRequest(ctx, 'delete', args, extra),
    );
  }
  registerSettings(); // last, so the read / write / delete groups stay together in tool lists
  return names;
}

export { RESOURCES };
