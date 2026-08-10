# Cloudflare OS Integration M3–M4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the non-technical **write path** (M3 — four write capabilities plus the `org-inbox` gadget, every change arriving as a pull request) and the **federation view** (M4 — a `get_federation_map` capability plus a federation-map gadget), then wire the package into `npm run selftest`.

**Architecture:** Writes never mutate a registry in place. A capability validates its payload, reads the target file, produces new content through a **comment-preserving text editor** (never a YAML round-trip, which would destroy the registries' extensive comments), and hands the result to `substrate.proposeChange()` — which opens a PR on a fresh branch named by a hash of the payload, so a double-submit reuses the open PR instead of opening a second one. The worst case a member can cause is a bad PR. M4 adds one pure builder (`buildFederationMap`) producing the `map.json` shape the existing `@org-os/federation-map` web component already consumes.

**Tech Stack:** Node ≥22 + `node --test`, `js-yaml` (reads only), `crypto.subtle` for hashing (present in both Node 22 and workerd), GitHub REST API through the injected `fetch`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md` (M3/M4 rows of the milestone table, "Write capabilities (exactly four)", Components 1 and 3)
**Branch:** `autopoiesis-phase2-pilot`
**Package root:** all paths below are relative to `packages/cloudflare-os-integration/` unless stated otherwise.

---

## Context: what already exists

- **86 tests green.** `src/page-core/` (`parse-helpers`, `build-state`, `render-page`), `src/substrate/` (`memory-substrate`, `github-substrate`), `src/gatekeeper/` (`instances`, `context-bundle`, `capabilities`).
- **The envelope contract** in `capabilities.mjs`: `handle()` never throws; every path resolves to `{ok: true, data, provenance: {instance, sha, date, stale}}` or `{ok: false, error: {code, message, detail?}}`. `message` is operator-facing plain language; `detail` is diagnostic and **must never be rendered**.
- **`proposeChange()` is a stub** in both substrates, throwing `Error("M3 — not implemented")` (`github-substrate.mjs:87`, and the matching stub in `memory-substrate.mjs`).
- **`GitHubSubstrate._cachedFetch(url, accept, label)`** handles GET with ETag/TTL/stale-while-revalidate. Writes need a separate uncached path — Task 5 adds `_write()`.
- **The adapter** (`src/adapter/gatekeeper-org-os/src/org-os.ts`) narrows its approval queue to `Pick<ApprovalQueue, "authorizeObservation">` with the comment *"authorizeObservation is the whole surface — there is no submitAction call anywhere."* Writes are **actions**, not observations, so that type must widen — see the gate below.

## Two gates before the deployment-dependent tasks

**Gate A — the upstream action API (blocks Task 9 only).** Per §D7 of `docs/integrations/cloudflare-os.md`, side-effecting actions go through the approval queue and must not execute until approved, with asynchronous approval and simulation. The **method name and signature** for submitting an action are not recorded anywhere in this repo. Read them from the pinned checkout before writing adapter code:

```bash
grep -n "Action\|submit\|approve" ~/code/cloudflare-os/packages/workshop-shared/src/gatekeeper.ts | head -40
```

Record the real signature in §D7 of `docs/integrations/cloudflare-os.md`. Tasks 1–8 and 10–13 are pure Node and do not depend on this.

**Gate B — token scope (blocks the deployment runbook, not this plan).** The pilot token is `contents: read` only. The write path needs `contents: write` **and** `pull-requests: write` on the target repos. Task 14 updates the runbook; granting it is operator work.

---

## File structure

| File | Responsibility |
|---|---|
| `src/edit/yaml-edit.mjs` | **Create.** Comment-preserving YAML text edits: append a sequence item, set a field on an item |
| `src/edit/markdown-edit.mjs` | **Create.** Append a checklist item under a markdown heading |
| `src/gatekeeper/write-payloads.mjs` | **Create.** Payload validation + the pure payload→file-edit transforms |
| `src/gatekeeper/capabilities.mjs` | **Modify.** `WRITE_CAPABILITIES`, four handlers, dispatch over read+write |
| `src/substrate/memory-substrate.mjs` | **Modify.** `proposeChange` records proposals; idempotent by branch |
| `src/substrate/github-substrate.mjs` | **Modify.** `proposeChange` → branch + commits + PR, idempotent; `_write()` |
| `src/page-core/build-federation-map.mjs` | **Create.** Pure `map.json` builder (M4) |
| `blueprints/org-inbox/gadget.html` | **Create.** The member-facing write form (M3) |
| `blueprints/federation-map/gadget.html` | **Create.** The federation view (M4) |
| `test/yaml-edit.test.mjs`, `test/markdown-edit.test.mjs`, `test/write-payloads.test.mjs`, `test/build-federation-map.test.mjs` | **Create.** |
| `test/memory-substrate.test.mjs`, `test/github-substrate.test.mjs`, `test/capabilities.test.mjs` | **Modify.** |
| `scripts/selftest.mjs` (repo root) | **Modify.** Run the package's suite |

---

## Milestone M3 — the write path

### Task 1: `yaml-edit.mjs` — comment-preserving edits

The registries carry heavy comments (`data/ideas.yaml` has section banners, `data/meetings.yaml` is `meetings: []` followed by a commented example block). `yaml.load` + `yaml.dump` would silently delete all of it, so every write is a **text** edit.

**Files:** Create `src/edit/yaml-edit.mjs`, `test/yaml-edit.test.mjs`

- [ ] **Step 1:** Write the failing test `test/yaml-edit.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { appendToSequence, setFieldOnItem } from "../src/edit/yaml-edit.mjs";

const IDEAS = `schema_version: "2.0"

# Ideas Registry
# Lifecycle: surfaced → proposed

ideas:
  # --- seeded ---
  - id: "idea-001"
    title: "First"
    status: "surfaced"
`;

const EMPTY_MEETINGS = `schema_version: "2.0"

# Meeting Registry

meetings: []
  # Example:
  # - id: "mtg-1"
`;

test("appendToSequence adds an item and preserves every comment", () => {
  const out = appendToSequence(IDEAS, "ideas", `  - id: "idea-002"\n    title: "Second"\n`);
  assert.ok(out.includes("# Ideas Registry"));
  assert.ok(out.includes("# --- seeded ---"));
  assert.equal(yaml.load(out).ideas.length, 2);
  assert.equal(yaml.load(out).ideas[1].id, "idea-002");
  assert.equal(yaml.load(out).schema_version, "2.0");
});

test("appendToSequence converts an empty flow sequence to a block sequence", () => {
  const out = appendToSequence(EMPTY_MEETINGS, "meetings", `  - id: "mtg-2"\n    title: "Sync"\n`);
  assert.ok(!/meetings: \[\]/.test(out), "flow sequence should be gone");
  assert.ok(out.includes("# Example:"), "commented example must survive");
  assert.equal(yaml.load(out).meetings.length, 1);
  assert.equal(yaml.load(out).meetings[0].id, "mtg-2");
});

test("appendToSequence throws on an unknown key", () => {
  assert.throws(() => appendToSequence(IDEAS, "nope", "  - a: 1\n"), /nope/);
});

test("appendToSequence does not disturb a following top-level key", () => {
  const src = `items:\n  - id: "a"\n\nother: 1\n`;
  const out = appendToSequence(src, "items", `  - id: "b"\n`);
  const parsed = yaml.load(out);
  assert.deepEqual(parsed.items.map((i) => i.id), ["a", "b"]);
  assert.equal(parsed.other, 1);
});

test("setFieldOnItem replaces a field, preserving quote style and comments", () => {
  const src = `projects:\n  # a comment\n  - id: "alpha"\n    status: "Develop"\n  - id: "beta"\n    status: "Discovery"\n`;
  const out = setFieldOnItem(src, "projects", "beta", "status", "Develop");
  assert.ok(out.includes("# a comment"));
  assert.equal(yaml.load(out).projects[0].status, "Develop");
  assert.equal(yaml.load(out).projects[1].status, "Develop");
  assert.ok(out.includes(`status: "Develop"`), "quote style preserved");
});

test("setFieldOnItem throws when the item or field is absent", () => {
  const src = `projects:\n  - id: "alpha"\n    status: "Develop"\n`;
  assert.throws(() => setFieldOnItem(src, "projects", "ghost", "status", "X"), /ghost/);
  assert.throws(() => setFieldOnItem(src, "projects", "alpha", "owner", "X"), /owner/);
});
```

- [ ] **Step 2:** Run it:

```bash
cd packages/cloudflare-os-integration && npm test
```

Expected: FAIL — `Cannot find module '../src/edit/yaml-edit.mjs'`.

- [ ] **Step 3:** Implement `src/edit/yaml-edit.mjs`:

```js
// ── yaml-edit.mjs ────────────────────────────────────────────────────────────
// Text-level edits to YAML registries. Deliberately NOT a parse/serialize
// round-trip: every org-os registry carries section banners, lifecycle notes
// and commented examples, and js-yaml's dump() discards all of them. A member
// submitting an idea must not silently strip the file's documentation.
//
// The trade-off is that these functions understand only the shapes org-os
// registries actually use: a top-level key holding a block sequence of mappings
// (or an empty flow sequence, `key: []`). Anything else throws rather than
// guessing — a thrown error becomes an operator-facing BAD_ARGS/UPSTREAM, which
// is far better than a corrupted registry in a PR.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Index of the line declaring top-level `key:`, or -1.
function findKeyLine(lines, key) {
  const re = new RegExp(`^${escapeRe(key)}:`);
  return lines.findIndex((l) => re.test(l));
}

// The block belonging to `keyIdx` runs until the next line that starts at
// column 0 and is neither blank nor a comment — i.e. the next top-level key.
// Column-0 comments are treated as part of the current block: absorbing a
// trailing comment is harmless (the item still lands inside the sequence),
// whereas ending the block early would insert the item outside it.
function blockEnd(lines, keyIdx) {
  for (let i = keyIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || /^\s/.test(l) || l.startsWith("#")) continue;
    return i;
  }
  return lines.length;
}

