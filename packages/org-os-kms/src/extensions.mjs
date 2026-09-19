// src/extensions.mjs — extension packs: kms.yaml `extensions: [<pack>]` names sibling packages of org-os-kms.
// loadExtensions (sync) registers each pack's schemas, Layer-B entities and opt-in types with the framework before
// any op runs; loadPackConnectors (async — dynamic import) collects their connectors. Every failure is a hard error
// naming the pack: an instance that declares a pack it cannot load must not start half-configured.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import * as fw from './framework.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/** The directory holding org-os-kms and its siblings (toolkit-framework, packs). */
export const PACKAGES_DIR = join(here, '..', '..');

const readYaml = (p) => yaml.load(readFileSync(p, 'utf8')) || {};
const versionOf = (pkgDir) => JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const FOUND = { framework: () => versionOf(join(here, '..', '..', 'toolkit-framework')), kms: () => versionOf(join(here, '..')) };

function cmp(a, b) {
  const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function checkRequires(name, requires = {}) {
  for (const [what, range] of Object.entries(requires)) {
    if (!FOUND[what]) throw new Error(`extension pack "${name}": unknown requires key "${what}" (framework | kms)`);
    const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(String(range));
    if (!m) throw new Error(`extension pack "${name}": unsupported requires range "${range}" (only ">=x.y.z")`);
    const found = FOUND[what]();
    if (cmp(found, m[1]) < 0) throw new Error(`extension pack "${name}" requires ${what} >=${m[1]}, found ${found}`);
  }
}

export function loadExtensions(config = {}, { packagesDir = PACKAGES_DIR } = {}) {
  const names = config.extensions ?? [];
  if (!Array.isArray(names)) throw new Error('kms.yaml: "extensions" must be a list of pack names');
  const packs = [];
  for (const name of names) {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`kms.yaml: invalid extension pack name: ${JSON.stringify(name)}`);
    const dir = join(packagesDir, name);
    if (!existsSync(dir)) throw new Error(`extension pack "${name}" not found (expected a sibling package at ${dir})`);
    const manifestPath = join(dir, 'pack.yaml');
    if (!existsSync(manifestPath)) throw new Error(`extension pack "${name}": pack.yaml not found`);
    const manifest = readYaml(manifestPath);
    if (manifest.name !== name) throw new Error(`extension pack "${name}": pack.yaml name "${manifest.name}" does not match its directory`);
    checkRequires(name, manifest.requires);
    const schemaDir = join(dir, 'schemas');
    const entitiesPath = join(dir, 'extension-entities.yaml');
    const profilePath = join(dir, 'profile', 'profile.yaml');
    fw.registerPack({
      name,
      schemaDir: existsSync(schemaDir) ? schemaDir : null,
      entities: existsSync(entitiesPath) ? (readYaml(entitiesPath).entities || {}) : {},
      types: manifest.types || [],
    });
    packs.push({ name, dir, manifest, profile: existsSync(profilePath) ? readYaml(profilePath) : {} });
  }
  return packs;
}

export async function loadPackConnectors(packs = []) {
  const out = {}; const owner = {};
  for (const p of packs) {
    const entry = join(p.dir, 'connectors', 'index.mjs');
    if (!existsSync(entry)) continue;
    const mod = await import(pathToFileURL(entry).href);
    for (const [name, connector] of Object.entries(mod.CONNECTORS || {})) {
      if (owner[name]) throw new Error(`pack connector "${name}" (${p.name}) collides with pack ${owner[name]}`);
      owner[name] = p.name; out[name] = connector;
    }
  }
  return out;
}
