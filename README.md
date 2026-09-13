# Qoyod MCP server (unofficial)

Connect an AI assistant to your own [Qoyod](https://www.qoyod.com) accounting books through the Qoyod API v2.0. It works with any app that supports the Model Context Protocol (MCP), for example Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI and Codex CLI.

> **Unofficial.** This project is not affiliated with, endorsed by or sponsored by Qoyod. The name "Qoyod" is used only to say what the software connects to.

**ملخص بالعربية في آخر الصفحة.**

## What it does

- Covers all 76 requests of the public Qoyod API (19 resource types), plus a read-only taxes list and PDF links for bills and credit notes.
- Supports several Qoyod companies at once. Each company has its own API key.
- Splits the tools into groups, so you can approve or block a whole group in your AI app:

| Group | Tools | What they do |
|---|---|---|
| Read | `qoyod_read_*` (22) | List, get, PDF links, connection status, raw GET. Marked read-only. |
| Write | `qoyod_write_*` (19) | Create, update, allocate, stock adjustments and transfers. These change your live books. |
| Delete | `qoyod_delete_*` (6) | Delete bills, simple bills, debit notes, invoices, credit notes, receipts. |
| Settings | `qoyod_settings` | The main company, stored on your computer. |

## Safety by design

- **No duplicate documents.** A write is never re-sent automatically. If Qoyod does not answer in time, the tool reports that the record may already be saved and tells the assistant to check before trying again.
- **Group switches.** Write tools, delete tools or changes to sales records can be removed entirely (see [Configuration](#configuration)).
- **Explicit company.** With several companies, a call always targets a company you named or chose (see [Several companies](#several-companies)).
- **Honest lists.** Every list says whether more pages exist, and large results are cut at whole records, never in the middle of the data.
- **Your keys stay local.** Keys are sent only to `api.qoyod.com`. There is no telemetry.

## Before you start

1. You need a Qoyod subscription with API access.
2. Create an API key for each company. In Qoyod, open the company, then **Settings → General Settings → API key**, generate the key and click **Save**.
3. Every install method except the desktop extension needs [Node.js](https://nodejs.org) 18 or newer. Claude Desktop runs extensions with its own built-in Node.js.

Use only one install method per computer.

## Install

### Claude Desktop (desktop extension, recommended)

1. Download `qoyod-mcp-<version>.mcpb` from the [Releases page](https://github.com/OsamaAls/qoyod-mcp/releases).
2. Double-click the file. Or open Claude Desktop, go to **Settings → Extensions → Advanced settings → Install Extension…** and choose the file.
3. Enter each company's name and API key. You can also turn off write or delete tools, or block changes to sales records.
4. Start a new chat and ask: *"Check my Qoyod connection."*

If the file does not appear in the **Install Extension…** dialog, update Claude Desktop first: older versions only accept the previous `.dxt` format. If the downloaded file ends in `.zip` (some email and chat apps rename it), rename it back to `.mcpb`. Turn on "File name extensions" in File Explorer to see the real ending. Each release lists a SHA-256 checksum for every file.

### Claude Code

```bash
claude mcp add qoyod --scope user --env QOYOD_COMPANY_1_NAME="My Company" --env QOYOD_API_KEY_1=YOUR_KEY -- npx -y qoyod-mcp
```

The key is then stored in your Claude Code user settings file.

### Cursor, Windsurf and Gemini CLI

Add this block to the app's MCP settings file:

- **Cursor:** `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`.
- **Gemini CLI:** `~/.gemini/settings.json`.

```json
{
  "mcpServers": {
    "qoyod": {
      "command": "npx",
      "args": ["-y", "qoyod-mcp"],
      "env": {
        "QOYOD_COMPANY_1_NAME": "My Company",
        "QOYOD_API_KEY_1": "YOUR_KEY"
      }
    }
  }
}
```

Never commit a project settings file that contains a key.

### VS Code

In `.vscode/mcp.json`, VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "qoyod-key-1", "description": "Qoyod API key (company 1)", "password": true }
  ],
  "servers": {
    "qoyod": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "qoyod-mcp"],
      "env": { "QOYOD_COMPANY_1_NAME": "My Company", "QOYOD_API_KEY_1": "${input:qoyod-key-1}" }
    }
  }
}
```

### Codex CLI

In `~/.codex/config.toml`:

```toml
[mcp_servers.qoyod]
command = "npx"
args = ["-y", "qoyod-mcp"]
env = { QOYOD_COMPANY_1_NAME = "My Company", QOYOD_API_KEY_1 = "YOUR_KEY" }
```

### Any other MCP app, or without npm

- **Command:** `npx -y qoyod-mcp`, or `node /path/to/qoyod-mcp.cjs` using the file from the manual zip on the Releases page.
- **Settings:** set the [environment variables](#configuration), or put them in a `.env` file next to `qoyod-mcp.cjs`. [`.env.example`](.env.example) shows the format.

**Claude Desktop on Windows without the extension:**

1. Unzip `qoyod-mcp-manual-<version>.zip`, for example to `C:\qoyod-mcp`.
2. Run the installer in that folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

The installer:
- asks for each company's name and key;
- checks each key with one read-only request;
- adds only the `qoyod` entry to Claude Desktop's settings, keeping everything else;
- makes a backup first.

With this method, the keys are stored in plain text in Claude Desktop's settings file.

### Self-hosted HTTP (advanced)

```bash
QOYOD_TRANSPORT=http QOYOD_HTTP_TOKEN=LONG_RANDOM_SECRET QOYOD_API_KEY_1=YOUR_KEY npx -y qoyod-mcp
```

- **Address:** the server listens on `http://127.0.0.1:8787/mcp`. `QOYOD_HTTP_HOST` and `QOYOD_HTTP_PORT` change it.
- **Token:** every request needs `Authorization: Bearer <token>`, and the server refuses to start without a token of at least 16 characters.
- **Remote access:** put it behind HTTPS that you control.
- **One owner only:** run one instance for the owner of the Qoyod account. Never host it for other people's accounts: their accounting data would pass through your server, and Qoyod's terms do not allow re-providing its service.

## Several companies

Give each company a key and a name: `QOYOD_API_KEY_1` with `QOYOD_COMPANY_1_NAME`, `QOYOD_API_KEY_2` with `QOYOD_COMPANY_2_NAME`, and so on.

- **You named the company** (for example *"list unpaid bills of My Company"*): the tool uses it directly.
- **You did not name one:**
  - **Reads** use your *main company for reads*, and the answer says which company it is for.
  - **Changes** use your *main company for changes*. The assistant tells you the company name before anything is sent.
  - **Without a main company,** you pick the company from a list. Apps that support MCP elicitation (for example Claude Code) show a pop-up that can also save the choice as your main company. Other apps ask you in the chat.
- **Change the main company** at any time by asking, for example *"make My Company my main company for reads"*.
- **Strict mode:** set `QOYOD_CONFIRM_WRITES=always` to get the pop-up for every change, even when you named the company. This needs an app that supports pop-ups; in other apps the named company is used and that app's own approval prompt is the check.
- **Record ids** belong to one company. The assistant is told never to reuse an id from another company.

The main companies live in a small settings file that holds company names only, never keys:
- **Windows:** `%APPDATA%\qoyod-mcp\settings.json`
- **macOS:** `~/Library/Application Support/qoyod-mcp/settings.json`
- **Linux:** `~/.config/qoyod-mcp/settings.json`

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QOYOD_API_KEY_<n>` | — | API key of company *n* (`QOYOD_API_KEY` also means company 1). |
| `QOYOD_COMPANY_<n>_NAME` | `Company <n>` | The company's name, as you say it to the assistant. |
| `QOYOD_TOOLSETS` | `all` | Which tools exist: `all`, or a list of `sales`, `purchases`, `inventory`, `accounting`. |
| `QOYOD_ALLOW_WRITES` | `all` | Write tools: `all`, `none`, or a list of toolsets. |
| `QOYOD_ALLOW_DELETES` | `all` | Delete tools: `all`, `none`, or a list of toolsets. |
| `QOYOD_BLOCK_SALES_WRITES` | `false` | Removes the write and delete tools for sales records. |
| `QOYOD_READ_ONLY` | `false` | Removes every write and delete tool. |
| `QOYOD_RAW_TOOLS` | `false` | Adds `qoyod_write_request` (raw POST/PUT/PATCH) and `qoyod_delete_request` (raw DELETE) for requests the other tools do not cover. They skip the per-tool guidance, so they are off by default. |
| `QOYOD_CONFIRM_WRITES` | `when_missing` | `always` = pop-up for every change. |
| `QOYOD_DEFAULT_COMPANY` | — | Preset main company for reads. A saved choice wins. |
| `QOYOD_DEFAULT_WRITE_COMPANY` | — | Preset main company for changes. A saved choice wins. |
| `QOYOD_TIMEOUT_MS` | `45000` | Per-request timeout, at most 50000. A whole call always stays under 50 seconds, so desktop apps with a 60-second tool limit still get the answer. |
| `QOYOD_DEBUG` | `false` | Log each request (company, method, path, status, time) to stderr. |
| `QOYOD_LOG_FILE` | — | Also append log lines to this file. |
| `QOYOD_ENV_FILE` | — | A `.env` file to read. `none` = read no `.env` file. |
| `QOYOD_SETTINGS_FILE` | — | Another location for the settings file. |
| `QOYOD_TRANSPORT` | `stdio` | `http` starts the self-hosted HTTP mode. |
| `QOYOD_HTTP_TOKEN`, `QOYOD_HTTP_HOST`, `QOYOD_HTTP_PORT` | —, `127.0.0.1`, `8787` | HTTP mode settings. |

- **Toolsets:**
  - `sales`: customers, quotes, invoices, invoice payments, credit notes and receipts.
  - `purchases`: vendors, purchase orders, bills, bill payments, simple bills, simple bill payments and debit notes.
  - `inventory`: products, categories, units and warehouses.
  - `accounting`: accounts, journal entries and taxes.
- **Raw request tools:** `qoyod_read_request` exists while every toolset is enabled; the raw write and delete tools also need `QOYOD_RAW_TOOLS=true` and every write or delete group enabled.
- **`.env` files** are read from the folder of `qoyod-mcp.cjs` and the folder above it. Real environment variables win.
- **Security:** the API address and the HTTP settings are never taken from a `.env` file.

## Tools

| Resource | Read (`qoyod_read_…`) | Write (`qoyod_write_…`) | Delete |
|---|---|---|---|
| accounts | list, get | create | — |
| products | list, get | create, update | — |
| inventories (warehouses) | list, get | create, update, adjust, transfer | — |
| product_categories | list, get | create, update | — |
| product_units | list, get | create | — |
| taxes | list | — | — |
| vendors | list, get | create, update | — |
| purchase_orders | list, get | create | — |
| bills | list, get, pdf | create, allocate | yes |
| bill_payments | list, get | create | — |
| simple_bills | list, get | create, update, allocate | yes |
| simple_bill_payments | list, get | create | — |
| debit_notes | list, get | create | yes |
| customers | list, get | create, update | — |
| quotes | list, get | create | — |
| invoices | list, get, pdf | create, allocate | yes |
| invoice_payments | list, get | create | — |
| credit_notes | list, get, pdf | create | yes |
| receipts | list, get | create, allocate | yes |
| journal_entries | list, get | create | — |

List options:
- `page` and `per_page`;
- `sort` (for example `"issue_date desc"`);
- `q` (Ransack filters, for example `{"issue_date_gteq":"2026-01-01","status_eq":"Approved"}`);
- `fetch_all` (up to 1,000 rows);
- `fields` (keep only some fields).

Limits of the Qoyod API itself:
- **No edits after creation** for invoices, bills, quotes, purchase orders, credit and debit notes, payments or journal entries.
- **No approving drafts.**
- **No deleting** customers, vendors, products or accounts.
- **Missing features:** no reports, no ZATCA submission, no webhooks, no sandbox.
- **Paging:** some lists ignore paging, so this server pages them locally.

[CAPABILITIES-AR.md](CAPABILITIES-AR.md) is the full reference in Arabic.

## Troubleshooting

- **Start here:** ask *"Check my Qoyod connection."* The status tool shows whether each key is accepted and which warehouses it sees.
- **"Server disconnected" or "Couldn't start" messages.** Version 2 keeps running when a key is missing and explains the setup instead. After installing, ask *"Check my Qoyod connection"* in each kind of session your app offers (for example a normal chat and a Cowork or Code session in Claude Desktop): a session that answers "not set up" did not receive your keys. If the messages continue, look at the app's MCP logs (`mcp.log` and `mcp-server-*.log`):
  - Claude Desktop on Windows: `%APPDATA%\Claude\logs` (classic installer) or `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\logs` (Microsoft Store).
  - Claude Desktop on macOS: `~/Library/Logs/Claude`.
- **The `.mcpb` file does not show in "Install Extension…".** Either Claude Desktop is out of date (older versions only list the previous `.dxt` format: update it), or the file was renamed to `.zip` or `.mcpb.zip` on the way (rename it to `.mcpb`).
- **401 from Qoyod.** The key is wrong, was not saved in Qoyod, or belongs to another company.
- **`may_already_be_saved`.** Check in Qoyod whether the record exists before asking again.
- **Slow or cut-off lists.** Narrow them with a date range in `q`, or use `fields`.
- **Tools missing after a change.** Fully quit and reopen the app, or reconnect the server.

## Development

```bash
npm install
npm run build                          # dist/qoyod-mcp.cjs
npm test                               # offline unit tests (no keys, no network)
node test/multicompany.test.js         # offline test of the built server against a fake Qoyod
node test/smoke.test.js                # LIVE and read-only, uses your keys
npm run release                        # .mcpb, manual zip, SHA256SUMS in release/
```

See [TESTING.md](TESTING.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy, security and legal

- **Data flow:** your AI app ↔ this server on your computer ↔ `api.qoyod.com` over HTTPS. There is no telemetry and no other destination. Your AI app receives what the tools return, so its own privacy terms apply to that data.
- **Accounting responsibility:** you are responsible for every change made to your books. Review drafts before approving them in Qoyod. This software is not tax, accounting or ZATCA compliance advice.
- **Licenses:** [MIT](LICENSE), with the bundled third-party licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). "Qoyod" and other names are trademarks of their owners.

Details are in [SECURITY.md](SECURITY.md).

---

## ملخص بالعربية

**ما هو؟** خادم MCP غير رسمي يربط مساعد الذكاء الاصطناعي بدفاترك في قيود، عبر واجهة قيود البرمجية وبمفاتيحك أنت. يعمل مع أي تطبيق يدعم MCP، مثل Claude Desktop و Claude Code و Cursor و VS Code.

**الأدوات ثلاث مجموعات:**
- القراءة `qoyod_read_*`.
- الكتابة `qoyod_write_*`.
- الحذف `qoyod_delete_*`.

يمكنك السماح بكل مجموعة أو منعها من إعدادات تطبيقك أو إعدادات الإضافة، ومنها خيار لمنع أي تعديل على سجلات المبيعات.

**أكثر من شركة:**
- إذا ذكرت اسم الشركة تُستخدم مباشرة.
- إذا لم تذكرها، فالقراءة تستخدم "الشركة الرئيسية للقراءة" ويذكر المساعد اسمها في الإجابة.
- وفي التعديل يخبرك المساعد باسم "الشركة الرئيسية للتعديل" قبل إرسال أي شيء.
- إذا لم تحدد شركة رئيسية تظهر لك قائمة تختار منها، ويمكنك حفظ اختيارك كشركة رئيسية.

**الأمان:**
- لا يُعاد إرسال أي عملية كتابة تلقائياً، وهذا يمنع تكرار الفواتير.
- المفاتيح لا تُرسل إلا إلى `api.qoyod.com`.
- لا توجد أي بيانات تتبع.

**التثبيت في Claude Desktop:**
1. نزّل ملف `.mcpb` من صفحة الإصدارات.
2. انقر عليه مرتين، أو افتح الإعدادات ← الإضافات ← الإعدادات المتقدمة ← تثبيت إضافة.
3. أدخل اسم كل شركة ومفتاحها.

إذا لم يظهر الملف في نافذة التثبيت فحدّث Claude Desktop أولاً (الإصدارات القديمة تقبل صيغة `.dxt` فقط). وإذا تحوّل اسم الملف إلى `.zip` فأعد تسميته إلى `.mcpb`.

**تنبيه:** هذا مشروع غير رسمي وغير تابع لقيود. أنت مسؤول عن أي تعديل على دفاترك، فراجع المسودات قبل اعتمادها. لا يُعد هذا استشارة ضريبية أو محاسبية.

المرجع الكامل بالعربية: [CAPABILITIES-AR.md](CAPABILITIES-AR.md)
