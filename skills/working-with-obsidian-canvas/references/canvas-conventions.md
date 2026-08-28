# Canvas conventions — per-vault palette and patterns

This file is **per-vault**. Fork it for each instance that adopts the skill and rewrite the meaning column.

The vault this file is currently calibrated for: **this instance** (framework template defaults — recalibrate on adoption).

## Status

By default an instance does **not** ship a canvas generator (no `scripts/generate-canvases.mjs`) and has **no standing canon canvases tracked at the repo root**. In that state, canvas activity typically happens:

- inside linked repositories (e.g. `repos/<linked-repo>/docs/canvases/`)
- inside operator worktrees (`.claude/worktrees/...`)
- in session-dated work surfaces produced ad hoc

The conventions below are the *starting point* if/when curated canvases land at the repo root. Update this file the moment a generator or canon canvas is introduced — it's the per-vault source of truth.

## Color palette (6 slots)

Obsidian Canvas exposes 6 palette slots indexed `"1"` through `"6"`. Each vault assigns its own semantics. **Always check this table before applying a color** — operators read color, not just shape.

| Slot | Hex (approx in Obsidian default theme) | This-instance meaning | Generic role |
|---|---|---|---|
| `"1"` | red    | blocked · risk · treasury warning            | warning / blocked |
| `"2"` | orange | in motion · skill / workflow                 | process / motion |
| `"3"` | yellow | planned · proposal · in-session              | wip / pending |
| `"4"` | green  | ratified · decisions (locked) · external partner | done / decided |
| `"5"` | blue   | hub · source of truth · org canonical        | canonical / anchor |
| `"6"` | purple | federation · peer instance · external tool ref | external link / peer |

A node without a `color` field is the default neutral — fine for most content; reserve colored nodes for signaling.

The mapping is shared across org-os instances to keep cross-network canvases legible: a node colored `"5"` should mean "hub / canonical" regardless of which org-os instance opened the file.

## Zone patterns (recommended layouts for this vault)

### Hub-and-spoke

One large `type:file` node in the center (the dashboard or root doc — e.g. `IDENTITY.md`, `MASTERPLAN.md`, or a project README), 6–8 group nodes radiating outward. Edges from center → spokes, labeled with the relationship ("reads", "writes", "drills into"). The center is colored `"5"` (hub).

Best fit: project dashboards, federation maps, governance overviews.

### Zone-with-leaves (spatial design board)

Several large group nodes acting as zones (labeled — e.g. "Council Election", "Onboarding", "Decisions Captured Today"). Inside each zone: free arrangement of text + file + link nodes. Edges are sparse; spatial proximity does most of the work.

Best fit: session-dated work surfaces (community calls, ratification working meetings), brainstorming boards, multi-stakeholder syntheses.

### Grid catalog

N flat items in an N×⌈√N⌉ grid, no group containers, edges optional. Used for: project lists, member rosters, asset libraries.

Best fit: `data/projects.yaml` → visual project board, `data/members.yaml` → candidate / steward roster.

### Three-zone progression (left → right)

Left zone = current state, middle = roadmap, right = target. Each zone colored consistently (often `"3"` → `"4"` → `"5"`). Edges flow left-to-right.

Best fit: governance evolution timelines (v2 → v3), funding pipeline state, multi-quarter roadmaps.

## Sizing conventions

Match these sizes to keep generated and hand-curated canvases visually consistent. (Mirrors the constants used by instances that ship a `scripts/generate-canvases.mjs`, so cross-network canvases line up.)

```
LEAF_FILE_W = 350,  LEAF_FILE_H =  80   // file refs
LEAF_TEXT_W = 400,  LEAF_TEXT_H = 120   // short text blocks
HEADER_W    = 400,  HEADER_H    = 120   // zone title text
TITLE_W     = 500,  TITLE_H     = 140   // canvas title
HUB_W       = 800,  HUB_H       = 600   // dashboard / root node
LEGEND_W    = 600,  LEGEND_H    = 220   // optional legend box
```

For zone (`type:group`) sizing: width and height are whatever the cluster of children needs, plus 40px padding on each side. Don't shrink-wrap tighter — Obsidian's group edge-detection gets noisy at small margins.

## Edge conventions

| Pattern | Style |
|---|---|
| Data flow ("X writes to Y") | label = verb, `toEnd: "arrow"`, no color |
| Drill-down ("hub → spoke") | label = "drills into" or unlabeled, color matches the hub's color |
| Cross-zone reference | no label, dashed style not available in JSONCanvas 1.0 — use light color |

## Auto-generated canvases (do not hand-edit)

**None in this instance by default.** When `scripts/generate-canvases.mjs` (or an equivalent generator) is introduced, list the owned filenames here and update SKILL.md's "Auto-generated canvas refusal" block in lockstep. Until then, the refusal phase is a no-op in this vault.

## Standing canvases (hand-curated — safe to edit, with care)

None tracked at the repo root yet. Canvases produced in linked repos (e.g. `repos/<linked-repo>/docs/canvases/`) are governed by *that* repo's conventions, not this file — coordinate with the repo's maintainer before structural edits.

When the first canon canvas lands in this instance, add it here with its owner.

## When to start a new canvas vs. extend an existing one

Start a new canvas when:
- The topic doesn't fit any existing zone.
- The canvas is session-dated (work-session surface, community call board).
- The audience is different (public vs. internal, operator vs. council vs. network).
- Existing canvas is at >200 nodes (Obsidian render starts to drag).

Extend existing when:
- The new content belongs inside an existing zone.
- The canvas is a "living dashboard" (project hub, federation map).
- The topic continues an in-progress design conversation.

## Cross-vault notes

This skill ships across sibling org-os instances with shared palette semantics. Keep the slot meanings aligned across vaults — if you remap a color here, mirror the change in the other vaults' `canvas-conventions.md` so a federation canvas opened from any vault reads the same.
