# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run build
npm test
node test/multicompany.test.js
```

## Rules for changes

- **Protect people's books.**
  - Tests must never write to a real Qoyod account.
  - Offline tests use the fake Qoyod in `test/unit/helpers.mjs` or `test/mock-qoyod.mjs`.
  - The live smoke test is read-only unless you pass `--write`, which only creates and deletes Draft purchase documents for a vendor named "MCP TEST VENDOR…".
- **Never commit secrets.** No `.env`, API keys, real company names or real customer or vendor data, in code, tests, docs or commit messages.
- **Keep the groups honest.**
  - A `qoyod_read_*` tool must never change data.
  - Writes belong in `qoyod_write_*`.
  - Deletes belong in `qoyod_delete_*`.
- **Writes are never retried automatically.** Keep it that way.
- **Watch the tool list size.** Run `node scripts/tool-size.mjs` and keep the `tools/list` total under the limit asserted in `test/unit/tools.test.mjs`.
- **Keep the manifest current.** When tools change, run `node scripts/sync-manifest.mjs`.
- **Keep the license notices current.** When dependencies change, run `node scripts/notices.mjs`.
- **Keep the docs neutral.** Documentation should work for any MCP app, not just one.

## Pull requests

- Keep each pull request focused, and describe what changed and how you tested it.
- CI runs the build, the unit tests, the offline process test, the manifest and notices checks, and a secret scan on Linux and Windows.
