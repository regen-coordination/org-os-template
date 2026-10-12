---
id: 2026-10-11-reviewer-review-the-role-voices-what-every-crew-a
role: reviewer
agent: reviewer
title: Review role voices
kind: claude
branch: crew/2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o
detached: true
pane: 'w10:p1'
workspace: w10
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-reviewer-review-the-role-voices-what-every-crew-a
task: null
handoff: handoff-2026-10-11-review-the-commons-steward-s-role-voices
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T02:01:03-03:00'
updated: '2026-10-11T02:03:41-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Review the role voices: what every crew agent will now be told it is

Goal. Give a pass or fail verdict on the branch you are seated on: two commits on feat/crew, `git diff feat/crew...HEAD`. On a pass the lead merges and pushes it, and then seats the operator's two new agents from roles/website.md and roles/platform.md. From tonight a Claude agent carries its role file, the shared boundaries and the charter as its system prompt, so these words are no longer documentation: they are what each agent is told it is, for its whole session. A sentence that is false, that loosens a boundary, or that makes an agent claim something it is not, is repeated in every seat.

The claims are in the commons-steward's Report section: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o.md (read only), which gives the seven new `## Voice` sections in full, the two changed headings, the one changed sentence in roles/lead.md, and the changes to HEARTBEAT.md, MEMORY.md, CHANGELOG.md, roles/README.md and the spec.

