# Security and privacy

## Reporting a vulnerability

Please use **"Report a vulnerability"** in this repository's Security tab, which opens a private report. Never paste an API key, a `.env` file or real accounting data into an issue or a report. If a key was exposed, create a new key in Qoyod right away; saving a new key replaces the old one.

Only the latest release receives fixes.

## Privacy

What this server does with your data:

- **Where data goes.** It forwards the tool calls your AI app makes to `api.qoyod.com` over HTTPS, and returns the results to that app.
- **What it stores.** It keeps only one small settings file on your computer, holding the names of your main companies. It stores no accounting data and no keys.
- **What it logs.** Log lines go to stderr, which your AI app may keep in its own log files. They contain the company name, HTTP method, API path, status and time, and only for writes, failures or when `QOYOD_DEBUG=1` is set. They never contain keys, query values or request or response bodies.
- **What it never does.** There is no telemetry, no analytics and no connection to any other service.

What you should know:

- **Your AI app sees the data.** Its provider receives the accounting data the tools return, as part of your conversation. Their privacy terms apply to that data.
- **You are responsible for personal data.** Your Qoyod data includes your customers' and vendors' details, such as names, phone numbers and tax numbers. Use this server only in AI apps and accounts you are allowed to share that data with.

## Where your API keys are stored

| Install method | Where the key is kept |
|---|---|
| Claude Desktop extension (`.mcpb`) | Claude Desktop's settings for the extension (fields marked sensitive) |
| `install.ps1` / manual Claude Desktop config | `claude_desktop_config.json` in plain text, plus its `.bak` backups |
| Claude Code, Cursor, Windsurf, Gemini CLI, Codex CLI | That app's settings file, in plain text |
| VS Code with `inputs` (`password: true`) | VS Code's secret storage |
| `.env` file | That file, in plain text |

## Recommendations

- **Give the assistant only what it needs.** Use `QOYOD_READ_ONLY=1`, `QOYOD_ALLOW_DELETES=none` or `QOYOD_BLOCK_SALES_WRITES=true` (or the matching extension settings) when you do not need those tools.
- **Keep approval on.** Set write and delete tools to "ask before running" in your AI app, especially for sales documents that feed ZATCA e-invoicing.
- **Keep keys out of shared files.** Never commit a settings file or `.env` that contains a key.
- **Lock down HTTP mode:**
  - use a long random token;
  - keep the default `127.0.0.1` binding unless you put HTTPS in front of it;
  - run one instance per owner of the Qoyod account;
  - never serve other people's accounts from your instance.
