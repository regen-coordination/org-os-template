---
name: working-with-obsidian-canvas
version: 0.1.0
description: Use when reading, generating, editing, validating, or reconciling Obsidian .canvas (JSONCanvas) files in any Obsidian vault — especially when about to merge canvas changes from another branch, when an existing canvas needs new nodes, when generating a new canvas from structured data, or when asked to "process" / "clean up" / "reorganize" a canvas
author: organizational-os
category: infrastructure
metadata:
  openclaw:
    requires:
      env: []
      bins: [node]
      config: []
---

# Working with Obsidian Canvas (v0.1)

## What This Is

A canvas is a **spatial design document**, not a data dump. Layout encodes intent: which nodes sit together, what zones contain what, how arrows flow. A merge that preserves all the JSON but flattens the spatial reorganization has destroyed the document.

This skill teaches Claude to:
1. Classify the intent of a canvas-touching task before acting.
2. Refuse to hand-edit canvases that are owned by a generator script.
3. Validate every canvas before writing it back to disk.
4. **Stop and escalate on structural divergence in merges** — the load-bearing rule.

The skill ships two scripts. Use them; don't reimplement their logic in your head:

- `scripts/validate-canvas.mjs <path>` — integrity checks (dangling edges, missing file refs, ID collisions, bounds, palette). Exits non-zero on errors.
- `scripts/diff-canvas.mjs <ours> <theirs>` — emits a JSON classifier report (`additive` / `disjoint-edit` / `positional-edit` / `structural` / `conflicting-spatial` / `no-change`) plus the recommended action.

## When to Use

- Operator asks to read, summarize, generate, edit, or merge a `.canvas` file.
- A git merge or rebase touches a `.canvas` file.
- The operator pastes a canvas path and asks for "preview" / "audit" / "clean up".
- Operator asks to "add a node" / "add this to the canvas" / "wire these together".
- A canvas has dangling file refs or broken links.

## When NOT to Use

- The target is a non-canvas Obsidian file (`.md`, `.base`) — different file format, different skill.
- The operator is editing a canvas in the Obsidian app and asks an unrelated question.
- The task is canvas → HTML/PDF export (deferred — separate `exporting-obsidian-canvas` skill once it exists).
- Auto-layout via dagre / force-directed graph — out of scope for v0.1.

## Phase A — Classify intent

First question on every canvas-touching task. Pick exactly one:

| Intent | Signal | Path |
|---|---|---|
| **Read-only** | "summarize", "what's in this canvas", "list", "audit" | B → end |
| **Additive edit** | "add a node", "wire X to Y", "append this section" | B → C → D → E |
| **Structural edit** | "reorganize", "rename zones", "move", "restructure layout" | B → C → confirm → D → E |
| **Generative** | "make a canvas for", "build a map of" (no existing canvas) | C → D → E |
| **Merge** | git merge/rebase, "merge `<branch>` into main", "reconcile" | B → **F** |

Then **check ownership**:

### Auto-generated canvas refusal

If this instance does **not ship a canvas generator** (no `scripts/generate-canvases.mjs`), there are no auto-generated canvases to refuse — this phase is a no-op. Check `references/canvas-conventions.md` for this vault's current status.

If a generator is later added and a `docs/canvases/` folder of auto-owned files appears, update `references/canvas-conventions.md` *and* this section in lockstep — list the owned filenames and re-introduce the refusal language below. The refusal pattern (for reference):

> "`<filename>` is owned by `scripts/generate-canvases.mjs` — hand edits will be overwritten on the next `npm run canvases`. To change it, edit the generator (the relevant `generateAspectCanvas` or `generateMetaCanvas` block) and re-run the script. Want me to make the change there instead?"

If the operator overrides with "I know, do it anyway" — proceed but warn explicitly: "OK, but this will revert on next `npm run canvases`."

Note: when working inside a linked repo (e.g. `repos/<linked-repo>/`), check that repo's own conventions before assuming a canvas is hand-editable.

## Phase B — Read & inventory

Before any modification, parse the canvas and report:

- `node_count`, `edge_count`
- Node-type breakdown: `text`, `file`, `link`, `group`
- Color breakdown (which palette slots are in use)
- Group inventory: label, position, dimensions, child node count (children = non-group nodes whose bounding box is inside the group)
- File refs: list of `file:` targets — flag any that don't exist on disk
- Link refs: list of `url:` targets — flag any malformed

