// The 19 Qoyod resource tools. One tool per resource type (matching the
// "19 resource types" in https://apidoc.qoyod.com/), each with an `action`.
import { z } from 'zod';
import { expandAliases } from './client.js';

const MAX_OUTPUT_CHARS = 80_000;

const LINE_ITEMS_DOC =
  'line_items[] (required): product_id*, quantity*, unit_price*, description, unit_type (unit id, defaults to product base unit), ' +
  'discount, discount_type ("percentage" default | "amount"), tax_percent (e.g. 15), is_inclusive (true if unit_price already includes VAT).';
const DOC_DISCOUNT_DOC =
  'Optional document-level discount: inclusive_cd_discount (amount >= 0; org setting "Total CD Discount" must be enabled), ' +
  'discount_account_id + discount_tax_id (both required when a discount is applied).';
const CUSTOM_FIELDS_DOC = 'custom_fields: object {fieldName: value} for custom fields already defined in Qoyod settings.';
const DATES_DOC = 'Dates are "yyyy-mm-dd".';
const LIST_DOC =
  'action "list": optional page, per_page, sort ("field asc|desc", e.g. "issue_date desc"), and q = Ransack filters, e.g. {"issue_date_gteq":"2025-01-01"}, {"code_start":"53"}, {"status_eq":"Draft"}, {"contact_id_eq":5}, {"id_in":[1,2]}. ' +
  'Predicates: _eq _not_eq _cont _start _end _gt _gteq _lt _lteq _in _null. Qoyod silently ignores filters on some fields (notably text _cont on names and "type"), so if a filter seems ignored, list without q and filter the results yourself. ' +
  'An empty result is returned as an empty array (Qoyod itself answers 404 "found nothing"). per_page is honoured only on some endpoints; others return everything.';

// ---- resource definitions ------------------------------------------------

