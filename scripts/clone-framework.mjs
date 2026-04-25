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
  'tests/fixtures/bread-coop-os-config.yaml',
  // Framework-only docs that leaked into instances (surfaced by bread-coop-os bootstrap):
  'PAPERCLIP_DEPLOYMENT_GUIDE.md',
  'RESEARCH_INTELLIGENCE_PLAN.md',
  'SYNC-GUIDE.md',
  // Framework-specific .well-known/ artifacts; .template.json files are kept,
  // generate:schemas will (re)write the .json files post-bootstrap, and dao.json
  // is rendered explicitly from the dao.json.template later in this script.
  '.well-known/instances.json',
  '.well-known/dao.json',
  '.well-known/members.json',
  '.well-known/projects.json',
  '.well-known/proposals.json',
  '.well-known/activities.json',
  '.well-known/contracts.json',
  '.well-known/finances.json',
  '.well-known/ideas.json',
  '.well-known/knowledge.json',
];

// Directory-level strip targets — wipe everything inside (and the dir if EXCEPT
// is empty). These are framework-scoped histories/specs that should never leak
// into instances. resetMarkdown() rewrites a clean stub for files the
// instance still needs (e.g. knowledge/INDEX.md).
const STRIP_DIRS = [
  // Framework's own audit + drift reports — instance starts with no audit history
  { dir: 'memory/reports', except: [] },
  // Framework's design specs — instances write their own under docs/superpowers/specs/
  { dir: 'docs/superpowers/specs', except: [] },
  // Framework's plans — keep README.md (the convention doc, generic) only
  { dir: 'docs/agent-plans', except: ['README.md'] },
];

// .well-known/ IS copied so generate:schemas has a target dir + dao.json templates
// available; framework-specific .json artifacts inside it are stripped via STRIP_LIST.
const SKIP_FROM_COPY = new Set(['.git', 'node_modules', '.claude', '.worktrees']);

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

function stripDirContents(target, relDir, except) {
  const full = path.join(target, relDir);
  if (!fs.existsSync(full)) return 0;
  const keep = new Set(except || []);
  let removed = 0;
  for (const entry of fs.readdirSync(full)) {
    if (keep.has(entry)) continue;
    fs.rmSync(path.join(full, entry), { recursive: true, force: true });
    removed++;
  }
  // If nothing kept, remove the dir itself so it doesn't sit empty in the instance
  if (keep.size === 0) {
    try {
      fs.rmdirSync(full);
    } catch {
      /* dir may have re-populated / not exist; ignore */
    }
  }
  return removed;
}

