---
id: 2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t
role: commons-steward
agent: commons-steward
kind: claude
branch: crew/2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t
detached: false
pane: 'w1B:p1'
workspace: w1B
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:47:57-03:00'
updated: '2026-10-11T00:02:14-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Make the record true to crew as merged tonight, and put the crew into the files every seat reads

Goal. feat/crew now holds everything tonight's crew built (tip 63bab29). The record has fallen behind it in known places, and the onboarding files every seat now reads say nothing about the crew. Bring the documents level with the code in one pass, so that what is pushed tonight tells an operator and a newly seated agent the truth. The code is the source of truth; you change no behaviour except the one configuration value in item 6, which the operator decided.

Branches in flight (you asked for this in your presentation). One: a researcher is writing docs/research/2026-10-10-herdr-one-crew-workspace.md on its own branch. It touches no other file. Nothing else is unmerged, and no engineer is changing crew while you work.

The work.
1. CHANGELOG.md preface. The [Unreleased] preface says everything below is already on main and staged for 0.5.1; the crew entry is only on feat/crew and targets 0.6.0. Lead's decision: move the crew entry under its own heading that says so (on feat/crew, targets 0.6.0, not on main), so the preface is true again and whoever merges to main has one heading to fold in. Take "not yet on main" out of the entry text and out of docs/agent-plans/QUEUE.md's sentence, and do not pin a commit there.
2. Stale and unclear sentences. The reviewer of your seat's first pass listed ten sentences made stale by later merges and six findings (plain language: "rescue branch", "detached", "Syncthing", "the first cycle"; the dash rule for handoff). The list, with file and line, is in the Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-reviewer-review-the-commons-steward-s-corrections.md (read only). Work through all of it against the code as it is now.
3. What merged after that list was written. The herdr adapter now acts on herdr's own codes: `git log a46e3b4..63bab29` and the Report section of .../memory/crew/2026-10-10-engineer-replace-crew-s-guesses-about-herdr-with.md say what changed (start retry on agent_pane_busy with a look at the pane, a 30 second ceiling in place of the 8 second guess, a cut-off start never sent twice, six codes that mean a prompt was not sent, leftovers named after a failed worktree step, `seat --handoff --base`). The engineer updated the spec, docs/CREW.md and the skill; check docs/COMMANDS.md and the CHANGELOG entry say the same, and that every seat is now sent to "Before you begin".
4. The spec and the skill. The first pass listed five problems it was not allowed to fix (Report section of .../memory/crew/2026-10-10-commons-steward-check-that-the-record-around-crew-is-tru.md, "Problems in files I could not edit"): the board example in spec section 8, the numbering of section 5.3, `--handoff <id|file>` in section 5, `nudge` missing from section 9, and skills/crew/SKILL.md saying a worktree is kept only for uncommitted changes. Check each against the files as they are now (some may already be fixed) and correct what is still untrue.
5. The onboarding files. Four seats reported that MASTERPLAN.md, SOUL.md and MEMORY.md never mention the crew. Add a short crew entry to MEMORY.md's Active Context and to HEARTBEAT.md, in each file's own form: what the crew is in one sentence, where it lives (feat/crew, docs/CREW.md, roles/), its status, and the open items in 7. Fix MEMORY.md's reference to a "v2.0.0" masterplan if the file it points at says otherwise. Add `DECISIONS.md` to the "Before you begin" list in roles/README.md, with half a sentence on why (MEMORY.md names it the authoritative decision record) and how to read a long log (the newest entries and those the brief touches). tests/scripts/crew-shipped-roles.test.mjs checks that list; run it. Do not edit MASTERPLAN.md: its identity section still names one "Framework Development Agent", and rewriting it is the operator's; say in your report what you would change.
6. The cap. The operator decided to raise the cap on seated agents from 4 to 6 so the whole crew can stay seated. Change `max_agents` in roles/circles.yaml to 6 and every sentence that states the number (docs/CREW.md, the spec's guardrail table, the skill if it says so). This is the shipped default every new instance receives; say that in the CHANGELOG. scripts/crew/roles.mjs has a fallback DEFAULT_MAX_AGENTS = 4 for a file with no such field; leave the code, and make sure no document confuses the two.
7. Open items, recorded where the next session will see them (HEARTBEAT.md or docs/agent-plans/QUEUE.md, whichever the files' own rules say): the four findings F-1 to F-4 of the last review (Report section of .../memory/crew/2026-10-10-reviewer-review-the-herdr-adapter-rewrite-before.md; F-1, the dead-end advice after a timed-out worktree step, is the one to fix first); the experiments against a live herdr that docs/CREW.md's smoke run lists and nobody has run; the proposals from the presentation round (a smoke run after each merge that touches herdr; a read-only herdr session or transcript for reviewers; in-flight branches in every documentation brief). Point at the trail files; do not paste them.

Constraints. Commands you show must match `node scripts/crew.mjs --help` (run `npm ci --ignore-scripts` first; the other crew commands refuse inside a crew worktree, so quote their syntax and say you did not run them). The pre-commit hook needs installed dependencies; do not bypass it. Vocabulary from roles/README.md. `npx prettier --check` on the files you touch must not get worse than it is on 63bab29.

Done means. Logical commits on your branch, one per numbered item where practical; nothing pushed or merged. `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` pass. Your report lists each claim you checked and how, each command and its result, what you changed per item, what you found already fixed, the onboarding files you read, and anything you judged not worth changing and why. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:54:32-03:00

Branch: crew/2026-10-10-commons-steward-make-the-record-true-to-crew-as-merged-t (from 63bab29), eight commits, nothing pushed or merged. Documents only, plus one line in a test (see item 5).

## Onboarding files read (from my worktree)
MASTERPLAN.md, SOUL.md, MEMORY.md, all present and read in full. Also read: HEARTBEAT.md (to place items 5 and 7), DECISIONS.md (top entry and conventions), the role file, the assignment, roles/README.md, and the Report sections of the four trail files the brief named. Absent: nothing.

## Commands run and results
- `npm ci --ignore-scripts` -> completed.
- `node scripts/crew.mjs --help` -> usage text; every command line I show in docs matches it. I did not run seat, nudge, release, report, handoff or handoff-close from the docs (they refuse in a crew worktree and need herdr).
- `node --test "tests/scripts/crew-*.test.mjs"` -> tests 151, pass 151, fail 0 (after the cap change and the test edit).
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` -> tests 25, pass 25, fail 0.
- `node --test tests/scripts/crew-shipped-roles.test.mjs` -> 8 pass, with DECISIONS.md asserted.
- `npm run version:check` -> "All version sources agree" (the new CHANGELOG heading has no [X.Y.Z], so it is not read as a release).
- `npx prettier --check` on the 12 files I touched: the same 9 files warn at 63bab29 and now. Changed lines against prettier's output, base -> now: CHANGELOG 21 -> 21, HEARTBEAT 20 -> 20, CREW 2 -> 2, QUEUE 36 -> 36, SKILL 18 -> 18, MEMORY 6 -> 6, spec 109 -> 105, plan 2133 -> 2133, test 90 -> 90. (An earlier draft of mine was worse on CHANGELOG and HEARTBEAT; fixed in the last commit.)

## Claims checked against the repository, and how
- 30 s start ceiling, 10 s look limit, 60 s herdr timeout, `agent_pane_busy`: scripts/crew/herdr.mjs:18-33.
- Six codes that mean a prompt was not sent: `PROMPT_NOT_SENT` in scripts/crew/core.mjs:30-37, used at :280 and :346.
- `may_remain` recorded: core.mjs:292, rendered :561.
- Every seat gets "Before you begin": `readingOrder`/`firstPrompt` core.mjs:86-100; `lead` adds HEARTBEAT.md and AGENTS.md: roles/lead.md:20-24.
- Board sections and text: `renderBoard`, core.mjs:628-662. The spec's board example now reproduces that format.
- Usage text, `--handoff <id|file>`, dash rule for seat and handoff: `node scripts/crew.mjs --help`.
- Cap: `max_agents` in roles/circles.yaml; fallback `DEFAULT_MAX_AGENTS = 4` at scripts/crew/roles.mjs:23, read at :32. Unchanged.
- MASTERPLAN.md says "Version: 0.5.0", not v2.0.0 (line 3).
- DECISIONS.md is newest first (top entry is 2026-10-10).
- Not checked: anything needing a live herdr. The `pilot` status and the "unverified" list are as the engineer and reviewer left them.

## Per item
1. CHANGELOG: the crew entry moved out of [Unreleased] into its own section "Crew — on `feat/crew`, targets 0.6.0, not on `main`", placed ABOVE `## [Unreleased]` so `version:update 0.5.1` cannot promote it (scripts/update-version.mjs rewrites only the [Unreleased] header, so anything below it would be swept into 0.5.1). "Not yet merged" and "Targets 0.6.0" are out of the entry text; the heading carries them. QUEUE.md #8 no longer pins 03d8bb8 or says "not yet on main". The [Unreleased] preface is true again. Decision for you: if you would rather the section sit below [Unreleased], say so; I judged above safer.
2. Plain language and the first review's list: defined rescue branch (now "a branch saved by an earlier release"), detached ("review copy", "git calls this detached") and Syncthing (CHANGELOG, CREW.md, SKILL.md); "first cycle" -> "first real use"; the dash rule for handoff beside seat in CHANGELOG, CREW.md, COMMANDS.md; "trail file" -> "file in memory/crew/" in CREW.md; Syncthing copies no longer "under Could not read"; board STATUS markers; the `--on` save applies only to review copies (finding 6). Of the ten stale sentences: 1 to 7 fixed, 8 already true, 9 and 10 fixed by item 1.
3. Later merges: CHANGELOG now has the 30 s look-and-wait (the 8 s sentence is gone), a cut-off start never sent twice, the six codes, leftovers after a failed worktree step, release when herdr did not answer, `seat --handoff --base`, and the Before you begin list. COMMANDS.md: `--base` wins over a handoff's branch; nudge also covers herdr missing. docs/CREW.md and the skill already said this (the engineer's work); I checked them and changed only wording.
4. Spec and skill: board example (STATUS, Worktrees left behind, Sync conflict copies, Could not read); 5.3 numbered 1-12 in order; `--handoff <id|file>` in section 5, section 7 and handoff-close; `nudge` in section 9; SKILL.md "uncommitted changes" -> modified, untracked and git-ignored files keep it. Also fixed, not on the list: the spec's Status line said "pre-implementation".
5. Onboarding: MEMORY.md Active Context entry and Quick Index line; "MASTERPLAN.md (v2.0.0)" replaced by a pointer that carries no number (the file says 0.5.0 and its task list moved); HEARTBEAT.md "Crew" subsection at the top of Active Tasks; roles/README.md adds DECISIONS.md with why and how to read it. I also added DECISIONS.md to the assertion in tests/scripts/crew-shipped-roles.test.mjs (one line) so the test checks the list as shipped; the guide, spec and CHANGELOG name the four files. MASTERPLAN.md not edited. What I would change there, for the operator: section 1 names one "Organizational OS Framework Development Agent" as "you"; the crew has a lead and five roles, so the identity section should say the framework is developed by the crew (`roles/`, `docs/CREW.md`) and keep the single-agent wording only for a session with no crew. Its "9 core skills" metric (section 5) and Active Instances table (section 7) look dated too; I did not verify them.
6. Cap: roles/circles.yaml `max_agents: 6` (the comment says why and names the fallback); CREW.md; the spec guardrail table; the CHANGELOG says it is the shipped default every new instance receives; plan line 23 says it was 4 when written. Code and the fallback of 4 untouched; the skill states no number. Tests that say "defaults the cap to 4" are about the fallback and still pass.
7. Open items in HEARTBEAT.md under Crew: F-1 (first), F-2 to F-4, the five live-herdr experiments, the three proposals, with pointers to the trail files and no copies. One more I found: `renderBoard` prints "Syncthing kept these ... a trail file" without defining either; it is code, so I listed it for the engineer.

## Judged not worth changing
- The plan file's code snippets that say 4 (the plan records what was built; the fallback is still 4).
- docs/MODULES.md crew entry: still true (`nudge` named, `pilot`).
- Prettier warnings that predate this branch (asterisk emphasis, blank lines): reformatting would touch many unrelated lines.

## What went wrong
- I put the cap bullet into the item 3 commit first and had to take it out before committing.
- My first board example for the spec had invented line formats; I caught it by reading `renderBoard` and rewrote it.
- Two of my shell commands were refused by the vault-safety guard because they contained a destructive-git word (one an unnecessary stash listing, one prose in a heredoc). Nothing ran; I removed the word and went on.
