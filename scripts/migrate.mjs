#!/usr/bin/env node

/**
 * migrate.mjs — Run every applicable framework migration script.
 *
 * Reads the instance's framework_version (federation.yaml metadata) and runs
 * every migration from that version up to the target: package.json's version,
 * or `--target <version>`.
 *
 * Usage:
 *   node scripts/migrate.mjs                  # run all applicable migrations
 *   node scripts/migrate.mjs --dry            # show which would run, don't execute
 *   node scripts/migrate.mjs --target 0.6     # migrate up to 0.6, whatever package.json says
 *   node scripts/migrate.mjs <root> --target 0.6
 *                                             # migrate the instance at <root> with this
 *                                             # repository's migrations (how doctor sync runs it)
 *
 * Migration file names carry their range, in one of two schemes that never mix:
 *   v0.5-to-v0.6-<slug>.mjs   0.x versions (the current numbering, 0.5 onwards)
 *   v2-to-v3-<slug>.mjs       the pre-0.5 numbering, majors only (v3-to-v3-5-… reads as 3 → 3)
 * A pre-0.5 migration never runs on a 0.x instance or for a 0.x target. An instance
 * whose framework_version is still on the old numbering (1.x–3.5), migrating to a
 * 0.x target, is read as 0.5: the doctor's 3.x → 0.5 re-baseline, read the same way.
 * Pre-0.5 migrations edit the repository they sit in, so they never run against
 * another <root>.
 *
 * Migrations are idempotent. Safe to re-run.
 */

import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { load as loadYaml } from 'js-yaml';

/** "0.5.3" → [0, 5]; "v3" → [3, 0]; anything else → null. */
export function majorMinor(v) {
  const m = String(v ?? '').trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];
const fmt = (v) => v.join('.');

/** A migration's scheme and range from its file name; null for a file that is not a migration. */
export function migrationRange(file) {
  const dotted = /^v(\d+)\.(\d+)-to-v(\d+)\.(\d+)-.+\.mjs$/.exec(file);
  if (dotted) {
    return { scheme: 'dotted', from: [Number(dotted[1]), Number(dotted[2])], to: [Number(dotted[3]), Number(dotted[4])] };
  }
  const legacy = /^v?(\d+)-to-v?(\d+)-.+\.mjs$/.exec(file);
  if (legacy) return { scheme: 'legacy', from: [Number(legacy[1]), 0], to: [Number(legacy[2]), 0] };
  return null;
}

/**
 * The version an instance migrates from: its framework_version, except that an
 * instance on the pre-0.5 numbering (major 1 or more) migrating to a 0.x target
 * is read as 0.5, the line the doctor re-baselines it to.
 * @param {string} instanceVersion
 * @param {string} targetVersion
 * @returns {[number, number]}
 */
export function migrateFrom(instanceVersion, targetVersion) {
  const at = majorMinor(instanceVersion) ?? [0, 0];
  const target = majorMinor(targetVersion);
  return target && target[0] === 0 && at[0] >= 1 ? [0, 5] : at;
}

/**
 * The migrations that take an instance at `instanceVersion` to `targetVersion`,
 * in the order they run. Dotted names apply only between 0.x versions, legacy
 * names only between versions of 1 or more; see migrateFrom for an instance
 * still on the old numbering.
 * @param {string[]} files
 * @param {string} instanceVersion
 * @param {string} targetVersion
 * @returns {{ file: string, from: string, to: string }[]}
 */
