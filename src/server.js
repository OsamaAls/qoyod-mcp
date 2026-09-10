// Builds the shared context (companies, clients, switches, settings) and MCP server instances.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { QoyodClient } from './client.js';
import { isTrue, loadCompanies, loadEnv, parseSwitches, resolveBaseUrl } from './config.js';
import { Settings, settingsFile } from './settings.js';
import { buildInstructions, registerTools } from './tools.js';

export const SETUP_HELP =
  'To set it up: in Qoyod open Settings > General Settings > API key, generate the key and click Save (each company has its own key). ' +
  'Then put the key in this server\'s settings: in a desktop extension, open the extension\'s settings; in a JSON or TOML client config or a .env file, ' +
  'set QOYOD_API_KEY_1 and QOYOD_COMPANY_1_NAME (QOYOD_API_KEY_2 and QOYOD_COMPANY_2_NAME for a second company). Then restart the app.';

function positiveInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function createContext({ processEnv = process.env, bundleDir, files, fetchImpl, log = () => {}, version = '0.0.0-dev' } = {}) {
  const { env, filesUsed } = loadEnv({ processEnv, bundleDir, files });
  const warnings = [];
  const { companies, problems, warnings: companyWarnings } = loadCompanies(env);
  warnings.push(...companyWarnings);
  const switches = parseSwitches(env, warnings);
  const base = resolveBaseUrl(env);
  if (base.warning) warnings.push(base.warning);

  const setup = [];
  if (base.error) setup.push(base.error);
  if (!companies.length) setup.push(problems.length ? `No usable Qoyod API key: ${problems.join(' ')}` : 'No Qoyod API key was found.');

  if (!setup.length) {
    const debug = isTrue(env.QOYOD_DEBUG);
    const timeoutMs = positiveInt(env.QOYOD_TIMEOUT_MS, 45_000);
    for (const c of companies) {
      c.client = new QoyodClient({
        apiKey: c.apiKey,
        baseUrl: base.baseUrl,
        fetchImpl,
        timeoutMs,
        totalTimeoutMs: Math.max(timeoutMs, 50_000),
        userAgent: `qoyod-mcp/${version}`,
        label: c.name,
        log,
        debug,
      });
    }
  }

  return {
    env,
    filesUsed,
    companies: setup.length ? [] : companies,
    problems,
    warnings,
    switches,
    settings: new Settings(settingsFile(env)),
    log,
    version,
    setup: setup.length ? setup : null,
    setupHelp: SETUP_HELP,
  };
}

export function buildServer(ctx) {
  const server = new McpServer(
    { name: 'qoyod', title: 'Qoyod (unofficial)', version: ctx.version },
    { instructions: buildInstructions(ctx) },
  );
  const tools = registerTools(server, ctx);
  return { server, tools };
}
