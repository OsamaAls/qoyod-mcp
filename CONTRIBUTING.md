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

## Release checklist (maintainers)

1. Bump the version in `package.json`, `manifest.json` and `server.json`; run `node scripts/sync-manifest.mjs` and `node scripts/notices.mjs`.
2. `npm test`, `npm run build`, `node test/multicompany.test.js`, then the live read-only smoke test.
3. `npm run release`, and check that `SHA256SUMS.txt` matches the files you upload.
4. Tag `vX.Y.Z` and create the GitHub Release with the `.mcpb`, the manual zip and `SHA256SUMS.txt`.
5. `npm publish` **before** announcing: the README's `npx -y qoyod-mcp` lines only work once the package exists.
6. On the first public release: enable **Private vulnerability reporting** (Settings → Security), because SECURITY.md sends reporters there; add repository topics.