Cache this inventory before any write. If the operator says "what changed?" later, you'll need it.

## Phase C — Plan changes (dry-run)

Before writing, state out loud:

- Nodes added: id, type, position, color, summary
- Nodes modified: id, what field
- Nodes moved: id, from → to (Δx, Δy)
- Nodes removed: id, label
- Edges added/removed/rewired
- Palette compliance check: do new colors match the vault's conventions? (See `references/canvas-conventions.md`.)

For any move > 200px on a pre-existing node, ask before proceeding. Positional edits to user content are not "free."

## Phase D — Generate or modify

### Layout heuristics (see `references/layout-heuristics.md` for details)

| Heuristic | Use when |
|---|---|
| **Hub-and-spoke (compass)** | One root + ≤8 branches. Math in the heuristics reference. |
| **Grid** | N disjoint items, N×⌈√N⌉ with consistent padding. Catalogs, palettes, project lists. |
| **Zone-with-leaves** | Group containers + offset children. The default "spatial design board" pattern. |

### Default sizes (keep aligned across vaults so federation canvases stay legible)

```
LEAF_FILE_W = 350,  LEAF_FILE_H = 80
LEAF_TEXT_W = 400,  LEAF_TEXT_H = 120
HEADER_W    = 400,  HEADER_H    = 120
HUB_W       = 800,  HUB_H       = 600
```

### Auto-place rule for new nodes in existing canvas

1. Identify the target group (if any) — the operator usually names it ("in the Decisions zone").
2. Find a non-overlapping `(x, y)` *inside* that group's bounding box, otherwise below it with `padding = 40`.
3. Never overlap an existing node's bounding box.
4. Never auto-relayout existing nodes. Their positions are user intent.

### ID generation

