# org-os Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one guided path that takes an operator from "I want an org-os instance" to a running instance and then keeps going — same agent, same conversation — through day-to-day operation.

**Architecture:** The wizard is a **path across the four canonical surfaces**, not a fifth surface: it is entered through Conversational, it drives the CLI, and it hands off to Admin and KMS. It holds **no state of its own** — `instance-doctor`'s scorecard is the state machine, and a pure `nextRung()` function maps that scorecard to the single thing the concierge should offer next. Phase 0 is documentation only. Phase 1 adds the two missing scorecard signals, the role registry, the ladder module and the skill. Phase 2 is the profile install/update contract and is **gated**.

**Tech Stack:** Node ESM (`.mjs`), `node --test` via the root glob `tests/**/*.test.mjs`, `js-yaml` (already a dependency). No new npm dependencies. Prettier for formatting. External (Phase 2 only): Hermes at version floor `v2026.8.16.2`.

**Spec:** `docs/superpowers/specs/2026-08-29-org-os-wizard-design.md`

## Global Constraints

- **The interfaces spec §4 is binding and unamended.** No new server, no new plane, no new write path. Everything here is a CLI/data-plane client. (spec §3, §9)
- **One role, not a roster.** `data/agent-roster.yaml` defines exactly `concierge` in v1, plus the schema for more. Do not add Comms/Governance/Ideation roles — those are refi-dao's. (spec §5 finding 1, §10)
- **The wizard never handles credentials.** It drafts; the operator executes. No key, token, or secret is ever read, written, or echoed. (spec §9)
- **Checks are pure functions.** `snapshot → CheckResult`. All filesystem I/O lives in `packages/instance-doctor/src/snapshot.mjs`; check fixtures are plain objects and check tests never touch the disk. (existing package contract, `snapshot.mjs` header)
- **The overlay never writes an instance-owned path.** Any change to `overlay.mjs` preserves that property; it is the reason the module exists. (`tests/instance-doctor/overlay.test.mjs` header)
- Tests live under root `tests/` — the glob `tests/**/*.test.mjs` covers them. No nested package test suite.
- `npx prettier --check` green on **code files only** (`.mjs`, `.json`) before every commit. Markdown in this repo is *not* prettier-formatted — every committed doc fails `--check` and CI does not run it, so reformatting docs would produce a large spurious diff. Never run `prettier --write` on a `.md` file here.
- Stage explicit paths only, never `git add -A`.
- The pre-commit hook runs `validate:structure`; a commit that breaks it will be rejected. Run `npm run validate:structure` before committing.
- Vault safety: this repo sits inside an Obsidian vault. Never `git stash`, `git clean`, or `git reset --hard`. Commit to the operator trunk (`luizfernando`), never to `main`.
- Phase 0 must stay **0.5.1-safe**: documentation only, no code, nothing that changes behavior.

---

## Phase 0 — Documentation (0.5.1-safe, unblocked, targets the ~2026-09-10 session)

### Task 1: `START-HERE.md` — the one page

**Files:**
- Create: `docs/START-HERE.md`
- Test: manual acceptance (step 5) — this task ships prose, and its test is that the prose works

**Interfaces:**
- Produces: `docs/START-HERE.md` with two anchors, `#door-a--i-already-use-an-ai-agent` and `#door-b--i-dont-have-one-yet`, which Task 2 links to.

The page's only job is to get a human to a working chat window. It is **not** the agent recipe — `docs/ADOPT-WITH-AN-AGENT.md` is, it already exists, and it is already verified end-to-end against v0.5.0. Do not duplicate its contents here; link to it.

- [ ] **Step 1: Read the two documents this page sits between**

Run: `sed -n '1,40p' docs/ADOPT-WITH-AN-AGENT.md` and `sed -n '30,50p' docs/OPERATOR-GUIDE.md`

You need to know what Door A already promises, so that `START-HERE.md` does not contradict or restate it.

- [ ] **Step 2: Write `docs/START-HERE.md`**

```markdown
# Start here

You do not need to be a developer to run an org-os instance. You need a chat
window with an AI agent in it. That is what this page is for — everything after
it is a conversation.

Pick the door that matches you.

## Door A — I already use an AI agent

If you use Claude Code, Cursor, OpenCode, or any coding agent with shell access:

1. Open it in an empty folder.
2. Say: **"Set up an org-os instance for &lt;my org&gt;. Follow
   https://github.com/regen-coordination/org-os-template/blob/main/docs/ADOPT-WITH-AN-AGENT.md"**
3. Answer its questions in plain language — org name, what you do, who you are.

The agent does the rest and shows you a health report at the end. That report is
not a formality: it is the same report your agent reads every time afterward to
know what to help you with next.

**[The recipe your agent follows →](ADOPT-WITH-AN-AGENT.md)**

## Door B — I don't have one yet

*Coming in 0.6.0.* One command installs the org's concierge agent — its role, its
skills, its schedule — into a chat app you already have. Until then, take Door A;
any of the agents listed there has a free tier.

## What happens after setup

The same agent that set you up is the one you keep talking to. There is no
"finished" moment and no second tool to learn. Ask it things like:

- *"What should I do next?"* — it reads your instance's health report and tells you
- *"Who are our members?"* / *"Add a project called X"*
- *"What's overdue?"*

When you want to see everything at once rather than ask for it, org-os has a
visual admin app; when you outgrow chat, everything is plain files in a git
repository you own. You are never locked into the door you came in through.

## If something goes wrong

Ask your agent — it can run the health check itself and read you the result. If
it is stuck, open an issue on the
[org-os repository](https://github.com/regen-coordination/org-os-template/issues)
and paste what the health check said.
```

- [ ] **Step 3: Check the prose against the two rules that govern it**

Read your draft and confirm both:
- It never tells the human to run a terminal command. (Door A step 2 is a sentence they say, not a command they run.)
- It never restates Door A's recipe. If you find yourself explaining `clone:framework`, delete it and link instead.

- [ ] **Step 4: Verify every link resolves**

Run:
```bash
grep -oE '\]\([^)#][^)]*\)' docs/START-HERE.md | tr -d ']()' | while read -r l; do
  case "$l" in http*) echo "SKIP (external) $l";;
  *) [ -f "docs/$l" ] && echo "OK   $l" || echo "DEAD $l";; esac
done
```
Expected: every non-external link prints `OK`.

- [ ] **Step 5: Acceptance — re-run Door A literally, in a scratch directory**

This is the spec's Phase 0 verification (§11). Follow `ADOPT-WITH-AN-AGENT.md` steps 1–5 exactly as written, in `/tmp`, as if you had no other context:

```bash
cd /tmp && rm -rf wizard-accept && mkdir wizard-accept && cd wizard-accept
git clone https://github.com/regen-coordination/org-os-template.git
cd org-os-template && npm install
# write my-org.yaml per the recipe, then:
npm run clone:framework -- --target ../harbor-bakery-os --config my-org.yaml
cd ../harbor-bakery-os && npm install
npm run generate:schemas && npm run validate:schemas && npm run validate:structure
cd ../org-os-template && npm run doctor -- --dir ../harbor-bakery-os
```

