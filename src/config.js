// Configuration: .env loading, the company/API-key layout, feature switches and base-URL safety.
// Everything here is pure (no network) so it can be unit-tested with a fake environment.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.qoyod.com/2.0';
export const TOOLSETS = ['sales', 'purchases', 'inventory', 'accounting'];

// Variables that are only ever taken from the real environment, never from a .env file.
const ENV_ONLY = new Set([
  'QOYOD_BASE_URL', 'QOYOD_ALLOW_CUSTOM_BASE_URL', 'QOYOD_ENV_FILE', 'QOYOD_SETTINGS_FILE',
  'QOYOD_LOG_FILE', 'QOYOD_TRANSPORT', 'QOYOD_HTTP_TOKEN', 'QOYOD_HTTP_HOST', 'QOYOD_HTTP_PORT',
]);

export function isTrue(v) {
  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());
}

// Empty strings, un-substituted "${user_config.x}" placeholders and "PASTE-..." template text count as unset.
export function isSet(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  return t !== '' && !/^\$\{[^}]*\}$/.test(t) && !/^PASTE-/i.test(t);
}

export function readDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const out = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val[0] === '"' || val[0] === "'") {
      const end = val.indexOf(val[0], 1);
      val = end > 0 ? val.slice(1, end) : val.slice(1);
    } else {
      val = val.replace(/\s+#.*$/, ''); // inline comment
    }
    out[key] = val;
  }
  return out;
}

// Company slot of a variable: QOYOD_API_KEY / _1 / QOYOD_COMPANY_NAME / _1_NAME -> "1", QOYOD_API_KEY_7 -> "7".
function slotOf(k) {
  if (/^QOYOD_(API_KEY(_1)?|COMPANY(_1)?_NAME)$/.test(k)) return '1';
  const m = /^QOYOD_API_KEY_(\d+)$/.exec(k) || /^QOYOD_COMPANY_(\d+)_NAME$/.exec(k);
  return m ? String(Number(m[1])) : null;
}
function keyVarsOf(slot) {
  return slot === '1' ? ['QOYOD_API_KEY', 'QOYOD_API_KEY_1'] : [`QOYOD_API_KEY_${slot}`];
}

export function envFileCandidates({ processEnv = process.env, bundleDir } = {}) {
  const f = processEnv.QOYOD_ENV_FILE;
  if (typeof f === 'string' && f.trim().toLowerCase() === 'none') return [];
  const list = [];
  if (isSet(f)) list.push(f.trim());
  if (bundleDir) list.push(path.join(bundleDir, '.env'), path.join(bundleDir, '..', '.env'));
  // Deliberately NOT the current working directory: a desktop client's cwd is arbitrary.
  return list;
}

/**
 * Real environment variables win. .env files fill in what is missing, with one rule per company:
 * a company slot (its name + key) comes from ONE source. The real environment owns a slot when its
 * key variable is present there (even empty, as a desktop extension passes an unused key).
 */
export function loadEnv({ processEnv = process.env, bundleDir, files } = {}) {
  const env = { ...processEnv };
  const filesUsed = [];
  const owner = {};
  for (const k of Object.keys(processEnv)) {
    const s = slotOf(k);
    if (s && keyVarsOf(s).some((x) => x in processEnv)) owner[s] = 'env';
  }
  for (const file of files ?? envFileCandidates({ processEnv, bundleDir })) {
    const parsed = readDotEnv(file);
    if (!parsed) continue;
    for (const [k, v] of Object.entries(parsed)) {
      const s = slotOf(k);
      if (s && !owner[s] && keyVarsOf(s).includes(k) && isSet(v)) owner[s] = file;
    }
    // A slot owned by this file takes its name from this file only, never from the real environment.
    for (const s of Object.keys(owner)) {
      if (owner[s] !== file) continue;
      const nameVars = s === '1' ? ['QOYOD_COMPANY_NAME', 'QOYOD_COMPANY_1_NAME'] : [`QOYOD_COMPANY_${s}_NAME`];
      for (const n of nameVars) if (!isSet(parsed[n])) delete env[n];
    }
    let took = false;
    for (const [k, v] of Object.entries(parsed)) {
      if (!k.startsWith('QOYOD_') || ENV_ONLY.has(k) || !isSet(v)) continue;
      const s = slotOf(k);
      if (s) {
        if (owner[s] !== file) continue;
        env[k] = v;
        took = true;
        continue;
      }
      if (isSet(env[k])) continue;
      env[k] = v;
      took = true;
    }
    if (took) filesUsed.push(file);
  }
  return { env, filesUsed };
}

/**
 * Company layout:
 *   QOYOD_API_KEY_1 (or QOYOD_API_KEY) + QOYOD_COMPANY_1_NAME (or QOYOD_COMPANY_NAME)   company 1
 *   QOYOD_API_KEY_<n> + QOYOD_COMPANY_<n>_NAME                                          company n (n >= 2)
 * Returns problems (block writes and deletes) and warnings (informational). Never includes key values.
 */