export function selectMigrations(files, instanceVersion, targetVersion) {
  const at = migrateFrom(instanceVersion, targetVersion);
  const target = majorMinor(targetVersion);
  if (!target) return [];
  const scheme = (v) => (v[0] === 0 ? 'dotted' : 'legacy');
  return files
    .map((file) => ({ file, range: migrationRange(file) }))
    .filter(({ range }) => range && range.scheme === scheme(at) && range.scheme === scheme(target))
    .filter(({ range }) => cmp(range.from, at) >= 0 && cmp(range.to, target) <= 0)
    .sort((a, b) => cmp(a.range.from, b.range.from) || cmp(a.range.to, b.range.to) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map(({ file, range }) => ({ file, from: fmt(range.from), to: fmt(range.to) }));
}

function readYamlSafe(p) {
  if (!existsSync(p)) return null;
  try { return loadYaml(readFileSync(p, 'utf-8')); } catch { return null; }
}

function main(argv) {
  // The repository this runner and its migrations sit in; by default also the instance.
  const own = resolve(fileURLToPath(import.meta.url), '../..');
  const dryRun = argv.includes('--dry');
  const t = argv.indexOf('--target');
  if (t >= 0 && !majorMinor(argv[t + 1])) {
    console.error('--target needs a version, for example: node scripts/migrate.mjs --target 0.6');
    process.exit(2);
  }
  const rootArg = argv.find((a, i) => !a.startsWith('--') && !(t >= 0 && i === t + 1));
  const root = rootArg ? resolve(rootArg) : own;
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`${root} is not a directory: nothing was migrated.`);
    process.exit(2);
  }

  const pkg = JSON.parse(readFileSync(join(own, 'package.json'), 'utf-8'));
  const fed = readYamlSafe(join(root, 'federation.yaml'));
  const target = t >= 0 ? argv[t + 1] : pkg.version;
  const instanceFramework = String(fed?.metadata?.framework_version || '0.0');

  console.log(`Framework version (code):       ${pkg.version}${t >= 0 ? `  (target: ${target})` : ''}`);
  console.log(`Instance:                       ${root}`);
  console.log(`Instance framework_version:     ${instanceFramework}`);

  const migrationsDir = join(own, 'scripts', 'migrations');
  if (!existsSync(migrationsDir)) {
    console.log('No scripts/migrations/ directory — nothing to run.');
    process.exit(0);
  }

  const at = majorMinor(instanceFramework) ?? [0, 0];
  const goal = majorMinor(target);
  if (goal && goal[0] === 0 && at[0] !== 0) {
    console.log(`\n! framework_version ${instanceFramework} is on the pre-0.5 numbering: read as 0.5 (the doctor's re-baseline).`);
    console.log('  The migrations do not change it. Afterwards, re-stamp metadata.framework_version in federation.yaml');
    console.log('  to the 0.x version this instance now tracks (`npm run doctor -- sync` re-stamps it).');
  }

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.mjs'));
  const applicable = selectMigrations(files, instanceFramework, target);

  const legacy = applicable.filter((m) => migrationRange(m.file)?.scheme === 'legacy');
  if (legacy.length > 0 && realpathSync(root) !== realpathSync(own)) {
    console.error(`\n${legacy.map((m) => m.file).join(', ')} edit the repository they sit in, not ${root}:`);
    console.error('run them from inside that instance (npm run migrate there). Nothing was migrated.');
    process.exit(2);
  }

  if (applicable.length === 0) {
    console.log('\n✓ No migrations to run — instance is at current framework version.');
    process.exit(0);
  }

  console.log(`\nMigrations to run (${applicable.length}):`);
  for (const m of applicable) console.log(`  ${m.file}  (${m.from} → ${m.to})`);

  if (dryRun) {
    console.log('\n(--dry) Not executing.');
    process.exit(0);
  }

  console.log('');
  let failed = 0;
  for (const m of applicable) {
    console.log(`─── ${m.file} ───`);
    // Dotted migrations take the instance as their argument; legacy ones run only on `own` (above).
    const args = migrationRange(m.file)?.scheme === 'dotted' ? [root] : [];
    const result = spawnSync('node', [join(migrationsDir, m.file), ...args], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`✗ Migration ${m.file} exited with code ${result.status}`);
      failed++;
    }
    console.log('');
  }

  if (failed > 0) {
    console.error(`${failed} migration(s) failed. Resolve manually and re-run.`);
    process.exit(1);
  }

  console.log(`✓ All ${applicable.length} migration(s) ran successfully.`);
}

// Run only when invoked, not when a test imports selectMigrations. realpath on both sides:
// a path through a symlink (macOS's /var → /private/var, a linked vault) must still run.
const invoked = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) main(process.argv.slice(2));
