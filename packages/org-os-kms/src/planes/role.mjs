// Which plane an instance is, read from its own kms.yaml:
//
//   a CANON names its public plane      planes: { public: { instance: … } }
//   a PUBLIC PLANE says that it is one  planes: { role: public, canon: <the canon's instance> }
//
// An instance with neither has no role and behaves as org-os-kms always has. The role decides which
// verbs make sense where: a canon exports and never publishes; a public plane publishes — after
// re-gating itself against its canon — and takes no ingest.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateCommons } from './validate-commons.mjs';

/** @returns {'canon' | 'public' | null} */
export function planeRole(config) {
  const planes = config?.planes;
  if (!planes) return null;
  const isCanon = Boolean(planes.public?.instance);
  if (planes.role !== undefined && planes.role !== 'public')
    throw new Error(`kms.yaml: planes.role is ${JSON.stringify(planes.role)} — the only value is "public"; a canon is declared by planes.public, not by a role`);
  if (isCanon && planes.role === 'public')
    throw new Error('kms.yaml: planes declares both a public plane and role: public — an instance is a canon or a public plane, never both');
  return isCanon ? 'canon' : planes.role === 'public' ? 'public' : null;
}

/** The canon a public plane belongs to, or null. Default: two levels up (<canon>/repos/<plane>), where
 *  clone-framework scaffolds it; planes.canon_dir overrides. A directory counts only if its own kms.yaml
 *  names THIS instance as its public plane — a plane cannot nominate a stranger as its canon. */
export function findCanon(dir, config) {
  const candidate = path.resolve(dir, config.planes?.canon_dir || path.join('..', '..'));
  const file = path.join(candidate, 'kms.yaml');
  if (!fs.existsSync(file)) return null;
  let cfg;
  try { cfg = yaml.load(fs.readFileSync(file, 'utf8')); } catch { return null; }
  return cfg?.planes?.public?.instance === config.instance ? candidate : null;
}

/**
 * The check a public plane makes before it publishes anywhere: is what it holds still what its canon
 * would publish today? Export proved that once; a hold added in the canon since, or a file edited in the
 * plane, is exactly what this catches.
 * @returns {{ status: 'clean' } | { status: 'failed', errors: string[] } | { status: 'canon-not-found' } | { status: 'disabled' }}
 */
export function regatePublicPlane(dir, config) {
  if (config.planes?.regate === false) return { status: 'disabled' };
  const canon = findCanon(dir, config);
  if (!canon) return { status: 'canon-not-found' };
  const v = validateCommons({ root: canon, outDir: path.resolve(dir) });
  return v.ok ? { status: 'clean' } : { status: 'failed', errors: v.errors };
}
