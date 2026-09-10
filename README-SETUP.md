# Qoyod MCP for Claude — setup on Windows

This connects Claude Desktop to your Qoyod accounting company (or two
companies) with 19 tools, one per Qoyod API resource type. Nothing is stored
anywhere except the API key(s) you enter, which Claude Desktop keeps on that
PC and sends only to `api.qoyod.com`.

**Each Qoyod company has its own API key.** In Qoyod, switch to the company,
then go to **Settings → General Settings → API key**, generate it, and click
**Save**. Repeat for the second company.

---

## Method A (recommended): install the `.mcpb` bundle — no Node.js needed

1. Download or copy `qoyod-mcp.mcpb` to the PC.
2. Open **Claude Desktop** and sign in.
3. Double-click `qoyod-mcp.mcpb` (or in Claude Desktop: **Settings → Extensions → Advanced settings → Install Extension…** and pick the file).
4. In the install dialog fill in:
   - **Company 1 – name** (any name you will use when talking to Claude, e.g. *My Company*)
   - **Company 1 – Qoyod API key**
   - **Company 2 – name** and **Company 2 – Qoyod API key** (leave empty if you have one company)
   then click **Install** / **Save**.
5. Make sure the extension is **enabled** (toggle in Settings → Extensions).
6. Start a new chat and ask: **"List my Qoyod accounts"** — Claude should call `qoyod_accounts` and show your chart of accounts. With two companies, say which one: *"List the accounts of Company 2"*.

To change a key or add the second company later: Settings → Extensions → Qoyod Accounting → Configure.

If Claude Desktop says the file isn't supported, update Claude Desktop to the latest version, or use Method B.

---

## Method B (fallback): manual install — needs Node.js

1. Install **Node.js LTS** from https://nodejs.org (or in PowerShell: `winget install OpenJS.NodeJS.LTS`). Restart the terminal afterwards.
2. Unzip `qoyod-mcp-manual.zip` to **`C:\qoyod-mcp\`** so that `C:\qoyod-mcp\qoyod-mcp.cjs` exists.
3. Open PowerShell in that folder and run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   It asks for the name and API key of each company. The script writes the
   server into `%APPDATA%\Claude\claude_desktop_config.json` (a `.bak` backup is kept).

   *No PowerShell?* Edit `%APPDATA%\Claude\claude_desktop_config.json` by hand
   using `claude_desktop_config.example.json` as the template (change the path
   and the keys; delete the `_2` lines if you have one company).
4. **Fully quit Claude Desktop** (right-click the tray icon → Quit), then open it again.
5. In a new chat, click the tools/connectors icon — `qoyod` should be listed with 19 tools. Ask: **"List my Qoyod accounts"**.

---

## Using it

Just talk to Claude normally, e.g.

- "Show me unpaid vendor bills from this year"
- "Create a draft bill in Company 2 from vendor X for 2 units of product Y at 100 SAR + VAT"
- "What's the stock of product Z in each warehouse?"
- "Record a payment of 500 SAR for bill 12 from the main bank account"
- "Give me the PDF link of invoice 7"

With two companies every tool has a `company` parameter. Reads default to
company 1 when you don't say which; **any write (create/update/delete/…)
refuses to run until the company is specified**, so nothing lands in the wrong
books by accident.

The 19 tools and their actions:

| Tool | Actions |
|---|---|
| `qoyod_accounts` | list, get, create |
| `qoyod_products` | list, get, create, update |
| `qoyod_inventories` | list, get, create, update, adjust (stock count), transfer (between warehouses) |
| `qoyod_product_categories` | list, get, create, update |
| `qoyod_product_units` | list, get, create |
| `qoyod_vendors` | list, get, create, update |
| `qoyod_purchase_orders` | list, get, create |
| `qoyod_bills` | list, get, create, delete, allocate |
| `qoyod_bill_payments` | list, get, create |
| `qoyod_simple_bills` | list, get, create, update, delete, allocate |
| `qoyod_simple_bill_payments` | list, get, create |
| `qoyod_debit_notes` | list, get, create, delete |
| `qoyod_customers` | list, get, create, update |
| `qoyod_quotes` | list, get, create |
| `qoyod_invoices` | list, get, create, delete, allocate, pdf |
| `qoyod_invoice_payments` | list, get, create |
| `qoyod_credit_notes` | list, get, create, delete |
| `qoyod_receipts` | list, get, create, delete, allocate |
| `qoyod_journal_entries` | list, get, create |

Claude will ask you before doing anything that changes data (Claude Desktop
prompts for tool permission). Records that the Qoyod API cannot delete
(customers, vendors, products, accounts, journal entries, payments, …) can
only be removed inside Qoyod itself. See `CAPABILITIES-AR.md` for the full
list of what is and isn't possible.

## Known Qoyod API quirks (handled for you)

- An empty list comes back from Qoyod as HTTP 404 "we found nothing" — the tool returns an empty array instead.
- Filtering works on fields like `code`, `issue_date`, `date`, `status`, `contact_id`, `id`; Qoyod ignores filters on some others (name text search, account `type`, receipt `kind`). Claude will then fetch the list and filter it itself.
- `per_page` is honoured on some endpoints (products, invoices, receipts, customers, bill payments) and ignored on others (accounts, vendors, journal entries return everything).
- Delete responses are plain sentences ("Bill destroyed successfully"), returned as `{"message": ...}`.

## Troubleshooting

- **"No API key found"** in the log → the key wasn't saved. Re-open the extension settings (Method A) or re-run `install.ps1` (Method B).
- **401 Unauthorized from Qoyod** → the key is wrong, wasn't saved in Qoyod (click Save in General Settings), or belongs to the other company.
- **Tools don't appear** → Claude Desktop must be fully quit and restarted after config changes.
- Logs: `%APPDATA%\Claude\logs\mcp-server-qoyod.log`.

## Updating

Replace `qoyod-mcp.mcpb` (Method A: install again over the old one) or
`qoyod-mcp.cjs` (Method B), then restart Claude Desktop.
