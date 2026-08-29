# org-os session — Regen Knowledge Commons (~2026-09-10)

**Audience:** Monty, Durgadas, Matt, Drew, Heenal + DAIAA as first external
audience. Matt is non-technical and should leave able to explain org-os to
others. Context: the group's agreed experiment is a lightweight org-os
instance on a **branch** of the `knowledge-commons` repo (never `main` —
Monty's condition), and Luiz leads the org-os side of Repo Stabilization.
Meeting record: `260827 Regen Knowledge Commons Sync`.

**What shipped that this session rides on:** `v0.5.0` (tagged 2026-08-29) —
live site, admin M1, instance-doctor, one honest setup path, and a release
process that stopped its own tag when acceptance failed (that story is worth
telling in the room).

---

## 1. Narrative arc (20 min talk track)

1. **The problem in this room** (2 min). The knowledge-commons work already
   produces structured knowledge; what it lacks is an *organizational*
   substrate — where decisions, members, projects and memory live in a form
   both humans and agents can read and act on. Not another app: files + git.

2. **What org-os is** (3 min). The operating system for organizations run by
   humans and AI agents together. A git repo *is* the organization: identity
   files agents actually follow, `data/*.yaml` registries as the single source
   of truth, machine-readable EIP-4824 schemas in `.well-known/`, session
   memory, and a federation protocol connecting sovereign instances. No SaaS,
   no lock-in — markdown, YAML, git.

3. **Why it's different** (3 min, from POSITIONING). Personal agent OSes run
   *you*; org-os runs *your organization*. "Company as code" templates give
   you prose; org-os is a running system — validators, dashboard, memory, a
   real federation operating since April 2026. And it composes with the agent
   runtimes people already use rather than competing with them.

4. **Connective tissue, not another platform** (4 min — the interop story).
   org-os adopts the everything-is-a-plugin direction: modules with manifests
   (`modules/*/module.yaml` — two tracked today), standards-first interop
   (AGENTS.md conventions, Agent Skills format, EIP-4824, MCP), bridges to
   Cloudflare OS, Hermes, Multica. **This group's own knowledge-commons
   pipeline is a live example of what it connects**: your pipeline produces
   knowledge; an org-os instance gives it an org-shaped home agents can
   operate — which is exactly the branch experiment we agreed on.

5. **Honesty as a feature** (3 min). v0.5 is *pre-beta by design* — renumbered
   down from 3.5 to say so. The federation is single-operator today (that is
   disclosed on the site, not hidden). The release itself refused its own tag
   when acceptance failed, and shipped with its known issues documented in the
   CHANGELOG. For a commons group, trust in the artifact comes from this.

6. **The ask** (2 min). Run the branch experiment (§I5 plan); one volunteer
   beyond Luiz to try the agent-driven setup recipe; feedback into the v0.6
   external-pilot gate. DAIAA as the first external audience for the pilot.

## 2. Live demo script (15 min, all local + one live URL)

> Pre-flight (morning of): `git pull` in org-os; `npm run initialize` renders;
> `cd packages/admin && npm run start` boots; site URL up; `../refi-med-os`
> present. Every step below degrades to a screenshot if offline.

1. **`/initialize`** in the org-os repo — the dashboard: projects, tasks,
   calendar, funding, federation, knowledge graph. *"This is a session
   opening. Every org-os instance greets its operator like this."*
2. **Federation map** — https://regen-coordination.github.io/org-os-template/federation
   — the live network: hub + instances + frontier. *"Each node is a git repo
   publishing machine-readable identity. The map is built from those files."*
3. **Admin M1** — `npm run admin`, open the **Members** registry; edit a
   member field; show the resulting git commit (`git log -1 --stat`). *"A
   web surface for people who will never touch YAML — every change is a
   commit."* (Stay on Members for the write demo — it's the registry the
   write path is proven on in this repo today.)
4. **Instance doctor** — `npm run doctor -- --dir ../refi-med-os`. Read the
   scorecard out loud: what's healthy, what drifted, each finding with its
   remediation hint. *"This is how a federation stays honest: assessment
   proven against every real instance before v0.5 shipped."*
5. **Site tour** — home (hero numbers), `/get-started` (the one honest path +
   agent recipe), `/docs`, `/llms.txt` (*"agents get a map of this org too"*).

## 3. FAQ (from POSITIONING §7 + release facts)

- **Is this another DAO tool?** No — it implements the DAOstar/EIP-4824
  standard but extends it to day-to-day ops: meetings, projects, finances,
  memory. On-chain is optional and absent by default.
- **vs Obsidian + agent skills?** Obsidian's skills teach agents file formats;
  org-os supplies the operational layer on top — and runs inside a vault
  natively (this hub literally lives in one).
- **vs OpenClaw / personal agent OSes?** They run *you*; org-os runs *your
  organization* — and federates with those runtimes rather than replacing them.
- **Who runs the federation today?** One operator (Luiz), five instances plus
  the hub — disclosed on the site. The external pilot is the open milestone;
  this room is where it starts.
- **Is sync between instances proven?** Assessment is — against all six real
  instances. Full sync is documented as unproven (CHANGELOG Known issue) with
  the redesign targeting v0.5.1. We ship what we can prove.
- **What does it cost / where's the lock-in?** MIT, files in a git repo you
  own. Leaving org-os = keeping your repo and deleting some scripts.
- **Durgadas 1:1 talking point (overlap):** his agent/knowledge work overlaps
  at the *runtime* layer — org-os deliberately doesn't compete there; it's the
  substrate his runtime (or any) plugs into. The plugin/module manifest line
  is the concrete integration surface to explore together.

## 4. Session logistics

- One-pager: `docs/sessions/2026-09-10-one-pager.md` (rendered — numbers stay
  live via `npm run render:templates`).
- Branch-instance plan: `docs/sessions/2026-09-10-knowledge-commons-instance-plan.md`.
- Scheduling draft: `docs/sessions/2026-09-10-scheduling-draft.md` (operator
  sends; agent never posts).
