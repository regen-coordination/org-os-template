# Skills Section Implementation Plan

> **Release status (2026-08-28):** Deferred to v0.6+ — portfolio memo §4 row 6 (named explicitly as the tempting quick-ship to resist). Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a discovery walker that scans workspace + user + plugin skills, expose the result as a compact dashboard section, a generated `SKILLS.md` page, a machine-readable `.well-known/skills.json`, and a `/skills` slash command — so operators can verify the right skills are loaded and federation peers can compare skill sets.

**Architecture:** A single `scripts/lib/discover-skills.mjs` walker is the only source of truth. `scripts/generate-skills.mjs` calls it and writes both `SKILLS.md` and `.well-known/skills.json`. `scripts/initialize.mjs` calls the same walker and exposes the data to the dashboard. A `/skills` slash command renders the same data inline. `dashboard.yaml` controls display. CI rejects anomalies.

**Tech Stack:** Node 22 (project requires `>=22`), ES modules, `js-yaml` (already a dependency), `gray-matter` (already a dependency). Tests use **`node:test`** + **`node:assert/strict`** (built in — no new dependencies).

**Spec:** [`docs/superpowers/specs/2026-04-27-skills-section-design.md`](../specs/2026-04-27-skills-section-design.md)

---

## Phase A — Discovery walker (TDD)

### Task 1: Test scaffolding + first failing test

**Files:**
- Create: `tests/discover-skills.test.mjs`
- Create: `tests/fixtures/skills-empty/.gitkeep`
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Add `test` script to `package.json`**

Open `package.json` and add this line to the `scripts` object (after the existing `check` script):

```json
"test": "node --test tests/"
```

- [ ] **Step 2: Create empty fixture directory**

```bash
mkdir -p tests/fixtures/skills-empty
touch tests/fixtures/skills-empty/.gitkeep
```

- [ ] **Step 3: Write the first failing test**

Create `tests/discover-skills.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverSkills } from '../scripts/lib/discover-skills.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

test('discoverSkills returns empty arrays for an empty workspace', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-empty'),
    userDir: null,
    pluginRoot: null,
  });

  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.anomalies, []);
  assert.equal(result.totals.workspace, 0);
  assert.equal(result.totals.user, 0);
  assert.equal(result.totals.plugin, 0);
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module '.../scripts/lib/discover-skills.mjs'`

- [ ] **Step 5: Commit**

```bash
git add package.json tests/
git commit -m "test: scaffold discover-skills test harness"
```

---

### Task 2: Minimal walker — workspace source only

**Files:**
- Create: `scripts/lib/discover-skills.mjs`

- [ ] **Step 1: Write a workspace-only fixture**

```bash
mkdir -p tests/fixtures/skills-workspace-1/skills/example-skill
cat > tests/fixtures/skills-workspace-1/skills/example-skill/SKILL.md <<'EOF'
---
name: example-skill
description: An example skill for tests
tier: core
category: example
---

# Example Skill

Body text.
EOF
```

- [ ] **Step 2: Add a failing test for the workspace path**

Append to `tests/discover-skills.test.mjs`:

```javascript
test('discoverSkills loads a single workspace skill', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-workspace-1'),
    userDir: null,
    pluginRoot: null,
  });

  assert.equal(result.skills.length, 1);
  const skill = result.skills[0];
  assert.equal(skill.id, 'example-skill');
  assert.equal(skill.source, 'workspace');
  assert.equal(skill.group, 'example');
  assert.equal(skill.tier, 'core');
  assert.equal(skill.description, 'An example skill for tests');
  assert.equal(skill.status, 'ok');
  assert.equal(result.totals.workspace, 1);
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL — `discoverSkills` not exported.

- [ ] **Step 4: Implement the minimal walker**

Create `scripts/lib/discover-skills.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

export function discoverSkills({ workspaceDir, userDir, pluginRoot }) {
  const skills = [];
  const anomalies = [];

  if (workspaceDir) {
    skills.push(...scanDir(workspaceDir, 'workspace', workspaceDir));
  }

  return {
    skills,
    anomalies,
    totals: {
      workspace: skills.filter((s) => s.source === 'workspace').length,
      user: skills.filter((s) => s.source === 'user').length,
      plugin: skills.filter((s) => s.source === 'plugin').length,
    },
  };
}

