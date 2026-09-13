// The Qoyod resources: the 19 documented resource types of https://apidoc.qoyod.com/ plus the read-only
// taxes list. Each resource becomes up to three tools: qoyod_read_<key>, qoyod_write_<key>, qoyod_delete_<key>.
//
// paging: 'server'  = Qoyod honours page/per_page (verified live)
//         'none'    = Qoyod ignores paging and returns every row; this server pages locally
//         'unknown' = not verified; page/per_page are sent, and local paging kicks in if Qoyod ignores them

const DATES = 'Dates are "yyyy-mm-dd".';
const LINE_ITEMS =
  'line_items[]*: {product_id*, quantity*, unit_price*, description, unit_type (unit id; default = product base unit), ' +
  'discount, discount_type ("percentage" default | "amount"), tax_percent (e.g. 15), is_inclusive (true if unit_price includes VAT)}.';
const CREDIT_LINE_ITEMS =
  'line_items[]*: {product_id*, quantity*, unit_price*, description, discount_percent, tax_percent (e.g. 15), is_inclusive}.';
const DOC_DISCOUNT =
  'Optional document discount: inclusive_cd_discount (amount >= 0; needs the Qoyod setting "Total CD Discount") with discount_account_id + discount_tax_id.';
const CUSTOM_FIELDS = 'custom_fields: {fieldName: value} for custom fields already defined in Qoyod.';
const TAX_IDS = 'tax_id*: 1 = 15% VAT, 2 = 0% VAT, 3 = exempt, or a company tax id from qoyod_read_taxes';
const RECEIPT_VIEW =
  'Qoyod returns receipt records here (envelope "receipts", same ids as qoyod_read_receipts): never add these rows to receipt totals. kind filter: {"kind_eq":"paid"} or "received".';