function copyAndStrip() {
  if (args.dryRun) {
    log(`copy ${FRAMEWORK_ROOT} → ${args.target}`);
    for (const p of STRIP_LIST) log(`strip ${p}`);
    for (const s of STRIP_DIRS) {
      const except = s.except.length ? ` (keep: ${s.except.join(', ')})` : '';
      log(`strip dir ${s.dir}/${except}`);
    }
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
  let dirRemoved = 0;
  for (const s of STRIP_DIRS) {
    dirRemoved += stripDirContents(args.target, s.dir, s.except);
  }
  log(`stripped ${dirRemoved} framework-scoped entries from ${STRIP_DIRS.length} dirs`);
}

copyAndStrip();

// Stage 4: reset framework-specific markdown (Task 21)
function resetMarkdown(answers) {
  if (args.dryRun) {
    log('reset MEMORY.md, HEARTBEAT.md, MASTERPLAN.md, DECISIONS.md, memory/');
    log('reset IDENTITY.md, SOUL.md, USER.md, CLAUDE.md, CHANGELOG.md');
    log('reset knowledge/INDEX.md, dashboard.yaml, repos.manifest.json');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);

  // Identity context (used by templates below). May be partial if called pre-answers.
  const orgName = answers?.identity?.name || '{{ org.name }}';
  const orgType = answers?.identity?.type || '{{ org.type }}';
  const orgEmoji = answers?.identity?.emoji || '';
  const orgShort = answers?.identity?.short_description || '';
  const orgSlug = (answers?.identity?.name || 'instance')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const network = answers?.federation?.network || 'standalone';
  const upstream = answers?.federation?.upstream || '../org-os';
  const fwVer = answers?.federation?.framework_version || '3.5';
  const operatorName = answers?.members?.[0]?.name || answers?.members?.[0]?.github || 'TBD';
  const operatorGithub = answers?.members?.[0]?.github || 'TBD';

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

  // IDENTITY.md: instance template (replaces framework-hub identity)
  fs.writeFileSync(path.join(args.target, 'IDENTITY.md'), `# IDENTITY.md — Organizational Identity

_Bridges agent identity with EIP-4824 organizational identity._

---

## Core Identity

- **Name:** ${orgName}
- **Type:** ${orgType}
- **Emoji:** ${orgEmoji}
- **Short description:** ${orgShort}

---

## On-Chain Identity

- **daoURI:** _(populate when on-chain registration is set up)_
- **Primary Chain:** _(populate when applicable)_

---

## Treasury

- **Primary Safe:** _(populate when treasury is set up)_
- **Operational Wallet:** _(populate)_

---

## Governance Infrastructure

- **Decision Model:** _(e.g., majority-vote, consensus, founder-led)_
- **Snapshot Space:** _(if applicable)_

---

## Federation Identity

- **Network:** ${network}
- **Node ID:** ${orgSlug}
- **Upstream:** ${upstream}

---

## Contact

- **GitHub:** _(populate)_
- **Maintainer:** _(populate)_
- **Telegram:** _(populate)_
- **Website:** _(populate)_
- **Email:** _(populate)_

---

_This file is read by agents at session startup. Keep it current as the organization evolves._
`);

  // SOUL.md: instance template
  fs.writeFileSync(path.join(args.target, 'SOUL.md'), `# SOUL.md — Mission, Values, Voice

_Read this first. It defines who we are and how we operate._

---

## Mission

_(One paragraph. What does this organization exist to do?)_

## Values

_(3-5 core values, each with a short description.)_

## Voice

_(How we communicate, internally and externally. What we sound like.)_

## Boundaries

_(What this organization will and will not do. Hard lines.)_

---

_Last updated: ${today}_
`);

  // USER.md: instance template
  fs.writeFileSync(path.join(args.target, 'USER.md'), `# USER.md — Operator Profile

_Operator-specific context. Updated as the operator learns and the org evolves._

---

## Operator

- **Name:** ${operatorName}
- **GitHub:** ${operatorGithub}
- **Role in this org:** _(maintainer, contributor, observer, etc.)_

## Working style

_(Populate as the operator establishes patterns: how they prefer to work, what they delegate, what they handle directly.)_

## Active focus

_(What the operator is currently driving in this org.)_

---

_Last updated: ${today}_
`);

  // CLAUDE.md: instance template (replaces framework-hub instructions)
  fs.writeFileSync(path.join(args.target, 'CLAUDE.md'), `# CLAUDE.md — Claude Code Instructions

This workspace is **${orgName}** — an instance of the org-os framework.

## Quick Start

Read these in order at session start:

1. \`SOUL.md\` — values, mission, voice, boundaries
2. \`IDENTITY.md\` — org identity, governance, federation
3. \`USER.md\` — operator profile
4. \`MEMORY.md\` — key decisions, active context
5. \`memory/YYYY-MM-DD.md\` — latest daily log
6. \`HEARTBEAT.md\` — active tasks (check urgency!)
7. \`TOOLS.md\` — endpoints, addresses, channels
8. \`federation.yaml\` — network peers and integrations

## Key Rules

- **Source of truth:** \`data/*.yaml\` for structured data, \`MEMORY.md\` for decisions
- **After data changes:** Run \`npm run generate:schemas && npm run validate:schemas\`
- **Memory:** Write daily logs to \`memory/YYYY-MM-DD.md\` (append, never overwrite)
- **Safety:** Draft-and-present for external actions

## Session Lifecycle

Use \`/initialize\` to start a session and \`/close\` to end it.

## Sync with framework

\`\`\`
npm run sync:upstream
\`\`\`

This pulls framework updates (skills, packages, schemas) while preserving instance-specific files.
`);

  // CHANGELOG.md: instance template (empty)
  fs.writeFileSync(path.join(args.target, 'CHANGELOG.md'), `# Changelog

All notable changes to this instance will be documented here.

## [Unreleased]

_Bootstrap entry — initial scaffolding from org-os v${fwVer}._
`);

  // knowledge/INDEX.md: minimal stub (replaces framework knowledge index)
  const knowledgeDir = path.join(args.target, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(path.join(knowledgeDir, 'INDEX.md'), `# Knowledge Index

This directory holds ${orgName}'s knowledge commons.

## Sources

_(Populate \`data/sources.yaml\` to register external sources, then run knowledge-curator skill to ingest.)_
`);

  // dashboard.yaml: instance template (no framework custom_sections)
  fs.writeFileSync(path.join(args.target, 'dashboard.yaml'), `# dashboard.yaml — Controls what /initialize shows
# See org-os/dashboard.yaml in the framework for reference + section options.

schema_version: "2.0"

sections:
  header:
    show: true
    style: ascii
  projects:
    show: true
  tasks:
    show: true
  calendar:
    show: true
    days: 7
  funding:
    show: true
    horizon_days: 30
  context:
    show: true
    max_entries: 3
  plans:
    show: true
    queued_preview: 2
  apps:
    show: true
  cheatsheet:
    show: true
  federation:
    show: true
  prompt:
    show: true
    suggestions: 3
`);

  // repos.manifest.json: empty (replaces framework's manifest of all org repos)
  fs.writeFileSync(path.join(args.target, 'repos.manifest.json'),
    JSON.stringify({ repositories: [] }, null, 2) + '\n');

  // memory/ — clear and add seed
  const memDir = path.join(args.target, 'memory');
  if (fs.existsSync(memDir)) {
    fs.rmSync(memDir, { recursive: true, force: true });
  }
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, `${today}.md`),
    `# ${today} — Bootstrap\n\n**Operator:** ${operatorName}\n**Session type:** initial bootstrap\n\n---\n\n## Welcome\n\nYour org-os instance is initialized. Run \`/initialize\` to start your first session.\n`);

  log('reset markdown identity files (MEMORY, HEARTBEAT, MASTERPLAN, DECISIONS, IDENTITY, SOUL, USER, CLAUDE, CHANGELOG, knowledge/INDEX, dashboard.yaml, repos.manifest.json, memory/)');
}