function scanDir(rootDir, source, sourceDetail) {
  const skillsDir = path.join(rootDir, 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const out = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    const parsed = matter(fs.readFileSync(skillMd, 'utf-8'));
    const data = parsed.data || {};
    out.push({
      id: data.name || entry.name,
      source,
      source_detail: sourceDetail,
      group: data.category || 'uncategorized',
      tier: data.tier || 'extended',
      version: data.version || null,
      description: data.description || '',
      status: 'ok',
      path: skillMd,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: minimal skill discovery walker (workspace source)"
```

---

### Task 3: Add user source

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`
- Create: `tests/fixtures/skills-user/skills/user-skill/SKILL.md`

- [ ] **Step 1: Write a user-source fixture**

```bash
mkdir -p tests/fixtures/skills-user/skills/user-skill
cat > tests/fixtures/skills-user/skills/user-skill/SKILL.md <<'EOF'
---
name: user-skill
description: A user-level skill
---
EOF
```

- [ ] **Step 2: Add failing test for user source**

Append to `tests/discover-skills.test.mjs`:

```javascript
test('discoverSkills loads user-level skills', () => {
  const result = discoverSkills({
    workspaceDir: null,
    userDir: path.join(fixturesDir, 'skills-user'),
    pluginRoot: null,
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].source, 'user');
  assert.equal(result.skills[0].group, 'uncategorized');
  assert.equal(result.totals.user, 1);
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL — only workspace path is wired.

- [ ] **Step 4: Add user source to walker**

In `scripts/lib/discover-skills.mjs`, replace the body of `discoverSkills` with:

```javascript
export function discoverSkills({ workspaceDir, userDir, pluginRoot }) {
  const skills = [];
  const anomalies = [];

  if (workspaceDir) skills.push(...scanDir(workspaceDir, 'workspace', workspaceDir));
  if (userDir)      skills.push(...scanDir(userDir,      'user',      userDir));

  return {
    skills,
    anomalies,
    totals: {
      workspace: skills.filter((s) => s.source === 'workspace').length,
      user: skills.filter((s) => s.source === 'user').length,
      plugin: skills.filter((s) => s.source === 'plugin').length,
    },
  };
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills picks up user-level skills"
```

---

### Task 4: Add plugin source

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`
- Create: plugin fixture tree

- [ ] **Step 1: Write a plugin-source fixture**

The real layout is `~/.claude/plugins/cache/<collection>/<plugin>/<version>/skills/<name>/SKILL.md`. The walker must walk that nested path.

```bash
mkdir -p tests/fixtures/skills-plugin/claude-plugins-official/superpowers/5.0.7/skills/plugin-skill
cat > tests/fixtures/skills-plugin/claude-plugins-official/superpowers/5.0.7/skills/plugin-skill/SKILL.md <<'EOF'
---
name: plugin-skill
description: A plugin skill from superpowers
---
EOF
```

- [ ] **Step 2: Add failing test for plugin source**

Append to `tests/discover-skills.test.mjs`:

```javascript
test('discoverSkills loads plugin skills and groups them by plugin name', () => {
  const result = discoverSkills({
    workspaceDir: null,
    userDir: null,
    pluginRoot: path.join(fixturesDir, 'skills-plugin'),
  });

  assert.equal(result.skills.length, 1);
  const skill = result.skills[0];
  assert.equal(skill.source, 'plugin');
  assert.equal(skill.group, 'superpowers');
  assert.equal(skill.source_detail, 'superpowers@5.0.7');
  assert.equal(result.totals.plugin, 1);
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL — plugin path is not wired.

- [ ] **Step 4: Implement plugin scanning**

In `scripts/lib/discover-skills.mjs`, add a new helper and wire it in:

```javascript
function scanPlugins(pluginRoot) {
  if (!fs.existsSync(pluginRoot)) return [];
  const out = [];

  for (const collection of safeReaddir(pluginRoot)) {
    const collectionDir = path.join(pluginRoot, collection);
    if (!isDir(collectionDir)) continue;

    for (const pluginName of safeReaddir(collectionDir)) {
      const pluginDir = path.join(collectionDir, pluginName);
      if (!isDir(pluginDir)) continue;

      for (const version of safeReaddir(pluginDir)) {
        const versionDir = path.join(pluginDir, version);
        if (!isDir(versionDir)) continue;

        const skillsDir = path.join(versionDir, 'skills');
        if (!fs.existsSync(skillsDir)) continue;

        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
          if (!fs.existsSync(skillMd)) continue;
          const parsed = matter(fs.readFileSync(skillMd, 'utf-8'));
          const data = parsed.data || {};
          out.push({
            id: data.name || entry.name,
            source: 'plugin',
            source_detail: `${pluginName}@${version}`,
            group: data.category || pluginName,
            tier: data.tier || 'extended',
            version: data.version || version,
            description: data.description || '',
            status: 'ok',
            path: skillMd,
          });
        }
      }
    }
  }
  return out;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
```

Then wire it into `discoverSkills`, before the `return`:

```javascript
if (pluginRoot)   skills.push(...scanPlugins(pluginRoot));
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills walks plugin cache, groups by plugin name"
```

---

### Task 5: Frontmatter category override on plugin skills

**Files:**
- Modify: `tests/discover-skills.test.mjs`
- Create: extra plugin fixture

- [ ] **Step 1: Add a plugin skill that overrides its group via frontmatter**

```bash
mkdir -p tests/fixtures/skills-plugin/claude-plugins-official/superpowers/5.0.7/skills/override-skill
cat > tests/fixtures/skills-plugin/claude-plugins-official/superpowers/5.0.7/skills/override-skill/SKILL.md <<'EOF'
---
name: override-skill
description: Plugin skill with explicit category
category: research
---
EOF
```

- [ ] **Step 2: Add failing test that asserts override**

Append to `tests/discover-skills.test.mjs`:

```javascript
test('frontmatter category overrides plugin name as group', () => {
  const result = discoverSkills({
    workspaceDir: null,
    userDir: null,
    pluginRoot: path.join(fixturesDir, 'skills-plugin'),
  });

  const override = result.skills.find((s) => s.id === 'override-skill');
  assert.ok(override, 'override-skill should be discovered');
  assert.equal(override.group, 'research');
});
```

- [ ] **Step 3: Run and confirm pass (already implemented in Task 4)**

Run: `npm test`
Expected: 5 tests passing — the existing code already prefers `data.category` over `pluginName`. This task is a guard test ensuring the rule stays correct as the file evolves.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: lock the frontmatter-category override behavior"
```

---

### Task 6: Anomaly — malformed frontmatter

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`
- Create: malformed fixture

- [ ] **Step 1: Write a malformed-frontmatter fixture**

```bash
mkdir -p tests/fixtures/skills-malformed/skills/broken-skill
cat > tests/fixtures/skills-malformed/skills/broken-skill/SKILL.md <<'EOF'
---
name: broken-skill
description: "missing closing quote
---
EOF
```

- [ ] **Step 2: Add failing test**

```javascript
test('malformed frontmatter produces an anomaly and a status:malformed entry', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-malformed'),
    userDir: null,
    pluginRoot: null,
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].status, 'malformed');
  assert.equal(result.anomalies.length, 1);
  assert.equal(result.anomalies[0].type, 'malformed_frontmatter');
  assert.equal(result.anomalies[0].id, 'broken-skill');
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL — current implementation throws when matter() fails.

- [ ] **Step 4: Wrap parsing in try/catch and emit anomaly**

In `scripts/lib/discover-skills.mjs`, extract a shared `parseSkill` helper and use it from both `scanDir` and `scanPlugins`:

```javascript
function parseSkill({ skillMd, dirName, source, sourceDetail, fallbackGroup, fallbackVersion }) {
  try {
    const parsed = matter(fs.readFileSync(skillMd, 'utf-8'));
    const data = parsed.data || {};
    return {
      skill: {
        id: data.name || dirName,
        source,
        source_detail: sourceDetail,
        group: data.category || fallbackGroup || 'uncategorized',
        tier: data.tier || 'extended',
        version: data.version || fallbackVersion || null,
        description: data.description || '',
        status: 'ok',
        path: skillMd,
      },
      anomaly: null,
    };
  } catch (err) {
    return {
      skill: {
        id: dirName,
        source,
        source_detail: sourceDetail,
        group: 'uncategorized',
        tier: 'extended',
        version: null,
        description: '',
        status: 'malformed',
        path: skillMd,
      },
      anomaly: { type: 'malformed_frontmatter', id: dirName, path: skillMd, error: String(err) },
    };
  }
}
```

Refactor `scanDir` and `scanPlugins` to call `parseSkill` and to push anomalies into a passed-in `anomalies` array. Update `discoverSkills` to pass it through.

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 6 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills emits anomaly for malformed frontmatter"
```

---

### Task 7: Anomaly — duplicate IDs

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`
- Create: duplicate fixture

- [ ] **Step 1: Write a fixture where the same id appears in workspace + user**

```bash
mkdir -p tests/fixtures/skills-dup-workspace/skills/twin
cat > tests/fixtures/skills-dup-workspace/skills/twin/SKILL.md <<'EOF'
---
name: twin
description: Workspace twin
---
EOF

mkdir -p tests/fixtures/skills-dup-user/skills/twin
cat > tests/fixtures/skills-dup-user/skills/twin/SKILL.md <<'EOF'
---
name: twin
description: User twin
---
EOF
```

- [ ] **Step 2: Add failing test**

```javascript
test('duplicate skill ids across sources produce an anomaly', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-dup-workspace'),
    userDir: path.join(fixturesDir, 'skills-dup-user'),
    pluginRoot: null,
  });

  assert.equal(result.skills.length, 2);
  const dup = result.anomalies.find((a) => a.type === 'duplicate_id');
  assert.ok(dup, 'expected a duplicate_id anomaly');
  assert.equal(dup.id, 'twin');
  assert.deepEqual(dup.sources.sort(), ['user', 'workspace']);
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL — no duplicate detection yet.

- [ ] **Step 4: Detect duplicates**

In `scripts/lib/discover-skills.mjs`, after the source scans and before the `return`, add:

```javascript
const byId = new Map();
for (const s of skills) {
  if (!byId.has(s.id)) byId.set(s.id, []);
  byId.get(s.id).push(s);
}
for (const [id, list] of byId) {
  if (list.length > 1) {
    anomalies.push({
      type: 'duplicate_id',
      id,
      sources: list.map((s) => s.source),
    });
  }
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 7 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills detects duplicate ids across sources"
```

---

### Task 8: Anomaly — federation.yaml drift

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`
- Create: drift fixture

- [ ] **Step 1: Write a fixture with a stale federation.yaml**

```bash
mkdir -p tests/fixtures/skills-drift/skills/a tests/fixtures/skills-drift/skills/b tests/fixtures/skills-drift/skills/c
for n in a b c; do
  cat > tests/fixtures/skills-drift/skills/$n/SKILL.md <<EOF
---
name: $n
description: skill $n
---
EOF
done
cat > tests/fixtures/skills-drift/federation.yaml <<'EOF'
agent:
  skills:
    - a
EOF
```

- [ ] **Step 2: Add failing test**

```javascript
test('federation.yaml that lists fewer skills than disk produces a drift anomaly', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-drift'),
    userDir: null,
    pluginRoot: null,
    federationYaml: path.join(fixturesDir, 'skills-drift', 'federation.yaml'),
  });

  const drift = result.anomalies.find((a) => a.type === 'federation_drift');
  assert.ok(drift, 'expected a federation_drift anomaly');
  assert.equal(drift.expected, 1);
  assert.equal(drift.actual, 3);
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 4: Implement drift detection**

In `scripts/lib/discover-skills.mjs`, accept `federationYaml` in the options and add detection after duplicate detection:

```javascript
import yaml from 'js-yaml';
// ...

if (federationYaml && fs.existsSync(federationYaml)) {
  try {
    const fed = yaml.load(fs.readFileSync(federationYaml, 'utf-8'));
    const declared = fed?.agent?.skills?.length || 0;
    const actual = skills.filter((s) => s.source === 'workspace').length;
    if (declared !== actual) {
      anomalies.push({
        type: 'federation_drift',
        expected: declared,
        actual,
        remediation: 'npm run reconcile:federation-skills',
      });
    }
  } catch {
    // ignore — not blocking; federation.yaml validation lives elsewhere
  }
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`
Expected: 8 tests passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills flags federation.yaml drift"
```

---

### Task 9: Aggregate output (groups + descriptions)

**Files:**
- Modify: `scripts/lib/discover-skills.mjs`
- Modify: `tests/discover-skills.test.mjs`

- [ ] **Step 1: Add failing test**

```javascript
test('discoverSkills exposes a groups summary', () => {
  const result = discoverSkills({
    workspaceDir: path.join(fixturesDir, 'skills-workspace-1'),
    userDir: path.join(fixturesDir, 'skills-user'),
    pluginRoot: path.join(fixturesDir, 'skills-plugin'),
  });

  assert.ok(Array.isArray(result.groups), 'groups should be an array');
  const example = result.groups.find((g) => g.name === 'example');
  assert.equal(example.count, 1);

  const superpowers = result.groups.find((g) => g.name === 'superpowers');
  assert.equal(superpowers.count, 1, 'one plugin skill remains in superpowers (the other moved to research via category override)');

  assert.equal(result.totals.groups, result.groups.length);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `groups` not yet emitted.

- [ ] **Step 3: Build the groups summary**

In `scripts/lib/discover-skills.mjs`, before the `return`, add:

```javascript
const groupMap = new Map();
for (const s of skills) {
  if (!groupMap.has(s.group)) {
    groupMap.set(s.group, { name: s.group, count: 0, skills: [], hasIssue: false });
  }
  const g = groupMap.get(s.group);
  g.count += 1;
  g.skills.push(s.id);
  if (s.status !== 'ok') g.hasIssue = true;
}
const groups = [...groupMap.values()].sort((a, b) => b.count - a.count);
```

Update `totals` to include `groups: groups.length` and add `groups` to the returned object.

- [ ] **Step 4: Run tests and confirm pass**

Run: `npm test`
Expected: 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/discover-skills.mjs tests/
git commit -m "feat: discover-skills exposes a groups summary"
```

---

## Phase B — Generator (TDD)

### Task 10: Test the JSON writer

**Files:**
- Create: `scripts/generate-skills.mjs`
- Modify: `tests/discover-skills.test.mjs` OR create `tests/generate-skills.test.mjs`

- [ ] **Step 1: Create the test file**

Create `tests/generate-skills.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateSkills } from '../scripts/generate-skills.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-skills-'));
}

test('generateSkills writes .well-known/skills.json with totals + skills + anomalies', () => {
  const out = tmpDir();
  generateSkills({
    workspaceDir: path.join(fixturesDir, 'skills-workspace-1'),
    userDir: null,
    pluginRoot: null,
    outDir: out,
  });

  const jsonPath = path.join(out, '.well-known', 'skills.json');
  assert.ok(fs.existsSync(jsonPath), 'skills.json should be written');

  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  assert.equal(json['@context'], 'https://orgos.network/skills/v1');
  assert.equal(json.totals.workspace, 1);
  assert.equal(json.skills.length, 1);
  assert.equal(json.skills[0].id, 'example-skill');
  assert.ok(typeof json.generated === 'string');
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `scripts/generate-skills.mjs` does not exist.

- [ ] **Step 3: Implement the JSON writer**

Create `scripts/generate-skills.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { discoverSkills } from './lib/discover-skills.mjs';

export function generateSkills({ workspaceDir, userDir, pluginRoot, outDir, federationYaml }) {
  const result = discoverSkills({ workspaceDir, userDir, pluginRoot, federationYaml });

  const wellKnown = path.join(outDir, '.well-known');
  fs.mkdirSync(wellKnown, { recursive: true });

  const json = {
    '@context': 'https://orgos.network/skills/v1',
    generated: new Date().toISOString(),
    totals: result.totals,
    anomalies: result.anomalies,
    groups: result.groups.map((g) => ({ name: g.name, count: g.count })),
    skills: result.skills,
  };

  fs.writeFileSync(path.join(wellKnown, 'skills.json'), JSON.stringify(json, null, 2) + '\n');
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repoRoot = process.cwd();
  generateSkills({
    workspaceDir: repoRoot,
    userDir: process.env.HOME ? path.join(process.env.HOME, '.claude') : null,
    pluginRoot: process.env.HOME ? path.join(process.env.HOME, '.claude', 'plugins', 'cache') : null,
    federationYaml: path.join(repoRoot, 'federation.yaml'),
    outDir: repoRoot,
  });
  console.log('✓ wrote .well-known/skills.json');
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `npm test`
Expected: 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-skills.mjs tests/generate-skills.test.mjs
git commit -m "feat: generate-skills writes .well-known/skills.json"
```

---

### Task 11: Test the SKILLS.md writer

**Files:**
- Modify: `scripts/generate-skills.mjs`
- Modify: `tests/generate-skills.test.mjs`

- [ ] **Step 1: Add a failing test**

Append to `tests/generate-skills.test.mjs`:

```javascript
test('generateSkills writes SKILLS.md with anomalies, groups, and per-skill entries', () => {
  const out = tmpDir();
  generateSkills({
    workspaceDir: path.join(fixturesDir, 'skills-workspace-1'),
    userDir: path.join(fixturesDir, 'skills-user'),
    pluginRoot: null,
    outDir: out,
  });

  const md = fs.readFileSync(path.join(out, 'SKILLS.md'), 'utf-8');
  assert.match(md, /^# Skills/m);
  assert.match(md, /## Anomalies/);
  assert.match(md, /## example \(1\)/);
  assert.match(md, /### example-skill/);
  assert.match(md, /workspace/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — SKILLS.md not written yet.

- [ ] **Step 3: Implement Markdown writer**

In `scripts/generate-skills.mjs`, add the writer and call it from `generateSkills`:

```javascript
function renderMarkdown(result, generated) {
  const lines = [];
  lines.push('# Skills — workspace + user + plugins');
  lines.push('');
  lines.push(`Generated ${generated} by \`npm run generate:skills\`. Do not edit by hand.`);
  lines.push('');
  lines.push(`**Totals:** ${result.skills.length} active across ${nonZeroSources(result.totals).length} source(s) — ` +
    `workspace: ${result.totals.workspace} · user: ${result.totals.user} · plugin: ${result.totals.plugin}.`);
  lines.push('');
  lines.push('## Anomalies');
  lines.push('');
  if (result.anomalies.length === 0) {
    lines.push('- (none)');
  } else {
    for (const a of result.anomalies) lines.push(`- ⚠ ${describeAnomaly(a)}`);
  }
  lines.push('');

  for (const g of result.groups) {
    lines.push(`## ${g.name} (${g.count})`);
    lines.push('');
    const groupSkills = result.skills.filter((s) => s.group === g.name);
    for (const s of groupSkills) {
      lines.push(`### ${s.id}  ·  ${s.source}  ·  tier: ${s.tier}`);
      if (s.description) {
        lines.push('');
        lines.push(`> ${s.description}`);
      }
      lines.push('');
      lines.push(`[${path.relative(process.cwd(), s.path) || s.path}](${path.relative(process.cwd(), s.path) || s.path})`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function nonZeroSources(t) {
  return ['workspace', 'user', 'plugin'].filter((k) => t[k] > 0);
}

function describeAnomaly(a) {
  switch (a.type) {
    case 'federation_drift':
      return `federation.yaml lists ${a.expected} skills, disk has ${a.actual}. Run: ${a.remediation}`;
    case 'malformed_frontmatter':
      return `malformed frontmatter in ${a.id} (${a.path})`;
    case 'duplicate_id':
      return `duplicate id "${a.id}" found in sources: ${a.sources.join(', ')}`;
    default:
      return JSON.stringify(a);
  }
}
```

In `generateSkills`, after writing `skills.json`:

```javascript
fs.writeFileSync(path.join(outDir, 'SKILLS.md'), renderMarkdown(result, json.generated) + '\n');
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `npm test`
Expected: 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-skills.mjs tests/generate-skills.test.mjs
git commit -m "feat: generate-skills writes SKILLS.md alongside skills.json"
```

---

### Task 12: Wire `npm run generate:skills`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the npm script**

Add to `package.json` `scripts`, near `generate:schemas`:

```json
"generate:skills": "node scripts/generate-skills.mjs",
```

- [ ] **Step 2: Chain into `generate:schemas`**

Change the existing `generate:schemas` line to:

```json
"generate:schemas": "node scripts/generate-all-schemas.mjs && node scripts/generate-skills.mjs",
```

- [ ] **Step 3: Run the generator and verify outputs**

```bash
npm run generate:skills
```

Expected: prints `✓ wrote .well-known/skills.json` (and SKILLS.md is created at repo root).

- [ ] **Step 4: Sanity-check both outputs**

```bash
test -f .well-known/skills.json && echo "skills.json OK"
test -f SKILLS.md && echo "SKILLS.md OK"
```

Expected: both `OK` lines printed.

- [ ] **Step 5: Commit**

```bash
git add package.json .well-known/skills.json SKILLS.md
git commit -m "feat: npm run generate:skills + chain into generate:schemas"
```

---

## Phase C — Frontmatter additions to canonical workspace skills

### Task 13: Tag canonical workspace skills with tier + category

**Files:** edit each of these `SKILL.md` files; add `tier:` and `category:` keys to the frontmatter (or update if already present).

```
skills/initialize/SKILL.md          → tier: core,      category: org-os
skills/heartbeat-monitor/SKILL.md   → tier: core,      category: org-os
skills/schema-generator/SKILL.md    → tier: core,      category: org-os
skills/bootstrap-interviewer/SKILL.md → tier: core,    category: org-os
skills/expert-feynman/SKILL.md      → tier: core,      category: research
skills/idea-scout/SKILL.md          → tier: core,      category: research
skills/knowledge-curator/SKILL.md   → tier: extended,  category: research
skills/meeting-processor/SKILL.md   → tier: core,      category: operations
skills/funding-scout/SKILL.md       → tier: core,      category: operations
skills/capital-flow/SKILL.md        → tier: core,      category: operations
skills/karpathy-guidelines/SKILL.md → tier: core,      category: guidelines
skills/workspace-improver/SKILL.md  → tier: extended,  category: operations
```

`skills/org-os-init/SKILL.md` already has `tier: core` — add `category: org-os`.

- [ ] **Step 1: For each file in the table, add the two frontmatter keys**

Use `Edit` on each file. Insert `tier:` and `category:` immediately after `description:`. Example for `skills/expert-feynman/SKILL.md` — find:

```yaml
---
name: expert-feynman
description: Richard Feynman's first-principles thinking and explanation frameworks. Use when trying to understand a complex system, learning something new, needing to explain a complicated concept simply, or debugging through systematic elimination.
```

Replace with:

```yaml
---
name: expert-feynman
description: Richard Feynman's first-principles thinking and explanation frameworks. Use when trying to understand a complex system, learning something new, needing to explain a complicated concept simply, or debugging through systematic elimination.
tier: core
category: research
```

Repeat for each file in the table above. **Do not** edit any plugin skills.

- [ ] **Step 2: Regenerate**

```bash
npm run generate:skills
```

- [ ] **Step 3: Verify groups are populated**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('.well-known/skills.json')).groups)"
```

Expected: `org-os`, `research`, `operations`, `guidelines` appear with non-zero counts.

- [ ] **Step 4: Commit**

```bash
git add skills/ .well-known/skills.json SKILLS.md
git commit -m "feat: tag canonical workspace skills with tier + category"
```

---

## Phase D — Dashboard integration

### Task 14: Replace loadSkills() in initialize.mjs with discovery walker

**Files:**
- Modify: `scripts/initialize.mjs`

- [ ] **Step 1: Import the walker**

At the top of `scripts/initialize.mjs`, add:

```javascript
import { discoverSkills } from './lib/discover-skills.mjs';
```

- [ ] **Step 2: Replace the body of `loadSkills`**

Find the existing `loadSkills()` function (around line 786). Replace its body with:

```javascript
function loadSkills() {
  const home = process.env.HOME;
  const result = discoverSkills({
    workspaceDir: rootDir,
    userDir: home ? path.join(home, '.claude') : null,
    pluginRoot: home ? path.join(home, '.claude', 'plugins', 'cache') : null,
    federationYaml: path.join(rootDir, 'federation.yaml'),
  });
  return result; // { skills, anomalies, totals, groups }
}
```

- [ ] **Step 3: Update consumers**

Find every usage of `skills` in `scripts/initialize.mjs` (the `state.skills` field and the markdown renderer). Where the old code expected an array, change it to read `state.skills.skills`. Specifically:

- In the `main()` aggregation around line 994, the `skills` variable is now an object `{ skills, anomalies, totals, groups }`. Rename: `const skillsData = loadSkills();` and assign `skills: skillsData` in the state.
- In `renderMarkdown(state)` around line 1049, update the destructure to `const { ... skills } = state;` and reference `skills.groups` / `skills.skills` / `skills.anomalies` where needed.
- The Federation footer at line ~1227 uses `status.skillCount` — replace with `state.skills.totals.workspace + state.skills.totals.user + state.skills.totals.plugin`.

- [ ] **Step 4: Run the dashboard end to end**

```bash
node scripts/initialize.mjs | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('groups:', j.skills.groups.map(g=>g.name+':'+g.count).join(', '))})"
```

Expected: a list of groups with non-zero counts, e.g. `org-os:5, superpowers:14, research:3, operations:4, ...`.

- [ ] **Step 5: Commit**

```bash
git add scripts/initialize.mjs
git commit -m "feat: initialize dashboard pulls skills from discover-skills walker"
```

---

### Task 15: Render the new Skills section in the dashboard

**Files:**
- Modify: `scripts/initialize.mjs` (markdown renderer)
- Modify: `skills/org-os-init/SKILL.md` (spec)

- [ ] **Step 1: Add the renderer**

In `scripts/initialize.mjs`, in `renderMarkdown(state)`, after the existing Federation block and before the trailing `---`, add:

```javascript
// Skills section
const skillsCfg = (state.dashboardConfig?.sections?.skills) || {};
if (skillsCfg.show !== false) {
  const groupOrder = skillsCfg.groups || skills.groups.map((g) => g.name);
  const featured = skillsCfg.featured_groups || groupOrder;
  const descriptions = skillsCfg.descriptions || {};
  const total = skills.totals.workspace + skills.totals.user + skills.totals.plugin;

  out += `─── Skills ───────────────────────────────────────────────────────────────\n\n`;
  for (const groupName of featured) {
    const g = skills.groups.find((x) => x.name === groupName);
    if (!g) continue;
    const status = g.hasIssue ? '⚠' : '●';
    const desc = descriptions[groupName] || g.skills.slice(0, 3).join(', ');
    out += `  ${status}  ${groupName.padEnd(12)}${String(g.count).padStart(2)}  ${desc}\n`;
  }
  out += `\n`;
  const sources = ['workspace', 'user', 'plugin'].filter((k) => skills.totals[k] > 0).length;
  out += `  ${total} active across ${sources} source(s)`;
  if (skills.anomalies.length > 0 && skillsCfg.show_anomalies !== false) {
    out += ` · ⚠ ${skills.anomalies.length} anomal${skills.anomalies.length === 1 ? 'y' : 'ies'}`;
  }
  out += `\n  Full list: ${skillsCfg.page || 'SKILLS.md'}  ·  Detail: /skills <name>\n\n`;
}
```

- [ ] **Step 2: Load `dashboard.yaml` once and attach to state**

In `main()` (where state is assembled), add:

```javascript
let dashboardConfig = null;
try {
  const yamlText = fs.readFileSync(path.join(rootDir, 'dashboard.yaml'), 'utf-8');
  dashboardConfig = (await import('js-yaml')).load(yamlText);
} catch { /* missing config is fine */ }
state.dashboardConfig = dashboardConfig;
```

- [ ] **Step 3: Update the `org-os-init` skill spec**

In `skills/org-os-init/SKILL.md`, find the existing `#### 9. FEDERATION (compact)` section and add a new section before the Session Prompt:

```markdown
#### 10. SKILLS

Compact group-level summary of every skill loaded across workspace, user, and plugin sources.

```
─── Skills ───────────────────────────────────────────────────────────────

  ●  org-os         5  core lifecycle (init, heartbeat, schema-gen, ...)
  ●  superpowers   12  engineering process (brainstorming, plans, TDD, ...)
  ●  research       2  feynman first-principles, idea-scout

  27 active across 3 sources · ⚠ 1 anomaly
  Full list: SKILLS.md  ·  Detail: /skills <name>
```

Rules:
- Pulls from `state.skills.groups` (produced by `scripts/lib/discover-skills.mjs`)
- Show `featured_groups` from `dashboard.yaml` in compact mode; all groups in full mode
- One-line group description from `dashboard.yaml.descriptions[group]`, falling back to the first 3 skill names
- Anomaly indicator on the totals line when `state.skills.anomalies.length > 0`
- Footer always points to `SKILLS.md` and `/skills <name>`
```

(Renumber the Session Prompt section from 10 → 11.)

- [ ] **Step 4: Run the dashboard and visually confirm**

```bash
node scripts/initialize.mjs --format=markdown | grep -A 12 "─── Skills"
```

Expected: see a Skills section with at least 3 groups and a totals line.

- [ ] **Step 5: Commit**

```bash
git add scripts/initialize.mjs skills/org-os-init/SKILL.md
git commit -m "feat: dashboard renders Skills section from discover-skills"
```

---

### Task 16: Add `skills:` block to dashboard.yaml

**Files:**
- Modify: `dashboard.yaml`

- [ ] **Step 1: Add the block under `sections:`**

In `dashboard.yaml`, between the `federation:` and `prompt:` sections, insert:

```yaml
  skills:
    show: true
    mode: compact
    featured_groups: [org-os, superpowers, research, operations]
    groups: [org-os, superpowers, research, operations, guidelines, paperclip]
    show_anomalies: true
    page: SKILLS.md
    descriptions:
      org-os: "core lifecycle (init, heartbeat, schema-gen, ...)"
      superpowers: "engineering process (brainstorming, plans, TDD, ...)"
      research: "feynman first-principles, idea-scout"
      operations: "meetings, funding, capital, bootstrap"
      guidelines: "behavioural guidance for coding agents"
      paperclip: "agent control + plugin authoring"
```

- [ ] **Step 2: Run the dashboard and confirm group descriptions appear**

```bash
node scripts/initialize.mjs --format=markdown | sed -n '/─── Skills/,/Full list/p'
```

Expected: each group line shows the configured description, not just skill names.

- [ ] **Step 3: Commit**

```bash
git add dashboard.yaml
git commit -m "feat: dashboard.yaml gains skills section with featured groups + descriptions"
```

---

## Phase E — Slash command + reconciliation

### Task 17: Create `/skills` slash command

**Files:**
- Create: `.claude/commands/skills.md`

- [ ] **Step 1: Write the command file**

Create `.claude/commands/skills.md`:

```markdown
---
name: skills
description: List skills loaded across workspace, user, and plugin sources. Use `/skills full` for detail, `/skills <name>` for one skill, `/skills regenerate` to refresh SKILLS.md.
---

You are responding to the `/skills` slash command. Argument (if any): `$ARGUMENTS`

## Step 1: Run discovery

Run: `npm run generate:skills`

This regenerates `.well-known/skills.json` and `SKILLS.md`, and also serves as the source of fresh data.

## Step 2: Render based on argument

- **No argument** → render the compact dashboard Skills section (groups + counts + anomaly line) directly in chat. Take it from `node scripts/initialize.mjs --format=markdown` and extract the `─── Skills` block. End with `See SKILLS.md for full list.`
- **`full`** → print the full grouped listing (read `SKILLS.md` and post it inline, trimmed if very long).
- **`regenerate`** → confirm with `✓ regenerated .well-known/skills.json + SKILLS.md`.
- **`<name>`** → read `.well-known/skills.json`, find the entry whose `id` matches `$ARGUMENTS`, and print its frontmatter fields (id, source, source_detail, group, tier, version, description) plus a short pointer to its `path`. If not found, suggest the closest match by Levenshtein.

## Step 3: Stay terse

Output is for the operator. No surrounding commentary.
```

- [ ] **Step 2: Smoke test (manual)**

In a Claude Code session, type `/skills` and confirm it renders the same Skills block that `/initialize` shows.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/skills.md
git commit -m "feat: /skills slash command (compact, full, regenerate, <name>)"
```

---

### Task 18: Reconcile-federation-skills script

**Files:**
- Create: `scripts/reconcile-federation-skills.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/reconcile-federation-skills.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { discoverSkills } from './lib/discover-skills.mjs';

const repoRoot = process.cwd();
const fedPath = path.join(repoRoot, 'federation.yaml');

const result = discoverSkills({
  workspaceDir: repoRoot,
  userDir: null,
  pluginRoot: null,
  federationYaml: fedPath,
});

const workspaceSkillIds = result.skills
  .filter((s) => s.source === 'workspace' && s.status === 'ok')
  .map((s) => s.id)
  .sort();

const fed = yaml.load(fs.readFileSync(fedPath, 'utf-8'));
const before = fed?.agent?.skills || [];

if (JSON.stringify(before) === JSON.stringify(workspaceSkillIds)) {
  console.log('✓ federation.yaml agent.skills already in sync');
  process.exit(0);
}

console.log(`Will update federation.yaml agent.skills:`);
console.log(`  before: ${before.length} entries`);
console.log(`  after:  ${workspaceSkillIds.length} entries`);
console.log(`  + add:    ${workspaceSkillIds.filter((s) => !before.includes(s)).join(', ') || '(none)'}`);
console.log(`  - remove: ${before.filter((s) => !workspaceSkillIds.includes(s)).join(', ') || '(none)'}`);

if (!process.argv.includes('--write')) {
  console.log('\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

fed.agent = fed.agent || {};
fed.agent.skills = workspaceSkillIds;
fs.writeFileSync(fedPath, yaml.dump(fed, { lineWidth: 100, noRefs: true }));
console.log('\n✓ federation.yaml updated. Review the diff and commit.');
```

- [ ] **Step 2: Add the npm script**

Add to `package.json` `scripts`:

```json
"reconcile:federation-skills": "node scripts/reconcile-federation-skills.mjs",
```

- [ ] **Step 3: Dry-run, then write**

```bash
npm run reconcile:federation-skills
```

Confirm the diff. Then:

```bash
node scripts/reconcile-federation-skills.mjs --write
```

- [ ] **Step 4: Verify and commit**

```bash
node scripts/initialize.mjs | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log(j.skills.anomalies)})"
```

Expected: no `federation_drift` anomaly remains.

```bash
git add package.json scripts/reconcile-federation-skills.mjs federation.yaml
git commit -m "feat: reconcile-federation-skills + sync federation.yaml agent.skills"
```

---

## Phase F — CI gate + docs

### Task 19: Extend validate-structure.mjs

**Files:**
- Modify: `scripts/validate-structure.mjs`

- [ ] **Step 1: Add a section that checks anomalies**

In `scripts/validate-structure.mjs`, before the `// --- Summary ---` block (line ~291), add:

```javascript
// --- 9. Skill anomalies ---
console.log('\n9. Skill Discovery');

if (fileExists('.well-known/skills.json')) {
  try {
    const skillsJson = JSON.parse(readFileSync(join(rootDir, '.well-known/skills.json'), 'utf-8'));
    check('.well-known/skills.json is valid', true);
    check(
      `skill discovery produces zero anomalies (got ${skillsJson.anomalies.length})`,
      skillsJson.anomalies.length === 0,
    );
    if (skillsJson.anomalies.length > 0) {
      for (const a of skillsJson.anomalies) {
        console.log(`    - ${a.type}: ${JSON.stringify(a)}`);
      }
    }
  } catch {
    check('.well-known/skills.json is valid', false);
  }
} else {
  warn('.well-known/skills.json not present — run npm run generate:skills');
}
```

- [ ] **Step 2: Run validation**

```bash
npm run validate:structure
```

Expected: Skill Discovery section is checked; passes since previous task synced `federation.yaml`.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-structure.mjs
git commit -m "feat: validate:structure rejects skill anomalies"
```

---

### Task 20: Document discovery in AGENTIC-ARCHITECTURE.md

**Files:**
- Modify: `docs/AGENTIC-ARCHITECTURE.md`

- [ ] **Step 1: Add a section**

Open `docs/AGENTIC-ARCHITECTURE.md`. Append (or insert near the existing "Skills" content — search for `## Skills` first):

```markdown
## Skill Discovery

A single walker, `scripts/lib/discover-skills.mjs`, scans three sources:

1. **Workspace** — `<repo>/skills/*/SKILL.md`
2. **User** — `~/.claude/skills/*/SKILL.md`
3. **Plugin** — `~/.claude/plugins/cache/<collection>/<plugin>/<version>/skills/*/SKILL.md`

It parses `SKILL.md` frontmatter and emits a normalized array of skills plus an anomalies array. The same walker feeds:

- The `Skills` section of the `/initialize` dashboard.
- `SKILLS.md` (human-readable page at repo root).
- `.well-known/skills.json` (machine-readable, federation-friendly).
- The `/skills` slash command (compact / full / `<name>` / regenerate).

Grouping rule:
1. If a skill's frontmatter has `category:`, that wins.
2. Else, if the skill is from a plugin source, the group is the plugin name.
3. Else, the group is `uncategorized`.

Anomalies surfaced today:
- `malformed_frontmatter` — SKILL.md frontmatter cannot be parsed.
- `duplicate_id` — the same skill id appears in multiple sources.
- `federation_drift` — `federation.yaml agent.skills` length differs from on-disk workspace skill count. Run `npm run reconcile:federation-skills` to fix.

CI gate: `npm run validate:structure` rejects any anomaly.

Regenerate: `npm run generate:skills` (also chained from `npm run generate:schemas`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/AGENTIC-ARCHITECTURE.md
git commit -m "docs: document skill discovery + anomaly handling"
```

---

### Task 21: End-to-end smoke test

**Files:** none (verification only).

- [ ] **Step 1: Clean regenerate**

```bash
rm -f .well-known/skills.json SKILLS.md
npm run generate:skills
```

Expected: both files written, no errors.

- [ ] **Step 2: Open the dashboard**

```bash
node scripts/initialize.mjs --format=markdown | sed -n '/─── Skills/,/Full list/p'
```

Expected: Skills section renders. Group counts for `org-os`, `superpowers`, `research`, `operations` are non-zero. No `⚠` anomaly indicator (federation was reconciled in Task 18).

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: 11 tests passing (8 in discover-skills, 2 in generate-skills, plus any added; adjust the assertion if more tests were added during Phase A iterations).

- [ ] **Step 4: Run validation**

```bash
npm run validate:structure
```

Expected: Skill Discovery section checks pass; overall result `✓ Instance passes structural validation`.

- [ ] **Step 5: Commit the regenerated artifacts (if changed)**

```bash
git add -A .well-known/skills.json SKILLS.md
git diff --cached --quiet || git commit -m "chore: refresh skills artifacts"
```

---

## Self-review notes

- **Spec coverage:** Architecture (Tasks 1-9), generator (10-12), frontmatter additions (13), dashboard integration (14-16), slash command (17), reconciliation (18), CI gate (19), docs (20), smoke (21). All sections in the spec map to at least one task.
- **No placeholders.** Every code block is concrete; commit messages explicit.
- **Type consistency.** The walker's return shape `{ skills, anomalies, totals, groups }` is referenced consistently from Task 9 onward. `tier`, `category`, and `group` keys match across walker, JSON output, dashboard renderer, and validate-structure.
- **TDD.** Phase A and the JSON/Markdown writers in Phase B are red-green. Phases C-F are integration (no new logic to test in isolation).
- **Frequent commits.** 21 tasks, 21+ commits.
- **Out of scope** stays out: `/commands` consolidation is its own future plan (queued).