const RESOURCES = [
  {
    name: 'qoyod_accounts', title: 'Qoyod Accounts (chart of accounts)', path: 'accounts', envelope: 'account',
    actions: ['list', 'get', 'create'],
    doc:
      'Chart of accounts. create data: name_en*, name_ar*, code* (all unique), type*, receive_payments* ("true"/"false" - allow receipts on this account), description. ' +
      'type is one of: FixedAsset, CurrentAsset, Bank, Cash, Inventory, Liability, CurrentLiability, NoncurrentLiability, Depreciation, DirectCost, Expense, Overhead, Equity, OtherIncome, Revenue, Sale.',
  },
  {
    name: 'qoyod_products', title: 'Qoyod Products & Services', path: 'products', envelope: 'product', updateMethod: 'PUT',
    actions: ['list', 'get', 'create', 'update'],
    doc:
      'Products, services, expenses, raw materials and recipes. create data (pass an array for bulk create): sku*, name_ar*, name_en*, product_unit_type_id*, category_id*, tax_id* (1=15% VAT, 2=0% VAT, 3=Tax exempt, or a custom tax id), ' +
      'barcode, description, type ("Product" default | "Service" | "Expense" | "RawMaterial" | "Recipe"), track_quantity (1 = inventory item), ' +
      'purchase_item (1) + buying_price + expense_account_id (COGS/purchases account), sale_item (1) + selling_price + sales_account_id, ' +
      'special_tax_reason_id (only for 0%/exempt: 1-11 zero-rated reasons, 12-14 exempt reasons), ' +
      'ingredients_attributes[] {component_id, unit_id, quantity} for recipes, unit_conversions[] {from_unit*, rate* (1 from_unit = rate base units), unit_purchase_price, unit_selling_price, barcode}. ' +
      'update: only send fields to change (sku, barcode, name_ar, name_en, description, category_id, ingredients_attributes, unit_conversions). Stock quantities cannot be set here - use qoyod_inventories action "adjust". ' +
      'Responses include per-warehouse "inventories" with current stock.',
  },
  {
    name: 'qoyod_inventories', title: 'Qoyod Inventories / Warehouses & stock adjustments', path: 'inventories', envelope: 'inventory', updateMethod: 'PATCH',
    actions: ['list', 'get', 'create', 'update', 'adjust', 'transfer'],
    doc:
      'Warehouses/locations plus stock movements. create data: name*, ar_name*, account_id* (an account of type Inventory), address {shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country}. update: only fields to change. ' +
      'action "adjust" (POST /inventory_adjustments) data: inventory_id*, revenue_account_id* (Revenue-type account, used when qty increases), expense_account_id* (Expense-type account, used when qty decreases), date*, description*, ' +
      'line_items[] {product_id*, actual_quantity* (the ABSOLUTE new stock count, not a delta), rate* (inventory value per unit)}. ' +
      'action "transfer" (POST /inventory_transfers) data: from_location*, to_location* (inventory ids), date*, description*, transfer_account (defaults to Inventory account id 10), line_items[] {product_id*, quantity*}.',
    custom: {
      adjust: (c, { data }) => c.post('inventory_adjustments', { inventory_adjustment: data }),
      transfer: (c, { data }) => c.post('inventory_transfers', { inventory_transfer: data }),
    },
  },
  {
    name: 'qoyod_product_categories', title: 'Qoyod Product Categories', path: 'categories', envelope: 'category', updateMethod: 'PUT',
    actions: ['list', 'get', 'create', 'update'],
    doc: 'Product categories. create data (array allowed for bulk): name*, description, parent_id (id of parent category). update: only fields to change.',
  },
  {
    name: 'qoyod_product_units', title: 'Qoyod Product Unit Types', path: 'product_unit_types', envelope: 'product_unit_type',
    actions: ['list', 'get', 'create'],
    doc: 'Units of measure. create data: unit_name*, unit_representation* (short symbol), kind (1=Unit, 2=Weight, 3=Working Time, 4=Length/Distance, 5=Area, 6=Volume).',
  },
  {
    name: 'qoyod_vendors', title: 'Qoyod Vendors (suppliers)', path: 'vendors', envelope: 'contact', updateMethod: 'PUT',
    actions: ['list', 'get', 'create', 'update'],
    doc:
      'Suppliers. create data (array allowed for bulk): name*, organization, phone_number, email, secondary_email, tax_number, status ("Active" default | "Inactive"), commission_id, linked_contact_id (+ link_to_contact), currency_code. ' +
      'update: only fields to change. Vendor ids are used as contact_id on purchase orders, bills, simple bills, debit notes and receipts of kind "paid".',
  },
  {
    name: 'qoyod_purchase_orders', title: 'Qoyod Purchase Orders', path: 'orders', envelope: 'order',
    actions: ['list', 'get', 'create'],
    doc:
      `Purchase orders to vendors. create data: contact_id* (vendor), issue_date*, expiry_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC}`,
  },
  {
    name: 'qoyod_bills', title: 'Qoyod Bills (purchase invoices)', path: 'bills', envelope: 'bill',
    actions: ['list', 'get', 'create', 'delete', 'allocate'],
    doc:
      `Vendor bills. create data: contact_id* (vendor), status* ("Draft" | "Approved"), issue_date*, due_date*, inventory_id*, reference (unique; auto-generated if omitted), ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC} ` +
      'action "allocate" (id = bill id) applies an existing debit note or receipt to the bill: data = {source_type: "DebitNote" | "Receipt", source_id, amount, date} or an array of those. To record a payment use qoyod_bill_payments.',
    allocate: { envelope: 'bill', style: 'attributes' },
  },
  {
    name: 'qoyod_bill_payments', title: 'Qoyod Bill Payments', path: 'bill_payments', envelope: 'bill_payment',
    actions: ['list', 'get', 'create'],
    doc: 'Payments against bills. create data: reference* (unique), bill_id*, account_id* (the bank/cash account debited), date*, amount*, description. ' + DATES_DOC,
  },
  {
    name: 'qoyod_simple_bills', title: 'Qoyod Simple Bills (expense bills)', path: 'simple_bills', envelope: 'simple_bill', updateMethod: 'PATCH',
    actions: ['list', 'get', 'create', 'update', 'delete', 'allocate'],
    doc:
      'Expense bills without products. create data: contact_id* (vendor), status* ("Draft" | "Approved"), issue_date*, inventory_id*, reference (unique), ' +
      'simple_bill_items_attributes[]* {expense_category_id* (expense account id), total_amount*, tax_id* (1=15% VAT, 2=0%, 3=exempt), description, is_inclusive}, ' +
      `${CUSTOM_FIELDS_DOC} update: only fields to change. ${DATES_DOC} ` +
      'action "allocate" (id = simple bill id): data = {source_type: "DebitNote" | "Receipt", source_id, amount, date}. To record a payment use qoyod_simple_bill_payments.',
    allocate: { envelope: 'simple_bill', style: 'attributes' },
  },
  {
    name: 'qoyod_simple_bill_payments', title: 'Qoyod Simple Bill Payments', path: 'simple_bill_payments', envelope: 'simple_bill_payment',
    actions: ['list', 'get', 'create'],
    doc: 'Payments against simple bills. create data: reference* (unique), simple_bill_id*, account_id* (account debited), date*, amount*, description. ' + DATES_DOC,
  },
  {
    name: 'qoyod_debit_notes', title: 'Qoyod Debit Notes (purchase returns)', path: 'debit_notes', envelope: 'debit_note',
    actions: ['list', 'get', 'create', 'delete'],
    doc:
      `Returns to vendors. create data: contact_id* (vendor), issue_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, draft_if_out_of_stock (true => save as Draft instead of erroring), ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC}`,
  },
  {
    name: 'qoyod_customers', title: 'Qoyod Customers', path: 'customers', envelope: 'contact', updateMethod: 'PUT',
    actions: ['list', 'get', 'create', 'update'],
    doc:
      'Customers. create data (array allowed for bulk): name*, organization, phone_number, secondary_phone_number, email, secondary_email, tax_number, status ("Active" default | "Inactive"), currency_code, commission_id, linked_contact_id (+ link_to_contact), ' +
      'shipping_address {shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country}, billing_address {billing_address, billing_city, billing_state, billing_zip, billing_country, building_number}. ' +
      'update: only fields to change. Customer ids are used as contact_id on quotes, invoices, credit notes and receipts of kind "received".',
  },
  {
    name: 'qoyod_quotes', title: 'Qoyod Quotes / Estimates', path: 'quotes', envelope: 'quote',
    actions: ['list', 'get', 'create'],
    doc:
      `Sales quotations. create data: contact_id* (customer), quotation_number* (unique), issue_date*, expiry_date*, status* ("Draft" | "Approved"), inventory_id*, notes, terms_conditions, ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC}`,
  },
  {
    name: 'qoyod_invoices', title: 'Qoyod Sales Invoices', path: 'invoices', envelope: 'invoice',
    actions: ['list', 'get', 'create', 'delete', 'allocate', 'pdf'],
    doc:
      `Sales invoices. create data: contact_id* (customer), status* ("Draft" | "Approved"), issue_date*, due_date*, inventory_id*, reference (unique; auto-generated if omitted), description, draft_if_out_of_stock, ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC} ` +
      'Tracked products cannot be invoiced beyond available stock. action "pdf" (id) returns a temporary download link. ' +
      'action "allocate" (id = invoice id): data = {source_type: "CreditNote" | "Receipt", source_id, amount, date}. To record a payment use qoyod_invoice_payments.',
    allocate: { envelope: 'invoice', style: 'attributes' },
    custom: { pdf: (c, { id }) => c.get(`invoices/${encodeURIComponent(String(id))}/pdf`) },
  },
  {
    name: 'qoyod_invoice_payments', title: 'Qoyod Invoice Payments', path: 'invoice_payments', envelope: 'invoice_payment',
    actions: ['list', 'get', 'create'],
    doc: 'Payments received against invoices. create data: reference* (unique), invoice_id*, account_id* (the bank/cash account credited), date*, amount*, description. ' + DATES_DOC,
  },
  {
    name: 'qoyod_credit_notes', title: 'Qoyod Credit Notes (sales returns)', path: 'credit_notes', envelope: 'credit_note',
    actions: ['list', 'get', 'create', 'delete'],
    doc:
      `Returns from customers. create data: contact_id* (customer), issue_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, ${LINE_ITEMS_DOC} ${DOC_DISCOUNT_DOC} ${CUSTOM_FIELDS_DOC} ${DATES_DOC}`,
  },
  {
    name: 'qoyod_receipts', title: 'Qoyod Receipts (money received / paid)', path: 'receipts', envelope: 'receipt',
    actions: ['list', 'get', 'create', 'delete', 'allocate'],
    doc:
      'Standalone receipts and payment vouchers. create data: contact_id*, reference* (unique), kind* ("received" from a customer | "paid" to a vendor), account_id* (bank/cash account), amount*, date*, description. ' +
      `${DATES_DOC} action "allocate" (id = receipt id) applies the receipt to a document: data = {allocatee_type: "Invoice" | "Bill" | "CreditNote" | "DebitNote", allocatee_id, amount}.`,
    allocate: { envelope: 'allocation', style: 'single' },
  },
  {
    name: 'qoyod_journal_entries', title: 'Qoyod Journal Entries', path: 'journal_entries', envelope: 'journal_entry',
    actions: ['list', 'get', 'create'],
    doc:
      'Manual journal entries. create data: description*, date*, debit_amounts[]* {account_id*, amount*, contact_id, comment}, credit_amounts[]* {account_id*, amount*, contact_id, comment}. ' +
      'Debits must equal credits. contact_id: customers only on the receivables account (id 9), vendors only on the payables account (id 14). ' + DATES_DOC,
  },
];