// Stage 4b: reset framework data registries to empty seeds (Fix 3)
// These are required by validate-structure (members, projects, governance, ideas) or
// commonly referenced (relationships); they exist in the instance but start empty.
function resetDataRegistries(answers) {
  if (args.dryRun) {
    log('reset data/projects.yaml, data/ideas.yaml, data/governance.yaml, data/relationships.yaml, data/members.yaml');
    return;
  }
  const orgName = answers?.identity?.name || 'instance';
  const dataDir = path.join(args.target, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // projects.yaml — empty list
  fs.writeFileSync(path.join(dataDir, 'projects.yaml'), `schema_version: "2.0"

# Projects Registry — ${orgName}
# Long-lived workstreams. Specific implementation plans live in docs/agent-plans/
# and reference their parent via \`workstream:\` frontmatter.

projects: []
`);

  // ideas.yaml — empty list
  fs.writeFileSync(path.join(dataDir, 'ideas.yaml'), `schema_version: "2.0"

# Ideas Registry — ${orgName}
# Lifecycle: surfaced → proposed → approved → developing → hatched → archived

ideas: []
`);

  // governance.yaml — empty governance with no decisions
  fs.writeFileSync(path.join(dataDir, 'governance.yaml'), `schema_version: "2.0"

# Governance Registry — ${orgName}

governance:
  model: "solo-maintainer"     # solo-maintainer | steward-council | multisig | assembly | conviction
  current_phase: "bootstrap"   # bootstrap | transition | active | sunset
  infrastructure:
    safe: null
    hats_tree: null
    gardens: null
    snapshot: null
  decisions: []
  elections: []
`);

  // relationships.yaml — empty list
  fs.writeFileSync(path.join(dataDir, 'relationships.yaml'), `schema_version: "2.0"

# Relationships Registry — ${orgName}
# Tracks relationships with peers, instances, and ecosystem collaborators.

relationships: []
`);

  // members.yaml — operator from answers (if any), else empty
  const seedMembers = (answers?.members || []).map((m) => {
    const handle = m.github ? `github:${m.github}` : (m.handle || 'unknown');
    return {
      id: handle,
      name: m.name || m.github || 'Operator',
      role: m.role || 'maintainer',
      joined: new Date().toISOString().slice(0, 10),
      handles: m.github ? { github: m.github } : {},
    };
  });
  fs.writeFileSync(path.join(dataDir, 'members.yaml'), `schema_version: "2.0"

# Members Registry — ${orgName}

${yaml.dump({ members: seedMembers })}`);

  log(`reset data registries (projects, ideas, governance, relationships, members[${seedMembers.length}])`);
}

// Stage 4c: render a lean instance package.json (Fix 5, Option A)
function renderInstancePackageJson(answers) {
  if (args.dryRun) {
    log('render lean instance package.json (drop framework-only scripts)');
    return;
  }
  const orgSlug = (answers?.identity?.name || 'org-os-instance')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Read framework package.json so dependencies/engines stay in lockstep with
  // what the instance actually needs (the script files copied across).
  let fwPkg = {};
  try {
    fwPkg = JSON.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf-8'));
  } catch {}

  const instancePkg = {
    name: orgSlug || 'org-os-instance',
    description: answers?.identity?.short_description || 'org-os instance',
    private: true,
    version: '0.1.0',
    type: 'module',
    license: fwPkg.license || 'MIT',
    scripts: {
      initialize: 'node scripts/initialize.mjs',
      sync: 'node scripts/sync-github.mjs',
      'sync:upstream': 'node scripts/sync-upstream.mjs',
      'sync:packages': 'node scripts/sync-packages.mjs',
      'generate:schemas': 'node scripts/generate-all-schemas.mjs',
      'validate:schemas': 'node scripts/validate-identity.mjs',
      'validate:structure': 'node scripts/validate-structure.mjs',
      'clone:repos': 'node scripts/clone-linked-repos.mjs',
      migrate: 'node scripts/migrate.mjs',
      check: 'tsc --noEmit && npx prettier . --check',
      format: 'npx prettier . --write',
    },
    engines: fwPkg.engines || { node: '>=22', npm: '>=10.9.2' },
    dependencies: fwPkg.dependencies || {},
    devDependencies: fwPkg.devDependencies || {},
  };
  fs.writeFileSync(path.join(args.target, 'package.json'),
    JSON.stringify(instancePkg, null, 2) + '\n');
  log(`rendered instance package.json (name=${instancePkg.name})`);
}

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

// Stage 4 (deferred): identity-scoped resets need answers, so they run here
// rather than immediately after copy/strip.
resetMarkdown(answers);
resetDataRegistries(answers);
renderInstancePackageJson(answers);

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

// Stage 8: write federation.yaml + render dao.json + run sync-packages (Task 25)
function getFrameworkVersion() {
  // Derive framework_version (major.minor) from the framework's package.json so
  // it always matches what gets copied into the target — keeps validate-structure's
  // version-consistency check happy.
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf-8'));
    const m = (pkg.version || '').match(/^(\d+)\.(\d+)/);
    if (m) return `${m[1]}.${m[2]}`;
  } catch {}
  return answers?.federation?.framework_version || '3.0';
}