Expected: the doctor scorecard shows **no blockers except `git-remote-absent`**. Any other blocker is a framework bug — stop, record it, and report it before continuing the plan.

- [ ] **Step 6: Commit**

```bash
npm run validate:structure
git add docs/START-HERE.md
git commit -m "docs(wizard): START-HERE — the one page, two doors

Its only job is a working chat window. Door A links to the verified
ADOPT-WITH-AN-AGENT recipe rather than restating it; Door B is marked 0.6.0.
Re-ran Door A end to end in a scratch directory: only blocker is the expected
git-remote-absent."
```

---

### Task 2: Wire the entry points

**Files:**
- Modify: `docs/OPERATOR-GUIDE.md` (Level 2 section, currently lines 32–45)
- Modify: `BOOTSTRAP.md` (Quick Path section, currently lines 15–56)
- Modify: `docs/superpowers/specs/2026-08-29-org-os-interfaces-design.md` (§4 "Not surfaces" paragraph)
- Modify: `README.md`
- Create: `tests/docs-entry-points.test.mjs`

**Interfaces:**
- Consumes: `docs/START-HERE.md` and its two anchors from Task 1.
- Produces: a test asserting the entry-point links stay alive, so a future rename cannot silently orphan the one page.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/docs-entry-points.test.mjs
//
// START-HERE.md is the only page a new operator is sent to. If a rename or a
// docs reshuffle orphans it, onboarding breaks silently and nothing else in the
// suite notices. These tests are the tripwire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf-8');

