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

// Stage 2-3: copy framework files + strip framework-only artifacts (Task 20)
const STRIP_LIST = [
  'data/instances.yaml',
  'data/skills-matrix.yaml',
  'data/packages-matrix.yaml',
  'docs/SKILL-PROMOTION.md',
  'docs/PACKAGE-LIFECYCLE.md',
  'scripts/clone-framework.mjs',
  'scripts/analyze-instances.mjs',
  'scripts/render-self.mjs',
  'scripts/install-hooks.mjs',
  'scripts/selftest.mjs',
  'templates/',
  'tests/fixtures/instance-config.yaml',
  '.well-known/instances.json',
];

const SKIP_FROM_COPY = new Set(['.git', 'node_modules', '.claude', '.well-known', '.worktrees']);

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_FROM_COPY.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function stripPath(target, relPath) {
  const full = path.join(target, relPath);
  if (!fs.existsSync(full)) return;
  fs.rmSync(full, { recursive: true, force: true });
}

function copyAndStrip() {
  if (args.dryRun) {
    log(`copy ${FRAMEWORK_ROOT} → ${args.target}`);
    for (const p of STRIP_LIST) log(`strip ${p}`);
    return;
  }
  if (args.force && fs.existsSync(args.target)) {
    fs.rmSync(args.target, { recursive: true, force: true });
  }
  fs.mkdirSync(args.target, { recursive: true });
  copyTree(FRAMEWORK_ROOT, args.target);
  log(`copied framework → ${args.target}`);
  for (const p of STRIP_LIST) {
    stripPath(args.target, p);
  }
  log(`stripped ${STRIP_LIST.length} framework-only artifacts`);
}

copyAndStrip();

// Stage 4: reset framework-specific markdown (Task 21)
function resetMarkdown() {
  if (args.dryRun) {
    log('reset MEMORY.md, HEARTBEAT.md, MASTERPLAN.md, DECISIONS.md, memory/');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);

  // MEMORY.md: keep heading, empty Key Decisions
  const memoryPath = path.join(args.target, 'MEMORY.md');
  fs.writeFileSync(memoryPath, `# MEMORY.md — Key Context Index

_Index of decisions, context, and pointers. Authoritative decisions log: \`DECISIONS.md\`._

---

## Key Decisions

_(none yet — log new decisions in \`DECISIONS.md\` with date and rationale.)_

---

## Active Context

_(empty on bootstrap; agent populates over time.)_

---

_Last updated: ${today}_
`);

  // HEARTBEAT.md: minimal bootstrap task list
  const heartbeatPath = path.join(args.target, 'HEARTBEAT.md');
  fs.writeFileSync(heartbeatPath, `# HEARTBEAT.md — Active Monitoring

---

## Active Tasks

### Bootstrap (do these first)
- [ ] Run \`/initialize\` for the first time
- [ ] Process your first meeting (use \`meeting-processor\` skill)
- [ ] Add at least one member to \`data/members.yaml\`
- [ ] Run \`npm run generate:schemas\`

---

## System Health

- [ ] First \`npm run validate:schemas && npm run validate:structure\` passes

---

_Last updated: ${today}_
`);

  // DECISIONS.md: empty
  fs.writeFileSync(path.join(args.target, 'DECISIONS.md'),
    `# DECISIONS.md — Authoritative Decisions Log\n\n_(no decisions logged yet)_\n\n---\n\n_Last updated: ${today}_\n`);

  // MASTERPLAN.md: instance template
  fs.writeFileSync(path.join(args.target, 'MASTERPLAN.md'), `# MASTERPLAN.md

**Version:** 1.0.0
**Date:** ${today}
**Status:** bootstrap

---

## 1. Identity

_(populate via \`bootstrap-interviewer\` skill)_

## 2. Mandate

_(populate after first session)_

## 3. Activations

_(what the agent should focus on right now — populate as priorities surface)_

---

_This file evolves. The bootstrap-interviewer skill helps fill it in._
`);

  // memory/ — clear and add seed
  const memDir = path.join(args.target, 'memory');
  if (fs.existsSync(memDir)) {
    fs.rmSync(memDir, { recursive: true, force: true });
  }
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, `${today}.md`),
    `# ${today} — Bootstrap\n\n**Operator:** TBD\n**Session type:** initial bootstrap\n\n---\n\n## Welcome\n\nYour org-os instance is initialized. Run \`/initialize\` to start your first session.\n`);

  log('reset MEMORY.md, HEARTBEAT.md, MASTERPLAN.md, DECISIONS.md, memory/');
}

resetMarkdown();

// Stage 5: collect bootstrap answers (Task 22)
async function collectAnswers() {
  if (args.dryRun) {
    log('collect bootstrap answers (interactive or from --config)');
    if (args.config) {
      const mod = await import('./bootstrap-collect.mjs');
      return mod.collectFromConfig(args.config);
    }
    return null;
  }
  const mod = await import('./bootstrap-collect.mjs');
  if (args.nonInteractive) return mod.collectFromConfig(args.config);
  return mod.collectInteractive(args.type || 'project');
}

const answers = await collectAnswers();
if (!answers && !args.dryRun) {
  console.error('Error: failed to collect bootstrap answers');
  process.exit(1);
}
log(`bootstrap answers collected${answers?.identity?.name ? `: ${answers.identity.name}` : ''}`);

// Stages 6-11 implemented in subsequent tasks (23-27).
log('render templates (Task 23)');
log('materialize packages (Task 24)');
log('materialize skills (Task 24)');
log('write federation.yaml (Task 25)');
log('npm install + validate (Task 26)');
log('git init + initial commit (Task 27)');
log('print next-steps');

console.log('\n[clone] dry-run complete' + (args.dryRun ? '' : ' (TODO: real impl in Task 22+)'));
process.exit(0);
