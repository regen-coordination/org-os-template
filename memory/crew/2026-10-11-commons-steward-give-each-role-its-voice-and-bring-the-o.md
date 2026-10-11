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
status: working
prompted: true
created: '2026-10-11T01:52:56-03:00'
updated: '2026-10-11T01:53:06-03:00'
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
