---
id: 2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo
role: engineer
agent: engineer
kind: claude
branch: crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo
detached: false
pane: 'wZ:p1'
workspace: wZ
worktree: >-
  /Users/luizfernando/.org-os/worktrees/org-os-crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo
task: null
handoff: null
seated_by: 2026-10-10-lead-first-crew-cycle-clear-the-deferred-mino
status: released
prompted: true
created: '2026-10-10T23:23:05-03:00'
updated: '2026-10-10T23:26:14-03:00'
worktree_removed: true
rescued_branch: null
---
## Brief

Onboard every seat to org-os: a "Before you begin" reading list the first prompt points at

Goal. A seated agent is told to read its role file and its assignment file, and nothing else. The repository's own CLAUDE.md says to read MASTERPLAN.md first and follow the AGENTS.md startup sequence, but no role file, the crew skill, docs/CREW.md, the first prompt or the design spec mentions any of it. In the first crew cycle the agents (and the lead) worked without the mission, the values or the active decisions. That cost little on work inside crew's own scripts; it will cost on schemas, instance-facing behaviour or federation. The operator has asked for every seat to be onboarded to org-os before it starts its brief.

Lead's decisions (say so in your report if reading the code shows one is wrong).
1. One list, in one place. roles/README.md gains a short section "Before you begin" naming what every seat reads before its brief: MASTERPLAN.md, SOUL.md and MEMORY.md, at the root of the agent's own worktree. An instance changes the list by editing that file, never the code. Say in one line why these three: mandate and priorities, values and boundaries, decisions in force.
2. The first prompt points at it. firstPrompt in scripts/crew/core.mjs tells the agent to read its role file, its assignment file, then the "Before you begin" section of roles/README.md (absolute path in the main checkout, as the other two) and what it lists, and only then begin. nudge sends the same prompt. The assignment file's last line already points at roles/README.md; make it name the section too.
3. A missing file is skipped, not fatal. Instances differ; one without MASTERPLAN.md must still seat. The section says: read what exists, and name in your report what you read and what was absent. Crew itself checks nothing and refuses nothing here: the script carries rules, the role files carry judgment.
4. A role may add to the list, never shorten it. roles/lead.md adds HEARTBEAT.md and the rest of the AGENTS.md startup sequence, because the lead splits goals and must know the active priorities. Leave the other shipped roles on the shared list unless you see a clear need; say what you decided.
5. Reports say what was read. Add to the shared boundary "Report before you stop" that the report names the onboarding files read.

Already known. You start from crew/2026-10-10-engineer-crew-follow-ups-from-the-first-cycle-s-r, an unmerged, unreviewed branch on top of feat/crew that already changed assignmentBody, seat, nudge and the docs; read its diff against feat/crew first and build on it. Files: scripts/crew/core.mjs (firstPrompt, assignmentBody), roles/README.md, roles/lead.md, docs/CREW.md, skills/crew/SKILL.md, docs/superpowers/specs/2026-10-10-org-os-crew-design.md (section 4.2 and section 5 step 6), tests/scripts/crew-seat.test.mjs, tests/scripts/crew-shipped-roles.test.mjs. roles/ is copied into new instances (tests/clone-manifest.txt, tests/clone-genesis.test.mjs), so what you write in roles/README.md must be true for an instance, not only for this framework repository: check that the three files exist in a fresh instance and say what you found. Do not paste the files' contents anywhere; point at them.

Done means. A test that fails on your base and passes after for: the first prompt names the section and the README path; nudge sends the same; and a test on the shipped roles that fails if roles/README.md loses the section or the section names a file that does not exist in this repository. `npm ci --ignore-scripts`, then `node --test "tests/scripts/crew-*.test.mjs"` and `node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` pass. Docs and spec say what the code now does. Logical commits; nothing pushed or merged. Before you start, do what the new section will ask: read MASTERPLAN.md, SOUL.md and MEMORY.md in your worktree, and name them in your report along with roughly how long that reading took, since every future seat will pay that cost. Then hand off to reviewer naming your branch with --branch; the reviewer will review your branch and the one under it together.

## Commands

Run these exactly as written. They are the only things you do outside your worktree.

- Report when you finish or cannot continue: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" report --file <path to your report>`
- Ask another role to take something on: `node "/Users/luizfernando/.cache/lf-worktrees/org-os-crew/scripts/crew.mjs" handoff <role> "<brief>" [--branch <branch>]`

Shared boundaries and the charter: /Users/luizfernando/.cache/lf-worktrees/org-os-crew/roles/README.md

