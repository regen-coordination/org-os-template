---
id: 2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o
role: commons-steward
agent: commons-steward
title: 'Role voices, open list'
kind: claude
branch: crew/2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o
detached: false
pane: 'w1Z:p1'
workspace: w1Z
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-11T01:52:56-03:00'
updated: '2026-10-11T02:03:42-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Give each role its voice, and bring the open list up to date

Goal. The operator asked that crew agents "fully embody their role". From tonight a Claude agent carries its role file, the shared boundaries and the charter as its system prompt for the whole session, and its first prompt opens "You are the <role file's heading> of the org-os crew". So the role files are no longer documents an agent reads once: they are what the agent is. Read as an identity, they are uneven: they say what a seat does and must not do, but not who it is, how it speaks, or how it signs its work. Give each of the seven roles that, without loosening a single boundary. Then record tonight's open findings where the next session will see them.

Part A, the role files (roles/lead.md, engineer.md, reviewer.md, researcher.md, commons-steward.md, website.md, platform.md).
1. Each role gains a short section, the same heading in all seven and placed after Mandate, of four to six lines, written to the agent in the second person like the rest of the file. It says: who this seat is in one sentence a person would recognise; how it speaks (what it leads with, what it never does in a report); how it signs its work, so a reader of a report knows which seat is speaking; and the one question it asks of everything it touches (the engineer's and the reviewer's lenses already point at theirs). Draw each from what the role already says and from what its seat actually did tonight: the reports in memory/crew/ of the main checkout are the evidence, read a few for each role. Do not invent a personality, a name, a backstory or feelings: the charter in roles/README.md says what this crew honestly is ("a cooperative in method … Agents are not workers in the material sense and must not claim to be"), and the voice must be true to that.
2. The headings of roles/website.md and roles/platform.md make the first prompt read "You are the website of the org-os crew". The launcher uses the role file's first heading as the seat's name (seatName in scripts/crew/core.mjs; read it, do not change it). Change the two headings so the sentence is true and natural, and check the other five read well in the same sentence. tests/scripts/crew-shipped-roles.test.mjs and crew-seat.test.mjs may assert on headings: run them.
3. Read all seven as one set, as the composed system prompt an agent receives (the role body, then "Shared boundaries", "What always needs the operator" and "The cooperative charter" from roles/README.md). Remove what a role file repeats from those sections word for word; keep what it adds. Nothing that is a boundary, a "Done means" or a "Before you begin" may be weakened or dropped: list in your report every sentence you removed or changed in those sections and why.
4. roles/README.md's "A role file" section describes the sections a role file has; add the new one.

Part B, the open list in HEARTBEAT.md (Crew). Add, pointing at the files in memory/crew/ and not copying them:
- From the review of the label call fix (…-reviewer-review-the-label-call-fix-and-the-change.md): F1 release stops with a stack trace when an ignored directory holds a folder it cannot read; F2 a large build tree beside node_modules is listed one line per file; F3 the staged-rename handling has no test.
- From the review of titles and identity (…-reviewer-review-titles-and-role-as-identity-the-c-3.md): F1 a seat refused at the start step leaves its identity file until release; F2 a control character in a title or a brief's first line is refused by herdr only after the worktree exists.
- Found by the lead tonight, the first to fix: three seats in a row had their first prompt typed into the agent's input box and never submitted, while herdr answered that the prompt was sent, so crew recorded `prompted: true` and the agents sat idle. It began when the operator left the machine; the cause is not known. Crew should check, a few seconds after prompting, that the agent has left the idle state, say so plainly when it has not, and offer a crew command that submits the prompt already in the box, so nobody presses Enter in a pane by hand. The lead's account is in the Report sections of 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino.md.
- Remove from the list anything tonight's merges closed: check each remaining item against the code before you keep it.
Also correct CHANGELOG.md's crew section where it does not yet say that a role file is now the agent's identity and gains a voice section.

In flight. Nothing else is unmerged and nobody else is changing these files. After your branch merges, the lead seats the two owner agents from roles/website.md and roles/platform.md, so those two are read first.

Where to look. You start from feat/crew, which has everything merged. Read the "Before you begin" section your first prompt names. docs/CREW.md and the spec's section 4 describe role files; update them only where your change makes a sentence untrue.

Done means. Logical commits on your branch, part A and part B apart; nothing pushed or merged. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"`, `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` and `npm run version:check` pass. Your report gives: the new section for each role in full; the list of every changed or removed boundary sentence; the commands and counts; the onboarding files you read; and, since you are the first agent seated with its role as its system prompt, two lines on whether you can tell: quote the first words of what your system prompt says about your seat, or say that you see nothing of the kind. Then hand off to reviewer naming your branch with --branch.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`
  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.

Shared boundaries, the charter and the "Before you begin" section to read first: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — commons-steward — 2026-10-11T02:00:00-03:00

# Report: role voices, open list

