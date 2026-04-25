#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { render } from '../templates/render.mjs';

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

// Stage 6: render templates (Task 23)
async function renderTemplates(answers) {
  if (args.dryRun) {
    log('render README + GETTING-STARTED');
    return;
  }
  const orgType = (answers.identity?.type || 'project').toLowerCase();
  const ctx = {
    org: {
      name: answers.identity.name,
      type: answers.identity.type,
      emoji: answers.identity.emoji,
      short_description: answers.identity.short_description,
      tagline: null,
    },
    federation: {
      network: answers.federation.network,
      role: 'standalone-instance',
      upstream: answers.federation.upstream,
      framework_version: answers.federation.framework_version,
      peers: [],
      downstream: [],
    },
    isFramework: false,
    isCooperative: orgType === 'cooperative',
    isDAO: orgType === 'dao',
    isLocalNode: orgType === 'localnode',
    isProject: orgType === 'project',
    isHub: orgType === 'hub',
    showCalendar: false,
    showFunding: false,
    today: new Date().toISOString().slice(0, 10),
    license: 'MIT',
    onchain: {}, treasury: {}, governance: {}, contact: {},
  };

  // Read templates from FRAMEWORK_ROOT (target's templates/ was stripped)
  const readmeTmpl = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'templates/README.instance.md'), 'utf-8');
  const gsTmpl = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'templates/GETTING-STARTED.md'), 'utf-8');
  fs.writeFileSync(path.join(args.target, 'README.md'), render(readmeTmpl, ctx));
  fs.writeFileSync(path.join(args.target, 'GETTING-STARTED.md'), render(gsTmpl, ctx));

  log('rendered README.md + GETTING-STARTED.md');
}

await renderTemplates(answers);

// Stage 7: materialize packages + skills (Task 24)
function materializePackages(answers) {
  if (args.dryRun) {
    log('write federation.yaml.packages');
    log('npm run sync:packages → materialize enabled packages');
    return;
  }
  // federation.yaml is written in the next stage; sync-packages is invoked there.
  log('packages selection captured (materialized in federation.yaml stage)');
}

function materializeSkills(answers) {
  if (args.dryRun) {
    log('strip skills not in answers.skills.enabled');
    return;
  }
  const enabledSet = new Set(answers.skills?.enabled || []);
  const skillsDir = path.join(args.target, 'skills');
  if (!fs.existsSync(skillsDir)) {
    log('skills/ dir not present in target — skipping');
    return;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!enabledSet.has(entry.name)) {
      fs.rmSync(path.join(skillsDir, entry.name), { recursive: true, force: true });
      removed++;
    }
  }
  log(`materialized skills: ${enabledSet.size} kept, ${removed} removed`);
}

materializePackages(answers);
materializeSkills(answers);

// Stage 8: write federation.yaml + run sync-packages (Task 25)
function writeFederation(answers) {
  if (args.dryRun) {
    log('write federation.yaml + run sync:packages');
    return;
  }
  const fed = {
    schema_version: '2.0',
    network: answers.federation?.network || null,
    upstream: answers.federation?.upstream || '../org-os',
    framework_version: answers.federation?.framework_version || '3.5',
    role: 'standalone-instance',
    peers: [],
    packages: answers.packages || {},
    skills: { enabled: answers.skills?.enabled || [] },
    knowledge_commons: false,
  };
  fs.writeFileSync(path.join(args.target, 'federation.yaml'), yaml.dump(fed));
  log('wrote federation.yaml');

  // Run sync-packages to materialize enabled packages from framework
  const syncResult = spawnSync('node', [
    path.join(FRAMEWORK_ROOT, 'scripts/sync-packages.mjs'),
    '--framework', FRAMEWORK_ROOT,
    '--target', args.target
  ], { stdio: 'inherit' });
  if (syncResult.status !== 0) {
    console.error('sync-packages failed; instance left in inspectable state');
    process.exit(syncResult.status || 1);
  }
}

writeFederation(answers);

// Stage 9: npm install + validate (Task 26)
function installAndValidate() {
  if (args.dryRun) {
    log('npm install + validate:schemas + validate:structure');
    return;
  }
  log('npm install in target ...');
  let r = spawnSync('npm', ['install'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('npm install failed; instance left in inspectable state');
    process.exit(r.status || 1);
  }
  log('npm run validate:schemas ...');
  r = spawnSync('npm', ['run', 'validate:schemas'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('validate:schemas failed; instance left in inspectable state');
    process.exit(r.status || 1);
  }
  log('npm run validate:structure ...');
  r = spawnSync('npm', ['run', 'validate:structure'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('validate:structure failed; instance left in inspectable state');
    process.exit(r.status || 1);
  }
  log('validation PASS');
}

// Stage 10-11: git init + initial commit + next-steps (Task 27)
function gitInit(answers) {
  if (args.dryRun) {
    log('git init + initial commit');
    log('print next-steps');
    return;
  }
  let r = spawnSync('git', ['init', '-b', 'main'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) { console.error('git init failed'); process.exit(r.status || 1); }
  spawnSync('git', ['add', '.'], { cwd: args.target, stdio: 'inherit' });
  const fwVer = answers.federation?.framework_version || '3.5';
  const msg = `bootstrap: initial scaffolding from org-os v${fwVer}`;
  spawnSync('git', ['commit', '-m', msg], { cwd: args.target, stdio: 'inherit' });
  log('git: initial commit made on main branch');

  const relPath = path.relative(args.target, FRAMEWORK_ROOT);
  console.log(`
─────────────────────────────────────────────────────────────────
  Instance ready at: ${args.target}
─────────────────────────────────────────────────────────────────

  Next steps:

  1. Add this instance to the framework's data/instances.yaml:
     ${relPath}/data/instances.yaml

  2. Create a remote and push:
     cd ${args.target}
     gh repo create <owner>/<repo> --private --source=. --remote=origin
     git push -u origin main

  3. Run your first session:
     cd ${args.target}
     /initialize   (in your agent runtime)

  4. Read GETTING-STARTED.md — your first 30 minutes are mapped out.
`);
}

const SKIP_FINISH = process.env.ORG_OS_CLONE_SKIP_FINISH === '1';

if (SKIP_FINISH) {
  log('skipping install + git init (ORG_OS_CLONE_SKIP_FINISH=1)');
} else {
  installAndValidate();
  gitInit(answers);
}

console.log('\n[clone] complete' + (args.dryRun ? ' (dry-run)' : ''));
process.exit(0);
