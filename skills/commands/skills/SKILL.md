---
name: skills
description: "List available skills across workspace, user, and plugin sources — with anomalies and promotion status"
---
<!-- GENERATED from .claude/commands/skills.md by scripts/sync-commands.mjs — edit the source, then run: npm run sync:commands -->


You are listing the skills available in this org-os workspace. Follow these steps.

## Step 1: Regenerate the skills index

This walks workspace + user + plugin sources, cross-references `data/skills-matrix.yaml`, and writes `SKILLS.md` + `.well-known/skills.json`:

```bash
npm run generate:skills
```

If `generate:skills` script doesn't exist, fall back to reading `data/skills-matrix.yaml` and listing `skills/` directly.

## Step 2: Print the freshly generated `SKILLS.md` verbatim

The generated file is the single source of truth. Print it as-is — do not reformat, abridge, or re-render. The operator wants to see exactly what the walker found.

```bash
cat SKILLS.md
```

## Step 3: Highlight anomalies

If the output includes an "⚠ Anomalies" section (skills with missing SKILL.md, duplicate ids across sources, broken frontmatter), call them out explicitly to the operator as something to fix.

If the output includes "⚠ On disk but not in `skills-matrix.yaml`", remind the operator that those skills exist on disk but aren't catalogued — they should be added to the matrix or removed from disk.

If the output includes "⚠ In `skills-matrix.yaml` but missing from disk", flag those as either:
- a stale matrix entry (skill was removed but matrix not updated), or
- an expected promotion candidate that's `in_framework: false`

## Step 4: Wait for the operator

After printing, ask what they want to do with the listing (e.g., "Want me to promote candidate X?", "Want me to fix anomaly Y?"). Do not act without direction.
