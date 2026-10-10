# Setup Guide

**Create an org-os instance: clone the framework once, generate your instance from a config file, check it, publish its identity.**

org-os is a generator. You keep a checkout of the framework (this repository) and run one command that writes a **new, separate instance** into a sibling directory, with your identity, a git history of its own and a lineage stamp. You do not fork the framework and edit it in place.

An AI agent can run all of this for you: see [Adopt org-os with an AI agent](ADOPT-WITH-AN-AGENT.md). Everything below is non-interactive.

> **The supported route is the clone.** The walkup path — fork the repository, run `npm run setup`, answer a guided interview in place — is not a working path for a newcomer. A clean-room test on 2026-08-21 found it broken in seven blocker-level ways (among them: it cannot complete outside an interactive terminal, and in a fork it leaves the maintainer's own identity and data in place while both validation commands report a pass). It has not been re-tested since. See [Setup paths](SETUP-PATHS.md).
>
> **Honest scope.** Every instance that exists today is run by the framework's maintainer. The path below is tested on every change (`tests/clone-framework-health.test.mjs` clones an instance and asks the doctor to judge it), but it has not yet been walked by an operator outside the project. If something here does not work, that is a bug in the framework: open an issue.

## Prerequisites

- Node.js 22 or higher and npm 10.9.2 or higher (the `engines` field of `package.json`)
- Git

## Step 1: Get the framework

```bash
git clone https://github.com/regen-coordination/org-os-template.git
cd org-os-template
npm install
```

The clone reads only **committed** files of the framework checkout (it lists `HEAD`), so an uncommitted local change in your checkout never ends up in a new instance.

## Step 2: Write a config file

Create `my-org.yaml` (anywhere; the example puts it in the framework directory). `org.name` and `org.type` are required; the rest is optional.

```yaml
org:
  name: "harbor-bakery-os"
  tagline: "Operations for a worker-owned bakery"
  type: "Cooperative"               # free text, e.g. Cooperative, DAO, LocalNode, Hub, Project; "Hub" sets is_hub
  short_description: "The shared operating system of Harbor Bakery Co-op."
  emoji: "🥖"
  license: "MIT"
  # base_url: "harbor.example.org"  # where .well-known/ will be served; defaults to <slug>.example.org
  # language: "pt-BR"               # see "Other languages" below

operator:
  name: "Your Name"
  email: "you@example.org"

network:
  name: "regen-coordination"        # omit if standalone
  upstream_url: "https://github.com/regen-coordination/org-os-template.git"

packages:
  operations: true                  # start with this one

skills:                             # omit to keep every skill
  - bootstrap-interviewer
  - org-os-init
  - heartbeat-monitor
  - knowledge-curator
```

A complete example is `tests/fixtures/instance-config.yaml`. Notes:

- `network.upstream_url` is honoured only when it is the canonical framework repository; anything else is replaced and the substitution is logged.
- `packages:` and `skills:` decide which `packages/<id>/` and `skills/<id>/` directories the new instance carries. Packages are described in [Packages](PACKAGES.md).
- A `kms:` block turns the instance into a knowledge system; see [Setup paths](SETUP-PATHS.md).

## Step 3: Generate the instance

```bash
npm run clone:framework -- --target ../harbor-bakery-os --config my-org.yaml
```

| Flag | Effect |
|---|---|
| `--target <dir>` | where the instance is written (required; must be empty) |
| `--config <file.yaml>` | the config above (required; there is no interactive mode) |
| `--dry` | inspect the stages without writing (see the header of `scripts/clone-framework.mjs`) |
| `--force` | allow a target that is not empty |
| `--no-git` | skip `git init` and the initial commit |
| `--commit-unverified` | commit even when the framework checkout is not a git repository |

The stages it prints: copy the committed framework files, strip the framework-only registries and generated `.well-known/` files, reset the placeholder identity files from `templates/scaffold/`, materialise the packages and skills you chose, write `federation.yaml` with your identity and the lineage stamp, render `README.md`, `GETTING-STARTED.md`, `CLAUDE.md` and `AGENTS.md`, then `git init` and one initial commit.

## Step 4: Publish the instance's schemas and validate

The clone ships `.well-known/` as templates only, so it cannot publish the framework's identity as yours. `generate:schemas` writes *your* files; run it before any validation.

```bash
cd ../harbor-bakery-os
npm install
npm run generate:schemas
npm run validate:schemas
npm run validate:structure
```

`generate:schemas` writes the EIP-4824 files (`dao.json`, `members.json`, `projects.json`, ...) into `.well-known/`; see the [EIP-4824 guide](EIP4824-GUIDE.md). Re-run it after you change `data/*.yaml` or `federation.yaml`.

It leaves the new `.well-known/` files untracked, so commit them (the doctor otherwise reports `working-tree-dirty`, and a push would publish only the initial commit):

```bash
git add -A && git commit -m "chore: generate schemas"
```

## Step 5: Check it with the doctor

From the framework directory:

```bash
npm run doctor -- --dir ../harbor-bakery-os
```

A fresh instance should report **no blockers except `git-remote-absent`**, which is expected until you give it a repository. Warnings such as `never-synced`, `memory-absent` and `no-sync-receipts` are normal on day one. Any other blocker is a framework bug.

Create a repository for the instance and connect it:

```bash
cd ../harbor-bakery-os
git remote add origin <your-instance-repo-url>
git remote add upstream https://github.com/regen-coordination/org-os-template.git
git push -u origin HEAD
```

## Step 6: Fill in what the clone could not

The clone writes structure, not substance. Edit:

- `IDENTITY.md`, `SOUL.md`, `MASTERPLAN.md` and `USER.md`: who the organisation is and what it is for
- `federation.yaml`: `peers`, and anything the config did not cover
- `data/members.yaml`: it is seeded with the operator; add the team (`id`, `name`, `role`, `joined`)

Then open an agent session in the instance and run the `bootstrap-interviewer` skill, which walks members, projects, channels and data sources and writes the files as you answer. That pass is Phase 1 of the instance's `BOOTSTRAP.md`. After any change to `data/*.yaml`, run `npm run generate:schemas` again.

## Publishing

The clone carries two things that publish: `.github/workflows/generate-schemas.yml`, which regenerates `.well-known/` on a push that touches `data/**`, `content/meetings/**`, `content/projects/**` or `federation.yaml`, daily, and on manual dispatch, and commits the result back, and `scripts/deploy-pages.mjs`, which builds the instance's webapps from `packages/` into a static `_site/` directory. It does **not** carry a workflow that deploys a site, and no Quartz site. Serving `.well-known/` at the `base_url` you configured is yours to arrange (any static host works); the `daoURI` in `.well-known/dao.json` should resolve once you do.

## Other languages

Set `org.language` to a BCP-47 tag and everything the clone writes comes out in that language. `pt-BR` ships today. The `kms:` block and the language rules are described in [Setup paths](SETUP-PATHS.md).

## Troubleshooting

- **Node version.** `node --version` should be 22 or higher.
- **`Target not empty`.** The target directory must be empty; use a new directory (or `--force`, knowing what it overwrites).
- **Validation fails right after the clone.** You skipped `npm run generate:schemas`; run it first.
- **Schema errors.** Check the YAML in `data/` is valid, then `npm run validate:schemas`.
- **Doctor reports a blocker other than `git-remote-absent`.** Run `npm run doctor -- --dir <instance> --json` and report it with the check code.

## Next steps

- [Operator guide](OPERATOR-GUIDE.md): the daily and weekly rhythm
- [Packages](PACKAGES.md): what each package adds
- [EIP-4824 guide](EIP4824-GUIDE.md): the published identity files
- [Federation](FEDERATION.md): connecting instances
- Keeping an instance current: from the framework checkout, `npm run doctor -- sync --dir ../harbor-bakery-os --dry-run` prints the plan; without `--dry-run` it snapshots tracked files (not untracked ones), overlays framework-owned files, migrates, regenerates schemas and writes a receipt under `memory/reports/`.

Issues and questions: <https://github.com/regen-coordination/org-os-template/issues>
