// Two-company mode check: the 2nd key is fake, so only schema/routing is verified.
//   node test/multicompany.test.js
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = process.env.SERVER || 'dist/qoyod-mcp.cjs';
let failed = 0;
const check = (label, cond, extra = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}  ${extra}`); if (!cond) failed++; };

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(SERVER)],
  env: { ...process.env, QOYOD_API_KEY_2: 'fake-key-for-schema-test', QOYOD_COMPANY_2_NAME: 'Test Co' },
  stderr: 'pipe',
});
transport.stderr.on('data', (d) => process.stdout.write(`  [server] ${d}`));
const c = new Client({ name: 'multicompany-test', version: '1.0.0' });
await c.connect(transport);

const { tools } = await c.listTools();
const t = tools.find((x) => x.name === 'qoyod_accounts');
check('19 tools', tools.length === 19);
check('company enum on tools', JSON.stringify(t.inputSchema.properties.company?.enum) === '["Company 1","Test Co"]', JSON.stringify(t.inputSchema.properties.company?.enum));
check('companies listed in description', t.description.includes('Companies configured'), t.description.slice(0, 120));

const r1 = await c.callTool({ name: 'qoyod_accounts', arguments: { action: 'list', per_page: 1 } });
check('read without company -> default company', !r1.isError && r1.content[0].text.startsWith('Company: Company 1'), r1.content[0].text.slice(0, 40).replace(/\n/g, ' '));

const r2 = await c.callTool({ name: 'qoyod_vendors', arguments: { action: 'create', data: { name: 'x' } } });
check('write without company -> blocked', r2.isError && /pass "company"/.test(r2.content[0].text), r2.content[0].text.slice(0, 100));

const r3 = await c.callTool({ name: 'qoyod_accounts', arguments: { action: 'list', per_page: 1, company: 'Test Co' } });
check('read company=Test Co routes to 2nd key (fake -> auth error)', r3.isError && /40[13]/.test(r3.content[0].text), r3.content[0].text.slice(0, 90));

await c.close();
console.log(failed ? `\n${failed} FAILED` : '\nall multi-company checks passed');
process.exit(failed ? 1 : 0);
