#!/usr/bin/env node
/**
 * validate-data.mjs — every data/*.yaml of an org-os instance against the admin schemas.
 *
 * Usage: node scripts/validate-data.mjs [path]
 *   path: root of the instance to check (default: the current directory)
 *
 * It runs from the framework against any instance, as validate-structure.mjs
 * does (the instance doctor runs it so): the schemas and their validator live in
 * packages/admin (lib/data-validate.mjs), which instances do not carry.
 *
 * It also checks that git holds nothing stricter than members (DAO-OS L5 spec §10.5): no record whose own
 * `visibility` is a hat or role level, no value of a field data/visibility.yaml restricts (the field is named, never
 * the value), no op of a proposal, open or closed, that writes either but a placeholder.
 *
 * One line per problem — file, [entry id], field path, message — with ⚠ for a
 * warning and ✗ for an error. Errors are printed last, just above the Results
 * line, so the last lines of the output name them.
 *
 * Exit codes: 0 no errors (warnings never fail) · 1 errors · 2 cannot run (admin
 * deps missing, or the root is not a readable directory).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

let validateRepo;
let REGISTRIES;
try {
  ({ validateRepo } = await import(new URL('../packages/admin/lib/data-validate.mjs', import.meta.url).href));
  ({ REGISTRIES } = await import(new URL('../packages/admin/lib/registries.mjs', import.meta.url).href));
} catch (err) {
  console.error(`✗ validate:data cannot load the admin schemas (${String(err?.message ?? err).split('\n')[0]})`);
  console.error('  run: npm ci --prefix packages/admin');
  process.exit(2);
}

const root = resolve(process.argv[2] || '.');
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`✗ no such directory: ${root}`);
  process.exit(2);
}

console.log(`validate:data — ${root}\n`);

const present = REGISTRIES.map((def) => `data/${def.name}.yaml`).filter((file) => existsSync(resolve(root, file)));
if (present.length === 0) {
  console.log('  · no registry files under data/: nothing to validate');
  console.log('\nResults: 0 passed, 0 failed, 0 warnings');
  process.exit(0);
}

const problems = validateRepo(root);
const line = (p) => `${p.file}${p.id ? ` [${p.id}]` : ''}${p.path ? ` ${p.path}` : ''}: ${p.message}`;
const errors = problems.filter((p) => p.level === 'error');
const warnings = problems.filter((p) => p.level === 'warn');
for (const p of warnings) console.log(`  ⚠ ${line(p)}`);
for (const p of errors) console.log(`  ✗ ${line(p)}`);
if (problems.length === 0) console.log(`  ✓ ${present.length} registry file(s), no problems`);

const failedFiles = new Set(errors.map((p) => p.file));
const passed = present.filter((file) => !failedFiles.has(file)).length;
// Files on both sides: passed and failed are files checked, warnings are lines.
console.log(`\nResults: ${passed} passed, ${failedFiles.size} failed, ${warnings.length} warnings`);
process.exit(errors.length > 0 ? 1 : 0);