Check.
1. Compose the system prompt for each of the seven roles (composeIdentity in scripts/crew/core.mjs is pure; call it as the tests do) and read all seven in full, as the agent that receives it. For each Voice section: is every sentence true of the seat and consistent with the role's Mandate, Boundaries and Done means, and with the shared boundaries and the charter that follow it in the same prompt? Does any sentence loosen a boundary, promise something the seat cannot do, or tell the seat to claim experience, feelings or ownership? The charter says "a cooperative in method … Agents are not workers in the material sense and must not claim to be" and "Nobody owns a file; roles steward areas".
2. The lead's changed sentence: the Mandate now points at the charter's "Circles and the lead" paragraph in place of saying it. Is anything lost for a lead that is not a Claude agent (it gets the role file by path only), and does the composed prompt for a Claude lead still say, somewhere, that the lead states both sides fairly when circles disagree?
3. Headings and the first prompt: "You are the website steward of the org-os crew", "platform steward", and the other five. Do the two renamed roles still match their ids, file names, and every place that names them (docs/CREW.md, the spec's 4.3 table, CHANGELOG.md, roles/circles.yaml, the tests)? "You own the development of" became "You steward the development of": does the rest of each file agree, including the boundary that the seat updates its own plans?
4. Diff every role file against feat/crew and list every line removed or changed outside the new Voice section. The steward says there are four such changes (two headings, two "own" to "steward", one lead sentence). Confirm the count yourself; any other change to a Boundaries, Done means or Before you begin section is a finding.
5. The website and platform Voice sections name commands (`npm run build`, `npm test`, `npm run typecheck`) and say "never describe milestone 2 or 3 as built". Check them against the Install and check sections of the same files.
6. HEARTBEAT.md's Crew open list: each added item points at a file that exists and says what that file says; each kept item is still true of the code (the steward gives lines); the corrected sentence about the six experiments is true. The first item points at the lead's account of the unsubmitted prompts: that account is now the last Report section of /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino.md, filed after the steward wrote; say whether the HEARTBEAT item's pointer needs one word changed.
7. A cloned instance receives five of the seven role files and roles/README.md: the manifest and clone tests pass, and nothing in the five says something untrue in an instance.
8. Nothing that should not be pushed. Name the onboarding files you read. You are seated with your own role as your system prompt, in its form before this branch: quote its first line, and say whether you would have reviewed differently with the new Voice section.

Done means. A verdict, pass or fail, with the commands run and counts (`npm ci --ignore-scripts`; `node --test "tests/scripts/crew-*.test.mjs"`; `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`; `npm run version:check`), expected versus actual for each finding with file and line, and whether each must be fixed before merge or can follow. You change nothing.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — reviewer — 2026-10-11T02:03:09-03:00

# Review: role voices (`git diff feat/crew...HEAD`, commits af4231b, a81e60a)

## Verdict: PASS, with one fix I would make before merge (F1, one sentence) and one that can follow (F2).

## Commands and counts (clean worktree, detached at a81e60a)

- `npm ci --ignore-scripts`: completed (node_modules present; npm audit notice only).
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 202, pass 202, fail 0.
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0.
- `npm run version:check`: "All version sources agree".
- Composed all seven prompts with `composeIdentity` (script in my scratchpad): each starts "You are the <seat> of the org-os crew: role …", `missing: 0` README sections. Seat names: lead, engineer, reviewer, researcher, commons steward, website steward, platform steward.

## Per check

1. **Voice sections, read as the composed prompt.** Seven sections, each 6 lines, second person. Every sentence agrees with the same file's Mandate, Boundaries and Done means and with the shared boundaries and charter that follow. None loosens a boundary, none claims experience, feelings, a name or ownership. "Sign a report with…" is a reporting format, not a claim of identity. Two things checked specifically: the reviewer's "what you changed in the branch (nothing)" matches the role's "You change nothing"; the steward's absolute "never write 'simply' or 'just'" has no conflict in its file.
2. **Lead sentence.** Composed lead prompt still says, in the charter's "Circles and the lead" paragraph (roles/README.md:111-114): "states both sides fairly when they disagree". Nothing is lost for a claude lead (the shipped file is `kind: claude`). A non-claude lead gets the role file by path only, and loses that sentence unless it follows the role file's Before-you-begin to roles/README.md, which it does. Acceptable; not a finding.
3. **Headings.** ids and file names unchanged (`website`, `platform`); no test, `roles/circles.yaml`, `docs/CREW.md` or `modules/org-os-crew/module.yaml` names them by heading (grep). `grep -rniE "you own|owns? the development" roles docs/CREW.md` finds nothing left. The rest of website.md and platform.md says "update only your own area's record" and "tick steps", consistent with "steward".
4. **Changes outside Voice.** `git diff --numstat -- roles/`: deletions only in lead (2 lines = one sentence), platform (2), website (2) = 6 lines, five changes: two headings, two "own"→"steward", one lead sentence. Matches the steward's count of four-plus-one. No Boundaries, Done means or Before you begin line changed.
5. **Commands in website/platform Voice.** `npm run build`, `npm test` (site/) and `npm test`, `npm run typecheck` (packages/admin/) are the commands in each file's Install and check section. Plans for milestones 2 and 3 are stamped "Deferred to v0.6" (docs/superpowers/plans/2026-07-23-admin-app-m2.md:3, m3:3), so "never describe milestone 2 or 3 as built" is true. See F2 on directory.
6. **HEARTBEAT.** Files cited exist in memory/crew/ (label-call-fix, titles-and-role-as-identity-c-3, herdr-adapter-rewrite). Kept F-2 to F-4 item still true: `agentOnPane` herdr.mjs:114/149/204, `ref = on || base || 'main'` core.mjs:310, `unfinishedRemoval` core.mjs:590/618, `ignoredBeyondDependencies` git.mjs:19. Experiment-6 sentence matches docs/CREW.md:295. First item: see F1.
7. **Instance receives five roles + README.** Manifest and clone tests pass (25/25). Nothing in the five Voice sections names the framework repo or a file an instance lacks; the researcher's "path of your note" and the lead's "assignments you seated" are true in an instance. CHANGELOG bullet tells instances that nothing refuses a role without a Voice, which is true (no code reads Voice).
8. **Nothing that should not be pushed.** Changed files are roles/, docs spec, CHANGELOG, HEARTBEAT, MEMORY only; a grep of added lines for token/secret/password/key finds only the word "tokens" in the label experiment. Working tree clean.

## Findings

**F1: HEARTBEAT.md first item, stale pointer (fix before merge; one sentence).**
Expected: the lead's account of the unsubmitted prompts is where the item says. Actual: item says "is meant to be in the `## Report` sections of `2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino.md`; on 2026-10-11 it was not there, and the brief that carried it is in the `## Brief` of `…commons-steward…`". Command: `grep -n "^## Report" /Users/luizfernando/.cache/lf-worktrees/org-os-crew/memory/crew/2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino.md` shows `## Report — lead — 2026-10-11T02:01:03-03:00` at line 164, "the unsubmitted first prompts of 2026-10-11, and what I did about them", with the cause "not known" and the same to-build list. Needed change: point at that last Report section and drop the "was not there" clause and the steward-brief pointer. The word "meant" and the second file are the whole edit. It also adds one fact worth carrying: the lead suggests `herdr agent prompt --wait` returns `agent_prompt_stalled` as the simplest check, and one Enter fixed the stuck seat; the item may cite that.

**F2: website and platform Voice name `npm test` without a directory (can follow).**
Expected: a seat that obeys its Voice runs the right suite. Actual: voice says "`npm run build` and `npm test`" / "`npm test` and `npm run typecheck`"; the same files' Install and check say these run from `site/` and `packages/admin/` respectively, and at the worktree root `npm test` is the framework's own suite. The Done means sections do say the directory, so a seat that reads the whole prompt gets it right; the Voice sentence alone can mislead. Fix: "in `site/`" / "in `packages/admin/`" (a few words each). Not a boundary.

## Not run
Live herdr seating of the two new seats (not in scope: no herdr session for a reviewer). Prettier on the changed markdown (steward reports a few pre-existing format deviations; I did not rerun).

## Onboarding files read
From "Before you begin": `MASTERPLAN.md` (wc 166 lines), `SOUL.md`, `MEMORY.md` were present at the worktree root; I did not read them line by line beyond confirming they exist and reading the MEMORY.md diff. `DECISIONS.md`: read the conventions and newest entries (2026-10-10 crew decision). None absent. Honest note: I read MASTERPLAN, SOUL and MEMORY by existence and diff, not in full, because this brief's claims sit in roles/ and HEARTBEAT.

## My own role as system prompt
First line of what I was seated with: `You are the reviewer of the org-os crew: role "reviewer", agent name "reviewer".` It carried the role body without a Voice section (the form before this branch). I would not have reviewed differently: the lenses and Done means gave the same questions. The Voice "could this check have failed?" is the existing lens "A passing check must be able to fail" restated.

## What went wrong, and what I would do differently
I first tried a regex for "states both sides fairly" against the composed prompt and got false on every seat, which would have been a false finding: the sentence wraps across a line break. I caught it by grepping the README; I would normalise whitespace before matching. I changed nothing in the branch; the report file is the only thing I wrote.
