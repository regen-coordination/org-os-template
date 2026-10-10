# Adopt org-os with an AI agent

The normal way to spin up an org-os instance is to have an AI coding agent —
Claude Code, Cursor, OpenCode, or a ChatGPT connector with shell access — run
the setup for you while you answer its questions in plain language. This page
is the recipe the agent follows. It uses only the **one recommended path**
(`clone:framework`, non-interactive and config-driven); the `npm run setup`
wizard needs a real interactive terminal and cannot be driven by an agent.

The walkup path — fork the repository, run `npm run setup`, answer a guided
interview in place — is **not a working path for a newcomer**: a clean-room
test on 2026-08-21 found it broken in seven blocker-level ways and it has not
been re-tested since. The clone is the supported route. Every instance that
exists today is run by the framework's maintainer; this recipe has not yet been
followed by an outside operator.

Paste this whole page to your agent, or point it here, and say
*"set up an org-os instance for `<my org>`."*

---

## The recipe (agent instructions)

**0. Requirements.** Node ≥22, npm ≥10.9.2, git. Everything below is
non-interactive and safe to run from an agent shell (no TTY needed).

**1. Clone the framework as a generator** — next to where the new org should
live, not inside it:

```bash
git clone https://github.com/regen-coordination/org-os-template.git
cd org-os-template
npm install
```

**2. Ask the operator, in conversation,** for: org name · org type
(free text, for example Cooperative, DAO, LocalNode, Hub, Project) · one-sentence description ·
an emoji · operator name + email · federation network name (or none) · which
operational packages they want (start with `operations: true` only) · which
skills to include (the four below are a good default). Then write the answers
as a config file:

```bash
# my-org.yaml (in the org-os-template directory)
```

```yaml
org:
  name: "harbor-bakery-os"
  tagline: "Operations for a worker-owned bakery"
  type: "Cooperative"
  short_description: "The shared operating system of Harbor Bakery Co-op."
  emoji: "🥖"
  license: "MIT"

operator:
  name: "Your Name"
  email: "you@example.org"

network:
  name: "regen-coordination"    # or omit if standalone
  upstream_url: "https://github.com/regen-coordination/org-os-template.git"

packages:
  operations: true

skills:
  - bootstrap-interviewer
  - org-os-init
  - heartbeat-monitor
  - knowledge-curator
```

**3. Generate the instance** into a sibling directory (dry-run first if the
operator wants to inspect the plan):

```bash
npm run clone:framework -- --target ../harbor-bakery-os --config my-org.yaml
```

**4. Install and publish the instance's schemas** — inside the new instance.
Order matters: the clone deliberately ships `.well-known/` as templates (so it
cannot publish the framework's identity), and `generate:schemas` is what
publishes *yours* — run it before any validation:

```bash
cd ../harbor-bakery-os
npm install
npm run generate:schemas && npm run validate:schemas
npm run validate:structure
git add -A && git commit -m "chore: generate schemas"
```

The commit matters: `generate:schemas` leaves the new `.well-known/` files
untracked, which the doctor reports as `working-tree-dirty`.

**5. Verify with the doctor** — back in the framework directory, run the
instance doctor against what you just made:

```bash
cd ../org-os-template
npm run doctor -- --dir ../harbor-bakery-os
```

**Acceptance:** the scorecard must show **no blockers except
`git-remote-absent`** (expected until the org gets its own remote repository —
create one and `git remote add origin <url>` when ready). Any other blocker is
a bug in the framework; report it upstream.

**6. Open the first session.** Read `GETTING-STARTED.md` (rendered for the new
org) and run the `bootstrap-interviewer` skill to fill in members, projects,
channels and data sources — that conversational pass is `BOOTSTRAP.md`
**Phase 1**, and it is where the org's actual substance goes.

---

## What the operator should double-check afterward

- `IDENTITY.md` and `SOUL.md` say **your** org's name and mission — not
  "org-os". (The clone seeds them from your config; the interviewer pass adds
  depth.)
- `.well-known/dao.json` — after `generate:schemas`, this is your public
  machine-readable identity. It should carry your name.
- `federation.yaml` — the lineage stamp: `metadata.genesis_commit` is the
  framework repository's **root commit** (the same for every instance), and
  `metadata.last_sync_commit` stays `null` until the first `doctor sync`
  records the framework commit it applied. `doctor assess` reads both
  (`never-synced` is the day-one warning). Keep them.

## Keeping the instance up to date

From the framework checkout: `npm run doctor -- --dir ../your-org` any time —
it is read-only and prints a scorecard. To update the instance from the
framework:

```bash
npm run doctor -- sync --dir ../your-org --dry-run   # print the plan, change nothing
npm run doctor -- sync --dir ../your-org             # snapshot, overlay, migrate, regenerate, receipt
```

`sync` is a file-level overlay: it copies framework-owned paths (`scripts/`,
`templates/`, ...) in, never deletes, leaves what the organisation owns alone,
and writes a receipt to `memory/reports/`. The overlay landed on `main` after
the `v0.5.0` tag (see `CHANGELOG.md`, Unreleased), so a checkout of the tag only
has the `--dry-run` plan. Run the dry run first and read it.

---

*Checked on 2026-10-10 against the framework as it then stood on `main`: steps 3–5 run in a scratch directory with the config
above. The clone wrote the instance; before `generate:schemas` the doctor showed
two blockers (`git-remote-absent`, `structure-invalid`); after it, one
(`git-remote-absent`). `npm install` inside the instance and a real remote were
not exercised.*
