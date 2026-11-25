/**
 * io.mjs — every side effect `doctor sync` can perform, in one injectable bag.
 *
 * runSync() takes this as a parameter so the stage machinery — ordering,
 * abort-on-first-failure, receipt contents — is testable without a network or a
 * real instance. `realIo` is the production implementation.
 *
 * Every primitive reports failure by returning `{ ok: false }`; none of them
 * throw. A sync against a broken instance is the normal case, and an exception
 * escaping mid-run is exactly the half-migrated state B9 forbids.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const realIo = {
  /**
   * Run git in `dir`. `opts.env`, when given, is merged over process.env — the
   * snapshot stage uses it to point GIT_INDEX_FILE at a throwaway index.
   *
   * @param {string} dir
   * @param {string[]} args
   * @param {{env?: Record<string, string>}} [opts]
   * @returns {{ok: boolean, out: string}}
   */
  git(dir, args, opts = {}) {
    try {
      const out = execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024,
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      });
      return { ok: true, out: (out ?? '').trim() };
    } catch (e) {
      const detail = `${e.stderr ?? ''}${e.stdout ?? ''}`.trim() || e.message;
      return { ok: false, out: detail.split('\n').slice(-3).join(' | ') };
    }
  },

  /** Run a command (npm, node, …) inside an instance. */
  run(cmd, args, dir) {
    const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf-8', timeout: 10 * 60_000 });
    if (r.error) return { ok: false, out: r.error.message };
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return { ok: r.status === 0, out: out.split('\n').slice(-5).join(' | ') };
  },

  readText(file) {
    try {
      return readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  },

  writeText(file, contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  },

  exists: (p) => existsSync(p),

  /** A fresh, empty directory under the OS temp dir. @returns {{ok: boolean, out: string}} */
  tempDir(prefix) {
    try {
      return { ok: true, out: mkdtempSync(path.join(tmpdir(), prefix)) };
    } catch (e) {
      return { ok: false, out: e.message };
    }
  },

  /** Remove a directory tree made by tempDir. Never throws. */
  removeDir(p) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // Best effort: a leftover temp dir is litter, not damage.
    }
  },

  mkdirp(p) {
    mkdirSync(p, { recursive: true });
  },

  copy(from, to) {
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  },

  /**
   * Repo-relative file paths under `root/prefix`, recursively. Used by the
   * overlay to enumerate framework-owned machinery. Returns [] when the prefix
   * does not exist, because a framework without templates/ is not an error.
   * Skips node_modules and .git, which are never framework-owned content.
   */
  listFiles(root, prefix) {
    const base = path.join(root, prefix);
    if (!existsSync(base)) return [];
    const out = [];
    const walk = (abs, rel) => {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const nextAbs = path.join(abs, entry.name);
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(nextAbs, nextRel);
        else if (entry.isFile()) out.push(`${prefix}${nextRel}`);
      }
    };
    walk(base, '');
    return out;
  },

  today: () => new Date().toISOString().slice(0, 10),

  timestamp: () =>
    new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-'),
};