/**
 * Append `itemYaml` (already indented, e.g. `  - id: "x"\n    title: "y"\n`)
 * to the block sequence held by top-level `key`.
 */
export function appendToSequence(text, key, itemYaml) {
  const lines = text.split("\n");
  const keyIdx = findKeyLine(lines, key);
  if (keyIdx === -1) throw new Error(`yaml-edit: top-level key not found: ${key}`);

  // `key: []` — an empty flow sequence. Convert to a block sequence so an item
  // can be appended; the commented example block beneath it is untouched.
  if (new RegExp(`^${escapeRe(key)}:\\s*\\[\\s*\\]\\s*$`).test(lines[keyIdx])) {
    lines[keyIdx] = `${key}:`;
  }

  let insertAt = blockEnd(lines, keyIdx);
  while (insertAt > keyIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  lines.splice(insertAt, 0, ...itemYaml.replace(/\n$/, "").split("\n"));
  return lines.join("\n");
}

// Start indices of each `- ` item inside a block, with the block's end.
function itemRanges(lines, keyIdx) {
  const end = blockEnd(lines, keyIdx);
  const starts = [];
  for (let i = keyIdx + 1; i < end; i++) {
    if (/^\s+-\s/.test(lines[i])) starts.push(i);
  }
  return starts.map((start, n) => ({ start, end: n + 1 < starts.length ? starts[n + 1] : end }));
}

/**
 * Set `field` to `value` on the item in `key`'s sequence whose `id` is
 * `itemId`. Preserves the field's existing quote style.
 */
export function setFieldOnItem(text, key, itemId, field, value) {
  const lines = text.split("\n");
  const keyIdx = findKeyLine(lines, key);
  if (keyIdx === -1) throw new Error(`yaml-edit: top-level key not found: ${key}`);

  const idRe = /^\s*(?:-\s*)?id:\s*"?([^"\n]*?)"?\s*$/;
  const range = itemRanges(lines, keyIdx).find((r) => {
    for (let i = r.start; i < r.end; i++) {
      const m = lines[i].match(idRe);
      if (m) return m[1] === itemId;
    }
    return false;
  });
  if (!range) throw new Error(`yaml-edit: no item with id "${itemId}" in ${key}`);

  const fieldRe = new RegExp(`^(\\s*(?:-\\s*)?${escapeRe(field)}:\\s*)(")?.*?\\2?\\s*$`);
  for (let i = range.start; i < range.end; i++) {
    const m = lines[i].match(fieldRe);
    if (!m) continue;
    const quote = m[2] ?? "";
    lines[i] = `${m[1]}${quote}${value}${quote}`;
    return lines.join("\n");
  }
  throw new Error(`yaml-edit: item "${itemId}" has no field "${field}"`);
}
```

- [ ] **Step 4:** Run:

```bash
cd packages/cloudflare-os-integration && npm test
```

Expected: PASS — 6 new tests, previous 86 still green.

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/edit/yaml-edit.mjs packages/cloudflare-os-integration/test/yaml-edit.test.mjs
git commit -m "feat(cloudflare-os): comment-preserving YAML text edits"
```

### Task 2: `markdown-edit.mjs`

**Files:** Create `src/edit/markdown-edit.mjs`, `test/markdown-edit.test.mjs`

- [ ] **Step 1:** Write the failing test `test/markdown-edit.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendChecklistItem } from "../src/edit/markdown-edit.mjs";

const HB = `# Heartbeat

## Active Tasks

### Operations
- [ ] Existing thing
- [x] Done thing

## System Health

- All green
`;

test("appends after the last checklist item in the section", () => {
  const out = appendChecklistItem(HB, "Active Tasks", "New thing");
  const lines = out.split("\n");
  const idx = lines.indexOf("- [ ] New thing");
  assert.ok(idx > lines.indexOf("- [x] Done thing"), "must land after existing items");
  assert.ok(idx < lines.indexOf("## System Health"), "must stay inside its section");
});

test("leaves other sections untouched", () => {
  const out = appendChecklistItem(HB, "Active Tasks", "New thing");
  assert.ok(out.includes("## System Health\n\n- All green"));
  assert.equal(out.match(/- \[ \] New thing/g).length, 1);
});

test("appends to a section that has no items yet", () => {
  const src = `# H\n\n## Active Tasks\n\n## Other\n`;
  const out = appendChecklistItem(src, "Active Tasks", "First");
  const lines = out.split("\n");
  assert.ok(lines.indexOf("- [ ] First") < lines.indexOf("## Other"));
});

test("throws when the heading is absent", () => {
  assert.throws(() => appendChecklistItem(HB, "Nope", "x"), /Nope/);
});
```

- [ ] **Step 2:** Run — expected FAIL (module not found).

- [ ] **Step 3:** Implement `src/edit/markdown-edit.mjs`:

```js
// ── markdown-edit.mjs ────────────────────────────────────────────────────────
// HEARTBEAT.md is the one write target that isn't YAML. Same principle as
// yaml-edit: edit the text, never regenerate the document.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Append `- [ ] <itemText>` inside the section introduced by a `##`/`###`
 * heading whose text is `heading`. The item lands after the section's last
 * existing checklist line, or at the end of the section when it has none.
 */
export function appendChecklistItem(text, heading, itemText) {
  const lines = text.split("\n");
  const headingRe = new RegExp(`^#{2,3}\\s+${escapeRe(heading)}\\s*$`);
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) throw new Error(`markdown-edit: heading not found: ${heading}`);

  // The section ends at the next heading of the same or shallower depth.
  const depth = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= depth) { end = i; break; }
  }

  let insertAt = end;
  for (let i = end - 1; i > start; i--) {
    if (/^\s*- \[[ xX~]\]/.test(lines[i])) { insertAt = i + 1; break; }
  }
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  lines.splice(insertAt, 0, `- [ ] ${itemText}`);
  return lines.join("\n");
}
```

- [ ] **Step 4:** Run — expected PASS (4 new tests).

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/edit/markdown-edit.mjs packages/cloudflare-os-integration/test/markdown-edit.test.mjs
git commit -m "feat(cloudflare-os): markdown checklist append"
```

### Task 3: `write-payloads.mjs` — validation and transforms

Each write is a pure function: `(payload, currentFileContent) → {path, content, message, title, body}`. No substrate, no I/O — fully testable.

**Note on `update_project_status`:** the documented vocabulary in `docs/DATA-MODEL.md` is `idea | develop | execute | archive`, but the hub's own `data/projects.yaml` uses `"Develop"` and `"Discovery"`. Rather than hard-code either (and reject an instance's real data), the validator accepts a status **already in use in that instance's registry**. The org's own file is the vocabulary. Task 14 logs the doc/data drift as a follow-up.

**Files:** Create `src/gatekeeper/write-payloads.mjs`, `test/write-payloads.test.mjs`

- [ ] **Step 1:** Write the failing test `test/write-payloads.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { WRITE_SPECS, buildWrite, ValidationError } from "../src/gatekeeper/write-payloads.mjs";

const IDEAS = `schema_version: "2.0"\n\n# Ideas\n\nideas:\n  - id: "idea-001"\n    title: "First"\n`;
const MEETINGS = `schema_version: "2.0"\n\nmeetings: []\n`;
const PROJECTS = `schema_version: "2.0"\n\nprojects:\n  - id: "alpha"\n    name: "Alpha"\n    status: "Discovery"\n  - id: "beta"\n    name: "Beta"\n    status: "Develop"\n`;
const HEARTBEAT = `# Heartbeat\n\n## Active Tasks\n\n- [ ] Existing\n\n## System Health\n`;

const NOW = new Date("2026-08-10T12:00:00Z");

test("the write catalog is exactly the four chat-safe operations", () => {
  assert.deepEqual(Object.keys(WRITE_SPECS), [
    "submit_idea", "log_meeting", "update_project_status", "add_action_item",
  ]);
});

test("submit_idea produces a valid appended registry", () => {
  const w = buildWrite("submit_idea", {
    title: "Compost mapping", description: "Map compost sites", submitted_by: "github:mona",
  }, { current: IDEAS, now: NOW });
  assert.equal(w.path, "data/ideas.yaml");
  const parsed = yaml.load(w.content);
  assert.equal(parsed.ideas.length, 2);
  assert.equal(parsed.ideas[1].title, "Compost mapping");
  assert.equal(parsed.ideas[1].status, "surfaced");
  assert.equal(parsed.ideas[1].created, "2026-08-10");
  assert.match(parsed.ideas[1].id, /^idea-2026-08-10-/);
  assert.ok(w.content.includes("# Ideas"), "comments preserved");
  assert.match(w.title, /Compost mapping/);
});

test("log_meeting works against an empty registry", () => {
  const w = buildWrite("log_meeting", {
    title: "Weekly Sync", date: "2026-08-09", summary: "Talked.", participants: ["github:mona"],
  }, { current: MEETINGS, now: NOW });
  assert.equal(w.path, "data/meetings.yaml");
  assert.equal(yaml.load(w.content).meetings.length, 1);
  assert.equal(yaml.load(w.content).meetings[0].title, "Weekly Sync");
});

test("update_project_status only accepts a status the registry already uses", () => {
  const w = buildWrite("update_project_status", { project_id: "alpha", status: "Develop" },
    { current: PROJECTS, now: NOW });
  assert.equal(yaml.load(w.content).projects[0].status, "Develop");

  assert.throws(
    () => buildWrite("update_project_status", { project_id: "alpha", status: "Shipped" },
      { current: PROJECTS, now: NOW }),
    (e) => e instanceof ValidationError && /Discovery/.test(e.message),
  );
});

test("add_action_item appends to HEARTBEAT under Active Tasks", () => {
  const w = buildWrite("add_action_item", { text: "Book the venue", due: "2026-08-20" },
    { current: HEARTBEAT, now: NOW });
  assert.equal(w.path, "HEARTBEAT.md");
  assert.ok(w.content.includes("- [ ] Book the venue (due: 2026-08-20)"));
});

