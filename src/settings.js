// Small local settings file (only the "main company for reads"). Never holds API keys.
// Several server instances can run at once (desktop chat, background sessions, IDEs), so the file is
// re-read on every use and written atomically.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function settingsFile(env = process.env, platform = process.platform) {
  if (typeof env.QOYOD_SETTINGS_FILE === 'string' && env.QOYOD_SETTINGS_FILE.trim()) return env.QOYOD_SETTINGS_FILE.trim();
  const home = os.homedir();
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'qoyod-mcp', 'settings.json');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'qoyod-mcp', 'settings.json');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'qoyod-mcp', 'settings.json');
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class Settings {
  constructor(file) {
    this.file = file;
  }

  read() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
    } catch {
      return {};
    }
  }

  write(obj) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          throw err;
        }
        sleepSync(25 * (attempt + 1));
      }
    }
  }

  update(patch) {
    const next = { ...this.read(), ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    this.write(next);
    return next;
  }
}

function findCompany(companies, name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const n = name.trim().toLowerCase();
  return companies.find((c) => c.name.toLowerCase() === n) ?? null;
}

/**
 * The saved main company for 'read' or 'write' calls: the settings file first, then the environment preset
 * (QOYOD_DEFAULT_COMPANY for reads, QOYOD_DEFAULT_WRITE_COMPANY for changes). Unknown names are ignored.
 */
export function defaultCompany(settings, companies, env = {}, kind = 'read') {
  const key = kind === 'write' ? 'default_write_company' : 'default_read_company';
  const envKey = kind === 'write' ? 'QOYOD_DEFAULT_WRITE_COMPANY' : 'QOYOD_DEFAULT_COMPANY';
  const saved = settings ? findCompany(companies, settings.read()[key]) : null;
  return saved ?? findCompany(companies, env[envKey]);
}

export function defaultReadCompany(settings, companies, env = {}) {
  return defaultCompany(settings, companies, env, 'read');
}

export { findCompany };
