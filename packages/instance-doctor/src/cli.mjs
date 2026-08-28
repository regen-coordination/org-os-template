#!/usr/bin/env node
/**
 * cli.mjs — the operator surface of instance-doctor.
 *
 *   npm run doctor                          assess the current workspace
 *   npm run doctor -- --dir ../refi-med-os  assess a sibling from the framework
 *   npm run doctor -- sync --dir ../x       repair + sync that instance
 *   npm run doctor -- sync --dry-run        print the plan, change nothing
 *
 * Hub mode (`--dir`) is the one that matters: an instance whose sync machinery
 * is missing, stubbed, or pointed at the wrong repository cannot fix itself,
 * because fixing itself is precisely the thing it has no working machinery for.
 * Run from the framework, the doctor supplies the machinery.
 *
 * Exit codes: 0 fine · 1 blockers found, or the sync aborted · 2 bad usage.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assessSnapshot } from './assess.mjs';
import { readInstance } from './snapshot.mjs';
import { renderScorecard, toJson, exitCodeFor } from './report.mjs';
import { runSync } from './run-sync.mjs';
import { realIo } from './io.mjs';
import { planSync } from './sync.mjs';

const HELP = `org-os instance doctor — assess any instance, and sync it reliably.

Usage:
  doctor [assess] [options]     read-only assessment, prints a scorecard
  doctor sync [options]         snapshot → repair → sync → migrate → re-assess → receipt

Options:
  --dir <path>        instance to operate on (default: the current directory)
  --framework <path>  framework checkout to assess/sync against
                      (default: the checkout this script lives in)
  --json              machine-readable assessment on stdout
  --strict            treat warnings as failures (assess only)
  --dry-run           print the sync plan and change nothing (sync only)
  --no-validators     skip the structure/schema validator subprocesses
  -h, --help          this message

Exit codes: 0 fine · 1 blockers found, or the sync aborted · 2 bad usage.`;

function parseArgs(argv) {
  const opts = {
    command: 'assess',
    dir: process.cwd(),
    framework: null,
    json: false,
    strict: false,
    dryRun: false,
    runValidators: true,
    help: false,
  };

  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    opts.command = rest.shift();
  }

  while (rest.length > 0) {
    const arg = rest.shift();
    switch (arg) {
      case '--dir':
        opts.dir = rest.shift();
        break;
      case '--framework':
        opts.framework = rest.shift();
        break;
      case '--json':
        opts.json = true;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--dry-run':
      case '--dry':
        opts.dryRun = true;
        break;
      case '--no-validators':
        opts.runValidators = false;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        return { error: `unrecognised option: ${arg}` };
    }
  }

  if (!opts.dir) return { error: '--dir needs a path' };
  return opts;
}

export function main(argv = process.argv.slice(2), { log = console.log, err = console.error } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) {
    err(opts.error);
    err(HELP);
    return 2;
  }
  if (opts.help) {
    log(HELP);
    return 0;
  }
  if (!['assess', 'sync'].includes(opts.command)) {
    err(`unknown command: ${opts.command}`);
    err(HELP);
    return 2;
  }

  // The framework is the checkout this file ships in, unless told otherwise.
  const frameworkDir =
    opts.framework ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  const snapshot = readInstance(opts.dir, {
    frameworkDir,
    runValidators: opts.runValidators,
  });

  if (opts.command === 'assess') {
    const assessment = assessSnapshot(snapshot);
    log(opts.json ? toJson(assessment) : renderScorecard(assessment));
    return exitCodeFor(assessment, { strict: opts.strict });
  }

  // --- sync --------------------------------------------------------------
  if (opts.dryRun) {
    log('');
    log(`doctor sync — ${snapshot.name} (dry run: nothing will be written)`);
    log(`  ${snapshot.dir}`);
    log('');
    for (const [i, stage] of planSync(snapshot).entries()) {
      log(`  ${String(i + 1).padStart(2)}. ${stage.title}`);
      log(`      ${stage.detail}`);
    }
    log('');
    log('  Re-run without --dry-run to execute this plan.');
    log('');
    return 0;
  }

  const io = {
    ...realIo,
    reassess: (dir) =>
      assessSnapshot(readInstance(dir, { frameworkDir, runValidators: opts.runValidators })),
  };

  const result = runSync(snapshot, {}, io);

  log('');
  log(`doctor sync — ${snapshot.name}`);
  log(`  ${snapshot.dir}`);
  log('');
  for (const stage of result.stages) {
    const icon = { ok: '✓', failed: '✗', skipped: '·', planned: '·' }[stage.status] ?? '?';
    log(`  ${icon} ${stage.title.padEnd(30)} ${stage.status}`);
    if (stage.detail) log(`      ${stage.detail}`);
  }
  log('');
  log(`  receipt: ${result.receiptPath}`);
  if (result.aborted) {
    log('');
    log(`  ✗ Aborted at \`${result.abortStage}\`. Nothing after it ran, so the instance`);
    log('    was not left half-migrated. Fix the cause above and re-run.');
    log('');
    return 1;
  }
  log('');
  log('  ✓ Sync complete.');
  log('');
  return 0;
}

// Only self-execute when run as a script, so tests can import main().
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