test('START-HERE.md exists and offers both doors', () => {
  assert.ok(existsSync(new URL('../docs/START-HERE.md', import.meta.url)));
  const page = read('docs/START-HERE.md');
  assert.match(page, /## Door A/);
  assert.match(page, /## Door B/);
});

test('START-HERE never tells a human to run a terminal command', () => {
  // Door A is a sentence you say, not a command you run. Fenced bash blocks in
  // this page would mean the one-page promise has quietly regressed.
  assert.doesNotMatch(read('docs/START-HERE.md'), /```(bash|sh|console)/);
});

test('the three entry points all point at START-HERE', () => {
  for (const p of ['docs/OPERATOR-GUIDE.md', 'BOOTSTRAP.md', 'README.md']) {
    assert.match(read(p), /START-HERE\.md/, `${p} does not link to START-HERE.md`);
  }
});

test('Door A still points at a recipe that exists', () => {
  assert.ok(existsSync(new URL('../docs/ADOPT-WITH-AN-AGENT.md', import.meta.url)));
  assert.match(read('docs/START-HERE.md'), /ADOPT-WITH-AN-AGENT\.md/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/docs-entry-points.test.mjs`
Expected: FAIL — the three entry points do not yet link to `START-HERE.md`.

- [ ] **Step 3: Point OPERATOR-GUIDE Level 2 at the page**

`docs/OPERATOR-GUIDE.md` Level 2 already tells the truth (there is no web form). It just needs the entry point. Replace its opening paragraph with:

```markdown
### Level 2: Guided Setup (Basic Computer Literacy)

Bootstrap a new org **with an AI agent doing the terminal work for you**. Start at
**[START-HERE.md](START-HERE.md)** — one page, two doors, no terminal. There is no
web form; the honest version of this level is that you talk and the agent runs the
one recommended path. The copy-paste recipe your agent follows is
[`ADOPT-WITH-AN-AGENT.md`](ADOPT-WITH-AN-AGENT.md); it covers:
```

Leave the numbered list and the paragraph that follows it unchanged.

- [ ] **Step 4: Cross-link BOOTSTRAP.md**

Add directly beneath the `## Quick Path: Cloning Engine (v3.5+)` heading:

```markdown
> **Not a developer?** Start at [`docs/START-HERE.md`](docs/START-HERE.md) instead —
> it gets you to an agent that runs everything below for you. This page is the
> mechanism; that page is the way in.
```

- [ ] **Step 5: Add the clarifying line to interfaces §4**

In `docs/superpowers/specs/2026-08-29-org-os-interfaces-design.md`, append to the **Not surfaces** paragraph:

```markdown
A *path across* surfaces is likewise not a surface: `org-os-wizard`
([spec](2026-08-29-org-os-wizard-design.md)) is entered through Conversational and
choreographs CLI, Admin and KMS, but introduces no plane and no server, so it is a
client under §3's rule and needs no entry here.
```

- [ ] **Step 6: Link it from the README**

Find the README's getting-started or quick-start area and add one line near the top:

```markdown
**New here and not a developer?** → [Start here](docs/START-HERE.md)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/docs-entry-points.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 8: Commit**

```bash
npx prettier tests/docs-entry-points.test.mjs --check
npm run validate:structure
git add docs/OPERATOR-GUIDE.md BOOTSTRAP.md README.md tests/docs-entry-points.test.mjs \
        docs/superpowers/specs/2026-08-29-org-os-interfaces-design.md
git commit -m "docs(wizard): route the three entry points at START-HERE

OPERATOR-GUIDE Level 2, BOOTSTRAP Quick Path and the README now point at the one
page; interfaces §4 records that a path across surfaces is not a surface. A test
pins the links so a rename cannot orphan onboarding silently."
```

**Phase 0 is complete here.** It is docs-only and safe to merge during 0.5.1. Everything below targets 0.6.0.

---

## Phase 1 — The concierge (targets 0.6.0)

### Task 3: The two missing scorecard signals

**Files:**
- Modify: `packages/instance-doctor/src/snapshot.mjs` (add registry counts to the returned object, ~line 217)
- Create: `packages/instance-doctor/src/checks/substance.mjs`
- Modify: `packages/instance-doctor/src/assess.mjs:18-26` (register the check)
- Test: `tests/instance-doctor/substance.test.mjs`

**Interfaces:**
- Consumes: `finding.warn(code, message, hint)` and `result(id, title, findings)` from `packages/instance-doctor/src/lib/finding.mjs`.
- Produces: `checkSubstance(snapshot)` → `CheckResult` with id `'substance'`; finding codes **`registries-unpopulated`** and **`no-sources-ingested`**; and `snapshot.registries` → `{members: number, projects: number, sources: number}`. Task 5's ladder matches on those two codes by name.

**Why this task exists:** the doctor's snapshot never reads `data/*.yaml` *contents*, so nothing reports the state a freshly-cloned instance is actually in — structurally valid, organizationally empty. That is the rung the wizard needs most, and without it the "scorecard is the state machine" claim is false. (spec §4)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/instance-doctor/substance.test.mjs
//
// A clone passes every structural check while describing no organization at all.
// That state is invisible to the other six checks — they ask "is this instance
// well-formed?", never "does it say anything?". The wizard's ladder needs this
// signal, and the scorecard is the only state source it is allowed to read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSubstance } from '../../packages/instance-doctor/src/checks/substance.mjs';

const codes = (r) => r.findings.map((f) => f.code);
const snap = (over = {}) => ({ isFramework: false, registries: { members: 0, projects: 0, sources: 0 }, ...over });

test('an empty instance reports both signals', () => {
  const r = checkSubstance(snap());
  assert.deepEqual(codes(r).sort(), ['no-sources-ingested', 'registries-unpopulated']);
  assert.equal(r.id, 'substance');
  assert.equal(r.status, 'WARN');
});

test('a populated instance is clean', () => {
  const r = checkSubstance(snap({ registries: { members: 3, projects: 2, sources: 1 } }));
  assert.deepEqual(codes(r), []);
  assert.equal(r.status, 'OK');
});

test('members alone counts as populated — a solo org is a real org', () => {
  const r = checkSubstance(snap({ registries: { members: 1, projects: 0, sources: 1 } }));
  assert.deepEqual(codes(r), []);
});

test('the framework repo is exempt', () => {
  // The framework is a running instance, but its registries describe the
  // framework, not an adopting org. Emptiness there is not a defect.
  const r = checkSubstance(snap({ isFramework: true }));
  assert.deepEqual(codes(r), []);
});

test('a missing registries bag is treated as empty, never as a crash', () => {
  // A broken instance is the normal input for this package.
  const r = checkSubstance({ isFramework: false });
  assert.deepEqual(codes(r).sort(), ['no-sources-ingested', 'registries-unpopulated']);
});

test('every finding carries an actionable hint', () => {
  for (const f of checkSubstance(snap()).findings) {
    assert.ok(f.hint && f.hint.length > 0, `${f.code} has no hint`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/instance-doctor/substance.test.mjs`
Expected: FAIL — `Cannot find module '.../checks/substance.mjs'`.

- [ ] **Step 3: Write the check**

```javascript
// packages/instance-doctor/src/checks/substance.mjs
/**
 * substance.mjs — does this instance describe an organization yet?
 *
 * The other six checks ask whether the instance is well-formed. None of them
 * asks whether it says anything, so a fresh clone scores clean while being
 * completely empty. That is exactly the state a new operator is in, and it is
 * the rung the wizard's ladder needs in order to offer the interview.
 *
 * WARN, never BLOCKER: an empty instance is not broken, it is new.
 */
import { finding, result } from '../lib/finding.mjs';

export function checkSubstance(snapshot) {
  const findings = [];

  // The framework repo is itself a running instance, but its registries
  // describe the framework rather than an adopting org.
  if (snapshot.isFramework) return result('substance', 'Substance', findings);

  const r = snapshot.registries ?? {};
  const members = r.members ?? 0;
  const projects = r.projects ?? 0;

  if (members === 0 && projects === 0) {
    findings.push(
      finding.warn(
        'registries-unpopulated',
        'data/members.yaml and data/projects.yaml are both empty — the instance is valid but describes no organization yet',
        'run the bootstrap-interviewer skill (BOOTSTRAP.md Phase 1)',
      ),
    );
  }

  if ((r.sources ?? 0) === 0) {
    findings.push(
      finding.warn(
        'no-sources-ingested',
        'data/sources.yaml lists no content sources — nothing has been ingested yet',
        'add one source, then npm run compile:knowledge (BOOTSTRAP.md Phase 2)',
      ),
    );
  }

  return result('substance', 'Substance', findings);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/instance-doctor/substance.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Feed the check from the snapshot**

In `packages/instance-doctor/src/snapshot.mjs`, add this helper next to the other readers (below `readYaml`, ~line 68):

```javascript
/** Count the entries in a registry list, tolerating every kind of malformed file. */
function registryCount(root, file, key) {
  const doc = readYaml(path.join(root, 'data', file));
  const list = doc?.[key];
  return Array.isArray(list) ? list.length : 0;
}
```

Then add one field to the object returned by `readInstance` (alongside `dirs`, ~line 233):

```javascript
    registries: {
      members: registryCount(root, 'members.yaml', 'members'),
      projects: registryCount(root, 'projects.yaml', 'projects'),
      sources: registryCount(root, 'sources.yaml', 'sources'),
    },
```

- [ ] **Step 6: Register the check**

In `packages/instance-doctor/src/assess.mjs`, add the import beside the others (after line 13):

```javascript
import { checkSubstance } from './checks/substance.mjs';
```

and place it in `CHECKS` between `checkStructure` and `checkFreshness` — the reading order is *am I well-formed → do I say anything → am I alive*:

```javascript
const CHECKS = [
  checkIdentity,
  checkLineage,
  checkVersions,
  checkMachinery,
  checkStructure,
  checkSubstance,
  checkFreshness,
];
```

- [ ] **Step 7: Find and fix anything that hardcoded the check count**

Adding a seventh check will break any test asserting six.

Run: `grep -rnE "checks: *6|length, *6|summary\.checks" tests/ packages/instance-doctor/`

For each hit, update the expected number to 7. If a test asserts on a *specific* check list, add `substance` in the position chosen in step 6.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS. If anything else fails, it is a real coupling you have just surfaced — fix it here rather than deferring.

- [ ] **Step 9: Verify the new signal against a real empty instance**

```bash
npm run doctor -- --dir /tmp/wizard-accept/harbor-bakery-os
```
Expected: the scorecard now shows a `Substance` line with `registries-unpopulated` and `no-sources-ingested` as WARNs, and the blocker set is unchanged (still only `git-remote-absent`). If the instance from Task 1 is gone, re-create it with the same commands.

- [ ] **Step 10: Commit**

```bash
npx prettier packages/instance-doctor/src/checks/substance.mjs \
             packages/instance-doctor/src/snapshot.mjs \
             packages/instance-doctor/src/assess.mjs \
             tests/instance-doctor/substance.test.mjs --check
npm run validate:structure
git add packages/instance-doctor/src/checks/substance.mjs \
        packages/instance-doctor/src/snapshot.mjs \
        packages/instance-doctor/src/assess.mjs \
        tests/instance-doctor/substance.test.mjs
git commit -m "feat(doctor): substance check — does this instance describe an org yet?

The six existing checks ask whether an instance is well-formed, never whether it
says anything, so a fresh clone scores clean while being completely empty. That
is the state a new operator is actually in and the rung the wizard's ladder needs.
WARN, never BLOCKER: an empty instance is new, not broken."
```

---

### Task 4: `data/agent-roster.yaml` — one role

**Files:**
- Create: `data/agent-roster.yaml`
- Modify: `docs/DATA-MODEL.md` (Framework-Only Registries section, ~line 330)
- Test: `tests/agent-roster.test.mjs`

**Interfaces:**
- Produces: `data/agent-roster.yaml` with `schema_version: "1.0"` and a `roles:` list whose single entry has id `concierge`. Task 5's skill and Task 7's manifest both read `roles[].id`, `roles[].soul`, `roles[].skills`.

**Why data and not code:** the roster is runtime-neutral on purpose. Hermes profiles, Berd's `.agents/skills/` bridge and Claude Code skills are all *consumers*; the registry presumes none of them. (spec §5 finding 1)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/agent-roster.test.mjs
//
// The roster is the framework's answer to "who is the agent you talk to?".
// It ships exactly one role. A framework that shipped a Comms Bot would have
// assumed something about the adopting org that org-os is not entitled to
// assume, so "exactly one" is a tested constraint, not a convention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

const roster = yaml.load(readFileSync(new URL('../data/agent-roster.yaml', import.meta.url), 'utf-8'));

test('the roster is valid and versioned', () => {
  assert.equal(roster.schema_version, '1.0');
  assert.ok(Array.isArray(roster.roles));
});

test('v1 ships exactly one role, and it is the concierge', () => {
  assert.equal(roster.roles.length, 1);
  assert.equal(roster.roles[0].id, 'concierge');
});

test('every role declares the fields a runtime needs to materialize it', () => {
  for (const role of roster.roles) {
    for (const field of ['id', 'title', 'soul', 'skills', 'model_tier']) {
      assert.ok(role[field] !== undefined, `role ${role.id} is missing ${field}`);
    }
    assert.ok(Array.isArray(role.skills) && role.skills.length > 0);
  }
});

test('no role declares credentials, tokens or secrets', () => {
  // The wizard never handles keys (spec §9). Keeping that true starts here:
  // a role that could name a credential would be a place to leak one.
  const text = readFileSync(new URL('../data/agent-roster.yaml', import.meta.url), 'utf-8');
  assert.doesNotMatch(text, /\b(api_key|token|secret|password|nsec|credential)\b/i);
});

test('the concierge names skills that exist in this repo', () => {
  for (const skill of roster.roles[0].skills) {
    assert.ok(
      existsSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url)),
      `skill ${skill} has no SKILL.md`,
    );
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/agent-roster.test.mjs`
Expected: FAIL — `ENOENT ... data/agent-roster.yaml`.

- [ ] **Step 3: Write the registry**

```yaml
schema_version: "1.0"

# Agent Roster — FRAMEWORK REGISTRY
# Named agent roles an org-os instance can materialize. Runtime-neutral by
# construction: Hermes profiles, Berd's .agents/skills/ bridge and Claude Code
# skills are all consumers of this file, and it presumes none of them.
#
# v1 ships exactly ONE role. A framework that shipped a Comms Bot or a
# Governance Bot would have assumed something about the adopting organization
# that org-os is not entitled to assume. Instances add their own roles here;
# refi-dao-os's five-Bot roster is instance infrastructure and stays there.
#
# model_tier: default | economy — advisory. Runtimes map tiers to real models.

roles:
  - id: "concierge"
    title: "Concierge"
    soul: "skills/org-os-wizard/SOUL.md"
    model_tier: "default"
    skills:
      - org-os-wizard
      - bootstrap-interviewer
      - instance-doctor
      - knowledge-curator
    cron: []
    notes: >
      The agent an operator meets first and keeps talking to. Sets the instance
      up, then reads the doctor scorecard to offer the next step, indefinitely.
      Setup and operation are the same conversation — there is no completion
      event and no second agent to hand off to.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/agent-roster.test.mjs`
Expected: FAIL on the last test only — `skills/org-os-wizard/SKILL.md` does not exist yet. That is Task 5. The other four pass.

- [ ] **Step 5: Document the registry**

In `docs/DATA-MODEL.md`, under **Framework-Only Registries**, add after the `packages-matrix.yaml` entry:

```markdown
### agent-roster.yaml — Named Agent Roles

Runtime-neutral registry of the named agent roles an instance can materialize.
Fields: `id`, `title`, `soul` (path to the role's SOUL), `model_tier`
(`default|economy`, advisory), `skills[]`, `cron[]`, `notes`.

v1 defines one role (`concierge`) — the agent an operator meets first and keeps
talking to. Consumers materialize it: Hermes as a profile, Berd as
`.agents/skills/`, Claude Code as a skill. The registry never contains
credentials. See `docs/superpowers/specs/2026-08-29-org-os-wizard-design.md` §5.
```

- [ ] **Step 6: Commit** (the roster test's last assertion stays red until Task 5 — that is the intended sequence)

```bash
npx prettier tests/agent-roster.test.mjs --check
npm run validate:structure
git add data/agent-roster.yaml docs/DATA-MODEL.md tests/agent-roster.test.mjs
git commit -m "feat(wizard): agent-roster registry — one role, the concierge

Runtime-neutral: Hermes profiles, Berd's skills bridge and Claude Code are all
consumers and the registry presumes none of them. Exactly one role is a tested
constraint — shipping a Comms Bot would assume something about the adopting org
that the framework is not entitled to assume."
```

---

### Task 5: The ladder — scorecard to next rung

**Files:**
- Create: `scripts/wizard-ladder.mjs`
- Modify: `package.json` (add the `wizard:next` script)
- Test: `tests/wizard-ladder.test.mjs`

**Interfaces:**
- Consumes: the assessment object produced by `assessSnapshot()` — `{checks: [{findings: [{level, code, hint}]}], summary}` — and the finding codes `registries-unpopulated` / `no-sources-ingested` from Task 3.
- Produces: `nextRung(assessment)` → `{id, title, say, run}` and `findingCodes(assessment)` → `Set<string>`. Task 6's SKILL.md calls `npm run wizard:next` and reads `say`/`run`.

`scripts/` is `FRAMEWORK_OWNED` in the overlay, so putting the ladder here means every instance receives it on sync — which is the point: the concierge must work inside the operator's own instance, not only in the framework checkout.

**Rung order is a safety decision, not an aesthetic one.** Identity leakage is fixed *before* the instance gets a git remote, because pushing an instance that still publishes the framework's identity broadcasts the wrong organization to the network. The order is: don't publish a lie → say who you are → publish it → back it up → fill it in → feed it → live in it.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/wizard-ladder.test.mjs
//
// The ladder is the wizard's entire state machine. It holds no state of its own:
// given a doctor assessment it returns the single next thing to offer, so a
// re-run always reconstructs where the operator actually is — including for
// someone who did half the setup by hand a month ago.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRung, findingCodes, RUNGS } from '../scripts/wizard-ladder.mjs';

const assessment = (...codes) => ({
  checks: [{ findings: codes.map((code) => ({ level: 'WARN', code, hint: 'h' })) }],
  summary: { blockers: 0, warnings: codes.length, checks: 7 },
});

test('no instance yields the create rung', () => {
  assert.equal(nextRung(null).id, 'create-instance');
  assert.equal(nextRung(undefined).id, 'create-instance');
});

test('a clean scorecard yields the operate rung', () => {
  assert.equal(nextRung(assessment()).id, 'operate');
});

test('each code maps to its rung', () => {
  const cases = {
    'template-leakage': 'fix-identity-leak',
    'identity-name-disagreement': 'fix-identity-leak',
    'identity-md-missing': 'author-identity',
    'scaffold-placeholder': 'author-identity',
    'dao-json-missing': 'publish-identity',
    'git-remote-absent': 'back-up',
    'not-a-git-repo': 'back-up',
    'registries-unpopulated': 'populate-registries',
    'no-sources-ingested': 'ingest-source',
  };
  for (const [code, rung] of Object.entries(cases)) {
    assert.equal(nextRung(assessment(code)).id, rung, `${code} should map to ${rung}`);
  }
});

test('identity leakage outranks the git remote', () => {
  // Pushing an instance that still publishes the framework's identity
  // broadcasts the wrong organization. Fix the lie before backing it up.
  assert.equal(nextRung(assessment('git-remote-absent', 'template-leakage')).id, 'fix-identity-leak');
});

test('the ladder returns exactly one rung, always', () => {
  const r = nextRung(assessment('no-sources-ingested', 'git-remote-absent', 'dao-json-missing'));
  assert.equal(typeof r.id, 'string');
  assert.equal(r.id, 'back-up');
});

test('every rung has something to say and every non-terminal rung something to run', () => {
  for (const rung of RUNGS) {
    assert.ok(rung.say?.length > 0, `${rung.id} has no say`);
    assert.ok(Array.isArray(rung.run), `${rung.id}.run must be an array`);
  }
});

test('unknown codes do not derail the ladder', () => {
  // New checks land upstream all the time; an unrecognized code must degrade to
  // "keep operating", never crash the operator's first conversation.
  assert.equal(nextRung(assessment('some-future-code')).id, 'operate');
});

test('findingCodes flattens every check', () => {
  const a = {
    checks: [
      { findings: [{ code: 'a' }, { code: 'b' }] },
      { findings: [{ code: 'c' }] },
      {},
    ],
  };
  assert.deepEqual([...findingCodes(a)].sort(), ['a', 'b', 'c']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/wizard-ladder.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/wizard-ladder.mjs'`.

- [ ] **Step 3: Write the ladder**

```javascript
// scripts/wizard-ladder.mjs
/**
 * wizard-ladder.mjs — given a doctor assessment, what does the concierge offer next?
 *
 * The wizard holds no state. This module is why: the instance's own scorecard
 * is the state machine, so re-running it always reconstructs where the operator
 * really is. Nothing to persist, nothing to corrupt, nothing to resume — and an
 * operator who did half the setup by hand a month ago gets the right next step,
 * because the scorecard describes the instance rather than the session.
 *
 * ORDER IS A SAFETY DECISION. Identity leakage is fixed before the instance gets
 * a git remote: pushing an instance that still publishes the framework's identity
 * broadcasts the wrong organization to the network. Don't publish a lie → say who
 * you are → publish it → back it up → fill it in → feed it → live in it.
 *
 * Lives in scripts/ because scripts/ is FRAMEWORK_OWNED in the overlay, so every
 * instance receives this file on sync. The concierge has to work inside the
 * operator's own instance, not only in a framework checkout.
 */

/** Ordered; first match wins. The terminal rung has no codes. */
export const RUNGS = [
  {
    id: 'create-instance',
    title: 'No instance yet',
    say: "There's no org-os instance here yet. I can create one — I need your org's name, what kind of thing it is, and a one-line description.",
    run: ['npm run clone:framework -- --target <dir> --config <config>.yaml'],
  },
  {
    id: 'fix-identity-leak',
    codes: ['template-leakage', 'identity-name-disagreement'],
    title: 'The instance is publishing the wrong organization',
    say: "Right now this instance still publishes the framework's identity rather than yours. Let's fix that before it goes anywhere public.",
    run: ['npm run generate:schemas', 'npm run validate:schemas'],
  },
  {
    id: 'author-identity',
    codes: ['identity-md-missing', 'scaffold-placeholder'],
    title: 'The org has not said who it is',
    say: "Your instance doesn't describe your organization yet. Let's do the interview — I'll ask, you answer in plain language.",
    run: ['bootstrap-interviewer skill (BOOTSTRAP.md Phase 1)'],
  },
  {
    id: 'publish-identity',
    codes: ['dao-json-missing'],
    title: 'Identity is authored but not published',
    say: "You've said who you are; it just isn't published in machine-readable form yet. One command fixes that.",
    run: ['npm run generate:schemas', 'npm run validate:schemas'],
  },
  {
    id: 'back-up',
    codes: ['not-a-git-repo', 'git-remote-absent'],
    title: 'Nothing is backed up',
    say: "Your instance only exists on this machine. Want me to walk you through putting it on GitHub so it survives this laptop?",
    run: ['git remote add origin <url>', 'git push -u origin main'],
  },
  {
    id: 'populate-registries',
    codes: ['registries-unpopulated'],
    title: 'Valid but empty',
    say: "The structure is sound but there's nobody and nothing in it yet. Let's add your members and what you're working on.",
    run: ['bootstrap-interviewer skill (BOOTSTRAP.md Phase 1)'],
  },
  {
    id: 'ingest-source',
    codes: ['no-sources-ingested'],
    title: 'Nothing has been read in yet',
    say: "Nothing has been ingested yet. Point me at one source — a repo, a blog, a Notion database — and I'll pull it in end to end.",
    run: ['npm run compile:knowledge'],
  },
  {
    id: 'operate',
    title: 'Ready to use',
    say: "Your instance is healthy. Ask me what's overdue, who your members are, what happened last session — or say 'open a session' and we'll get to work.",
    run: ['npm run initialize'],
  },
];

/** Every finding code in the assessment, flattened across checks. */
export function findingCodes(assessment) {
  return new Set(
    (assessment?.checks ?? []).flatMap((c) => c.findings ?? []).map((f) => f.code),
  );
}

/**
 * The single next thing to offer.
 *
 * @param {object|null} assessment assessSnapshot() output, or null when no instance exists
 * @returns {{id: string, title: string, say: string, run: string[]}}
 */
export function nextRung(assessment) {
  if (assessment === null || assessment === undefined) return RUNGS[0];

  const codes = findingCodes(assessment);
  for (const rung of RUNGS.slice(1)) {
    // The terminal rung carries no codes and matches unconditionally, which is
    // also what makes an unrecognized future code degrade to "keep operating".
    if (!rung.codes) return rung;
    if (rung.codes.some((c) => codes.has(c))) return rung;
  }
  return RUNGS[RUNGS.length - 1];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/wizard-ladder.test.mjs`
Expected: PASS, 8/8.

- [ ] **Step 5: Confirm how the doctor emits JSON, then add the CLI wrapper**

Run: `npm run doctor -- --help` and confirm the JSON flag's exact name (`--json` is expected; `report.mjs` renders a JSON shape).

Append to `scripts/wizard-ladder.mjs`:

```javascript
// --- CLI ------------------------------------------------------------------
// Reads an assessment as JSON on stdin so this module stays pure and the doctor
// stays the only thing that touches an instance:
//   npm run doctor -- --dir ../my-org --json | npm run wizard:next
if (process.argv[1] && process.argv[1].endsWith('wizard-ladder.mjs')) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  const rung = nextRung(raw ? JSON.parse(raw) : null);
  console.log(`${rung.title}\n\n${rung.say}\n`);
  for (const cmd of rung.run) console.log(`  $ ${cmd}`);
}
```

Add to `package.json` scripts, beside `doctor`:

```json
    "wizard:next": "node scripts/wizard-ladder.mjs",
```

- [ ] **Step 6: Verify the CLI end to end against the real instance**

```bash
npm run doctor -- --dir /tmp/wizard-accept/harbor-bakery-os --json | npm run wizard:next --silent
```
Expected: prints the `fix-identity-leak` or `back-up` rung with its `say` line and commands — a real rung derived from a real scorecard. If the doctor's JSON flag is named something else, use the name step 5 found.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx prettier scripts/wizard-ladder.mjs tests/wizard-ladder.test.mjs package.json --check
npm run validate:structure
git add scripts/wizard-ladder.mjs tests/wizard-ladder.test.mjs package.json
git commit -m "feat(wizard): the ladder — doctor scorecard to next rung

The wizard's entire state machine, and the reason it holds no state of its own:
re-running reconstructs where the operator actually is, including someone who did
half the setup by hand a month ago. Rung order is a safety decision — identity
leakage is fixed before the instance gets a remote, because pushing an instance
that still publishes the framework's identity broadcasts the wrong org. Lives in
scripts/ so the overlay carries it to every instance."
```

---

### Task 6: The concierge skill

**Files:**
- Create: `skills/org-os-wizard/SKILL.md`
- Create: `skills/org-os-wizard/SOUL.md`
- Modify: `data/skills-matrix.yaml` (add the row)
- Test: `tests/wizard-skill.test.mjs`

**Interfaces:**
- Consumes: `nextRung()` via `npm run wizard:next` (Task 5); `roles[0].soul` path from `data/agent-roster.yaml` (Task 4), which is `skills/org-os-wizard/SOUL.md`.
- Produces: the skill that Task 4's last assertion needs in order to go green.

**The `terminal.cwd` lesson.** In the refi-dao build, Hermes profiles did not inherit a working directory, so without an explicit pin every Bot silently missed the workspace's `AGENTS.md` contract — an agent that looks like it works and is not bound by the org's rules. The org-os analogue is an agent running where `CLAUDE.md`/`AGENTS.md` never load. **The concierge verifies its own working directory before it does anything else, and says what it found.** (spec §5 finding 3)

- [ ] **Step 1: Write the failing test**

```javascript
// tests/wizard-skill.test.mjs
//
// Two properties of this skill are load-bearing enough to pin:
//   1. It verifies its own working directory FIRST. The refi-dao build shipped
//      agents that silently ran outside the workspace contract; that defect is
//      the reason this assertion exists.
//   2. It never asks a human for a credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const skill = readFileSync(new URL('../skills/org-os-wizard/SKILL.md', import.meta.url), 'utf-8');

test('the skill and its SOUL both exist', () => {
  assert.ok(existsSync(new URL('../skills/org-os-wizard/SOUL.md', import.meta.url)));
});

test('frontmatter carries the fields every org-os skill has', () => {
  for (const field of ['name:', 'version:', 'description:', 'author:', 'category:']) {
    assert.match(skill, new RegExp(`^${field}`, 'm'), `frontmatter missing ${field}`);
  }
  assert.match(skill, /^name: org-os-wizard$/m);
});

test('working-directory verification comes before any other step', () => {
  const cwdAt = skill.search(/working director|terminal\.cwd|verify.*cwd/i);
  const cloneAt = skill.search(/clone:framework/);
  assert.ok(cwdAt > -1, 'the skill never verifies its working directory');
  assert.ok(cloneAt === -1 || cwdAt < cloneAt, 'cwd verification must precede any setup action');
});

test('the skill drives the ladder rather than reimplementing it', () => {
  assert.match(skill, /wizard:next/);
});

test('the skill never asks for a credential', () => {
  assert.doesNotMatch(skill, /\b(paste|enter|provide) (your |the )?(api[ _-]?key|token|password|secret)/i);
});

test('the skill is registered in the skills matrix', () => {
  const matrix = readFileSync(new URL('../data/skills-matrix.yaml', import.meta.url), 'utf-8');
  assert.match(matrix, /id: "org-os-wizard"/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/wizard-skill.test.mjs`
Expected: FAIL — `ENOENT ... skills/org-os-wizard/SKILL.md`.

- [ ] **Step 3: Write `skills/org-os-wizard/SOUL.md`**

```markdown
# Concierge — SOUL

You are the concierge of this org-os instance. You are the first agent the
operator meets and the one they keep talking to; there is no handover and no
second agent behind you.

**Voice.** Plain language. The operator is not a developer and does not need to
become one. Never explain a command you are about to run unless they ask — run
it and tell them what happened.

**Judgment.** Offer one next step, not a menu. The instance's health report tells
you which one; trust it over your memory of the conversation.

**Boundaries.** You draft, the operator decides. You never send anything
externally, never execute a credential grant, and never ask anyone to paste a
key, token or password to you. If a step needs a secret, you write down what the
operator should do and stop.

**Honesty.** If the health report says something is broken, say so in the first
sentence. An operator who finds out later that you knew is an operator who stops
trusting the report.
```

- [ ] **Step 4: Write `skills/org-os-wizard/SKILL.md`**

```markdown
---
name: org-os-wizard
version: 1.0.0
description: Guide an operator from "I want an org-os instance" to a running one, then keep going — read the instance's health report and offer the single next step, indefinitely. Setup and day-to-day operation are the same conversation.
author: organizational-os
category: onboarding
metadata:
  openclaw:
    requires:
      env: []
      bins: ["git", "node"]
      config: []
---

# org-os-wizard — the concierge

Trigger: the operator says "set me up", "what should I do next?", or opens a
session in an instance that is not finished.

Your SOUL is `SOUL.md` beside this file. Read it first.

## Step 0 — verify your own working directory (always, before anything else)

Agents do not reliably inherit a working directory. An agent running outside the
instance root never loads `CLAUDE.md` or `AGENTS.md`, which means it looks like it
is working while being bound by none of the organization's rules. This is not
hypothetical: it shipped in a sibling repo's agent build and was caught in review.

```bash
pwd && ls -d data/ federation.yaml 2>/dev/null
```

- If those exist, you are in an instance. Say which one, by name.
- If they do not, you are not in an instance yet — that is fine, it means the
  operator is at the create rung. Say so.

Never skip this because the previous message implied a directory.

## Step 1 — read the health report

The instance's health report is your only source of truth about where the
operator is. Do not track progress yourself; you will be wrong after any gap.

```bash
npm run doctor -- --dir <instance> --json | npm run wizard:next --silent
```

This prints one rung: a title, a sentence to say, and the commands behind it.

## Step 2 — offer that one rung

Say the rung's sentence in your own voice. Do not list the other rungs; the
operator does not need the map, they need the next step.

If the operator agrees, run the commands and report what happened. If a command
fails, read the health report's hint aloud — every finding carries one — and fix
the cause rather than the symptom.

## Step 3 — repeat, forever

There is no completion event. After every action, re-read the health report. When
it comes back clean, the rung becomes `operate` and you are the operator's
day-to-day agent: sessions, heartbeat, drift, questions about their own org.

The transition from "setting up" to "running" is not something you announce. It
is the scorecard filling in.

## What you never do

- Ask for an API key, token or password. Draft the step and let the operator run it.
- Push to a remote, publish, or send anything externally without being asked.
- Invent progress state. The health report is the state.
- Offer a menu when the report already told you the answer.

## The rungs

Reference only — `wizard:next` decides, you do not. Order is a safety decision:
identity leakage is fixed before the instance gets a remote, because pushing an
instance that still publishes the framework's identity broadcasts the wrong
organization to the network.

`create-instance` → `fix-identity-leak` → `author-identity` → `publish-identity`
→ `back-up` → `populate-registries` → `ingest-source` → `operate`
```

- [ ] **Step 5: Register in the skills matrix**

Add to `data/skills-matrix.yaml`, in the framework-canonical section, keeping the file's alphabetical ordering:

```yaml
  - id: "org-os-wizard"
    owner: "framework"
    instances_using: []
    in_framework: true
    promotion_status: "evaluating"
    notes: "The concierge. Guided setup that continues into day-to-day operation; reads the doctor scorecard as its state machine. Shipped in framework, awaiting instance adoption."
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/wizard-skill.test.mjs tests/agent-roster.test.mjs`
Expected: PASS — 6/6 and 5/5. Task 4's last assertion goes green here.

- [ ] **Step 7: Run the full suite and the structure validator**

Run: `npm test && npm run validate:structure`
Expected: both pass. `validate:structure` should now count 37 skills and confirm every skill directory has a `SKILL.md`.

- [ ] **Step 8: Acceptance — drive the ladder from both ends** (spec §11)

Point the concierge at the healthy instance and at a deliberately broken one, and confirm it offers the correct rung in both cases:

```bash
# broken: remove the published identity from a COPY, never the original
cp -R /tmp/wizard-accept/harbor-bakery-os /tmp/wizard-accept/broken
rm /tmp/wizard-accept/broken/.well-known/dao.json
npm run doctor -- --dir /tmp/wizard-accept/broken --json | npm run wizard:next --silent
```
Expected: the broken copy yields a rung reflecting the missing identity publication; the healthy one yields its own correct rung. Record both outputs in the commit message.

- [ ] **Step 9: Commit**

```bash
npx prettier tests/wizard-skill.test.mjs --check
npm run validate:structure
git add skills/org-os-wizard/ data/skills-matrix.yaml tests/wizard-skill.test.mjs
git commit -m "feat(wizard): the concierge skill

Step 0 is verifying its own working directory, before anything else. Agents do not
reliably inherit one, and an agent outside the instance root loads neither
CLAUDE.md nor AGENTS.md — it looks like it works while bound by none of the org's
rules. That shipped in a sibling repo's agent build and was caught in review; here
it is a tested precondition.

The skill drives wizard:next rather than reimplementing the ladder, and never asks
anyone to paste a credential."
```

**Phase 1 is complete here.**

---

## Phase 2 — The install/update contract (GATED)

> **Do not start Phase 2 until both gates clear.** Task 7 is the gate itself and is safe to run any time. Task 8 additionally needs the 0.5.1 overlay cut, but does **not** depend on Task 7 — it is pure org-os code with no Hermes dependency.

### Task 7: V1 — pin and read the Hermes profile CLI

**Files:**
- Create: `docs/integrations/hermes-profile-VERIFIED.md`

**Interfaces:**
- Produces: the verified command table that every subsequent Phase 2 task copies **verbatim**. Nothing in Phase 2 may assume a command shape that is not in this file.

**Why this is a blocking gate.** `hermes profile install <git-url>` and
`hermes profile update` are recorded in the wizard spec as *reported from the
refi-dao build session, not read from source*. They appear nowhere in the
refi-dao-os tree. That repo was already bitten by exactly this class of error: its
deployed entrypoint called `hermes cron add --name … --schedule …` when the real
CLI is positional `cron create "<schedule>" "<prompt>"`, and the mismatch silently
broke the cron reconcile from May until the August audit found it. Do not write a
line against this interface before reading it.

- [ ] **Step 1: Pin the version floor**

```bash
git clone https://github.com/NousResearch/hermes ~/tools/hermes 2>/dev/null || git -C ~/tools/hermes fetch --tags
git -C ~/tools/hermes tag --list | grep -F 'v2026.8.16.2'
git -C ~/tools/hermes switch --detach v2026.8.16.2
```
If the tag does not exist, stop and report — the version floor in the spec is wrong and the spec must be corrected before proceeding.

- [ ] **Step 2: Read the actual profile CLI surface**

```bash
grep -rn "profile" ~/tools/hermes --include='*.py' --include='*.rs' --include='*.ts' | grep -iE "install|update|add_parser|subcommand|clap" | head -40
```
Record what subcommands genuinely exist under `profile`, with their exact argument shapes — positional vs flag, in order.

- [ ] **Step 3: Record the outcome, whichever it is**

Write `docs/integrations/hermes-profile-VERIFIED.md` with: the pinned tag, the date, the exact grep commands run, and a table of *intent → verified invocation → output shape*.

Then record which case you are in:
- **Case A — the commands exist as reported.** Phase 2 proceeds; Task 8 and the install path are written against this table.
- **Case B — the shape differs.** Record the real shape. org-os is unaffected by design: it owns the `agent-profile.yaml` manifest and the region contract, and the runtime adapter is a thin translation layer. Amend the wizard spec §5 finding 2 to match reality and note the amendment.
- **Case C — no such commands.** Door B does not exist upstream yet. Task 8 still proceeds (it has no Hermes dependency); the install path becomes `npm run agent:install` in org-os itself, and Door B in `START-HERE.md` is rewritten against that. Amend spec §5 finding 2 and §6 Door B.

- [ ] **Step 4: Report before continuing**

Stop and report which case obtained. This is an operator decision point, not an agent one — Case B and Case C both change the spec.

- [ ] **Step 5: Commit**

```bash
git add docs/integrations/hermes-profile-VERIFIED.md
git commit -m "docs(wizard): V1 — Hermes profile CLI pinned and read at v2026.8.16.2

The spec recorded these commands as reported, not verified. This is the read.
Records case A/B/C and the exact invocation table Phase 2 copies from."
```

---

### Task 8: `PROFILE_LOCAL` — the preserved region

**Files:**
- Modify: `packages/instance-doctor/src/overlay.mjs` (add the region beside `FRAMEWORK_OWNED` / `INSTANCE_OWNED`, ~line 37)
- Test: `tests/instance-doctor/overlay.test.mjs` (extend)

**Interfaces:**
- Consumes: `overlayPlan({frameworkFiles, instanceFiles})`, `isFrameworkOwned`, `isInstanceOwned` — all existing exports.
- Produces: `PROFILE_LOCAL` (array of prefixes) and `isProfileLocal(path)` → boolean.

**Gate:** the 0.5.1 overlay cut. **Not** gated on Task 7 — this is pure org-os code with no Hermes dependency.

**Why here and not in a new module:** `profile update` must refresh org truth while never touching the installer's own config and credentials. That is the ownership partition `overlay.mjs` already implements, one level down. Two copies of a "never write these paths" rule will drift, and the copy that drifts is the one that destroys someone's credentials.

- [ ] **Step 1: Write the failing test**

First extend the **existing** import block at the top of `tests/instance-doctor/overlay.test.mjs` — ESM imports belong there, not at the bottom of the file:

```javascript
import {
  FRAMEWORK_OWNED,
  INSTANCE_OWNED,
  PROFILE_LOCAL,
  isFrameworkOwned,
  isInstanceOwned,
  isProfileLocal,
  overlayPlan,
} from '../../packages/instance-doctor/src/overlay.mjs';
```

Then append the new cases at the end of the file:

```javascript
// --- the profile region ----------------------------------------------------
// `profile update` refreshes the org's truth (SOUL, skills, cron, MCP) and must
// never touch what the installer owns: their config, their credentials, their
// agent's memory. Same rule as the instance overlay, one level down — which is
// exactly why it lives in this module and not a second copy of it.

test('the installer owns their config, credentials, memory and sessions', () => {
  for (const p of [
    'profiles/concierge/config.yaml',
    'profiles/concierge/credentials.json',
    'profiles/concierge/MEMORY.md',
    'profiles/concierge/sessions/2026-08-29.jsonl',
  ]) {
    assert.equal(isProfileLocal(p), true, `${p} must be installer-owned`);
  }
});

test('org truth is not installer-owned', () => {
  for (const p of ['profiles/concierge/SOUL.md', 'profiles/concierge/skills/org-os-wizard/SKILL.md']) {
    assert.equal(isProfileLocal(p), false, `${p} is org truth and must refresh`);
  }
});

test('the overlay never writes an installer-owned path', () => {
  // The property the whole module exists to guarantee, extended to profiles.
  const framework = new Map([
    ['profiles/concierge/config.yaml', 'FRAMEWORK VERSION'],
    ['profiles/concierge/SOUL.md', 'org truth'],
  ]);
  const instance = new Map([['profiles/concierge/config.yaml', 'MY OWN CONFIG']]);
  const plan = overlayPlan({ frameworkFiles: framework, instanceFiles: instance });
  const written = plan.actions.filter((a) => a.action !== 'unchanged').map((a) => a.path);
  assert.ok(!written.includes('profiles/concierge/config.yaml'));
});

test('PROFILE_LOCAL and INSTANCE_OWNED do not overlap', () => {
  for (const p of PROFILE_LOCAL) {
    assert.equal(isInstanceOwned(p), false, `${p} is claimed by two regions`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/instance-doctor/overlay.test.mjs`
Expected: FAIL — `PROFILE_LOCAL` is not exported.

- [ ] **Step 3: Add the region**

In `packages/instance-doctor/src/overlay.mjs`, after the `INSTANCE_OWNED` block:

```javascript
/**
 * Paths the INSTALLER of an agent profile owns. `profile update` refreshes the
 * org's truth — SOUL, skills, cron, MCP — and must never touch these: they are
 * the operator's own configuration, their credentials, and their agent's
 * accumulated memory.
 *
 * This is the same rule as INSTANCE_OWNED, one level down. It lives here rather
 * than in a second module because two copies of a never-write list will drift,
 * and the copy that drifts is the one that destroys someone's credentials.
 */
export const PROFILE_LOCAL = [
  'profiles/*/config.yaml',
  'profiles/*/credentials.json',
  'profiles/*/MEMORY.md',
  'profiles/*/sessions/',
];

/** True when `path` belongs to whoever installed the profile. */
export function isProfileLocal(path) {
  return PROFILE_LOCAL.some((pattern) => {
    const re = new RegExp('^' + pattern.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+'));
    return re.test(path);
  });
}
```

Then extend the guard in `isFrameworkOwned` so the overlay honors the new region:

```javascript
export function isFrameworkOwned(path) {
  return matches(path, FRAMEWORK_OWNED) && !matches(path, INSTANCE_OWNED) && !isProfileLocal(path);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/instance-doctor/overlay.test.mjs`
Expected: PASS, including every pre-existing assertion. If an existing test broke, you have changed the instance overlay's behavior — that is a regression, not a rename; fix it before continuing.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier packages/instance-doctor/src/overlay.mjs tests/instance-doctor/overlay.test.mjs --check
npm run validate:structure
git add packages/instance-doctor/src/overlay.mjs tests/instance-doctor/overlay.test.mjs
git commit -m "feat(overlay): PROFILE_LOCAL — the region profile update must never touch

profile update refreshes org truth while preserving the installer's own config
and credentials. That is this module's existing ownership partition one level
down, so it lives here rather than in a second copy: two never-write lists drift,
and the one that drifts destroys someone's credentials."
```

---

### Remaining Phase 2 tasks — authored after Task 7

The `agent-profile.yaml` manifest, the install/update path, and Door B in
`START-HERE.md` are **deliberately not specified here.** Their shape depends on
which case Task 7 returns, and writing TDD steps against an interface nobody has
read is how the refi-dao cron bug happened. After Task 7 reports, return to the
writing-plans skill and append those tasks against the verified table.

---

## Verification (whole plan)

- `npm test` green after every task.
- `npm run validate:structure` green (it is also enforced by the pre-commit hook).
- `npm run validate:schemas` green.
- `npx prettier --check` green on the `.mjs` files this plan adds (markdown is not formatted in this repo).
- Phase 0 acceptance: Door A followed literally in a scratch directory produces an instance whose only blocker is `git-remote-absent` (Task 1 step 5).
- Phase 1 acceptance: the concierge offers the correct rung from both a clean and a deliberately broken scorecard (Task 6 step 8), and verifies its own working directory before acting (Task 6 test).
- Phase 2 acceptance: `profile update` leaves a modified `config.yaml`, added credentials and a local `MEMORY.md` byte-identical while refreshing `SOUL.md` and the skills subset (Task 8 tests cover the region; the end-to-end run waits on Task 7).
- **Path acceptance, deferred to a real person:** one operator who is not Luiz reaches a clean scorecard using only `START-HERE.md`. This is the same datapoint the v0.6 `external-pilot` gate needs. It cannot be self-certified.