test("missing required fields raise ValidationError naming the field", () => {
  assert.throws(() => buildWrite("submit_idea", { description: "x" }, { current: IDEAS, now: NOW }),
    (e) => e instanceof ValidationError && /title/.test(e.message));
});

test("free text is rejected when it would break out of its YAML string", () => {
  assert.throws(
    () => buildWrite("submit_idea", { title: 'Bad "quote" idea', description: "x", submitted_by: "y" },
      { current: IDEAS, now: NOW }),
    (e) => e instanceof ValidationError && /quotation|character/i.test(e.message),
  );
});

test("an unknown write name throws", () => {
  assert.throws(() => buildWrite("delete_everything", {}, { current: IDEAS, now: NOW }), /delete_everything/);
});
```

- [ ] **Step 2:** Run — expected FAIL (module not found).

- [ ] **Step 3:** Implement `src/gatekeeper/write-payloads.mjs`:

```js
// ── write-payloads.mjs ───────────────────────────────────────────────────────
// Validation + the pure payload→file-edit transforms behind the four write
// capabilities. No substrate, no network: given a payload and the current file
// contents, produce the new contents plus the PR's message/title/body.
//
// The four operations are exactly the "Write operations (with confirmation)"
// list in docs/CHAT-INTERFACE.md. The "Never via chat" list from that document
// is enforced by absence: there is no capability here that touches SOUL.md,
// IDENTITY.md, federation.yaml, finances, governance, or skills. Adding one
// would be a governance change, not a code change.

import yaml from "js-yaml";
import { appendToSequence, setFieldOnItem } from "../edit/yaml-edit.mjs";
import { appendChecklistItem } from "../edit/markdown-edit.mjs";

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

// Values are emitted into double-quoted YAML scalars. Rather than implement
// YAML escaping (and risk getting it subtly wrong on a file a human will read
// in a PR), reject the characters that would need it. A member's idea title
// does not need a double quote or a newline; being told so is better than a
// mangled registry.
const FORBIDDEN = /["\n\r\t\\]/;

function str(payload, field, { required = true, max = 500 } = {}) {
  const v = payload?.[field];
  if (v === undefined || v === null || v === "") {
    if (!required) return null;
    throw new ValidationError(`"${field}" is required.`);
  }
  if (typeof v !== "string") throw new ValidationError(`"${field}" must be text.`);
  if (v.length > max) throw new ValidationError(`"${field}" is too long (max ${max} characters).`);
  if (FORBIDDEN.test(v)) {
    throw new ValidationError(
      `"${field}" can't contain quotation marks, tabs, backslashes or line breaks — please rephrase it as a single line.`,
    );
  }
  return v;
}

function isoDate(payload, field, { required = true } = {}) {
  const v = str(payload, field, { required, max: 10 });
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError(`"${field}" must be a date like 2026-08-10.`);
  return v;
}

function strList(payload, field, { max = 20 } = {}) {
  const v = payload?.[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`"${field}" must be a list.`);
  if (v.length > max) throw new ValidationError(`"${field}" has too many entries (max ${max}).`);
  return v.map((entry, i) => str({ [field]: entry }, field, { max: 120 }) ?? `${i}`);
}

const ymd = (now) => now.toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
const yamlList = (items) => `[${items.map((i) => `"${i}"`).join(", ")}]`;

// ── the four transforms ──────────────────────────────────────────────────────

function submitIdea(payload, { current, now }) {
  const title = str(payload, "title", { max: 160 });
  const description = str(payload, "description", { max: 1000 });
  const submittedBy = str(payload, "submitted_by", { max: 120 });
  const gap = str(payload, "ecosystem_gap", { required: false, max: 1000 });
  const champions = strList(payload, "champions");
  const date = ymd(now);
  const id = `idea-${date}-${slug(title)}`;

  const item =
    `  - id: "${id}"\n` +
    `    title: "${title}"\n` +
    `    status: "surfaced"\n` +
    `    submitted_by: "${submittedBy}"\n` +
    `    champions: ${yamlList(champions)}\n` +
    (gap ? `    ecosystem_gap: "${gap}"\n` : "") +
    `    description: "${description}"\n` +
    `    created: "${date}"\n` +
    `    updated: "${date}"\n`;

  return {
    path: "data/ideas.yaml",
    content: appendToSequence(current, "ideas", item),
    message: `idea: ${title}`,
    title: `Idea: ${title}`,
    body: `Submitted by ${submittedBy} via the org-inbox gadget.\n\n${description}`,
    key: id,
  };
}

function logMeeting(payload, { current, now }) {
  const title = str(payload, "title", { max: 160 });
  const date = isoDate(payload, "date");
  const summary = str(payload, "summary", { max: 2000 });
  const type = str(payload, "type", { required: false, max: 40 }) ?? "sync";
  const participants = strList(payload, "participants", { max: 60 });
  const id = `mtg-${date.replace(/-/g, "")}-${slug(title)}`;

  const item =
    `  - id: "${id}"\n` +
    `    title: "${title}"\n` +
    `    date: "${date}"\n` +
    `    type: "${type}"\n` +
    `    participants: ${yamlList(participants)}\n` +
    `    summary: "${summary}"\n` +
    `    decisions: []\n` +
    `    action_items: []\n`;

  return {
    path: "data/meetings.yaml",
    content: appendToSequence(current, "meetings", item),
    message: `meeting: ${title} (${date})`,
    title: `Meeting log: ${title} — ${date}`,
    body: `Logged via the org-inbox gadget.\n\n${summary}`,
    key: id,
  };
}

function updateProjectStatus(payload, { current }) {
  const projectId = str(payload, "project_id", { max: 120 });
  const status = str(payload, "status", { max: 60 });

  // The registry defines its own vocabulary. docs/DATA-MODEL.md documents
  // `idea|develop|execute|archive` while the hub's own file uses "Develop" and
  // "Discovery"; hard-coding either would reject real data. Accepting only a
  // value already in use keeps a member from inventing a new stage by typo,
  // without this module having an opinion about which vocabulary is right.
  let parsed;
  try {
    parsed = yaml.load(current);
  } catch (err) {
    throw new ValidationError(`The projects registry couldn't be read: ${err.message}`);
  }
  const known = [...new Set((parsed?.projects ?? []).map((p) => p?.status).filter(Boolean))];
  if (!known.includes(status)) {
    throw new ValidationError(
      `"${status}" isn't a status this org uses. Current statuses: ${known.join(", ")}.`,
    );
  }

  return {
    path: "data/projects.yaml",
    content: setFieldOnItem(current, "projects", projectId, "status", status),
    message: `project ${projectId}: status → ${status}`,
    title: `Project status: ${projectId} → ${status}`,
    body: `Status change submitted via the org-inbox gadget.`,
    key: `${projectId}:${status}`,
  };
}

function addActionItem(payload, { current }) {
  const text = str(payload, "text", { max: 240 });
  const due = isoDate(payload, "due", { required: false });
  const assignee = str(payload, "assignee", { required: false, max: 60 });
  const section = str(payload, "section", { required: false, max: 60 }) ?? "Active Tasks";

  // Matches the format extractCheckboxes() parses: "(due: YYYY-MM-DD)" then "@handle".
  const line = `${text}${due ? ` (due: ${due})` : ""}${assignee ? ` @${assignee}` : ""}`;

  return {
    path: "HEARTBEAT.md",
    content: appendChecklistItem(current, section, line),
    message: `heartbeat: ${text}`,
    title: `Action item: ${text}`,
    body: `Added to HEARTBEAT.md under "${section}" via the org-inbox gadget.`,
    key: line,
  };
}

// ── catalog ──────────────────────────────────────────────────────────────────
// `path` is the file each write reads and rewrites — the capability layer uses
// it to fetch current contents before calling buildWrite().
export const WRITE_SPECS = {
  submit_idea: { path: "data/ideas.yaml", build: submitIdea },
  log_meeting: { path: "data/meetings.yaml", build: logMeeting },
  update_project_status: { path: "data/projects.yaml", build: updateProjectStatus },
  add_action_item: { path: "HEARTBEAT.md", build: addActionItem },
};

export function buildWrite(name, payload, { current, now }) {
  const spec = WRITE_SPECS[name];
  if (!spec) throw new ValidationError(`"${name}" isn't a write this gatekeeper supports.`);
  return spec.build(payload, { current, now });
}
```

- [ ] **Step 4:** Run — expected PASS (8 new tests).

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/gatekeeper/write-payloads.mjs packages/cloudflare-os-integration/test/write-payloads.test.mjs
git commit -m "feat(cloudflare-os): write payload validation + transforms"
```

### Task 4: `MemorySubstrate.proposeChange`

**Files:** Modify `src/substrate/memory-substrate.mjs`, `test/memory-substrate.test.mjs`

- [ ] **Step 1:** Replace the existing `head + proposeChange` test in `test/memory-substrate.test.mjs` with:

```js
test("head returns provenance", async () => {
  assert.deepEqual(await sub.head(), { sha: "abc123", date: "2026-08-08" });
});

test("proposeChange records a proposal without mutating the base files", async () => {
  const s = new MemorySubstrate({ "a.md": "one" }, { sha: "s", date: "d" });
  const r = await s.proposeChange({
    files: { "a.md": "two" }, message: "m", branch: "inbox/x1", title: "T", body: "B",
  });
  assert.equal(r.branch, "inbox/x1");
  assert.equal(r.reused, false);
  assert.match(r.url, /inbox\/x1/);
  assert.equal(s.proposals.length, 1);
  assert.deepEqual(s.proposals[0].files, { "a.md": "two" });
  assert.equal(await s.readFile("a.md"), "one", "base must be unchanged — a PR is not a merge");
});

test("proposeChange on the same branch reuses the proposal", async () => {
  const s = new MemorySubstrate({ "a.md": "one" }, { sha: "s", date: "d" });
  const first = await s.proposeChange({ files: { "a.md": "two" }, message: "m", branch: "b", title: "T", body: "B" });
  const second = await s.proposeChange({ files: { "a.md": "three" }, message: "m", branch: "b", title: "T", body: "B" });
  assert.equal(second.reused, true);
  assert.equal(second.url, first.url);
  assert.equal(s.proposals.length, 1, "no second proposal");
});
```

- [ ] **Step 2:** Run — expected FAIL: `M3 — not implemented`.

- [ ] **Step 3:** In `src/substrate/memory-substrate.mjs`, initialise `this.proposals = []` in the constructor and replace the `proposeChange` stub:

```js
  // A proposal is a *proposed* change: it is recorded, and deliberately does
  // NOT mutate the substrate's files. That mirrors a pull request — the base
  // branch is untouched until a human merges — and keeps tests honest about
  // what a member's submission does and doesn't do.
  async proposeChange({ files, message, branch, title, body }) {
    const existing = this.proposals.find((p) => p.branch === branch);
    if (existing) return { ...existing.result, reused: true };
    const result = {
      url: `memory://proposal/${this.proposals.length + 1}/${branch}`,
      number: this.proposals.length + 1,
      branch,
      reused: false,
    };
    this.proposals.push({ files, message, branch, title, body, result });
    return result;
  }
