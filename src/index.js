#!/usr/bin/env node
// Qoyod MCP server (unofficial): exposes the Qoyod accounting API to any MCP client.
// stdio by default; QOYOD_TRANSPORT=http starts a local Streamable HTTP endpoint instead (see src/http.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isSet } from './config.js';
import { startHttp } from './http.js';
import { buildServer, createContext } from './server.js';

function scriptDir() {
  // __dirname exists in the esbuild CJS bundle; import.meta.url in the ESM source.
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(fileURLToPath(import.meta.url));
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(scriptDir(), '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0-dev';
  }
}

/* global __QOYOD_VERSION__ */
const VERSION = typeof __QOYOD_VERSION__ !== 'undefined' ? __QOYOD_VERSION__ : packageVersion();

function makeLogger(env) {
  const file = isSet(env.QOYOD_LOG_FILE) ? env.QOYOD_LOG_FILE.trim() : null;
  return (msg) => {
    try {
      process.stderr.write(`[qoyod-mcp] ${msg}\n`);
    } catch {
      /* stderr closed */
    }
    if (file) {
      try {
        fs.appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`);
      } catch {
        /* ignore */
      }
    }
  };
}

let shuttingDown = false;
function shutdown(code, log, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) log?.(`stopping (${reason})`);
  // Give pending stderr writes a moment, then exit.
  setTimeout(() => process.exit(code), 50).unref();
}

async function main() {
  const log = makeLogger(process.env);
  log(`v${VERSION} starting (pid ${process.pid})`);

  process.on('SIGINT', () => shutdown(0, log, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(0, log, 'SIGTERM'));
  process.stdout.on('error', (err) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') shutdown(0, log, 'client closed the connection');
  });
  process.stderr.on('error', () => {});
  process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${reason?.stack ?? reason}`));
  process.on('uncaughtException', (err) => {
    if (err?.code === 'EPIPE') return shutdown(0, log, 'client closed the connection');
    log(`fatal: ${err?.stack ?? err}`);
    shutdown(1, log);
  });

  const ctx = createContext({ processEnv: process.env, bundleDir: scriptDir(), log, version: VERSION });
  for (const w of ctx.warnings) log(`warning: ${w}`);
  for (const p of ctx.problems) log(`configuration problem (changes blocked): ${p}`);
  if (ctx.setup) {
    for (const s of ctx.setup) log(`not set up: ${s}`);
    log(ctx.setupHelp);
  }

  if ((ctx.env.QOYOD_TRANSPORT ?? '').trim().toLowerCase() === 'http') {
    await startHttp({ ctx, buildServer, log });
    return;
  }

  // Never exit because of missing keys: stay connected so the assistant can explain the setup
  // (exiting shows up as repeated "Server disconnected" messages in desktop clients).
  const { server, tools } = buildServer(ctx);
  const transport = new StdioServerTransport();
  transport.onclose = () => shutdown(0, log, 'transport closed');
  process.stdin.on('end', () => shutdown(0, log, 'stdin ended'));
  await server.connect(transport);
  log(
    `v${VERSION} ready: ${tools.length} tools, ` +
      (ctx.setup ? 'NOT SET UP (setup mode)' : `companies: ${ctx.companies.map((c) => c.name).join(', ')}`) +
      (ctx.filesUsed.length ? ` (settings from ${ctx.filesUsed.join(', ')})` : ''),
  );
}

main().catch((err) => {
  try {
    process.stderr.write(`[qoyod-mcp] fatal: ${err?.stack ?? err}\n`);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
