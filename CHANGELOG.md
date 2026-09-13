# Changelog

## 2.0.0 (unreleased)

### Breaking changes

- **Tools are split into groups.** Each v1 tool `qoyod_<resource>` becomes:
  - `qoyod_read_<resource>` for list, get and pdf;
  - `qoyod_write_<resource>` for create, update, allocate, adjust and transfer;
  - `qoyod_delete_<resource>` for delete, where Qoyod allows it.

  This lets apps approve or block whole groups. Any "Always allow" choice made for v1 tools has to be made again.
- **Companies without a key number are no longer accepted.** Company keys must be named `QOYOD_API_KEY_<number>` (`QOYOD_API_KEY` still means company 1). `QOYOD_COMPANIES` and `QOYOD_API_KEY_<WORD>` are no longer supported.
- **`.env` files are read from fewer places.** They are no longer read from the current working directory. `QOYOD_BASE_URL` is never read from a `.env` file, and it must be `https://api.qoyod.com` unless `QOYOD_ALLOW_CUSTOM_BASE_URL=1`.
- **Results are compact JSON with a `company` field.** v1 returned a `Company: …` line followed by indented JSON.

### Safety fixes

- **No duplicate records from retries.** A write (POST, PUT, PATCH, DELETE) is never re-sent after it may have reached Qoyod. The error says the record may already be saved.
- **Calls stop on time.** A call stays under about 50 seconds, and a stalled response body times out. Cancelling in the AI app stops the request. `Retry-After` is capped.
- **Redirects are never followed.** The API key is never sent to another host.
- **Allocations are not dropped.** Receipt allocation takes exactly one allocation per call, where v1 silently dropped all but the first.
- **The wrong key cannot win.** A `.env` key no longer overrides the key your app configured for company 1. The same key under two company names now blocks changes.
- **Company names are checked.** With one company configured, a different company name is an error instead of a silent write to the only key.
- **Empty results are only real empties.** Only Qoyod's "found nothing" 404 becomes an empty list, and an empty filter no longer returns every record.
- **Arrays only where Qoyod supports them.** Array data is accepted only where Qoyod documents bulk create.
- **No crash on missing keys.** Without keys, the server stays connected in setup mode instead of exiting. Exiting caused repeated "Server disconnected" messages in desktop apps.
- **Raw changes are opt-in.** `qoyod_write_request` and `qoyod_delete_request` exist only with `QOYOD_RAW_TOOLS=true`; the raw GET tool stays on.
- **Every call ends within 50 seconds**, whatever `QOYOD_TIMEOUT_MS` says, so desktop apps with a 60-second limit always receive the answer, including "may already be saved".
- **A choice pop-up that is answered after the app gave up on the call sends nothing.**
- **The installer is safer.** It now:
  - works in Windows PowerShell 5.1;
  - writes UTF-8 without a BOM;
  - makes timestamped backups;
  - refuses invalid config files and duplicate keys;
  - checks each key with one read-only request;
  - supports the Microsoft Store build of Claude Desktop.
- **No personal data in docs.** The documentation contains no real business data.

### Company choice

- **Pop-up only when needed.** With several companies, the pop-up (MCP elicitation) appears only when a call names no company. Apps without pop-ups ask in the chat.
- **Saved main companies.**
  - The main company for reads is used silently, and the answer says which company it is for.
  - The main company for changes is named to you before anything is sent.
- **Strict mode.** `QOYOD_CONFIRM_WRITES=always` asks for every change.

### New

- **New tools:**
  - `qoyod_read_status` checks each key and shows the warehouses it opens.
  - `qoyod_read_taxes` lists taxes.
  - PDF links for bills and credit notes.
  - Raw request tools per group (raw GET always; raw changes with `QOYOD_RAW_TOOLS`).
  - `qoyod_settings` for the main companies.
- **Group switches:** `QOYOD_TOOLSETS`, `QOYOD_ALLOW_WRITES`, `QOYOD_ALLOW_DELETES`, `QOYOD_BLOCK_SALES_WRITES` and `QOYOD_READ_ONLY`, mirrored in the desktop extension settings.
- **Better lists:**
  - a `_page` summary on every list;
  - local paging for lists Qoyod does not page;
  - `fetch_all` and `fields`;
  - output cut at whole records.
- **Filter fixes.** Receipt `kind_eq` accepts `paid` and `received`. Account `type_*` filters are applied locally, because Qoyod returns nothing for them.
- **Smaller tool list.** Shared guidance moved into the server instructions, so the tool list is smaller than v1's despite more tools.
- **Optional self-hosted Streamable HTTP mode** with a required bearer token.
- **Diagnostics:** an identifying User-Agent, and optional `QOYOD_DEBUG` and `QOYOD_LOG_FILE`.
- **Testing and release:**
  - offline unit tests;
  - an offline test of the built server;
  - a live read-only smoke test covering every company;
  - a release script with a file allowlist, key scanning and SHA-256 checksums;
  - CI.

## 1.1.0

- Baseline: 19 tools (one per Qoyod resource, with an `action` parameter) and support for several companies.