```

- [ ] **Step 4:** Run — expected PASS.

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/substrate/memory-substrate.mjs packages/cloudflare-os-integration/test/memory-substrate.test.mjs
git commit -m "feat(cloudflare-os): MemorySubstrate proposeChange"
```

### Task 5: `GitHubSubstrate.proposeChange` — branch, commits, PR

**Files:** Modify `src/substrate/github-substrate.mjs`, `test/github-substrate.test.mjs`

- [ ] **Step 1:** Append to `test/github-substrate.test.mjs`:

```js
test("proposeChange creates a branch, commits each file, opens a PR", async () => {
  const f = fakeFetch([
    { status: 200, headers: {}, body: "[]" },                                              // no open PR
    { status: 200, headers: {}, body: '{"commit":{"sha":"base1","commit":{"committer":{"date":"2026-08-10T00:00:00Z"}}}}' },
    { status: 201, headers: {}, body: '{"ref":"refs/heads/inbox/x"}' },                    // create ref
    { status: 200, headers: {}, body: '{"sha":"blob1"}' },                                 // existing file sha
    { status: 200, headers: {}, body: '{"content":{"sha":"blob2"}}' },                     // PUT contents
    { status: 201, headers: {}, body: '{"html_url":"https://github.com/o/r/pull/7","number":7}' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  const r = await sub.proposeChange({
    files: { "data/ideas.yaml": "ideas: []\n" }, message: "idea: x",
    branch: "inbox/x", title: "Idea: x", body: "B",
  });
  assert.deepEqual(r, { url: "https://github.com/o/r/pull/7", number: 7, branch: "inbox/x", reused: false });

  assert.match(f.calls[0].url, /\/pulls\?head=o%3Ainbox%2Fx&state=open/);
  assert.match(f.calls[2].url, /\/git\/refs$/);
  assert.equal(JSON.parse(f.calls[2].opts.body).ref, "refs/heads/inbox/x");
  assert.equal(JSON.parse(f.calls[2].opts.body).sha, "base1");
  assert.equal(f.calls[4].opts.method, "PUT");
  const put = JSON.parse(f.calls[4].opts.body);
  assert.equal(put.branch, "inbox/x");
  assert.equal(put.sha, "blob1");
  assert.equal(atob(put.content), "ideas: []\n");
  assert.equal(JSON.parse(f.calls[5].opts.body).head, "inbox/x");
  assert.equal(JSON.parse(f.calls[5].opts.body).base, "main");
});

test("proposeChange reuses an already-open PR for the same branch", async () => {
  const f = fakeFetch([
    { status: 200, headers: {}, body: '[{"html_url":"https://github.com/o/r/pull/3","number":3}]' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  const r = await sub.proposeChange({
    files: { "a.md": "x" }, message: "m", branch: "inbox/x", title: "T", body: "B",
  });
  assert.deepEqual(r, { url: "https://github.com/o/r/pull/3", number: 3, branch: "inbox/x", reused: true });
  assert.equal(f.calls.length, 1, "an existing PR short-circuits every other call");
});

test("proposeChange tolerates an existing branch (422 on ref creation)", async () => {
  const f = fakeFetch([
    { status: 200, headers: {}, body: "[]" },
    { status: 200, headers: {}, body: '{"commit":{"sha":"base1","commit":{"committer":{"date":"d"}}}}' },
    { status: 422, headers: {}, body: '{"message":"Reference already exists"}' },
    { status: 404, headers: {}, body: '{"message":"Not Found"}' },                          // new file, no sha
    { status: 201, headers: {}, body: '{"content":{"sha":"blob9"}}' },
    { status: 201, headers: {}, body: '{"html_url":"https://github.com/o/r/pull/9","number":9}' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  const r = await sub.proposeChange({
    files: { "new.md": "hi" }, message: "m", branch: "inbox/y", title: "T", body: "B",
  });
  assert.equal(r.number, 9);
  assert.equal(JSON.parse(f.calls[4].opts.body).sha, undefined, "a new file must not carry a blob sha");
});

test("proposeChange surfaces a write failure as UPSTREAM", async () => {
  const f = fakeFetch([
    { status: 200, headers: {}, body: "[]" },
    { status: 200, headers: {}, body: '{"commit":{"sha":"base1","commit":{"committer":{"date":"d"}}}}' },
    { status: 403, headers: {}, body: '{"message":"Resource not accessible by personal access token"}' },
  ]);
  const sub = new GitHubSubstrate({ ...base, fetchImpl: f, cache: new Map() });
  await assert.rejects(
    () => sub.proposeChange({ files: { "a.md": "x" }, message: "m", branch: "b", title: "T", body: "B" }),
    (e) => e.code === "UPSTREAM" && /403/.test(e.message),
  );
});
```

The scripted `fakeFetch` at the top of this file records `opts`, so `opts.method` and `opts.body` assertions work without changes.

- [ ] **Step 2:** Run — expected FAIL: `M3 — not implemented`.

- [ ] **Step 3:** In `src/substrate/github-substrate.mjs`, add the base64 helper next to the other module-level helpers:

```js
// btoa() is byte-oriented; UTF-8 content must be encoded first or any
// non-ASCII character in a member's submission throws InvalidCharacterError.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
```

- [ ] **Step 4:** Replace the `proposeChange` stub with the implementation, and add the uncached request helper below it:

```js
  /**
   * Open a pull request carrying `files`. Never commits to the base branch.
   *
   * Idempotent by branch: the caller derives the branch name from a hash of
   * the payload (see capabilities.mjs), so a member who double-clicks Submit
   * gets the same PR back rather than a second one. The check is "is there an
   * open PR for this head branch", which survives a Worker restart — an
   * in-memory guard would not.
   */
  async proposeChange({ files, message, branch, title, body }) {
    const headParam = encodeURIComponent(`${this.owner}:${branch}`);
    const existing = await this._json(
      "GET",
      `${API_BASE}/repos/${this.owner}/${this.repo}/pulls?head=${headParam}&state=open`,
    );
    if (Array.isArray(existing) && existing.length > 0) {
      return { url: existing[0].html_url, number: existing[0].number, branch, reused: true };
    }

    const { sha: baseSha } = await this.head();

    // 422 means the ref already exists — a previous attempt created the branch
    // but failed before opening the PR. Continuing is correct: the commits
    // below are idempotent in content, and the PR gets opened this time.
    await this._json(
      "POST",
      `${API_BASE}/repos/${this.owner}/${this.repo}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: baseSha },
      { allowStatus: [422] },
    );

    for (const [path, content] of Object.entries(files)) {
      const url = `${API_BASE}/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`;
      // Updating a file requires its current blob sha; creating one must omit
      // it. A 404 here means "new file", not an error.
      const meta = await this._json("GET", `${url}?ref=${encodeURIComponent(branch)}`, null, {
        allowStatus: [404],
      });
      const payload = { message, content: toBase64(content), branch };
      if (meta && meta.sha) payload.sha = meta.sha;
      await this._json("PUT", url, payload);
    }

    const pr = await this._json("POST", `${API_BASE}/repos/${this.owner}/${this.repo}/pulls`, {
      title, head: branch, base: this.ref, body,
    });
    return { url: pr.html_url, number: pr.number, branch, reused: false };
  }

  // Uncached JSON request. Deliberately separate from _cachedFetch: writes must
  // never be served from, or written into, the read cache.
  // `allowStatus` lists non-2xx statuses the caller handles itself — the body is
  // parsed when possible and `null` returned otherwise, instead of throwing.
  async _json(method, url, body, { allowStatus = [] } = {}) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
    };
    if (body !== undefined && body !== null) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(url, {
      method,
      headers,
      ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && !allowStatus.includes(res.status)) {
      const snippet = await this._errorSnippet(res);
      throw new SubstrateError(
        "UPSTREAM",
        `upstream error ${res.status} for ${method} ${url}${snippet ? `: ${snippet}` : ""}`,
      );
    }
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 5:** Run — expected PASS (4 new tests).

- [ ] **Step 6:** Commit:

```bash
git add packages/cloudflare-os-integration/src/substrate/github-substrate.mjs packages/cloudflare-os-integration/test/github-substrate.test.mjs
git commit -m "feat(cloudflare-os): GitHubSubstrate proposeChange — PR-only, idempotent by branch"
```

### Task 6: The four write capabilities

**Files:** Modify `src/gatekeeper/capabilities.mjs`, `test/capabilities.test.mjs`

- [ ] **Step 1:** Append to `test/capabilities.test.mjs`:

```js
import { WRITE_CAPABILITIES, ALL_CAPABILITIES } from "../src/gatekeeper/capabilities.mjs";

// A gatekeeper whose substrate is inspectable, so writes can be asserted.
function writableGk() {
  const sub = new MemorySubstrate(loadFixture(), { sha: "abc123", date: "2026-08-08" });
  const gk = createGatekeeper({
    instances: [{ id: "instance-a", owner: "o", repo: "r", ref: "main", trust: "write" }],
    substrateFor: () => sub,
    now: () => new Date("2026-08-10T12:00:00Z"),
  });
  return { gk, sub };
}

test("write catalog", () => {
  assert.deepEqual(WRITE_CAPABILITIES, [
    "submit_idea", "log_meeting", "update_project_status", "add_action_item",
  ]);
  assert.deepEqual(ALL_CAPABILITIES, [...READ_CAPABILITIES, ...WRITE_CAPABILITIES]);
});

test("submit_idea opens a proposal and returns the PR reference", async () => {
  const { gk, sub } = writableGk();
  const r = await gk.handle("submit_idea", {
    instance: "instance-a", title: "Compost mapping", description: "Map sites",
    submitted_by: "github:mona",
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.reused, false);
  assert.ok(r.data.pr_url);
  assert.equal(r.provenance.sha, "abc123");
  assert.equal(sub.proposals.length, 1);
  assert.ok(sub.proposals[0].files["data/ideas.yaml"].includes("Compost mapping"));
});

test("an identical resubmission reuses the same PR", async () => {
  const { gk, sub } = writableGk();
  const args = {
    instance: "instance-a", title: "Compost mapping", description: "Map sites",
    submitted_by: "github:mona",
  };
  const first = await gk.handle("submit_idea", args);
  const second = await gk.handle("submit_idea", args);
  assert.equal(second.data.reused, true);
  assert.equal(second.data.pr_url, first.data.pr_url);
  assert.equal(sub.proposals.length, 1);
});

test("a different payload opens a different PR", async () => {
  const { gk, sub } = writableGk();
  const base = { instance: "instance-a", description: "d", submitted_by: "github:mona" };
  await gk.handle("submit_idea", { ...base, title: "One" });
  await gk.handle("submit_idea", { ...base, title: "Two" });
  assert.equal(sub.proposals.length, 2);
  assert.notEqual(sub.proposals[0].branch, sub.proposals[1].branch);
});

test("validation failures are BAD_ARGS with an operator-safe message", async () => {
  const { gk, sub } = writableGk();
  const r = await gk.handle("submit_idea", { instance: "instance-a", description: "no title" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "BAD_ARGS");
  assert.match(r.error.message, /title/);
  assert.equal(sub.proposals.length, 0, "nothing proposed on a rejected payload");
});

test("a write against a read-only instance is refused", async () => {
  const sub = new MemorySubstrate(loadFixture(), { sha: "s", date: "d" });
  const gk = createGatekeeper({
    instances: [{ id: "ro", owner: "o", repo: "r", ref: "main", trust: "read" }],
    substrateFor: () => sub,
    now: () => new Date("2026-08-10T12:00:00Z"),
  });
  const r = await gk.handle("submit_idea", {
    instance: "ro", title: "x", description: "y", submitted_by: "z",
  });
  assert.equal(r.error.code, "FORBIDDEN");
  assert.equal(sub.proposals.length, 0);
});

test("add_action_item edits HEARTBEAT.md", async () => {
  const { gk, sub } = writableGk();
  const r = await gk.handle("add_action_item", { instance: "instance-a", text: "Book the venue" });
  assert.equal(r.ok, true);
  assert.ok(sub.proposals[0].files["HEARTBEAT.md"].includes("- [ ] Book the venue"));
});
```

- [ ] **Step 2:** Run — expected FAIL (`WRITE_CAPABILITIES` is not exported).

- [ ] **Step 3:** Implement in `src/gatekeeper/capabilities.mjs`. Add the imports:

```js
import { WRITE_SPECS, buildWrite, ValidationError } from "./write-payloads.mjs";
```

Add the catalogs after `READ_CAPABILITIES`:

```js
// ── the write capabilities ───────────────────────────────────────────────────
// Exactly the four "with confirmation" operations from docs/CHAT-INTERFACE.md.
// Every one lands as a pull request; none can commit to a base branch. The
// document's "Never via chat" list is enforced by absence — there is no
// capability here that reaches SOUL.md, IDENTITY.md, federation.yaml,
// finances, governance or skills.
export const WRITE_CAPABILITIES = [
  "submit_idea",
  "log_meeting",
  "update_project_status",
  "add_action_item",
];

export const ALL_CAPABILITIES = [...READ_CAPABILITIES, ...WRITE_CAPABILITIES];
```

Add the hashing helper and the shared write handler:

```js
// A short, stable fingerprint of a write. The branch name derives from it, so
// an identical resubmission targets the same branch and reuses the open PR
// instead of opening a second one. crypto.subtle exists in both workerd and
// Node ≥22.
async function fingerprint(name, payload) {
  const canonical = JSON.stringify([name, payload], Object.keys(payload ?? {}).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

// One handler serves all four writes: they differ only in their spec entry.
function makeWriteHandler(name) {
  return async function writeHandler(substrate, args, ctx) {
    if (ctx.trust !== "write") {
      throw new CapabilityError(
        "FORBIDDEN",
        `Instance "${ctx.instanceId}" is configured read-only, so it can't accept submissions.`,
        `trust=${ctx.trust}, capability=${name}`,
      );
    }

    const { path } = WRITE_SPECS[name];
    let current;
    try {
      current = await substrate.readFile(path);
    } catch (err) {
      wrapSubstrateError(err, { what: `"${path}"`, instanceId: ctx.instanceId });
    }

    // The instance/capability routing fields are not part of the payload.
    const { instance, ...payload } = args ?? {};

    let write;
    try {
      write = buildWrite(name, payload, { current, now: ctx.now() });
    } catch (err) {
      if (err instanceof ValidationError) badArgs(err.message, `${name}: ${err.message}`);
      // A yaml-edit/markdown-edit failure means the file isn't the shape this
      // capability can safely edit — an instance problem, not a member's.
      throw new CapabilityError(
        "UPSTREAM",
        `"${path}" in instance "${ctx.instanceId}" isn't in a shape this submission can update. An operator needs to look at it.`,
        err.message,
      );
    }

    const branch = `org-inbox/${name.replace(/_/g, "-")}-${await fingerprint(name, payload)}`;
    const result = await substrate.proposeChange({
      files: { [write.path]: write.content },
      message: write.message,
      branch,
      title: write.title,
      body: `${write.body}\n\n---\nProposed by \`gatekeeper-org-os\`. Review the diff before merging.`,
    });

    return { pr_url: result.url, pr_number: result.number, branch: result.branch, reused: result.reused };
  };
}
```

Extend the dispatch table:

```js
const HANDLERS = {
  get_registry: getRegistry,
  get_federation: getFederation,
  get_schema: getSchema,
  get_context_bundle: getContextBundle,
  get_page: getPage,
  ...Object.fromEntries(WRITE_CAPABILITIES.map((n) => [n, makeWriteHandler(n)])),
};
```

In `handle()`, widen the capability check and thread `trust` into the context — change the `READ_CAPABILITIES.includes(name)` guard to `ALL_CAPABILITIES.includes(name)`, and the handler call to:

```js
      const data = await handler(substrate, args, {
        now,
        instanceId: instance.id,
        trust: instance.trust,
      });