export function loadCompanies(env) {
  const companies = [];
  const problems = [];
  const warnings = [];
  const k1 = env.QOYOD_API_KEY_1;
  const k0 = env.QOYOD_API_KEY;
  if (isSet(k1) && isSet(k0) && k1.trim() !== k0.trim()) {
    problems.push('QOYOD_API_KEY and QOYOD_API_KEY_1 are both set, to different keys. Both mean company 1: keep only one of them.');
  }
  const slots = new Map();
  if (isSet(k1) || isSet(k0)) {
    slots.set(1, {
      keyVar: isSet(k1) ? 'QOYOD_API_KEY_1' : 'QOYOD_API_KEY',
      key: isSet(k1) ? k1 : k0,
      name: isSet(env.QOYOD_COMPANY_1_NAME) ? env.QOYOD_COMPANY_1_NAME : env.QOYOD_COMPANY_NAME,
    });
  }
  for (const [k, v] of Object.entries(env)) {
    const m = /^QOYOD_API_KEY_(\d+)$/.exec(k);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && isSet(v)) slots.set(n, { keyVar: k, key: v, name: env[`QOYOD_COMPANY_${m[1]}_NAME`] });
      continue;
    }
    if (/^QOYOD_API_KEY_./.test(k) && isSet(v)) warnings.push(`Ignored variable ${k}: company keys must be named QOYOD_API_KEY_<number>.`);
  }
  if (isSet(env.QOYOD_COMPANIES)) {
    warnings.push('QOYOD_COMPANIES is no longer supported: use QOYOD_API_KEY_<n> and QOYOD_COMPANY_<n>_NAME.');
  }
  for (const n of [...slots.keys()].sort((a, b) => a - b)) {
    const s = slots.get(n);
    const key = s.key.trim();
    const name = (isSet(s.name) ? s.name : '').trim() || `Company ${n}`;
    if (/[\s#"']/.test(key)) {
      problems.push(`${s.keyVar} looks malformed (it contains a space, # or quote). Paste the key again.`);
      continue;
    }
    const sameKey = companies.find((c) => c.apiKey === key);
    if (sameKey) {
      if (sameKey.name.toLowerCase() !== name.toLowerCase()) {
        problems.push(
          `The same Qoyod API key is set for "${sameKey.name}" and "${name}". Each Qoyod company has its own key: ` +
            `switch to "${name}" in Qoyod, open Settings > General Settings > API key, click Save, and paste that key.`,
        );
      }
      continue;
    }
    if (companies.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      problems.push(`Two companies are named "${name}". Give each company a different name.`);
      continue;
    }
    companies.push({ name, apiKey: key, keyVar: s.keyVar, slot: n });
  }
  return { companies, problems, warnings };
}

export function resolveBaseUrl(env) {
  const custom = isSet(env.QOYOD_BASE_URL);
  const raw = custom ? env.QOYOD_BASE_URL.trim().replace(/\/+$/, '') : DEFAULT_BASE_URL;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'QOYOD_BASE_URL is not a valid URL.' };
  }
  const official = u.protocol === 'https:' && (u.hostname === 'api.qoyod.com' || u.hostname.endsWith('.qoyod.com'));
  if (official) return { baseUrl: raw, warning: custom && raw !== DEFAULT_BASE_URL ? `Using Qoyod base URL ${u.origin}${u.pathname}.` : undefined };
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!isTrue(env.QOYOD_ALLOW_CUSTOM_BASE_URL)) {
    return { error: `Refusing to send Qoyod API keys to ${u.origin}: QOYOD_BASE_URL must be https://api.qoyod.com (set QOYOD_ALLOW_CUSTOM_BASE_URL=1 only for local testing).` };
  }
  if (u.protocol !== 'https:' && !local) {
    return { error: `Refusing to send Qoyod API keys over plain http to ${u.origin}.` };
  }
  return { baseUrl: raw, warning: `Using a custom base URL (${u.origin}). API keys are sent there.` };
}

function parseToolsetList(value, name, warnings) {
  if (!isSet(value)) return new Set(TOOLSETS);
  const t = value.trim().toLowerCase();
  if (['all', 'true', 'yes', 'on', '1'].includes(t)) return new Set(TOOLSETS);
  if (['none', 'false', 'no', 'off', '0'].includes(t)) return new Set();
  const out = new Set();
  for (const item of t.split(/[\s,;]+/).filter(Boolean)) {
    if (TOOLSETS.includes(item)) out.add(item);
    else warnings.push(`${name}: unknown value "${item}" ignored (use all, none, or a list of: ${TOOLSETS.join(', ')}).`);
  }
  return out;
}

export function parseSwitches(env, warnings = []) {
  const readOnly = isTrue(env.QOYOD_READ_ONLY);
  const toolsets = parseToolsetList(env.QOYOD_TOOLSETS, 'QOYOD_TOOLSETS', warnings);
  let writes = parseToolsetList(env.QOYOD_ALLOW_WRITES, 'QOYOD_ALLOW_WRITES', warnings);
  let deletes = parseToolsetList(env.QOYOD_ALLOW_DELETES, 'QOYOD_ALLOW_DELETES', warnings);
  if (isTrue(env.QOYOD_BLOCK_SALES_WRITES)) {
    writes.delete('sales');
    deletes.delete('sales');
  }
  if (readOnly) {
    writes = new Set();
    deletes = new Set();
  }
  const mode = (env.QOYOD_CONFIRM_WRITES || '').trim().toLowerCase();
  // Default: a pop-up only when a change names no company. "always" = pop-up for every change (strict mode).
  if (mode && !['always', 'when_missing'].includes(mode)) warnings.push(`QOYOD_CONFIRM_WRITES: unknown value "${mode}", using "when_missing".`);
  return { readOnly, toolsets, writes, deletes, confirmWrites: mode === 'always' ? 'always' : 'when_missing' };
}
