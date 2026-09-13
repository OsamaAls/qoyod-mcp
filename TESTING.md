# Testing

## Offline (no keys, no network)

```bash
npm test                          # unit tests against a fake Qoyod
npm run build
node test/multicompany.test.js    # starts the built server like a real app does, against a local fake Qoyod
```

`test/multicompany.test.js` removes every `QOYOD_*` variable from your shell and disables `.env` loading, so it can never reach your real account. It checks four things:
- the tool count;
- that the version matches `package.json`;
- company routing;
- that a change without a company is never sent.

## Live and read-only

```bash
node test/smoke.test.js [--server dist/qoyod-mcp.cjs] [--env-file path/to/.env]
```

For every configured company, the smoke test:
- calls every read tool with small pages (journal entries are limited to the last 60 days);
- opens a few records;
- fetches one invoice PDF link;
- checks the accounts type filter, an empty filter, a missing record (404) and a raw GET.

Qoyod rate-limits its API, so avoid running it many times in a row.

## Live write cycle (purchases side only)

```bash
node test/smoke.test.js --write --company "My Company" --vendor <test vendor id>
```

- **Test vendor:** the vendor's name must start with `MCP TEST VENDOR`, otherwise the test refuses to write. The API cannot delete vendors, so create that vendor once in Qoyod and keep it Inactive.
- **What it does:**
  1. Re-activates the test vendor.
  2. Creates a Draft bill and a Draft simple bill.
  3. Updates the simple bill.
  4. Deletes both documents.
  5. Sets the vendor back to Inactive, even if a step failed.
- **What it never touches:** sales records.

## Checking a running server by hand

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) CLI talks to the server without an AI app:

```bash
npx -y @modelcontextprotocol/inspector --cli node dist/qoyod-mcp.cjs --method tools/list
npx -y @modelcontextprotocol/inspector --cli node dist/qoyod-mcp.cjs --method tools/call --tool-name qoyod_read_status
```

The Inspector has no approval prompts, so use read tools only.

## Tool list size

```bash
node scripts/tool-size.mjs
```

This shows how many characters `tools/list` costs every conversation, and lists the largest tools.