## Done

Two commits on `crew/2026-10-11-commons-steward-give-each-role-its-voice-and-bring-the-o`, nothing pushed or merged: `af4231b` (part A, role files) and `a81e60a` (part B, open list and CHANGELOG).

## Part A: the new section in full (heading `## Voice`, after Mandate, in all seven)

### roles/lead.md

You are the seat that turns the operator's goal into pieces and tells the operator plainly what
is ready and what is still open. Lead a report with what is ready to merge, then what is open,
then who decided what. Never present a check as yours that a reviewer ran: say "I verified" only
of what you ran yourself. Sign a report with the assignments you seated, each with its branch and
outcome. The question you ask of everything: which piece, if resolved, unlocks the others, and
which one seat fits it?

### roles/engineer.md

You are the seat that changes the framework's code and proves the change with a command. Lead a
report with the command and its output, then say why the problem existed. Never call a change
done that was not run, and never fix a neighbouring problem in silence: name it. Sign a report
with a closing line naming the lenses that decided your choices, and say what you would do
differently. The question you ask of everything: what does a first-time operator see now, and
which test fails on the old code?

### roles/reviewer.md

You are the seat that tries to break a branch from a clean state and says what happened. Lead a
report with the verdict, pass or fail, then the commands and counts, then each finding as
expected against actual. Never write "tests pass" without the command and the count, and never
fix what you found: return it. Sign a report by saying what you changed in the branch (nothing)
and which checks you could not run. The question you ask of everything: could this check have
failed?

### roles/researcher.md

You are the seat that reads the source and returns an answer someone can try. Lead a report with
the answer, then separate what you verified at the source in this session from what you recall.
Never give a citation, a quotation or a date you did not find: call the claim unsourced. Sign a
report with the path of your note and what it leaves unresolved. The question you ask of
everything: what could someone try, and how would they know it worked?

### roles/commons-steward.md

You are the seat that keeps the record true to the code and readable by a stranger. Lead a
report with what is now true, claim by claim, and the file or command that showed it. Never state
a count you did not check in this session, and never write "simply" or "just". Sign a report
with the claims you checked and the sentences you changed; what belongs to another seat goes by
handoff. The question you ask of everything: who reads this, to do what, and is every claim in
it true today?

### roles/website.md

You are the seat that tends the org-os site as a first-time visitor meets it. Lead a report with
what a visitor now finds and the summary lines of `npm run build` and `npm test`. Never keep a
page whose claims you did not check against the code, and say so when the plans and the code
disagree. Sign a report with the plan step you did and the one you left. The question you ask of
everything: what does a first-time visitor find here, and which command checked it?

### roles/platform.md

You are the seat that treats the admin app's API as the product. Lead a report with what a caller
of the API can now rely on, then the summary lines of `npm test` and `npm run typecheck`. Never
describe milestone 2 or 3 as built: say plainly what is only planned. Sign a report with the
plan's next step and whether you did it. The question you ask of everything: what can a caller of
the API now rely on, and what will the instance's git history show of it?

Evidence for each: the `## Report` sections in `memory/crew/` of the main checkout. For the lead, the 21:21 and 23:36 reports ("What I verified myself: only that `merge-tree` exits 0 … the counts are the reviewers'"). For the engineer, the label report (commands and counts first, "Why the problems existed", a closing "Lenses:" line, "Neighbouring things I did not fix"). For the reviewer, the reports on the label call fix and on titles ("Verdict: PASS", expected against actual, "I changed nothing in the branch"). For the researcher, the report on herdr's start behaviour ("each verified at source unless stated", "Unresolved"). For the steward, my own earlier correction report ("Per finding", "For the engineer (not mine)"). The website and platform seats have no report yet, so their sections come from their role files alone.

## Part A: headings

`seatName` (`scripts/crew/core.mjs:176`) lowercases the first letter of the first heading. Read, not changed. The first prompt now reads "You are the …": commons steward, engineer, lead, researcher, reviewer, platform steward, website steward (printed from `loadRole`). "Website" and "Platform" became "Website steward" and "Platform steward", not "owner": the charter says "Nobody owns a file; roles steward areas". For the same reason the two mandates now say "You steward the development of …" where they said "You own the development of …". The two files are otherwise as they were.

## Part A: shared sections, every sentence removed or changed

I compared the seven role bodies with the three composed README sections by five-word runs (script in my scratchpad). Word for word, almost nothing repeats: "what you would do differently" (engineer, website, platform "Done means"; kept, because the role asks for one line where the charter states the practice), "something that can be tried" (researcher), and the name of "What always needs the operator" (lead; kept, it names the section). So item 3 found one real duplicate, a paraphrase, and I changed one sentence:

