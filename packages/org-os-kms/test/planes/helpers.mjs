import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

// Round-4-legal fixture: a lineage (and therefore an origin_prefix) is exactly one notation — a
// workspace-relative corpus path `repos/<Repo>/`. The brief this fixture was originally written
// against also carried a `https://github.com/refibcn/ReFi-Barcelona/` entry in origin_prefixes;
// that is no longer valid card configuration (validateCards reports a URL there as an error) so it
// is dropped here, keeping only the corpus-path entry. public_use stays 'ok-with-caveat' — a card
// with no public_use is treated as unassessed and refuses its material.
export const SOURCE_CARDS = {
  'refi-bcn-old-kb': { title: 'ReFi BCN Old KB', type: 'repo', steward: 's', return_path: 'r',
    url: 'https://github.com/refibcn/ReFi-Barcelona',
    origin_prefixes: ['repos/ReFi-Barcelona/'], public_use: 'ok-with-caveat' },
};

/** A throwaway canon root: data/kb/<schema>.yaml per key, plus kms.yaml. */
export function makeCanon(entriesBySchema = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-'));
  fs.mkdirSync(path.join(root, 'data', 'kb'), { recursive: true });
  fs.writeFileSync(path.join(root, 'kms.yaml'), yaml.dump({ instance: 'lf-work', adapter: 'repo-data', target: '.', planes: { public: { instance: 'regenerant-catalunya-commons' } } }));
  const all = { 'source-system': SOURCE_CARDS, ...entriesBySchema };
  for (const [schema, entries] of Object.entries(all)) {
    fs.writeFileSync(path.join(root, 'data', 'kb', `${schema}.yaml`), yaml.dump({ entries }));
  }
  return root;
}

// dirPath, when given, is where the commons is created exactly (e.g. nested under a canon's
// repos/) rather than a fresh top-level temp dir — for fixtures that must mirror the real
// production layout (<canon>/repos/<instance>). Existing callers (no dirPath) are unaffected.
//
// `options` writes the two keys that decide WHICH TYPES this commons publishes: `extensions`
// (which packs to load — registers their types) and `publish.types_opt_in` (which of them are
// publish-eligible). Both default to absent, which is exactly today's behaviour: no pack, core
// PUBLISHABLE_TYPES only — so every existing caller is unaffected.
export function makeCommons(instance = 'regenerant-catalunya-commons', dirPath, { extensions, types_opt_in: typesOptIn } = {}) {
  const dir = dirPath ?? fs.mkdtempSync(path.join(os.tmpdir(), 'commons-'));
  fs.mkdirSync(dir, { recursive: true });
  const cfg = { instance, adapter: 'repo-data', target: '.' };
  if (extensions) cfg.extensions = extensions;
  if (typesOptIn) cfg.publish = { types_opt_in: typesOptIn };
  fs.writeFileSync(path.join(dir, 'kms.yaml'), yaml.dump(cfg));
  return dir;
}

export function readTree(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readTree(p, base, out);
    else out[path.relative(base, p)] = fs.readFileSync(p, 'utf8');
  }
  return out;
}