// ---- generic action dispatch --------------------------------------------

function requireId(args, action) {
  if (args.id == null || args.id === '') throw new Error(`"id" is required for action "${action}"`);
  return encodeURIComponent(String(args.id));
}

function requireData(args, action) {
  if (args.data == null) throw new Error(`"data" is required for action "${action}"`);
  return expandAliases(args.data);
}

async function dispatch(res, client, args) {
  const { action } = args;
  if (res.custom?.[action]) {
    if (action === 'pdf') requireId(args, action);
    const data = action === 'adjust' || action === 'transfer' ? requireData(args, action) : args.data;
    return res.custom[action](client, { ...args, data });
  }
  switch (action) {
    case 'list':
      try {
        return await client.get(res.path, { page: args.page, per_page: args.per_page, q: args.q, sort: args.sort });
      } catch (err) {
        // Qoyod answers an empty list with 404 "We could not retrieve your X, we found nothing."
        if (err.status === 404) return { status: 200, data: { [res.path]: [], message: err.body?.message ?? 'No records found', http_status: 404 } };
        throw err;
      }
    case 'get':
      return client.get(`${res.path}/${requireId(args, action)}`);
    case 'create':
      return client.post(res.path, { [res.envelope]: requireData(args, action) });
    case 'update': {
      const id = requireId(args, action);
      const body = { [res.envelope]: requireData(args, action) };
      return res.updateMethod === 'PATCH' ? client.patch(`${res.path}/${id}`, body) : client.put(`${res.path}/${id}`, body);
    }
    case 'delete':
      return client.delete(`${res.path}/${requireId(args, action)}`);
    case 'allocate': {
      const id = requireId(args, action);
      const data = requireData(args, action);
      const body = res.allocate.style === 'single'
        ? { [res.allocate.envelope]: Array.isArray(data) ? data[0] : data }
        : { [res.allocate.envelope]: { allocations_attributes: Array.isArray(data) ? data : [data] } };
      return client.post(`${res.path}/${id}/allocations`, body);
    }
    default:
      throw new Error(`Unsupported action "${action}" for ${res.name}`);
  }
}

