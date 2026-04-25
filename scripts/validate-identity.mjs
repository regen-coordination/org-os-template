#!/usr/bin/env node
// Minimal EIP-4824 schema validator.
// Loads .well-known/*.json files and verifies they parse as valid JSON.
// Pre-flight stub for v3.5; expand with proper EIP-4824 schema checks later.

import fs from 'node:fs';
import path from 'node:path';

const WELL_KNOWN = '.well-known';

if (!fs.existsSync(WELL_KNOWN)) {
  console.log('validate:schemas: no .well-known/ dir; skipping');
  process.exit(0);
}

const errors = [];
const files = fs.readdirSync(WELL_KNOWN).filter(f => f.endsWith('.json') && !f.endsWith('.template.json'));

for (const f of files) {
  const p = path.join(WELL_KNOWN, f);
  try {
    JSON.parse(fs.readFileSync(p, 'utf-8'));
    console.log(`✓ ${p}: valid JSON`);
  } catch (e) {
    errors.push(`✗ ${p}: ${e.message}`);
  }
}

if (errors.length) {
  console.error('\nvalidate:schemas FAIL:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

console.log(`\nvalidate:schemas PASS (${files.length} files)`);
process.exit(0);
