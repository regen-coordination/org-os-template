#!/usr/bin/env node
/**
 * repos-manifest.mjs — repos.manifest.json derived from the repo Systems that say where they are mounted.
 *
 * Usage: node scripts/repos-manifest.mjs [target-dir]
 *   target-dir: the instance (default: this script's own checkout)
 *   `npm run generate:schemas -- <dir>` chains generate-all-schemas.mjs && this script, so npm appends <dir> to this
 *   script's command only: the schemas step still runs on this checkout.
 *
 * A repo System with a `mount` becomes a manifest entry. Entries no System names are kept, never dropped.
 * The file is written only when the derived manifest differs from what is on disk.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const NO_MOUNTS = 'repos.manifest.json left as it is: no repo System has a mount yet';

/** The repo Systems that say where they are mounted.  @param {unknown[]} systems @returns {any[]} */
export function mountedSystems(systems) {
  return (Array.isArray(systems) ? systems : []).filter(
    (s) => s && typeof s === 'object' && s.kind === 'repo' && typeof s.mount === 'string' && s.mount !== '');
}

/** @param {unknown[]} systems  @param {object|null} current  @returns {{manifest: object|null, notes: string[]}} */
export function deriveManifest(systems, current) {
  const notes = [];
  const mounted = mountedSystems(systems);
  if (mounted.length === 0) return { manifest: null, notes: [NO_MOUNTS] };
  const baseDirectory = current && typeof current.baseDirectory === 'string' && current.baseDirectory ? current.baseDirectory : 'repos';
  const base = baseDirectory.replace(/\/+$/, '');
  const currentRepos = Array.isArray(current?.repositories) ? current.repositories : [];
  const derived = [];
  const seen = new Set();
  const merged = new Set(); // the old entries merged into a derived one: only the first of each name
  for (const s of mounted) {
    const mount = s.mount.replace(/\/+$/, '');
    if (!mount.startsWith(`${base}/`)) {
      notes.push(`system "${s.id}": mount ${s.mount} is outside ${baseDirectory}/; not in the manifest`);
      continue;
    }
    if (mount.slice(base.length + 1).includes('/')) {
      notes.push(`system "${s.id}": mount ${s.mount} is more than one folder under ${baseDirectory}/; not in the manifest`);
      continue;
    }
    const name = path.posix.basename(mount);
    if (seen.has(name)) {
      notes.push(`system "${s.id}": another System already mounts ${s.mount}; not in the manifest`);
      continue;
    }
    const sysUrl = typeof s.url === 'string' ? s.url.trim().replace(/\/+$/, '') : '';
    const old = currentRepos.find((e) => e?.name === name);
    if (!sysUrl && !old?.url) {
      notes.push(`system "${s.id}": no url; not in the manifest`);
      continue;
    }
    seen.add(name);
    if (old) merged.add(old);
    const url = sysUrl ? (sysUrl.endsWith('.git') ? sysUrl : `${sysUrl}.git`) : old.url;
    const branch = s.branch ?? old?.branch ?? 'main';
    if (old?.url && url !== old.url) {
      notes.push(`repos.manifest.json: "${name}" url changed to ${url} (from data/systems.yaml)`);
    }
    derived.push({ ...(old ?? {}), name, url, branch });
  }
  const names = new Set(derived.map((e) => e.name));
  const kept = [];
  for (const e of currentRepos) {
    if (merged.has(e)) continue;
    kept.push(e);
    if (names.has(e?.name)) notes.push(`repos.manifest.json: "${e?.name}" appears more than once; the extra entry is kept as it is`);
    else notes.push(`repos.manifest.json: "${e?.name}" isn't mapped as a System yet`);
  }
  return { manifest: { ...(current ?? {}), baseDirectory, repositories: [...derived, ...kept] }, notes };
}

const NO_DATES = yaml.CORE_SCHEMA.extend({
  implicit: [yaml.types.merge],
  explicit: [yaml.types.binary, yaml.types.omap, yaml.types.pairs, yaml.types.set],
});

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const root = path.resolve(arg ?? path.join(scriptDir, '..'));
  const sysFile = path.join(root, 'data', 'systems.yaml');
  const manFile = path.join(root, 'repos.manifest.json');
  let systems = [];
  if (existsSync(sysFile)) {
    try { systems = yaml.load(readFileSync(sysFile, 'utf8'), { schema: NO_DATES })?.systems ?? []; }
    catch (e) { console.error(`✗ data/systems.yaml cannot be read: ${e.message}`); process.exit(1); }
  }
  // No mounted System: the manifest is not even read, so a malformed one can't fail generate:schemas.
  if (mountedSystems(systems).length === 0) {
    console.log(`  · ${NO_MOUNTS}`);
    return;
  }
  let onDisk = null;
  let current = null;
  if (existsSync(manFile)) {
    onDisk = readFileSync(manFile, 'utf8');
    try { current = JSON.parse(onDisk); }
    catch (e) { console.error(`✗ repos.manifest.json cannot be read: ${e.message}`); process.exit(1); }
  }
  const { manifest, notes } = deriveManifest(systems, current);
  for (const n of notes) console.log(`  · ${n}`);
  if (!manifest) return;
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (text !== onDisk) {
    writeFileSync(manFile, text);
    console.log('✓ repos.manifest.json written');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
