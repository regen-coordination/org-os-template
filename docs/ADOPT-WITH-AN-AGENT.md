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
npm install --prefix packages/admin   # the doctor's data and governance checks load it
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

**4. Install and validate** — inside the new instance:

```bash
cd ../harbor-bakery-os
npm install
npm run validate:schemas && npm run validate:structure
```

The clone ships `.well-known/` as templates plus a `dao.json` rendered from
the config, so it cannot publish the framework's identity. A new instance has
no `identity.daoURI` in `federation.yaml`, and `npm run generate:schemas`
builds nothing without one (it says so and warns that `dao.json` is not
refreshed; that is expected). Publishing is the operator's decision: ask before
setting `identity.daoURI` and writing `data/visibility.yaml`, then run
`generate:schemas` and commit what it wrote. See [Setup](SETUP.md), Step 4.

**5. Verify with the doctor** — back in the framework directory, run the
instance doctor against what you just made:

```bash
cd ../org-os-template
npm run doctor -- --dir ../harbor-bakery-os
```

**Acceptance:** the scorecard must show **no blockers except
`git-remote-absent`** (expected until the org gets its own remote repository —
create one and `git remote add origin <url>` when ready). Any other blocker is
a bug in the framework; report it upstream. A `validator-did-not-run` warning
for `data` or `governance` means the `packages/admin` install in step 1 was
skipped.

**6. Open the first session.** Read `GETTING-STARTED.md` (rendered for the new
org) and run the `bootstrap-interviewer` skill to fill in members, projects,
channels and data sources — that conversational pass is `BOOTSTRAP.md`
**Phase 1**, and it is where the org's actual substance goes.

---

## What the operator should double-check afterward

- `IDENTITY.md` and `SOUL.md` say **your** org's name and mission — not
  "org-os". (The clone seeds them from your config; the interviewer pass adds
  depth.)
- `.well-known/dao.json` — the clone renders it from the config; once a
  `daoURI` is set, `generate:schemas` rewrites it. It is your public
  machine-readable identity and should carry your name.
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
npm run doctor -- sync --dir ../your-org             # snapshot (tracked files only), overlay, migrate, declare visibility, regenerate, receipt
```

`sync` is a file-level overlay: it copies framework-owned paths (`scripts/`,
`templates/`, ...) in, never deletes, leaves what the organisation owns alone,
and writes a receipt to `memory/reports/`. It runs the framework's migrations
against the instance (`scripts/migrate.mjs <instance> --target <version>`). When
the instance has no `data/visibility.yaml` and its `.well-known/` holds files an
earlier generator wrote, it writes one declaring public what they already
publish, as its own commit: a publication decision for the org to confirm, edit
or revert. The overlay shipped in `v0.6.0` (see `CHANGELOG.md`); a checkout of
`v0.5.0` only has the `--dry-run` plan. Run the dry run first and read it.

---

*Checked on 2026-10-10 against the framework as it then stood on `main`: steps 3–5 run in a scratch directory with the config
above. The clone wrote the instance; before `generate:schemas` the doctor showed
two blockers (`git-remote-absent`, `structure-invalid`); after it, one
(`git-remote-absent`). `npm install` inside the instance and a real remote were
not exercised. These steps were not re-run for 0.6: the 0.6 changes above
(no `.well-known/` requirement without a `daoURI`, the doctor's four
validators) are read from the code.*