```

- [ ] **Step 4:** Allow `trust: "write"` in `src/gatekeeper/instances.mjs` — find the trust default/validation and permit the value `"write"` alongside `"read"`, rejecting anything else:

```js
const TRUST_LEVELS = ["read", "write"];
```

and validate `entry.trust ?? "read"` against it, throwing `` `invalid trust "${t}" for instance "${id}" — use one of: ${TRUST_LEVELS.join(", ")}` `` otherwise. Add a test to `test/instances.test.mjs`:

```js
test("trust defaults to read and rejects unknown levels", () => {
  assert.equal(validateInstances([{ id: "a", owner: "o", repo: "r" }])[0].trust, "read");
  assert.equal(validateInstances([{ id: "a", owner: "o", repo: "r", trust: "write" }])[0].trust, "write");
  assert.throws(() => validateInstances([{ id: "a", owner: "o", repo: "r", trust: "admin" }]), /trust/);
});
```

- [ ] **Step 5:** Run the full package suite:

```bash
cd packages/cloudflare-os-integration && npm test
```

Expected: PASS — all previous tests plus the new write coverage.

- [ ] **Step 6:** Commit:

```bash
git add packages/cloudflare-os-integration/src/gatekeeper packages/cloudflare-os-integration/test
git commit -m "feat(cloudflare-os): four write capabilities — PR-only, trust-gated, idempotent"
```

### Task 7: The `org-inbox` gadget

**Files:** Create `blueprints/org-inbox/gadget.html`, `blueprints/org-inbox/README.md`

- [ ] **Step 1:** Create `blueprints/org-inbox/gadget.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>org-os inbox</title>
<style>
  body { font: 14px/1.6 ui-monospace, monospace; margin: 1.5rem; max-width: 42rem; }
  fieldset { border: 1px solid #ccc; margin-bottom: 1rem; }
  label { display: block; margin: .6rem 0 .2rem; }
  input, textarea, select, button { font: inherit; width: 100%; box-sizing: border-box; }
  button { width: auto; padding: .4rem 1rem; margin-top: .8rem; }
  #preview { background: #f6f6f6; padding: .8rem; white-space: pre-wrap; }
  .err { color: #b00020; } .ok { color: #0a6b3d; }
  .hint { color: #666; font-size: 12px; }
</style></head>
<body>
<h1>Submit to the org</h1>
<p class="hint">Nothing here changes the org directly. Every submission opens a pull request a
maintainer reviews first.</p>

<label for="instance">Instance</label>
<select id="instance">
  <option value="refi-bcn-os">refi-bcn-os</option>
  <option value="org-os">org-os (hub)</option>
</select>

<label for="kind">What are you submitting?</label>
<select id="kind">
  <option value="submit_idea">An idea</option>
  <option value="log_meeting">A meeting log</option>
  <option value="update_project_status">A project status change</option>
  <option value="add_action_item">An action item</option>
</select>

<fieldset id="fields"></fieldset>
<button id="preview-btn">Preview</button>
<button id="submit-btn" disabled>Submit</button>
<div id="preview"></div>
<p id="status"></p>

<script type="module">
  // SEAM (§D4 of docs/integrations/cloudflare-os.md): same contract as the
  // org-dashboard gadget — callCapability(name, args) → the gatekeeper envelope.
  import { callCapability } from "./rpc.mjs";

  const FORMS = {
    submit_idea: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "description", label: "What is it?", type: "textarea", required: true },
      { name: "ecosystem_gap", label: "What gap does it address? (optional)", type: "textarea" },
      { name: "submitted_by", label: "Your handle (e.g. github:you)", type: "text", required: true },
    ],
    log_meeting: [
      { name: "title", label: "Meeting title", type: "text", required: true },
      { name: "date", label: "Date (YYYY-MM-DD)", type: "text", required: true },
      { name: "type", label: "Type (sync, assembly, workshop…)", type: "text" },
      { name: "summary", label: "Summary", type: "textarea", required: true },
    ],
    update_project_status: [
      { name: "project_id", label: "Project id", type: "text", required: true },
      { name: "status", label: "New status", type: "text", required: true },
    ],
    add_action_item: [
      { name: "text", label: "The task", type: "text", required: true },
      { name: "due", label: "Due (YYYY-MM-DD, optional)", type: "text" },
      { name: "assignee", label: "Assignee handle (optional)", type: "text" },
    ],
  };

  const $ = (id) => document.getElementById(id);
  let payload = null;

  function renderFields() {
    $("fields").innerHTML = FORMS[$("kind").value]
      .map((f) => `<label for="f-${f.name}">${f.label}</label>` +
        (f.type === "textarea"
          ? `<textarea id="f-${f.name}" rows="4"></textarea>`
          : `<input id="f-${f.name}" type="text">`))
      .join("");
    $("preview").textContent = "";
    $("status").textContent = "";
    $("submit-btn").disabled = true;
    payload = null;
  }

  function collect() {
    const out = {};
    for (const f of FORMS[$("kind").value]) {
      const v = $(`f-${f.name}`).value.trim();
      if (v) out[f.name] = v;
    }
    return out;
  }

  $("kind").addEventListener("change", renderFields);

  $("preview-btn").addEventListener("click", () => {
    payload = collect();
    $("preview").textContent = JSON.stringify(payload, null, 2);
    $("status").textContent = "Check the details above, then submit.";
    $("status").className = "";
    $("submit-btn").disabled = false;
  });

  $("submit-btn").addEventListener("click", async () => {
    $("submit-btn").disabled = true;
    $("status").textContent = "Submitting…";
    $("status").className = "";
    const r = await callCapability($("kind").value, { instance: $("instance").value, ...payload });
    // Render code + message only. NEVER render r.error.detail — it carries raw
    // upstream response bodies and parser output (see capabilities.mjs header).
    if (!r.ok) {
      $("status").textContent = `Couldn't submit [${r.error.code}]: ${r.error.message}`;
      $("status").className = "err";
      $("submit-btn").disabled = false;
      return;
    }
    $("status").innerHTML = r.data.reused
      ? `Already submitted — see <a href="${r.data.pr_url}">the open pull request</a>.`
      : `Submitted. <a href="${r.data.pr_url}">Pull request #${r.data.pr_number}</a> is waiting for review.`;
    $("status").className = "ok";
  });

  renderFields();
</script>
</body></html>
```

- [ ] **Step 2:** Create `blueprints/org-inbox/README.md`:

```markdown
# org-inbox gadget

The member-facing write path. Renders a form per write capability, previews the payload, and
submits it — every submission opens a pull request.

**Seam:** `rpc.mjs` (written at install time from §D4 of `docs/integrations/cloudflare-os.md`)
must export `callCapability(name, args)` returning the gatekeeper envelope. This is the same
contract the `org-dashboard` gadget uses; one shim serves both.

**Display rule:** render `error.code` and `error.message` only. `error.detail` carries raw
upstream response bodies and parser output and must never reach a member's screen.

**Not directly installable.** Per §D6, a `.gadget` archive is produced *from a live gadget*:
create the gadget in the workspace, paste this HTML as its source, export the blueprint, and
commit the archive next to this file. The HTML stays the human-editable source of truth.
```

- [ ] **Step 3:** Commit:

```bash
git add packages/cloudflare-os-integration/blueprints/org-inbox
git commit -m "feat(cloudflare-os): org-inbox gadget — the member write path (M3)"
```

### Task 8: Adapter write wiring (needs Gate A)

**Files:** Modify `src/adapter/gatekeeper-org-os/src/org-os.ts`, `src/types.d.ts`, `src/types-code.ts`, `src/adapter/README.md`

**Precondition:** Gate A answered — the upstream action-submission method recorded in §D7.

- [ ] **Step 1:** Widen the approval-queue type. The current narrowing at `org-os.ts:87-88` is `Pick<ApprovalQueue, "authorizeObservation">` with a comment stating there is no action call. Replace both the comment and the type to include the action method discovered in Gate A, e.g.:

```ts
// Reads authorize an observation; writes submit an action. Both are the whole
// surface this gatekeeper needs — see §D7 of docs/integrations/cloudflare-os.md.
type OrgOsQueue = Pick<ApprovalQueue, "authorizeObservation" | "<ACTION_METHOD_FROM_GATE_A>"> &
  Record<string, unknown>;
```

- [ ] **Step 2:** Add four methods to `OrgOsInstanceImpl`, each mirroring the existing read methods' shape but submitting an **action** rather than authorizing an observation. Per §D7, an action must be *queued and simulated*, not performed, until approved; `implementsRevert: true` is honest here because closing a PR reverts it. Follow the exact signature Gate A recorded. Each delegates to `this.#gatekeeper.handle("<name>", { instance: this.#id, ...payload })` exactly as the read methods do.

- [ ] **Step 3:** Add the same four methods to `src/types.d.ts` (the agent-facing types), with the return type `Promise<{ pr_url: string; pr_number: number; branch: string; reused: boolean }>`, and regenerate `types.txt`:

```bash
cd <cf-workspace>/packages/gatekeeper-org-os && node scripts/sync-types.mjs
```

- [ ] **Step 4:** Update `getAutoApprovableActions()` — it currently returns `[]`. Keep it `[]`: no org-os write should auto-apply, because the whole design premise is that a human reviews the PR. Add a comment saying so explicitly, so a future reader does not "fix" it.

- [ ] **Step 5:** Type-check and verify locally:

```bash
cd <cf-workspace>/packages/gatekeeper-org-os && ORG_OS_REPO=/path/to/org-os node scripts/sync-core.mjs && pnpm run types:check
cd <cf-workspace> && pnpm run-local
```

Expected: `types:check` silent; the stack starts; `GET /gatekeeper/org-os/` → 200.

- [ ] **Step 6:** Update `src/adapter/README.md`: add a "Writes" section recording the action API used, the widened queue type, the `contents: write` + `pull-requests: write` token requirement, and that `getAutoApprovableActions()` stays empty by design. Commit:

```bash
git add packages/cloudflare-os-integration/src/adapter
git commit -m "feat(cloudflare-os): adapter write wiring — actions through the approval queue"
```

---

## Milestone M4 — the federation view

### Task 9: `build-federation-map.mjs`

Produces the `map.json` shape `@org-os/federation-map` already consumes:
`{version, generated_at, self:{id,name,type,emoji,url}, nodes:[{id,kind,name,type,ring,trust,live,url,repo,counts,last_seen}], edges:[{from,to,kind}]}`, with `kind` ∈ `instance|frontier|ecosystem` and rings 1–3.

**Scope:** rings 1 and 2 only. Ring 3 (ecosystems/sources) needs `data/ecosystems.yaml`, whose `sources:` lists are empty on the hub (a known open task in HEARTBEAT.md), so emitting ring 3 would draw an empty shell. Documented, not silently dropped.

**Files:** Create `src/page-core/build-federation-map.mjs`, `test/build-federation-map.test.mjs`

- [ ] **Step 1:** Write the failing test `test/build-federation-map.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFederationMap } from "../src/page-core/build-federation-map.mjs";

const SELF = `identity:
  name: org-os
  type: Project
federation:
  network: test-net
peers:
  - name: refi-bcn-os
    url: https://github.com/refibcn/refi-bcn-os
    trust: full
  - name: refi-dao-os
    url: https://github.com/ReFiDAO/refi-dao-os
    trust: read
downstream:
  - name: refi-med-os
    url: https://github.com/x/refi-med-os
`;

const PEER = `identity:
  name: refi-bcn-os
  type: LocalNode
peers:
  - name: regen-coordination-os
    url: https://github.com/x/regen-coordination-os
  - name: org-os
    url: https://github.com/regen-coordination/org-os-template
`;

const GENERATED_AT = "2026-08-10T12:00:00.000Z";

test("ring 1 holds peers and downstream instances", () => {
  const map = buildFederationMap({ self: SELF, peers: {} }, { generatedAt: GENERATED_AT });
  assert.equal(map.version, "1");
  assert.equal(map.generated_at, GENERATED_AT);
  assert.deepEqual(map.self, { id: "org-os", name: "org-os", type: "Project", emoji: null, url: null });

  const ring1 = map.nodes.filter((n) => n.ring === 1).map((n) => n.id).sort();
  assert.deepEqual(ring1, ["refi-bcn-os", "refi-dao-os", "refi-med-os"]);
  assert.equal(map.nodes.every((n) => n.kind === "instance" || n.kind === "frontier"), true);

  const bcn = map.nodes.find((n) => n.id === "refi-bcn-os");
  assert.equal(bcn.trust, "full");
  assert.equal(bcn.repo, "refibcn/refi-bcn-os");
  assert.deepEqual(
    map.edges.filter((e) => e.to === "refi-med-os"),
    [{ from: "org-os", to: "refi-med-os", kind: "downstream" }],
  );
});

test("a peer's own peers become ring-2 frontier nodes", () => {
  const map = buildFederationMap(
    { self: SELF, peers: { "refi-bcn-os": PEER } },
    { generatedAt: GENERATED_AT },
  );
  const frontier = map.nodes.filter((n) => n.ring === 2).map((n) => n.id);
  assert.deepEqual(frontier, ["regen-coordination-os"]);
  assert.equal(map.nodes.find((n) => n.id === "regen-coordination-os").kind, "frontier");
  assert.ok(map.edges.some((e) => e.from === "refi-bcn-os" && e.to === "regen-coordination-os" && e.kind === "federation"));
});

test("a frontier node that is already ring 1 (or self) is not duplicated", () => {
  const map = buildFederationMap(
    { self: SELF, peers: { "refi-bcn-os": PEER } },
    { generatedAt: GENERATED_AT },
  );
  assert.equal(map.nodes.filter((n) => n.id === "org-os").length, 0, "self is not a node");
  assert.equal(new Set(map.nodes.map((n) => n.id)).size, map.nodes.length, "no duplicate ids");
});

test("an unreadable or absent peer file degrades to ring 1 only", () => {
  const map = buildFederationMap({ self: SELF, peers: { "refi-bcn-os": ": : bad" } }, { generatedAt: GENERATED_AT });
  assert.equal(map.nodes.filter((n) => n.ring === 2).length, 0);
  assert.equal(map.nodes.filter((n) => n.ring === 1).length, 3);
});

test("a missing self federation file throws — there is no map without it", () => {
  assert.throws(() => buildFederationMap({ self: null, peers: {} }, { generatedAt: GENERATED_AT }), /federation/);
});
```

- [ ] **Step 2:** Run — expected FAIL (module not found).

- [ ] **Step 3:** Implement `src/page-core/build-federation-map.mjs`:

```js
// ── build-federation-map.mjs ─────────────────────────────────────────────────
// Produces the map.json document `@org-os/federation-map` renders (see that
// package's README: data in, pixels out — it never reads YAML itself).
//
// Scope: rings 1 and 2. Ring 3 (ecosystems / sources) needs data/ecosystems.yaml
// with populated `sources:` lists; those are empty on the hub today (tracked in
// HEARTBEAT.md), so emitting ring 3 would draw an empty shell rather than a
// truthful absence. Add it here when the data exists.

import yaml from "js-yaml";

function parse(text) {
  if (typeof text !== "string") return null;
  try {
    return yaml.load(text) ?? null;
  } catch {
    return null;
  }
}

// federation.yaml comes in two shapes across instances: peers/upstream nested
// under `federation:`, or at the root. Both are live in the network.
const section = (doc, key) => doc?.federation?.[key] ?? doc?.[key] ?? [];

// "https://github.com/owner/repo" → "owner/repo"; anything else → null.
function repoOf(url) {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url ?? "");
  return m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : null;
}

const idOf = (entry) => (typeof entry === "string" ? entry : entry?.name ?? entry?.id ?? null);

function node(entry, { ring, kind, edgeKind }) {
  const id = idOf(entry);
  const url = typeof entry === "string" ? null : entry?.url ?? null;
  return {
    id,
    kind,
    name: typeof entry === "string" ? entry : entry?.name ?? id,
    type: typeof entry === "string" ? null : entry?.type ?? null,
    ring,
    trust: typeof entry === "string" ? null : entry?.trust ?? null,
    live: false,
    url,
    repo: repoOf(url),
    counts: {},
    last_seen: null,
    _edgeKind: edgeKind,
  };
}

/**
 * @param {{self: string|null, peers: Record<string, string>}} files
 *   `self` is the instance's own federation.yaml; `peers` maps a ring-1 node id
 *   to that peer's federation.yaml (only for peers the gatekeeper can read).
 * @param {{generatedAt: string}} opts — injected, never Date.now(): the same
 *   inputs must always produce the same document.
 */
export function buildFederationMap(files, { generatedAt }) {
  const selfDoc = parse(files?.self);
  if (!selfDoc) throw new Error("buildFederationMap: federation.yaml is missing or unreadable");

  const selfId = selfDoc.identity?.name ?? "self";
  const self = {
    id: selfId,
    name: selfId,
    type: selfDoc.identity?.type ?? null,
    emoji: selfDoc.identity?.emoji ?? null,
    url: selfDoc.identity?.url ?? null,
  };

  const nodes = [];
  const edges = [];
  const seen = new Set([selfId]);

  const addNode = (n) => {
    if (!n.id || seen.has(n.id)) return false;
    seen.add(n.id);
    const { _edgeKind, ...rest } = n;
    nodes.push(rest);
    return true;
  };

  for (const [key, edgeKind] of [["peers", "federation"], ["downstream", "downstream"]]) {
    for (const entry of section(selfDoc, key)) {
      const n = node(entry, { ring: 1, kind: "instance", edgeKind });
      if (!n.id) continue;
      addNode(n);
      edges.push({ from: selfId, to: n.id, kind: edgeKind });
    }
  }

  // Ring 2: the peers of our ring-1 peers, for the instances we can actually
  // read. A peer we can't read simply contributes no frontier — the map says
  // less rather than guessing.
  for (const [peerId, text] of Object.entries(files?.peers ?? {})) {
    const peerDoc = parse(text);
    if (!peerDoc) continue;
    for (const entry of section(peerDoc, "peers")) {
      const n = node(entry, { ring: 2, kind: "frontier", edgeKind: "federation" });
      if (!n.id || n.id === selfId) continue;
      addNode(n);
      edges.push({ from: peerId, to: n.id, kind: "federation" });
    }
  }

  return { version: "1", generated_at: generatedAt, self, nodes, edges };
}
```

- [ ] **Step 4:** Run — expected PASS (5 new tests).

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/page-core/build-federation-map.mjs packages/cloudflare-os-integration/test/build-federation-map.test.mjs
git commit -m "feat(cloudflare-os): pure federation map builder (rings 1-2)"
```

### Task 10: `get_federation_map` capability

**Files:** Modify `src/gatekeeper/capabilities.mjs`, `test/capabilities.test.mjs`

- [ ] **Step 1:** Append to `test/capabilities.test.mjs`:

```js
test("get_federation_map returns a renderable map document", async () => {
  const r = await gk.handle("get_federation_map", { instance: "instance-a" });
  assert.equal(r.ok, true);
  assert.equal(r.data.version, "1");
  assert.equal(r.data.self.id, "instance-a");
  assert.ok(Array.isArray(r.data.nodes) && Array.isArray(r.data.edges));
  assert.equal(r.data.generated_at, "2026-08-08T12:00:00.000Z", "clock is injected, not ambient");
  assert.equal(r.provenance.sha, "abc123");
});

test("get_federation_map is in the read catalog", () => {
  assert.ok(READ_CAPABILITIES.includes("get_federation_map"));
});
```

- [ ] **Step 2:** Run — expected FAIL: `UNKNOWN_CAPABILITY`.

- [ ] **Step 3:** In `capabilities.mjs`, import the builder:

```js
import { buildFederationMap } from "../page-core/build-federation-map.mjs";
```

Append `"get_federation_map"` to `READ_CAPABILITIES` (append, never insert — consumer indices stay stable), add the handler, and register it in `HANDLERS`:

```js
// Reads this instance's federation.yaml, plus that of every *other configured*
// instance, to populate the ring-2 frontier. Cross-instance reads are tolerant:
// a peer we can't reach contributes no frontier nodes rather than failing the
// map. `otherSubstrates` is supplied by dispatch, which is the only place that
// knows about the instance registry.
async function getFederationMap(substrate, args, ctx) {
  let self;
  try {
    self = await substrate.readFile("federation.yaml");
  } catch (err) {
    wrapSubstrateError(err, { what: "the federation config", instanceId: ctx.instanceId });
  }

  const peers = {};
  await Promise.all(
    Object.entries(ctx.otherSubstrates ?? {}).map(async ([id, sub]) => {
      const text = await readOptional(sub, "federation.yaml");
      if (text !== null) peers[id] = text;
    }),
  );

  return buildFederationMap({ self, peers }, { generatedAt: ctx.now().toISOString() });
}
```

In `createGatekeeper`, build the sibling map and pass it in the handler context:

```js
      const others = Object.fromEntries(
        validated.filter((i) => i.id !== instance.id).map((i) => [i.id, resolveSubstrate(i)]),
      );
      const data = await handler(substrate, args, {
        now,
        instanceId: instance.id,
        trust: instance.trust,
        otherSubstrates: others,
      });
```

- [ ] **Step 4:** Run — expected PASS.

- [ ] **Step 5:** Commit:

```bash
git add packages/cloudflare-os-integration/src/gatekeeper/capabilities.mjs packages/cloudflare-os-integration/test/capabilities.test.mjs
git commit -m "feat(cloudflare-os): get_federation_map capability"
```

### Task 11: The `federation-map` gadget

The web component supports `src="/map.json"` (fetch) or an inline `<script type="application/json">`. A gadget has no static file host, so **inline is the only option**: the capability's document is injected as the element's JSON child.

**Files:** Create `blueprints/federation-map/gadget.html`, `blueprints/federation-map/README.md`

- [ ] **Step 1:** Create `blueprints/federation-map/gadget.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>org-os federation</title>
<style>
  body { font: 14px/1.5 ui-monospace, monospace; margin: 1.5rem; }
  nav { margin-bottom: 1rem; } select, button { font: inherit; margin-right: .4rem; }
  federation-map { display: block; width: 100%; height: 30rem; }
  footer { margin-top: 1rem; color: #666; font-size: 12px; }
  .stale { color: #b45309; font-weight: 700; }
  #err { color: #b00020; }
  pre { white-space: pre-wrap; }
</style>
<!-- The bundle is committed at packages/org-os-federation-map/dist/federation-map.iife.js;
     paste its contents into the gadget as a second file at install time (§D6). -->
<script src="./federation-map.iife.js"></script>
</head>
<body>
<nav>
  <select id="instance">
    <option value="org-os">org-os (hub)</option>
    <option value="refi-bcn-os">refi-bcn-os</option>
  </select>
  <button id="refresh">↻</button>
</nav>
<div id="err"></div>
<div id="host"></div>
<h2>Instances</h2>
<pre id="instances">loading…</pre>
<footer id="prov"></footer>

<script type="module">
  // Same seam as the other gadgets: callCapability(name, args) → envelope.
  import { callCapability } from "./rpc.mjs";

  const $ = (id) => document.getElementById(id);

  function showProvenance(p) {
    const { sha, date, stale } = p ?? {};
    $("prov").innerHTML = `as of <code>${(sha || "").slice(0, 7)}</code> · ${date || "?"}` +
      (stale ? ` · <span class="stale">STALE — refresh failed, showing cache</span>` : "");
  }

  async function load() {
    $("err").textContent = "";
    const instance = $("instance").value;

    const map = await callCapability("get_federation_map", { instance });
    if (!map.ok) {
      // code + message only — never error.detail.
      $("err").textContent = `Couldn't load the federation map [${map.error.code}]: ${map.error.message}`;
      $("host").innerHTML = "";
    } else {
      // The component reads an inline JSON child; a gadget has no static file
      // host, so `src=` is not available to us.
      $("host").innerHTML =
        `<federation-map><script type="application/json">${JSON.stringify(map.data).replace(/</g, "\\u003c")}<\/script></federation-map>`;
      showProvenance(map.provenance);
    }

    const page = await callCapability("get_page", { instance, page_id: "instances" });
    $("instances").textContent = page.ok
      ? page.data.markdown
      : `Couldn't load the instances page [${page.error.code}]: ${page.error.message}`;
  }

  $("instance").addEventListener("change", load);
  $("refresh").addEventListener("click", load);
  load();
</script>
</body></html>
```

- [ ] **Step 2:** Create `blueprints/federation-map/README.md`:

```markdown
# federation-map gadget

"The torch" in a workspace: an instance's external world as an orbital constellation, plus the
instances table underneath.

**Two files at install time.** This HTML, and the bundle
`packages/org-os-federation-map/dist/federation-map.iife.js` pasted in as a second gadget file
(the `<script src="./federation-map.iife.js">` above resolves to it). The bundle is committed in
that package; do not rebuild it here.

**Inline data, not `src=`.** The web component supports `src="/map.json"` or an inline
`<script type="application/json">` child. A gadget has no static file host, so the capability's
document is injected inline. `<` is escaped in the serialised JSON so a string in the data can't
close the script tag.

**Rings.** `get_federation_map` emits rings 1 (peers, downstream) and 2 (peers-of-peers, for
instances this gatekeeper can read). Ring 3 (ecosystems/sources) is omitted until
`data/ecosystems.yaml` carries populated `sources:` lists.

**Display rule:** `error.code` and `error.message` only, never `error.detail`.
```

- [ ] **Step 3:** Commit:

```bash
git add packages/cloudflare-os-integration/blueprints/federation-map
git commit -m "feat(cloudflare-os): federation-map gadget (M4)"
```

### Task 12: Wire the package into `npm run selftest`

**Files:** Modify `scripts/selftest.mjs` (repo root)

- [ ] **Step 1:** Read how existing suites are registered:

```bash
grep -n "test:\|npm test\|checks\.push\|name:" scripts/selftest.mjs | head -30
```

- [ ] **Step 2:** Add the package's suite as a check, following the exact shape the surrounding entries use — the command is:

```bash
npm run test:cloudflare-os-integration
```

Match the neighbouring entries' structure (name, command, and whichever trigger-layer field they carry); do not invent a new shape.

- [ ] **Step 3:** Run it:

```bash
npm run selftest
```

Expected: the new check appears and passes.

- [ ] **Step 4:** Commit:

```bash
git add scripts/selftest.mjs
git commit -m "chore(cloudflare-os): wire integration tests into selftest"
```

### Task 13: Process wiring and the M3–M4 runbook

**Files:** Modify `docs/integrations/cloudflare-os.md`, `DECISIONS.md`, `HEARTBEAT.md`, `docs/MODULES.md`; create/append `memory/<today>.md`

- [ ] **Step 1:** Extend the deployment runbook in `docs/integrations/cloudflare-os.md` — append after its step 8:

```markdown
- [ ] **9. Widen the token for writes.** The write path needs `contents: write` **and**
      `pull-requests: write` on the repos that accept submissions. Keep read-only instances
      configured as `trust: read` — the gatekeeper refuses a write against them with
      `FORBIDDEN` regardless of what the token can do, so the two controls are independent.

- [ ] **10. M3 acceptance — the member write path.** Install the `org-inbox` gadget (same
      `rpc.mjs` shim as the dashboard). Have a **real refi-bcn member** submit an idea.
      **Verify:** a PR appears on the repo with exactly the expected one-item diff and the
      registry's comments intact; submitting the identical form again returns the *same* PR
      rather than opening a second; a payload with a missing required field is refused in the
      UI with a plain-language message; and merging the PR makes the idea appear in the
      dashboard gadget's next refresh. **Record** the PR link here.

- [ ] **11. M4 acceptance — the federation view.** Install the `federation-map` gadget with the
      bundle as its second file. **Verify:** the map renders ring 1 for the hub, switching
      instances re-renders, the instances table matches `data/instances.yaml`, and the
      provenance footer shows a real sha.
```

- [ ] **Step 2:** Append a decision entry to `DECISIONS.md` (newest-first, matching the existing format) recording: writes are **PR-only and idempotent by payload hash**; the four capabilities are exactly `docs/CHAT-INTERFACE.md`'s "with confirmation" list and the "never via chat" list is enforced by absence; registry edits are **text edits, never a YAML round-trip**, because `yaml.dump` would strip every comment in the registries; `update_project_status` accepts only a status **already in use in that instance's registry** rather than a hard-coded vocabulary, because `docs/DATA-MODEL.md` (`idea|develop|execute|archive`) and the hub's own data (`"Develop"`, `"Discovery"`) disagree; write access requires **both** `trust: "write"` on the instance and a token with `pull-requests: write`; and `getAutoApprovableActions()` stays empty by design.

- [ ] **Step 3:** Update `docs/MODULES.md` — in the `org-os-cloudflare-os` entry, extend "How it works" to name the write path and the federation map, and update the "Status" paragraph's pending list (deployed-workspace verification remains; M3 is no longer pending). Then confirm the catalog test still passes:

```bash
cd site && npm test
```

- [ ] **Step 4:** Add to `HEARTBEAT.md`:

```markdown
- [ ] Reconcile the project status vocabulary: `docs/DATA-MODEL.md` documents `idea | develop | execute | archive`; `data/projects.yaml` uses `"Develop"` and `"Discovery"`. The Cloudflare OS `update_project_status` capability sidesteps this by accepting only statuses already in use — pick one vocabulary and migrate
- [ ] Cloudflare OS M3/M4 acceptance needs a deployed workspace and a widened token (`contents: write` + `pull-requests: write`) — runbook steps 9–11 in `docs/integrations/cloudflare-os.md`
- [ ] federation map ring 3: `get_federation_map` omits ecosystems/sources until `data/ecosystems.yaml` carries populated `sources:` lists
```

- [ ] **Step 5:** Write session notes to `memory/<today>.md` (append if the file exists; never overwrite).

- [ ] **Step 6:** Full verification sweep:

```bash
npm test
npm run test:cloudflare-os-integration
npm run selftest
npm run validate:structure
cd site && npm test
```

Expected: all green.

- [ ] **Step 7:** Commit:

```bash
git add docs/ DECISIONS.md HEARTBEAT.md memory/
git commit -m "chore(cloudflare-os): M3-M4 runbook, decisions, follow-ups"
```

---

## Self-review (done at plan time)

**Spec coverage.** "Write capabilities (exactly four)" with schema validation, minimal diff, PR
on a fresh branch, idempotency by content hash → Tasks 3, 5, 6 · `proposeChange` in the
substrate interface → Tasks 4–5 · `org-inbox` gadget (form → preview → capability → PR link) →
Task 7 · never-via-chat enforced by absence → Task 3's catalog and its header comment · M4
`federation-map` gadget fed by federation data, plus the instances view → Tasks 9–11 · "wired
into `npm run selftest`" → Task 12 · write safety ("worst case is a bad PR, never corrupted
`data/`") → PR-only in both substrates, asserted by the MemorySubstrate test that the base is
unchanged. Deliberately deferred, per the spec's own Phase 2 list: webhook cache invalidation,
the workerd port, the skills bridge, blueprint publication tooling.

**Placeholder scan.** One deliberate unknown: the upstream action-submission method name in
Task 8, which is unknowable from this repo. It is fenced as **Gate A** with the exact command
that answers it and a named home for the answer (§D7), and it blocks only Task 8 — every other
task is pure Node. Task 12 says "match the neighbouring entries' structure" rather than
inventing a shape for a file whose format was not read at plan time; Step 1 reads it first.

**Type consistency.** The envelope stays `{ok, data, provenance}` throughout; write handlers
return `{pr_url, pr_number, branch, reused}` in Task 6, and Task 8's `types.d.ts` and Task 7's
gadget both consume exactly those four fields. `proposeChange({files, message, branch, title,
body})` → `{url, number, branch, reused}` is identical in `MemorySubstrate` (Task 4),
`GitHubSubstrate` (Task 5), and the caller (Task 6) — note the substrate returns `url`/`number`
and the capability renames them to `pr_url`/`pr_number` at the boundary, which the gadget then
uses. `ValidationError` → `BAD_ARGS`; the new `FORBIDDEN` code is added to the envelope's code
set and asserted in Task 6. `buildFederationMap(files, {generatedAt})` matches its Task 10
call site, and its output keys match the `map.json` fixture the shipped component consumes.

**Ordering.** Tasks 1–3 are independent; 4–5 are independent of each other; 6 needs 1–5; 7 needs
6; 8 needs 6 + Gate A; 9 is independent; 10 needs 9; 11 needs 10; 12–13 last.
