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

/** Write advanced cursors back into kms.yaml. Reads the file, replaces the `connectors`
 *  list with the passed-in one (cursors updated), writes once. Other keys are preserved. */
export function persistConnectorCursors(dir, connectors) {
  const path = join(dir, 'kms.yaml');
  const doc = yaml.load(readFileSync(path, 'utf8')) || {};
  doc.connectors = connectors;
  writeFileSync(path, yaml.dump(doc, { lineWidth: -1 }));
  return { path, connectors: connectors.length };
}