function writeFederation(answers) {
  if (args.dryRun) {
    log('write federation.yaml + render dao.json + run sync:packages');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const frameworkVersion = getFrameworkVersion();
  const network = answers.federation?.network || null;
  const upstream = answers.federation?.upstream || '../org-os';

  // Nested federation.yaml schema — matches validate-structure.mjs expectations
  // (identity / federation / agent / metadata sections + metadata.framework_version).
  const fed = {
    version: '3.0',
    spec: 'organizational-os/3.0',

    identity: {
      name: answers.identity?.name || 'Unnamed Instance',
      type: answers.identity?.type || 'Project',
      emoji: answers.identity?.emoji || '',
      short_description: answers.identity?.short_description || '',
      daoURI: '',
      onchain_registration: { enabled: false, chain: '', contract_address: '' },
    },

    federation: {
      network,
      upstream,
      role: 'standalone-instance',
      peers: [],
      downstream: [],
    },

    agent: {
      runtime: 'claude-code',
      workspace: '.',
      skills: answers.skills?.enabled || [],
      channels: [],
      proactive: false,
      heartbeat_interval: '1h',
    },

    'knowledge-commons': {
      enabled: false,
      'shared-domains': [],
      'sync-protocol': 'git',
      publish: { meetings: false, projects: false, funding: false },
      subscribe: [],
    },

    // Operational packages — sync-packages.mjs requires `packages` to be a flat
    // map of { id: boolean }, so we keep that shape at the top level.
    packages: answers.packages || {},

    governance: {
      maintainers: (answers.members || []).map((m) => ({
        handle: m.github ? `github:${m.github}` : (m.handle || 'unknown'),
        role: m.role || 'maintainer',
      })),
      decision_model: 'solo-maintainer',
      proposal_threshold: 'maintainer decision',
    },

    platforms: {
      primary: 'github',
      deployment: 'github-pages',
      domain: '',
      mirrors: [],
    },

    metadata: {
      created: today,
      last_updated: today,
      framework_version: frameworkVersion,
    },
  };
  fs.writeFileSync(path.join(args.target, 'federation.yaml'), yaml.dump(fed));
  log(`wrote federation.yaml (framework_version=${frameworkVersion})`);

  // Render .well-known/dao.json from its template using bootstrap answers so
  // generate:schemas (which only READS dao.json) and validate-structure both
  // find a populated, parseable dao.json in the new instance.
  renderDaoJson(answers);

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

function renderDaoJson(answers) {
  const wellKnownDir = path.join(args.target, '.well-known');
  fs.mkdirSync(wellKnownDir, { recursive: true });
  const tmplPath = path.join(wellKnownDir, 'dao.json.template');
  const orgName = answers.identity?.name || 'Unnamed Instance';
  const orgDescription = answers.identity?.short_description || `${orgName} — org-os instance`;
  // Sensible default base URL; instance owner can edit later.
  const baseUrl = `${(orgName || 'instance').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example.com`;

  let dao;
  if (fs.existsSync(tmplPath)) {
    const raw = fs.readFileSync(tmplPath, 'utf-8')
      .replace(/\{\{ORGANIZATION_NAME\}\}/g, orgName)
      .replace(/\{\{ORGANIZATION_DESCRIPTION\}\}/g, orgDescription)
      .replace(/\{\{BASE_URL\}\}/g, baseUrl);
    dao = JSON.parse(raw);
  } else {
    dao = {
      '@context': 'http://www.daostar.org/schemas',
      type: answers.identity?.type || 'Organization',
      name: orgName,
      description: orgDescription,
    };
  }
  fs.writeFileSync(path.join(wellKnownDir, 'dao.json'), JSON.stringify(dao, null, 2) + '\n');
  log('rendered .well-known/dao.json from template');
}

writeFederation(answers);

// Stage 9: npm install + generate:schemas + validate (Task 26)
function installAndValidate() {
  if (args.dryRun) {
    log('npm install + generate:schemas + validate:schemas + validate:structure');
    return;
  }
  log('npm install in target ...');
  let r = spawnSync('npm', ['install'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('npm install failed; instance left in inspectable state');
    process.exit(r.status || 1);
  }
  // generate:schemas must run AFTER npm install (needs node_modules) and BEFORE
  // the validators (so .well-known/*.json files exist for validate-structure).
  log('npm run generate:schemas ...');
  r = spawnSync('npm', ['run', 'generate:schemas'], { cwd: args.target, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('generate:schemas failed; instance left in inspectable state');
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