Use 16-char hex strings (matches Obsidian's own convention). Example: `9bb4435c4d9fb25b`.

```js
const id = [...crypto.getRandomValues(new Uint8Array(8))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");
```

## Phase E — Validate before write

**Mandatory.** Run before every write that touches a canvas. Not "after," not "if the change is big," not "if I'm worried." Always.

```bash
node skills/working-with-obsidian-canvas/scripts/validate-canvas.mjs <path>
```

Paste the JSON output. If `status` is `FAIL`, do not write — fix the errors first. If there are warnings (non-standard color, contained node), surface them to the operator and let them decide.

For *generative* tasks where the canvas doesn't exist yet, write to a temp path first, validate, then move.

## Phase F — Reconcile (merge only) — THE LOAD-BEARING PHASE

**This is the phase that exists because a programmatic merge has been reverted before** (incident in a sibling org-os instance, 2026-05-14 — see "Source of the merge rule" below). The lesson generalizes: a clean JSON merge can still destroy a canvas if it flattens spatial intent.

### Step F.1 — Run the classifier

```bash
node skills/working-with-obsidian-canvas/scripts/diff-canvas.mjs <ours.canvas> <theirs.canvas>
```

The script outputs a `classification` field:

| Classification | What it means | Action |
|---|---|---|
| `no-change` | Identical | Take either side |
| `additive` | Only adds/removes/text-edits | **Auto-merge by ID union** — safe |
| `disjoint-edit` | Different nodes edited, no group changes | Auto-merge |
| `positional-edit` | Nodes moved >200px, no bulk pattern | **ASK** before merging |
| `structural` | Bulk translation OR groups renamed OR groups resized | **STOP — escalate** |
| `conflicting-spatial` | Both sides moved overlapping nodes | **STOP — escalate** |

### Step F.2 — On `structural` or `conflicting-spatial`: paste this escalation prompt verbatim

> Branch `<X>` carries a structural canvas reorganization (`<signal>: <metric from classifier>`). Spatial layout in canvases encodes design intent that programmatic merge will flatten. I'm pausing here. Three options:
>
> (a) Keep both versions on separate branches and reconcile visually in Obsidian.
> (b) Designate one side as canonical; I'll discard the other for this canvas only.
> (c) Override and proceed with programmatic union (not recommended — past instances of this have been reverted).
>
> Which?

Wait for the operator's choice. Do not pick (a/b/c) on their behalf.

### Step F.3 — On `additive` or `disjoint-edit`: auto-merge

Build the merged canvas:

```js
const ids = new Map();
for (const n of [...ours.nodes, ...theirs.nodes]) ids.set(n.id, n); // theirs wins on conflict
const merged = { nodes: [...ids.values()], edges: /* same union */ };
```

Then run `validate-canvas.mjs` on the merged output. If it fails, restore and escalate.

### Step F.4 — On `positional-edit`: surface moves and ask

Print the moved nodes from the classifier's `detail.nodes_moved` list. Ask:

> The merge moves these nodes by these amounts. Are these intentional? (y / no-take-ours / no-take-theirs / show-me-more)

## Common Mistakes (rationalization table)

| Excuse | Reality |
|---|---|
| "This canvas is small, the rules are overkill" | Rules apply at any size. Validation is seconds. |
| "User said 'merge' — they want a merge" | The operator's locked preference is *separate-branch + UI reconciliation* on structural divergence. A past incident (sibling instance, 2026-05-14) makes this concrete. |
| "Auto-generated canvas refusal feels gatekeeper-y" | When a generator exists, hand edits get wiped on the next generator run. Refusing is helping. N/A in this vault today. |
| "I'll fix the dangling edge after writing" | Validate before, not after. Invalid canvas pollutes git history. |
| "JSON conflict markers look small" | A line-diff understates spatial change. Run `diff-canvas.mjs`. |
| "I'll re-run dagre to clean it up" | Destroys hand-placed intent. Never auto-relayout an existing canvas. |
| "Both sides additive, low risk" | "Low risk" isn't the test. Check the classifier signals. |
| "The 50% bulk-translation threshold is arbitrary" | Yes, tunable — but it's the operational signal. Don't drop the check. |
| "I'll just preview it and let the user confirm later" | If you generated the file, you wrote to disk. Run validate first. |
| "The script's output is verbose, I'll skip pasting it" | The output is the evidence. Paste it. |

## Red flags — STOP and re-read this skill

- About to write a `.canvas` file without running `validate-canvas.mjs` → STOP.
- About to merge a `.canvas` file without running `diff-canvas.mjs` → STOP.
- About to edit a generator-owned file (once a generator exists in this vault) → STOP.
- About to move a pre-existing node by > 200px without operator confirmation → STOP.
- About to re-layout an existing canvas with an automatic algorithm → STOP.
- About to take action (a/b/c) on a structural-merge escalation without operator response → STOP.

## Quick Reference

**Read a canvas:**
```bash
node skills/working-with-obsidian-canvas/scripts/validate-canvas.mjs <path>
# inventory comes from the same JSON
```

**Merge two canvases:**
```bash
node skills/working-with-obsidian-canvas/scripts/diff-canvas.mjs <ours> <theirs>
# branch on `classification`
```

**See conventions for this vault:** `references/canvas-conventions.md`

**See layout recipes:** `references/layout-heuristics.md`

**See the JSONCanvas spec:** `references/jsoncanvas-spec.md` (or https://jsoncanvas.org/)

## Output surface

This skill does not own any files. It only reads, writes, and validates canvases that other workflows produce. Treat every write as auditable: the operator should be able to see, from the conversation, exactly what changed.

## Source of the merge rule

The structural-divergence escalation rule originated in a sibling org-os instance (locked 2026-05-14). Background: a collaborator pushed a canvas branch with 109 new nodes plus a bulk translation (all pre-existing nodes shifted x = -2340 → -6040) and several zones renamed. A programmatic 3-way JSON merge was technically clean (199 nodes, 0 dangling refs) and was reverted because the spatial reorganization carried design intent that the merge flattened.

That feedback was authored in the originating instance (its `memory/feedback_canvas_merge.md`). When the equivalent failure mode surfaces in this instance — or when a canvas merge is performed here — record the local incident as `memory/feedback_canvas_merge.md` in this vault too, so future-you doesn't have to cross-reference.

If a future incident reveals a new failure mode, update this skill's classifier (`scripts/diff-canvas.mjs`) and the rationalization table here — both together, and ideally in lockstep across all vaults that ship the skill.
