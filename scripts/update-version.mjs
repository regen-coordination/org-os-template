#!/usr/bin/env node

/**
 * update-version.mjs — Bump the framework version across all sources of truth.
 *
 * Usage:
 *   node scripts/update-version.mjs <new-version>     # bump mode
 *   npm run version:update 3.1.0
 *
 *   node scripts/update-version.mjs --check           # check mode (v3.5+)
 *   npm run version:check
 *
 * Bump mode:
 * 1. Validates the new version is a proper semver and higher than current.
 * 2. Updates package.json → version.
 * 3. Updates federation.yaml → metadata.framework_version (major.minor only).
 * 4. Updates federation.yaml → version (top-level field).
 * 5. Updates federation.yaml → metadata.last_updated (ISO date).
 * 6. Promotes CHANGELOG.md [Unreleased] section to [<new-version>] — <date>.
 * 7. Inserts a new empty [Unreleased] section at the top.
 * 8. Does NOT commit, does NOT tag, does NOT push. Those are manual.
 *
 * Check mode:
 * - Verifies package.json version, federation.yaml framework_version (major.minor),
 *   and most-recent CHANGELOG.md [X.Y.Z] heading all agree.
 * - Exit 0 if consistent; exit 1 with diff if not. No file modifications.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const frameworkRoot = resolve(process.argv[1], '../..');
const arg = process.argv[2];

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- Check mode (v3.5+) — read all three sources and verify agreement ---
if (arg === '--check') {
  const pkg = JSON.parse(readFileSync(resolve(frameworkRoot, 'package.json'), 'utf-8'));
  const pkgVersion = pkg.version;
  const pkgMajorMinor = (pkgVersion.match(/^(\d+)\.(\d+)/) || [])[0];

  const fedRaw = readFileSync(resolve(frameworkRoot, 'federation.yaml'), 'utf-8');
  const fedFwMatch = fedRaw.match(/^\s*framework_version:\s*"?([\d.]+)"?$/m);
  const fedFw = fedFwMatch ? fedFwMatch[1] : null;

  const changelogRaw = readFileSync(resolve(frameworkRoot, 'CHANGELOG.md'), 'utf-8');
  const clMatch = changelogRaw.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  const clVersion = clMatch ? clMatch[1] : null;
  const clMajorMinor = clVersion ? (clVersion.match(/^(\d+)\.(\d+)/) || [])[0] : null;

  console.log('Version triplet check:');
  console.log(`  package.json:                       ${pkgVersion}`);
  console.log(`  federation.yaml framework_version:  ${fedFw}`);
  console.log(`  CHANGELOG.md most-recent release:   ${clVersion}`);
  console.log('');

  const errors = [];
  if (!fedFw) errors.push('federation.yaml is missing metadata.framework_version');
  if (!clVersion) errors.push('CHANGELOG.md has no [X.Y.Z] release entry');
  if (fedFw && pkgMajorMinor !== fedFw) {
    errors.push(`major.minor mismatch: package.json ${pkgMajorMinor} ≠ federation.yaml ${fedFw}`);
  }
  if (clMajorMinor && pkgMajorMinor !== clMajorMinor) {
    errors.push(`major.minor mismatch: package.json ${pkgMajorMinor} ≠ CHANGELOG.md ${clMajorMinor}`);
  }

  if (errors.length === 0) {
    console.log('✓ All version sources agree.');
    process.exit(0);
  }
  console.error('✗ Version triplet inconsistent:');
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

const newVersion = arg;

if (!newVersion) {
  die('Usage: node scripts/update-version.mjs <new-version> | --check');
}

const semverRe = /^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?(\+[\w.]+)?$/;
const match = newVersion.match(semverRe);
if (!match) {
  die(`Not a valid semver: ${newVersion}`);
}
const [, major, minor] = match;
const majorMinor = `${major}.${minor}`;

// --- 1. package.json ---

const pkgPath = resolve(frameworkRoot, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);
const currentVersion = pkg.version;

function cmpSemver(a, b) {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0).slice(0, 3);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0).slice(0, 3);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

if (cmpSemver(newVersion, currentVersion) <= 0) {
  die(`New version ${newVersion} must be greater than current ${currentVersion}`);
}

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`✓ package.json: ${currentVersion} → ${newVersion}`);

// --- 2. federation.yaml (targeted line edits to preserve formatting / comments) ---

const fedPath = resolve(frameworkRoot, 'federation.yaml');
let fedRaw = readFileSync(fedPath, 'utf-8');

const today = new Date().toISOString().slice(0, 10);

const topVersionRe = /^version:\s*".*"$/m;
const metaFrameworkRe = /^(\s*)framework_version:\s*".*"$/m;
const metaLastUpdatedRe = /^(\s*)last_updated:\s*".*"$/m;

if (!topVersionRe.test(fedRaw)) {
  die('federation.yaml: missing top-level `version:` field');
}
if (!metaFrameworkRe.test(fedRaw)) {
  die('federation.yaml: missing `metadata.framework_version` field');
}

fedRaw = fedRaw.replace(topVersionRe, `version: "${majorMinor}"`);
fedRaw = fedRaw.replace(metaFrameworkRe, (_m, indent) => `${indent}framework_version: "${majorMinor}"`);
fedRaw = fedRaw.replace(metaLastUpdatedRe, (_m, indent) => `${indent}last_updated: "${today}"`);

writeFileSync(fedPath, fedRaw, 'utf-8');
console.log(`✓ federation.yaml: version "${majorMinor}", metadata.framework_version "${majorMinor}", last_updated "${today}"`);

// --- 3. CHANGELOG.md ---

const changelogPath = resolve(frameworkRoot, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf-8');

const unreleasedHeader = /## \[Unreleased\]\n/;
if (!unreleasedHeader.test(changelog)) {
  die('CHANGELOG.md: missing `## [Unreleased]` section');
}

// Promote [Unreleased] → [<new>] — <date>. Prepend a fresh [Unreleased] stub.
changelog = changelog.replace(
  unreleasedHeader,
  `## [Unreleased]\n\n_(Append changes here as they land.)_\n\n## [${newVersion}] — ${today}\n`
);

// Update or add comparison links at the bottom
const repoBase = 'https://github.com/regen-coordination/org-os-template';
const unreleasedLinkRe = /^\[Unreleased\]:.*$/m;
const newUnreleasedLink = `[Unreleased]: ${repoBase}/compare/v${newVersion}...HEAD`;
if (unreleasedLinkRe.test(changelog)) {
  changelog = changelog.replace(unreleasedLinkRe, newUnreleasedLink);
}

// Insert the new version link right after [Unreleased]
const newVersionLink = `[${newVersion}]: ${repoBase}/compare/v${currentVersion}...v${newVersion}`;
changelog = changelog.replace(
  unreleasedLinkRe.test(changelog) ? newUnreleasedLink : '',
  `${newUnreleasedLink}\n${newVersionLink}`
);

writeFileSync(changelogPath, changelog, 'utf-8');
console.log(`✓ CHANGELOG.md: promoted [Unreleased] → [${newVersion}] — ${today}`);

// --- Done ---

console.log('');
console.log(`✓ Version bumped to ${newVersion}`);
console.log('');
console.log('Next steps (manual):');
console.log('  1. Edit CHANGELOG.md — replace the stub for the new version with real content');
console.log('  2. Review diff: git diff');
console.log(`  3. Commit: git commit -am "release: v${newVersion}"`);
console.log(`  4. Tag:    git tag -a v${newVersion} -m "v${newVersion}"`);
console.log('  5. (optional) Push: git push && git push origin v' + newVersion);