export const RESOURCES = [
  {
    key: 'accounts', title: 'Chart of accounts', singular: 'account', path: 'accounts', envelope: 'account',
    toolset: 'accounting', paging: 'none', perPage: 50, localTypeFilter: true,
    readActions: ['list', 'get'],
    readNotes:
      'Qoyod returns every account (paged locally here). In list rows "type" is only the parent class (Asset, Liability, Equity, Revenue, Expense); ' +
      'type_* filters are applied by this tool. Names are not filterable: use code_start (e.g. {"code_start":"53"}).',
    writeActions: ['create'],
    writeDoc:
      'create data: name_en*, name_ar*, code* (all unique), type*, receive_payments* ("true"/"false": allow receipts on this account), description. ' +
      'type: FixedAsset, CurrentAsset, Bank, Cash, Inventory, Liability, CurrentLiability, NoncurrentLiability, Depreciation, DirectCost, Expense, Overhead, Equity, OtherIncome, Revenue, Sale. ' +
      'Accounts cannot be edited or deleted through the API.',
  },
  {
    key: 'products', title: 'Products & services', singular: 'product', path: 'products', envelope: 'product',
    toolset: 'inventory', paging: 'server', perPage: 50, bulkCreate: true, updateMethod: 'PUT',
    readActions: ['list', 'get'],
    readNotes: 'Rows include per-warehouse stock ("inventories"). Names are not filterable: use sku_cont or barcode_eq.',
    writeActions: ['create', 'update'],
    writeDoc:
      `create data (an array = bulk create): sku*, name_ar*, name_en*, product_unit_type_id*, category_id*, ${TAX_IDS}, barcode, description, ` +
      'type ("Product" default | "Service" | "Expense" | "RawMaterial" | "Recipe"), track_quantity (1 = inventory item), ' +
      'purchase_item (1) + buying_price + expense_account_id, sale_item (1) + selling_price + sales_account_id, ' +
      'special_tax_reason_id (0%/exempt only: 1-11 zero-rated reasons, 12-14 exempt reasons), ingredients_attributes[] {component_id, unit_id, quantity} for recipes, ' +
      'unit_conversions[] {from_unit*, rate* (1 from_unit = rate base units), unit_purchase_price, unit_selling_price, barcode}. ' +
      'update (id): send only fields to change; documented updatable fields: sku, barcode, name_ar, name_en, description, category_id, ingredients_attributes, unit_conversions. ' +
      'Tracking, unit and sales account cannot change once the product is on invoices or bills. Stock cannot be set here (use qoyod_write_inventories action "adjust"). ' +
      'After an update, compare the returned product with what you sent: Qoyod may ignore undocumented keys. Products cannot be deleted through the API.',
  },
  {
    key: 'inventories', title: 'Warehouses & stock movements', singular: 'warehouse', path: 'inventories', envelope: 'inventory',
    toolset: 'inventory', paging: 'none', perPage: 50, updateMethod: 'PATCH',
    readActions: ['list', 'get'],
    readNotes: 'Qoyod returns every warehouse.',
    writeActions: ['create', 'update', 'adjust', 'transfer'],
    writeDoc:
      'create data: name*, ar_name*, account_id* (an Inventory-type account), address {shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country}. update (id): only fields to change. ' +
      'action "adjust" (no id) data: inventory_id*, revenue_account_id* (Revenue account, used when stock goes up), expense_account_id* (Expense account, used when stock goes down), date*, description*, ' +
      'line_items[]* {product_id*, actual_quantity* (the NEW TOTAL stock count, not a difference), rate* (value per unit)}. ' +
      'action "transfer" (no id) data: from_location*, to_location* (warehouse ids), date*, description*, transfer_account (optional; default = the default Inventory account), line_items[]* {product_id*, quantity*}. ' +
      `Adjustments and transfers cannot be listed or deleted afterwards. ${DATES}`,
    custom: {
      adjust: { path: 'inventory_adjustments', envelope: 'inventory_adjustment' },
      transfer: { path: 'inventory_transfers', envelope: 'inventory_transfer' },
    },
  },
  {
    key: 'product_categories', title: 'Product categories', singular: 'category', path: 'categories', envelope: 'category',
    toolset: 'inventory', paging: 'none', perPage: 50, bulkCreate: true, updateMethod: 'PUT',
    readActions: ['list', 'get'],
    readNotes: 'Qoyod returns every category.',
    writeActions: ['create', 'update'],
    writeDoc: 'create data (an array = bulk create): name*, description, parent_id (parent category id). update (id): only fields to change.',
  },
  {
    key: 'product_units', title: 'Units of measure', singular: 'unit', path: 'product_unit_types', envelope: 'product_unit_type',
    toolset: 'inventory', paging: 'none', perPage: 50,
    readActions: ['list', 'get'],
    readNotes: 'Qoyod returns every unit.',
    writeActions: ['create'],
    writeDoc: 'create data: unit_name*, unit_representation* (short symbol), kind (integer: 1 Unit, 2 Weight, 3 Working time, 4 Length/distance, 5 Area, 6 Volume).',
  },
  {
    key: 'taxes', title: 'Taxes', singular: 'tax', path: 'taxes', envelope: 'tax',
    toolset: 'accounting', paging: 'server', perPage: 50,
    readActions: ['list'],
    readNotes: 'The company\'s taxes (ids and rates) for tax_id / discount_tax_id. Undocumented Qoyod endpoint: works today, may change.',
  },
  {
    key: 'vendors', title: 'Vendors (suppliers)', singular: 'vendor', path: 'vendors', envelope: 'contact',
    toolset: 'purchases', paging: 'none', perPage: 50, bulkCreate: true, updateMethod: 'PUT',
    readActions: ['list', 'get'],
    readNotes: 'Qoyod returns every vendor (paged locally here). Find a vendor with q {"name_cont":"..."} or {"tax_number_eq":"..."}.',
    writeActions: ['create', 'update'],
    writeDoc:
      'Search with qoyod_read_vendors before creating, to avoid duplicates. create data (an array = bulk create): name*, organization, phone_number, email, secondary_email, tax_number, ' +
      'status ("Active" default | "Inactive"), commission_id, linked_contact_id (+ link_to_contact), currency_code. update (id): only fields to change. Vendors cannot be deleted through the API.',
  },
  {
    key: 'purchase_orders', title: 'Purchase orders', singular: 'purchase order', path: 'orders', envelope: 'order',
    toolset: 'purchases', paging: 'unknown', perPage: 20,
    readActions: ['list', 'get'],
    readNotes: '',
    writeActions: ['create'],
    writeDoc:
      `create data: contact_id* (vendor), issue_date*, expiry_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, ${LINE_ITEMS} ${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES} ` +
      'Purchase orders cannot be edited or deleted through the API.',
  },
  {
    key: 'bills', title: 'Bills (purchase invoices)', singular: 'bill', path: 'bills', envelope: 'bill',
    toolset: 'purchases', paging: 'server', perPage: 20, canDelete: true,
    readActions: ['list', 'get', 'pdf'],
    readNotes: 'action "pdf" (id) returns a temporary PDF link (undocumented endpoint).',
    writeActions: ['create', 'allocate'],
    allocate: { envelope: 'bill', style: 'attributes' },
    writeDoc:
      `create data: contact_id* (an Active vendor), status* ("Draft" | "Approved"), issue_date*, due_date*, inventory_id*, reference (unique; auto if omitted), ${LINE_ITEMS} ` +
      `Products must be purchasable. ${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES} ` +
      'action "allocate" (id = bill id) applies an existing debit note or receipt: data = {source_type: "DebitNote" | "Receipt", source_id, amount, date} or an array of them. ' +
      'To pay a bill use qoyod_write_bill_payments. Bills cannot be edited through the API.',
  },
  {
    key: 'bill_payments', title: 'Bill payments', singular: 'bill payment', path: 'bill_payments', envelope: 'bill_payment',
    toolset: 'purchases', paging: 'server', perPage: 50, kindFilter: true,
    readActions: ['list', 'get'],
    readNotes: RECEIPT_VIEW,
    writeActions: ['create'],
    writeDoc: `create data: reference* (unique), bill_id*, account_id* (the bank/cash account paid from), date*, amount*, description. ${DATES}`,
  },
  {
    key: 'simple_bills', title: 'Simple bills (expense bills)', singular: 'simple bill', path: 'simple_bills', envelope: 'simple_bill',
    toolset: 'purchases', paging: 'unknown', perPage: 20, updateMethod: 'PATCH', canDelete: true,
    readActions: ['list', 'get'],
    readNotes: '',
    writeActions: ['create', 'update', 'allocate'],
    allocate: { envelope: 'simple_bill', style: 'attributes' },
    writeDoc:
      'create data: contact_id* (vendor), status* ("Draft" | "Approved"), issue_date*, inventory_id*, reference (unique), ' +
      `simple_bill_items_attributes[]* {expense_category_id* (an Expense account id), total_amount*, ${TAX_IDS}, description, is_inclusive}, ${CUSTOM_FIELDS} ` +
      `update (id): only fields to change. ${DATES} action "allocate" (id): data = {source_type: "DebitNote" | "Receipt", source_id, amount, date}. ` +
      'To pay use qoyod_write_simple_bill_payments.',
  },
  {
    key: 'simple_bill_payments', title: 'Simple bill payments', singular: 'simple bill payment', path: 'simple_bill_payments', envelope: 'simple_bill_payment',
    toolset: 'purchases', paging: 'none', perPage: 50, kindFilter: true,
    readActions: ['list', 'get'],
    readNotes: `${RECEIPT_VIEW} Qoyod returns all paid receipts here (mostly ordinary bill payments), not only simple-bill payments: check each row's allocations.`,
    writeActions: ['create'],
    writeDoc: `create data: reference* (unique), simple_bill_id*, account_id* (the account paid from), date*, amount*, description. ${DATES}`,
  },
  {
    key: 'debit_notes', title: 'Debit notes (purchase returns)', singular: 'debit note', path: 'debit_notes', envelope: 'debit_note',
    toolset: 'purchases', paging: 'unknown', perPage: 20, canDelete: true,
    readActions: ['list', 'get'],
    readNotes: '',
    writeActions: ['create'],
    writeDoc:
      'create data: contact_id* (vendor), issue_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, ' +
      `draft_if_out_of_stock (true = save as Draft instead of failing), ${LINE_ITEMS} ${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES}`,
  },
  {
    key: 'customers', title: 'Customers', singular: 'customer', path: 'customers', envelope: 'contact',
    toolset: 'sales', paging: 'server', perPage: 50, bulkCreate: true, updateMethod: 'PUT',
    readActions: ['list', 'get'],
    readNotes: 'Find a customer with q {"name_cont":"..."} or {"tax_number_eq":"..."}.',
    writeActions: ['create', 'update'],
    writeDoc:
      'Search with qoyod_read_customers before creating, to avoid duplicates. create data (an array = bulk create): name*, organization, phone_number, secondary_phone_number, email, secondary_email, tax_number, ' +
      'status ("Active" default | "Inactive"), currency_code, commission_id, linked_contact_id (+ link_to_contact), ' +
      'shipping_address {shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country}, ' +
      'billing_address {billing_address, billing_city, billing_state, billing_zip, billing_country, building_number}. update (id): only fields to change. Customers cannot be deleted through the API.',
  },
  {
    key: 'quotes', title: 'Quotes', singular: 'quote', path: 'quotes', envelope: 'quote',
    toolset: 'sales', paging: 'unknown', perPage: 20,
    readActions: ['list', 'get'],
    readNotes: '',
    writeActions: ['create'],
    writeDoc:
      'create data: contact_id* (customer), quotation_number* (unique), issue_date*, expiry_date*, status* ("Draft" | "Approved"), inventory_id*, notes, terms_conditions, ' +
      `${LINE_ITEMS} ${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES} Quotes cannot be edited or deleted through the API.`,
  },
  {
    key: 'invoices', title: 'Sales invoices', singular: 'sales invoice', path: 'invoices', envelope: 'invoice',
    toolset: 'sales', paging: 'server', perPage: 20, canDelete: true,
    readActions: ['list', 'get', 'pdf'],
    readNotes: 'Records include ZATCA fields (qrcode_string, zatca_details). action "pdf" (id) returns a temporary PDF link.',
    writeActions: ['create', 'allocate'],
    allocate: { envelope: 'invoice', style: 'attributes' },
    writeDoc:
      'Sales invoices feed ZATCA e-invoicing: use status "Draft" unless the user clearly asked to approve. ' +
      `create data: contact_id* (customer), status* ("Draft" | "Approved"), issue_date*, due_date*, inventory_id*, reference (unique; auto if omitted), description, draft_if_out_of_stock, ${LINE_ITEMS} ` +
      `${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES} Tracked products cannot be invoiced beyond stock. ` +
      'action "allocate" (id = invoice id): data = {source_type: "CreditNote" | "Receipt", source_id, amount, date} or an array of them. ' +
      'To record a payment use qoyod_write_invoice_payments. Invoices cannot be edited through the API.',
  },
  {
    key: 'invoice_payments', title: 'Invoice payments', singular: 'invoice payment', path: 'invoice_payments', envelope: 'invoice_payment',
    toolset: 'sales', paging: 'server', perPage: 50, kindFilter: true,
    readActions: ['list', 'get'],
    readNotes: RECEIPT_VIEW,
    writeActions: ['create'],
    writeDoc: `create data: reference* (unique), invoice_id*, account_id* (the bank/cash account received into), date*, amount*, description. ${DATES}`,
  },
  {
    key: 'credit_notes', title: 'Credit notes (sales returns)', singular: 'credit note', path: 'credit_notes', envelope: 'credit_note',
    toolset: 'sales', paging: 'server', perPage: 20, canDelete: true,
    readActions: ['list', 'get', 'pdf'],
    readNotes: 'Records include ZATCA fields. action "pdf" (id) returns a temporary PDF link (undocumented endpoint).',
    writeActions: ['create'],
    writeDoc:
      'Credit notes feed ZATCA e-invoicing: use status "Draft" unless the user clearly asked to approve. ' +
      `create data: contact_id* (customer), issue_date*, status* ("Draft" | "Approved"), inventory_id*, reference, notes, terms_conditions, ${CREDIT_LINE_ITEMS} ${DOC_DISCOUNT} ${CUSTOM_FIELDS} ${DATES}`,
  },
  {
    key: 'receipts', title: 'Receipts & payment vouchers', singular: 'receipt', path: 'receipts', envelope: 'receipt',
    toolset: 'sales', paging: 'server', perPage: 20, canDelete: true, kindFilter: true,
    readActions: ['list', 'get'],
    readNotes: 'kind filter: {"kind_eq":"paid"} (money paid out) or "received" (money received); the tool maps these to Qoyod\'s codes.',
    writeActions: ['create', 'allocate'],
    allocate: { envelope: 'allocation', style: 'single' },
    writeDoc:
      'create data: contact_id*, reference* (unique), kind* ("received" from a customer | "paid" to a vendor), account_id* (bank/cash account), amount*, date*, description. ' +
      `${DATES} action "allocate" (id = receipt id) applies the receipt to ONE document per call: data = {allocatee_type: "Invoice" | "Bill" | "CreditNote" | "DebitNote", allocatee_id, amount}.`,
  },
  {
    key: 'journal_entries', title: 'Journal entries', singular: 'journal entry', path: 'journal_entries', envelope: 'journal_entry',
    toolset: 'accounting', paging: 'none', perPage: 50,
    readActions: ['list', 'get'],
    readNotes: 'Qoyod returns the WHOLE ledger on every list (slow): always filter with q {"date_gteq":"...","date_lteq":"..."} and sort "date desc".',
    writeActions: ['create'],
    writeDoc:
      'create data: description*, date*, debit_amounts[]* {account_id*, amount*, contact_id, comment}, credit_amounts[]* {account_id*, amount*, contact_id, comment}. ' +
      'Debits must equal credits. contact_id is allowed only on the receivables account (customers) or the payables account (vendors). ' +
      `Journal entries cannot be edited or deleted through the API. ${DATES}`,
  },
];
