// The commons' publication policy, read from ITS kms.yaml. Loading an extension pack registers the
// pack's types with the framework; only `publish.types_opt_in` makes them publish-eligible, so
// declaring `extensions` never widens what is published. publishableTypes() throws on an opt-in
// naming an unregistered type — hence packs are loaded first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { publishableTypes, resetPacks } from '../framework.mjs';
import { loadExtensions } from '../extensions.mjs';
import { resetRegistryBindings } from '../bind.mjs';
import { fieldPolicy } from './public-fields.mjs';

// fileURLToPath (not URL.pathname): the checkout path may contain spaces.
// src/planes → src → org-os-kms → packages: the directory this package is vendored into, beside its siblings.
const PACKAGES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @param {{ commonsDir: string, packagesDir?: string }} opts
 * @returns {{ config: object, types: string[], fields: object }} config = the commons' parsed kms.yaml;
 *   types = the publish-eligible types under that config, after its declared packs are loaded;
 *   fields = the field allowlist it publishes with (the framework's, plus its publish.public_fields).
 */
export function loadCommonsPolicy({ commonsDir, packagesDir = PACKAGES_DIR }) {
  const file = path.join(commonsDir, 'kms.yaml');
  const config = yaml.load(fs.readFileSync(file, 'utf8'), { filename: file }) || {};
  // Registries are process-global: start clean so repeated calls are idempotent and a commons
  // that declares no pack does not inherit an earlier call's types or bindings.
  resetPacks();
  resetRegistryBindings();
  loadExtensions(config, { packagesDir });
  return { config, types: publishableTypes(config), fields: fieldPolicy(config.publish) };
}
