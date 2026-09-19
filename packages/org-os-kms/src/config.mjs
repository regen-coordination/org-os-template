// src/config.mjs
// Thin wrapper over the framework's loadConfig: reads <dir>/kms.yaml, validates the keys
// org-os-kms needs, and guarantees an object (never null) so callers can rely on it.
// Declared extension packs are registered here — before any op can run — and exposed as config.packs.
import * as fw from './framework.mjs';
import { loadExtensions } from './extensions.mjs';

export function loadKmsConfig(dir = '.', { packagesDir } = {}) {
  const cfg = fw.loadConfig(dir);
  if (!cfg) throw new Error(`not an initialized instance (no kms.yaml): ${dir}`);
  if (!cfg.adapter) throw new Error('kms.yaml: missing "adapter"');
  // target: "" is a valid value (the instance dir itself), so only reject a truly-absent target
  if (cfg.target === undefined) throw new Error('kms.yaml: missing "target"');
  const packs = loadExtensions(cfg, packagesDir ? { packagesDir } : {});
  return { render: {}, peers: {}, connectors: [], publish: {}, extensions: [], ...cfg, packs };
}