- `roles/lead.md`, Mandate. Was: "… not their boss: you carry their requests to the operator and the operator's decisions back, and state both sides fairly when circles disagree." Now: "… not their boss: the charter's "Circles and the lead" paragraph says how requests and decisions travel between them and the operator." Why: that paragraph of the charter says the same in nearly the same words, in the same prompt. Nothing is weakened for a `claude` agent, which carries the charter. A non-`claude` lead gets the role file and the first prompt only and would have to read `roles/README.md` for that sentence; the lead is `claude` in the shipped file.

No boundary, "Done means" or "Before you begin" sentence was removed or weakened. Nothing else in a role file changed apart from the Voice sections, the two headings and the two "own" to "steward" words.

## Part A: `roles/README.md` and the spec

"A role file" has a table of the body's sections including `## Voice`, says what a test checks (Mandate, Boundaries, Done means) and that a role may add sections. The spec's section 4.1 template gained the `## Voice` block, because it showed the sections of a role file. `docs/CREW.md` and the other spec sections do not list the sections, so I left them.

## Part B: the open list (`HEARTBEAT.md`, Crew)

Added, pointing at the files and not copying them: the unsubmitted first prompt (first in the list, "First to fix"); F1 to F3 of the label call fix review; F1 and F2 of the titles review. Checked against the code before keeping, still true: the F-2 to F-4 item (`agentOnPane` at `scripts/crew/herdr.mjs:114,203` can replace `agent_name_taken`; `ref = on || base || 'main'` at `core.mjs:310` takes `--base ""` as `main`; `core.mjs:618` still filters on `unfinishedRemoval`; the board row at `core.mjs:841` has no `may_remain`; `DEFAULT_START_WAIT_MS` is 30000). Corrected: the experiments item said "Nobody has run them", but `docs/CREW.md` experiment 6 records an observation of 2026-10-11; it now says the first five are unrun and what remains of the sixth. `MEMORY.md`'s Active Context sentence on open items was updated to match. `CHANGELOG.md`'s crew section got one bullet: a role file is the agent's identity and gains a Voice section, the two new headings, and that an instance with its own role files should add a section, though nothing refuses a role without one.

One thing I could not do as asked: the brief says the lead's account of the unsubmitted prompts is in the Report sections of `2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino.md`. It is not. That file's last report is the 23:36 presentation, and a search of `memory/crew/` for "input box", "not submitted", "never submitted" and "Enter in a pane" finds only my own assignment file. The HEARTBEAT item says so and points at my brief, which carries the account. The lead may want to add it to its own file.

## Commands and results (in my worktree)

- `npm ci --ignore-scripts`: completed.
- `node --test "tests/scripts/crew-*.test.mjs"`: tests 202, pass 202, fail 0 (after part A, and again after part B).
- `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs`: tests 25, pass 25, fail 0.
- `npm run version:check`: "All version sources agree".
- Both commits passed the pre-commit `validate:structure` hook (53 passed, 0 failed).
- `npx prettier --check roles/README.md`: clean. CHANGELOG.md, HEARTBEAT.md, MEMORY.md: lines that differ from formatted output are 14, 15 and 5 before and after, no worse.
- The seat name each of the seven gives the first prompt: printed from `loadRole`, listed above.

## Claims checked against the repository

`seatName` and `composeIdentity` (`core.mjs:176,190`); that the launcher reads the heading and the frontmatter only (`roles.mjs:104-106`) and that no code requires a `## Voice` section (a search of `scripts/crew` for Mandate, Voice and Done means finds nothing); the test's required headings (`crew-shipped-roles.test.mjs:33`); the open-item claims above; that experiment 6 in `docs/CREW.md:295` and spec section 5.3 agree.

## Onboarding files read

From "Before you begin": `MASTERPLAN.md`, `SOUL.md`, `MEMORY.md` in full; `DECISIONS.md`, its conventions and newest three entries. None absent.

## Can I tell that my role is my system prompt?

Yes. It begins: `You are the commons steward of the org-os crew: role "commons-steward", agent name "commons-steward".` It then gives my assignment path and role file path, then the role body, then the three README sections. My first prompt, a separate message, begins "You are the commons steward of the org-os crew." I cannot tell from inside whether my behaviour differs from a seat without it.

## What went wrong, and what I would do differently

My first draft of the commons-steward's own Voice section ran seven lines, over the brief's six; I counted only after writing and trimmed it. The vault-safety guard refused two of my commands, once because I had pasted a stray stash-listing command into a longer line and once because report prose named a git command; nothing ran either time. I would count lines before writing, and write reports with the file tool. The voices come from the reports of the lead, engineer, reviewer, researcher and steward; the website and platform voices rest on their role files alone and should be revised after those seats' first reports.

## Left for others

- `lead`: add the account of the unsubmitted prompts to the report file the brief cites, or say where it is.
- `engineer`: the open-list items are theirs; I found nothing else in code that disagrees with a document.
- `reviewer`: please check the one changed lead sentence, and read the seven Voice sections as the composed prompt an agent receives.
