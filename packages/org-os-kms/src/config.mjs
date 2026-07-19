// src/config.mjs
// Thin wrapper over the framework's loadConfig: reads <dir>/kms.yaml, validates the keys
// org-os-kms needs, and guarantees an object (never null) so callers can rely on it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import * as fw from './framework.mjs';

export function loadKmsConfig(dir = '.') {
  const cfg = fw.loadConfig(dir);
  if (!cfg) throw new Error(`not an initialized instance (no kms.yaml): ${dir}`);
  if (!cfg.adapter) throw new Error('kms.yaml: missing "adapter"');
  // target: "" is a valid value (the instance dir itself), so only reject a truly-absent target
  if (cfg.target === undefined) throw new Error('kms.yaml: missing "target"');
  return { render: {}, peers: {}, connectors: [], ...cfg };
}

/** Write advanced cursors back into kms.yaml. MERGES by connector name: matched on-disk
 *  entries are updated (cursor advanced), unlisted connectors are preserved, genuinely new
 *  ones are appended. This makes a filtered run (`ingest --connector X`) safe — it never
 *  drops the other declared connectors. Other top-level keys are untouched. */
export function persistConnectorCursors(dir, connectors) {
  const path = join(dir, 'kms.yaml');
  const doc = yaml.load(readFileSync(path, 'utf8')) || {};
  const onDisk = Array.isArray(doc.connectors) ? doc.connectors : [];
  const updates = new Map(connectors.map((c) => [c.name, c]));
  const merged = onDisk.map((c) => (updates.has(c.name) ? updates.get(c.name) : c));
  const seen = new Set(onDisk.map((c) => c.name));
  for (const c of connectors) if (!seen.has(c.name)) merged.push(c);
  doc.connectors = merged;
  writeFileSync(path, yaml.dump(doc, { lineWidth: -1 }));
  return { path, connectors: merged.length };
}
