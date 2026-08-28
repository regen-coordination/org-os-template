---
name: meeting-notes-transcription-fixer
version: 1.0.0
description: Audit and repair meeting notes/transcripts in an org-os instance — fix missing frontmatter, normalize project links, correct org-specific terminology drift (proper nouns, acronyms, names that recur in this org's meetings), and prepare notes for processing. Use BEFORE meeting-processor when notes have transcription errors or before batch normalization of legacy meetings.
author: organizational-os
category: operations
metadata:
  openclaw:
    requires:
      env: []
      bins: ["python3"]
      config: []
---

# Meeting Notes Transcription Fixer

Standardize legacy and recent meeting files in an org-os instance without destroying transcript authenticity.

> Each instance can maintain its own terminology dictionary (e.g., `data/transcription-fixes.yaml` listing recurring transcription errors like `COI→KOI`, `Luis→Luizfernando`, `Zargon→Zargham`, etc.). The skill consumes this dictionary at runtime.

## When to Use

- Before `meeting-processor`, when raw notes contain transcription errors (typos in proper nouns, acronyms misheard by the transcription tool, names of org-specific concepts/people)
- Auditing the meeting backlog in `packages/operations/meetings/` for missing frontmatter / project links / sections
- Batch normalization of historical meeting files

> **Customization required before first use in a new instance:** The Python scripts under `scripts/` (`fix_meeting_terminology.py`, `audit_meeting_notes.py`, `build_fix_queue.py`, `fix_meeting_frontmatter.py`) ship with example dictionaries from the originating instance (ReFi DAO OS) — proper nouns, acronyms, project mappings. Before running them in your instance, edit `fix_meeting_terminology.py` (TERMINOLOGY_FIXES tuple) and `fix_meeting_frontmatter.py` (PROJECT_MAPPING dict) to reflect the recurring transcription errors and project names in your meeting corpus. Future work (tracked as `meeting-notes-transcription-fixer-externalize-dict`): move dictionaries to per-instance `data/transcription-fixes.yaml` so the scripts become fully generic.

## When NOT to Use

- One-off, clean meeting transcripts → go straight to `meeting-processor`
- Processing notes that aren't yet in `packages/operations/meetings/` (use this AFTER `meeting-processor` has filed them, or run on the source vault location first)

## Core Rules

- Preserve meaning; never invent attendees, decisions, or action items.
- Preserve transcript authenticity; fix only obvious transcription errors.
- Run safe/reversible operations first (audit + metadata dry-run).
- Keep conflict/hash-suffixed files out of automatic writes unless explicitly requested.

## Runbook

### 1) Audit first (always)

```bash
python3 skills/meeting-notes-transcription-fixer/scripts/audit_meeting_notes.py \
  --root packages/operations/meetings \
  --markdown skills/meeting-notes-transcription-fixer/last-audit.md \
  --json skills/meeting-notes-transcription-fixer/last-audit.json
```

Review in report:
- missing frontmatter / categories / projects / date
- projects field not list format
- conflict-like filenames
- terminology drift concentration (Luis, RefIDal, COI, Zargon)
- transcript-heavy files and section gaps

### 2) Build actionable queues

```bash
python3 skills/meeting-notes-transcription-fixer/scripts/build_fix_queue.py \
  --audit skills/meeting-notes-transcription-fixer/last-audit.json \
  --markdown skills/meeting-notes-transcription-fixer/fix-queue.md \
  --json skills/meeting-notes-transcription-fixer/fix-queue.json
```

This produces priority queues + batch plan (metadata / semantic / terminology / conflicts).

### 3) Apply safe metadata fixes (dry-run → write)

Dry run:
```bash
python3 skills/meeting-notes-transcription-fixer/scripts/fix_meeting_frontmatter.py \
  --root packages/operations/meetings
```

Write mode:
```bash
python3 skills/meeting-notes-transcription-fixer/scripts/fix_meeting_frontmatter.py \
  --root packages/operations/meetings --write
```

Behavior:
- ensures frontmatter exists
- ensures `categories` includes `Meetings`
- normalizes `projects` scalar → list
- infers projects from filename + path context when missing
- adds `date` from YYMMDD filename when missing
- creates per-file `.bak-<UTC>` backup on write
- skips sync-conflict/hash files by default

### 4) Semantic pass for transcript-heavy notes

For files in semantic queue:
- add/repair sections:
  - `## Attendees`
  - `## Agenda`
  - `## Key Decisions`
  - `## Action Items`
  - `## Next Steps`
- keep raw transcript below a divider (`---`)
- mark uncertain extraction as `[unclear]`

### 5) Terminology normalization (context-aware)

Fast dry-run:
```bash
python3 skills/meeting-notes-transcription-fixer/scripts/fix_meeting_terminology.py \
  --root packages/operations/meetings
```

Apply with backups:
```bash
python3 skills/meeting-notes-transcription-fixer/scripts/fix_meeting_terminology.py \
  --root packages/operations/meetings --write
```

High-confidence corrections include (ReFi DAO scope):
- `RefIDAL`/`ReFiDAO`/`refi dao` (lowercase) → `ReFi DAO`
- `COI` → `KOI` (when context is Knowledge Organization Infrastructure)
- `Luis` → `Luizfernando`
- `Zargon`/`Zargham's` typos → `Zargham`
- `Greenpeal` → `Greenpill Network`
- `Monte` → `Monty`
- Project naming style: `local refi toolkit` → `Local ReFi Toolkit`, `refi space` → `ReFi space`, `refi token` → `ReFi token`

Ambiguous cases (e.g., `Michelle` could be person or `Miceli` typo) are reported, never auto-changed.

### 6) Integrate with graph

After fixing each meeting:
- ensure `projects` links target real project pages (`[[260101 ReFi DAO]]`, etc.)
- update `data/meetings.yaml` if metadata changed
- run `npm run generate:schemas && npm run validate:schemas`

## Suggested operating mode

- Batch size: 10–20 files
- Order: metadata → conflicts review → semantic → graph integration
- For transcription-fix-only on a single new note before processing: run step 5 with `--root <single-file-dir>` against the source location

## Chain with meeting-processor

Typical flow for a fresh transcript:
1. Drop raw note into vault root or `packages/operations/meetings/`
2. **Run this skill** (steps 1, 3, 5) to fix frontmatter and terminology
3. Run `meeting-processor` to extract decisions/actions, update `data/meetings.yaml`, append to HEARTBEAT
4. Run `npm run generate:schemas && npm run validate:schemas`

## Notes

- Scripts require Python 3 with `pyyaml` (already present in this repo's environment)
- Backups: `.bak-<UTC>` for frontmatter, `.termbak-<UTC>` for terminology
- Audit JSON path is the contract between scripts — keep `last-audit.json` as the source for `build_fix_queue` and `fix_meeting_terminology`