function formatResult({ status, data }, companyName) {
  let text = (companyName ? `Company: ${companyName}\n` : '') + JSON.stringify(data, null, 2);
  if (text.length > MAX_OUTPUT_CHARS) {
    text = text.slice(0, MAX_OUTPUT_CHARS) +
      `\n... [truncated: response was ${text.length} characters. Use per_page/page, or q filters, to narrow the result]`;
  }
  return { content: [{ type: 'text', text }], _meta: { httpStatus: status } };
}

const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'allocate', 'adjust', 'transfer']);

function inputSchemaFor(res, companies) {
  return {
    action: z.enum(res.actions).describe(`One of: ${res.actions.join(', ')}`),
    ...(companies.length > 1
      ? {
          company: z.enum(companies.map((c) => c.name)).optional().describe(
            `Which Qoyod company to act on. Default for read actions: "${companies[0].name}". REQUIRED for create/update/delete/allocate/adjust/transfer.`,
          ),
        }
      : {}),
    id: z.union([z.number().int(), z.string()]).optional().describe('Record id (for get / update / delete / allocate / pdf)'),
    page: z.number().int().min(1).optional().describe('list: page number (1-based)'),
    per_page: z.number().int().min(1).max(500).optional().describe('list: results per page (default 50)'),
    q: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]))
      .optional().describe('list: Ransack filters, e.g. {"name_cont":"acme","status_eq":"Approved"}'),
    sort: z.string().optional().describe('list: sort expression, e.g. "issue_date desc"'),
    data: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
      .optional().describe('Body fields for create / update / allocate / adjust / transfer (see tool description). An array means bulk create where supported.'),
  };
}

