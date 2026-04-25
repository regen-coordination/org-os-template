#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.resolve(__dirname, '..');

const HELP = `
Usage: node scripts/clone-framework.mjs --target <dir> [options]

Options:
  --target <dir>          (required) Target directory for the new instance
  --type <type>           Org type: cooperative | dao | localnode | project | hub
  --interactive           Run bootstrap-interviewer skill prompts
  --non-interactive       Skip prompts; require --config
  --config <file>         YAML file with bootstrap answers (for non-interactive)
  --force                 Wipe target dir if non-empty
  --dry-run               Show planned actions, write nothing
  --help                  Print this message
`;

function parseArgs(argv) {
  const args = {
    target: null, type: null, interactive: false, nonInteractive: false,
    config: null, force: false, dryRun: false, help: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--target': args.target = argv[++i]; break;
      case '--type': args.type = argv[++i]; break;
      case '--interactive': args.interactive = true; break;
      case '--non-interactive': args.nonInteractive = true; break;
      case '--config': args.config = argv[++i]; break;
      case '--force': args.force = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--help': case '-h': args.help = true; break;
    }
  }
  return args;
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

if (!args.target) {
  console.error('Error: --target required\n' + HELP);
  process.exit(2);
}

if (args.nonInteractive && !args.config) {
  console.error('Error: --non-interactive requires --config <file>');
  process.exit(2);
}

const log = args.dryRun
  ? (msg) => console.log('[dry-run]', msg)
  : (msg) => console.log('[clone]', msg);

// Stage 1: verify target
function verifyTarget() {
  const exists = fs.existsSync(args.target);
  if (exists && !args.force) {
    const isEmpty = fs.readdirSync(args.target).length === 0;
    if (!isEmpty) {
      console.error(`Error: target ${args.target} is non-empty. Use --force to wipe.`);
      process.exit(2);
    }
  }
  log(`verify target: ${args.target}`);
}

verifyTarget();

// Stages 2–11 implemented in subsequent tasks (20-27).
// For dry-run scaffold: print what stages would do.
log('copy framework files (Task 20)');
log('strip framework-only artifacts (Task 20)');
log('reset markdown (Task 21)');
log('run bootstrap-interviewer (Task 22)');
log('render templates (Task 23)');
log('materialize packages (Task 24)');
log('materialize skills (Task 24)');
log('write federation.yaml (Task 25)');
log('npm install + validate (Task 26)');
log('git init + initial commit (Task 27)');
log('print next-steps');

console.log('\n[clone] dry-run complete' + (args.dryRun ? '' : ' (TODO: real impl in Task 20+)'));
process.exit(0);
