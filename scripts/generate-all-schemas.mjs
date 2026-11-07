#!/usr/bin/env node
/**
 * generate-all-schemas.mjs — an instance's .well-known/ from its records (DAO-OS L8): the EIP-4824 documents
 * (dao.json, members, proposals, activities, contracts), governance.md, DAOIP-5 grant pools and applications, DAOIP-3
 * attestation issuers, and the org-os extras (meetings, projects, finances, ideas, knowledge). Public records and
 * fields only, as data/visibility.yaml says: what is not public is counted ("withheld: …"), never written.
 *
 * Usage: node scripts/generate-all-schemas.mjs [target-dir]
 *   target-dir: the instance to generate (default: this script's own checkout)
 *
 * The builder is found, in order, at
 *   1. ../packages/admin/lib/standards/ (the framework: the builder with its schema check), or
 *   2. ./lib/standards/ (an instance's vendored copy: the same builder, no schema check — no ajv there).
 * Neither: it refuses (exit 2). It never falls back to 0.6's generator, which published everything.
 *
 * Exit codes: 0 written (or nothing to generate: no identity.daoURI — each standard file left in .well-known/ by an
 * earlier generator is named in a warning, and kept) · 1 nothing written (a withheld value would have
 * been published, the daoURI is not an https URL, or federation.yaml cannot be read) · 2 cannot run.
 * It writes the files the builder produced, removes the standard files it did not produce (a pool that is gone, the
 * live-copy-only applications.json), and touches nothing else under .well-known/ — no template, no other file.
 */

import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const root = path.resolve(arg ?? path.join(scriptDir, '..'));
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`✗ no such directory: ${root}`);
  process.exit(2);
}

// js-yaml's default schema less its timestamps: a date stays the string the record wrote, as with the server's parser.
const NO_DATES = yaml.CORE_SCHEMA.extend({
  implicit: [yaml.types.merge],
  explicit: [yaml.types.binary, yaml.types.omap, yaml.types.pairs, yaml.types.set],
});
const parseYaml = (text) => yaml.load(text, { schema: NO_DATES });

const NOTHING = '· nothing generated: identity.daoURI is not set — every id is built from it';
/** The builder's STANDARD_FILES (lib/standards/build.mjs; a test keeps them equal): named here because without a
 *  daoURI the builder is not loaded. */
const STANDARD_FILES = ['dao.json', 'members.json', 'proposals.json', 'activities.json', 'contracts.json', 'governance.md',
  'grant-pools.json', 'applications.json', 'attestation-issuers.json', 'meetings.json', 'projects.json', 'finances.json',
  'ideas.json', 'knowledge.json'];

/** Nothing to build (R32): say so, and name each standard file still in .well-known/ — written by an earlier
 *  generator (0.6), never refreshed now. Nothing is removed: they are the organisation's to keep or delete. */
function nothingToGenerate() {
  console.log(NOTHING);
  for (const f of STANDARD_FILES) {
    if (existsSync(path.join(root, '.well-known', f))) {
      console.log(`  ⚠ .well-known/${f}: left by an earlier generator and not refreshed without identity.daoURI; not removed`);
    }
  }
  process.exit(0);
}

// Without a daoURI there is nothing to build (every id is built from it), with or without a builder.
let federation;
try {
  const file = path.join(root, 'federation.yaml');
  federation = existsSync(file) ? parseYaml(readFileSync(file, 'utf-8')) : undefined;
} catch (err) {
  console.error(`✗ federation.yaml cannot be read as YAML (${String(err?.message ?? err).split('\n')[0]}); nothing written`);
  process.exit(1);
}
const daoURI = federation?.identity?.daoURI;
if (typeof daoURI !== 'string' || daoURI.trim() === '') nothingToGenerate();

/** The builder: the framework's (with the schema check), else an instance's vendored core. */
async function findBuilder() {
  const reasons = [];
  const places = [
    { dir: new URL('../packages/admin/lib/standards/', import.meta.url), checked: true },
    { dir: new URL('./lib/standards/', import.meta.url), checked: false },
  ];
  for (const { dir, checked } of places) {
    if (!existsSync(fileURLToPath(dir))) continue;
    try {
      const core = await import(new URL('build.mjs', dir).href);
      const { loadStandardsInput } = await import(new URL('load.mjs', dir).href);
      const build = checked ? (await import(new URL('index.mjs', dir).href)).buildStandards : core.buildCore;
      return { build, load: loadStandardsInput, planWrites: core.planWrites, checked };
    } catch (err) {
      reasons.push(`${path.relative(root, fileURLToPath(dir)) || '.'}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }
  return { reasons };
}

const builder = await findBuilder();
if (!builder.build) {
  console.error('✗ generate:schemas needs the org-os standards builder (packages/admin or scripts/lib/standards)');
  for (const r of builder.reasons) console.error(`  could not load ${r}`);
  if (builder.reasons.some((r) => r.startsWith('packages'))) console.error('  run: npm ci --prefix packages/admin');
  process.exit(2);
}

console.log(`generate:schemas — ${root}`);
if (!builder.checked) console.log("· schemas not checked here (no ajv): run the framework's validate:schemas against this instance");

const { input, problems: loaded } = builder.load(root, { parseYaml });
if (!input) nothingToGenerate();
const out = builder.build(input);
const plan = builder.planWrites(out);

const problems = [...loaded, ...out.problems];
for (const p of problems.filter((p) => p.level === 'warn')) console.log(`  ⚠ ${p.file}: ${p.text}`);
for (const p of problems.filter((p) => p.level === 'error')) console.log(`  ✗ ${p.file}: ${p.text}`);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
for (const w of out.withheld) console.log(`withheld: ${w.collection} ${plural(w.records, 'record')}, ${plural(w.fields, 'field')}`);

if (plan.refuse) {
  console.error('✗ nothing written: the errors above stop every file (a withheld value would be published, or no id can be built)');
  process.exit(1);
}

const dir = path.join(root, '.well-known');
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(plan.write)) writeFileSync(path.join(dir, name), text);
for (const name of plan.remove) {
  const file = path.join(dir, name);
  if (existsSync(file)) {
    rmSync(file);
    console.log(`· removed .well-known/${name} (nothing to publish in it)`);
  }
}
console.log(`✓ wrote ${plural(Object.keys(plan.write).length, 'file')} to .well-known/: ${Object.keys(plan.write).join(', ')}`);
if (problems.some((p) => p.level === 'error')) {
  console.log('  ✗ lines above: written, but not conformant — fix the records, then run npm run validate:schemas');
}