// Resolve which company's client handles this call.
function pickCompany(companies, args) {
  if (companies.length === 1) return companies[0];
  if (args.company) {
    const hit = companies.find((c) => c.name.toLowerCase() === String(args.company).toLowerCase());
    if (!hit) throw new Error(`Unknown company "${args.company}". Configured: ${companies.map((c) => c.name).join(', ')}`);
    return hit;
  }
  if (WRITE_ACTIONS.has(args.action)) {
    throw new Error(`More than one company is configured (${companies.map((c) => c.name).join(', ')}); pass "company" for action "${args.action}".`);
  }
  return companies[0];
}

export function registerTools(server, companies) {
  const companyDoc = companies.length > 1
    ? `Companies configured: ${companies.map((c, i) => (i === 0 ? `"${c.name}" (default for reads)` : `"${c.name}"`)).join(', ')} - pass company=... (mandatory for any write). `
    : '';
  for (const res of RESOURCES) {
    const description = `${res.title}. Actions: ${res.actions.join(', ')}. ${companyDoc}${LIST_DOC} ${res.doc}`;
    server.registerTool(
      res.name,
      {
        title: res.title,
        description,
        inputSchema: inputSchemaFor(res, companies),
        annotations: {
          readOnlyHint: false,
          destructiveHint: res.actions.includes('delete'),
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const company = pickCompany(companies, args);
          const query = { ...args };
          if (args.action === 'list' && args.per_page == null) query.per_page = 50;
          const result = await dispatch(res, company.client, query);
          return formatResult(result, companies.length > 1 ? company.name : null);
        } catch (err) {
          const detail = err.body != null ? `\n${JSON.stringify(err.body, null, 2)}` : '';
          return { isError: true, content: [{ type: 'text', text: `${err.message}${detail}` }] };
        }
      },
    );
  }
  return RESOURCES.length;
}

export { RESOURCES };