## Report — 2026-10-10T23:25:41-03:00

## Report: Before you begin reading list

Branch: crew/2026-10-10-engineer-onboard-every-seat-to-org-os-a-before-yo (on top of crew/...-crew-follow-ups-from-the-first-cycle-s-r)

### What changed (2 commits, nothing pushed)
- scripts/crew/core.mjs: firstPrompt takes the README path and names the "Before you begin" section of roles/README.md and the files it lists, before "begin the work". Seat, nudge and the "type this yourself" message for an unconfirmed prompt all use it. The assignment file's last line names the section too.
- roles/README.md: new section "Before you begin" (MASTERPLAN.md, SOUL.md, MEMORY.md at the worktree root, with a one-line why; missing file skipped; report names read/absent; roles add, never shorten; instance edits the section, not code). Shared boundary "Report before you stop" now also asks for the onboarding files read.
- roles/lead.md: its own "Before you begin" adds HEARTBEAT.md and the rest of the AGENTS.md startup sequence. Other roles left on the shared list: nothing in their mandates needs more.
- docs/CREW.md, skills/crew/SKILL.md, spec 4.2 and section 5 step 6 say what the code now does.
- tests: crew-seat (prompt names section + README path; nudge sends the same; assignment last line; unconfirmed message) and crew-shipped-roles (section exists, every backticked file it names exists here, the three are present, lead adds HEARTBEAT/AGENTS, shared boundary asks for the list). 7 new tests failed on the base (29 pass / 7 fail), all pass now.

### Proof
`node --test "tests/scripts/crew-*.test.mjs"` : pass 125, fail 0
`node --test tests/scripts/module-manifests.test.mjs tests/clone-genesis.test.mjs` : pass 25, fail 0
(run together: pass 150, fail 0). Prettier is clean on the docs I touched.

### Onboarding files I read, and the cost
Read MASTERPLAN.md (6.7 KB), SOUL.md (3.3 KB), MEMORY.md (5.7 KB) in my worktree: ~16 KB, roughly 4k tokens, three file reads, a few seconds. Cheap.
Observations from the reading:
- MEMORY.md says DECISIONS.md is the authoritative decision log; MEMORY.md only indexes it ("decisions in force" is really DECISIONS.md). The lead's decision 1 names MEMORY.md; I followed it and the wording in README says "decisions in force". Worth deciding whether DECISIONS.md joins the list; it can be long, so I did not add it.
- MASTERPLAN.md section 3 no longer carries active tasks; it points to docs/agent-plans/QUEUE.md and HEARTBEAT.md. That is why lead gets HEARTBEAT.md.

### Fresh instance check
Cloned with `node scripts/clone-framework.mjs --target <tmp> --config tests/fixtures/instance-config.yaml --no-git`. All three files exist at the root, plus HEARTBEAT.md, AGENTS.md and roles/README.md (also listed in tests/clone-manifest.txt). But they are scaffold stubs (MASTERPLAN.md 157 bytes "TODO: define", SOUL.md 366 bytes, MEMORY.md 164 bytes) until the operator fills them. So the section is true for an instance, and a newcomer's agent will read near-empty files: cheap, but it learns nothing. The README text says "a new one may hold only a stub". Also note the instance's SOUL/MASTERPLAN describe that org, not the framework; that is the intent.

### Why the problem existed
firstPrompt was written before the CLAUDE.md/AGENTS.md startup sequence was connected to crew; role files assumed the repo's CLAUDE.md, but seats start from the role file, not CLAUDE.md. No test or doc linked the two.

### Design note (lens: The newcomer's path is the product)
The prompt is now longer and the list lives in prose, so a typo in a filename in README is only caught for files in this repo by the new test, not for an instance that edits the list; that is by design (script carries no judgment). One more thing: CLAUDE.md in the worktree is loaded automatically by Claude Code and already says "read MASTERPLAN.md first" so a Claude seat may be told twice; harmless.

### Migration note
Instance-facing: instances that already have a copied roles/README.md will not get the section until they sync roles/; the first prompt will then point at a section that is absent and the agent should report that. Run sync:upstream (or copy roles/README.md) to adopt it. No schema or data change.

### What I would do differently
Decide DECISIONS.md vs MEMORY.md with the lead before writing, and add a test that the first prompt is still one line before adding words to it (the existing test caught it only incidentally).

### Handoff
Handing off to reviewer with --branch; the reviewer should review this branch together with the one under it.
