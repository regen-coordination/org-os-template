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
npm install --prefix packages/admin
```

The second install is for `packages/admin`, which has its own dependencies. The doctor (Step 5) runs `validate:data` and `validate:governance` from this checkout, and both load the admin's schemas and modules; without that install each is reported as `validator-did-not-run`. It is also what the [Admin app](ADMIN-APP.md) needs.

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

The stages it prints: copy the committed framework files, strip the framework-only registries and generated `.well-known/` files, reset the placeholder identity files from `templates/scaffold/`, materialise the packages and skills you chose, copy the standards generator (the pure core of `packages/admin/lib/standards/`, without its two ajv modules) into the instance's `scripts/lib/`, write `federation.yaml` with your identity and the lineage stamp, render `.well-known/dao.json` from your config, render `README.md`, `GETTING-STARTED.md`, `CLAUDE.md` and `AGENTS.md`, then `git init` and one initial commit.

## Step 4: Install and validate

```bash
cd ../harbor-bakery-os
npm install
npm run validate:schemas
npm run validate:structure
```

The clone ships `.well-known/` as `*.json.template` files plus the `dao.json` it rendered from your config, so it cannot publish the framework's identity as yours. A new instance publishes nothing more until you decide to:

- `federation.yaml` has no `identity.daoURI`, and `npm run generate:schemas` builds nothing without one, because every id it writes is built from it. On a fresh instance it says `nothing generated: identity.daoURI is not set` and warns that the rendered `dao.json` is not refreshed; that is expected. `validate:structure` requires `.well-known/dao.json`, `members.json` and `projects.json` only once a `daoURI` is set (`scripts/validate-structure.mjs`).
- To publish, set `identity.daoURI` to the `https` URL where `dao.json` will be served (see the [EIP-4824 guide](EIP4824-GUIDE.md)), and say what is public in `data/visibility.yaml`: a collection it does not list is `members`, so its records are not written (see [Data model](DATA-MODEL.md)). Then run `npm run generate:schemas` and commit what it wrote (the doctor otherwise reports `working-tree-dirty`). Re-run it after you change `data/*.yaml` or `federation.yaml`.

In an instance, `generate:schemas` runs the copy of the generator in `scripts/lib/standards/`, which has no schema check (no ajv). To check the published files against their schemas, run the framework's validator against the instance: `node scripts/validate-identity.mjs ../harbor-bakery-os` from the framework checkout.

## Step 5: Check it with the doctor

From the framework directory:

```bash
npm run doctor -- --dir ../harbor-bakery-os
```

A fresh instance should report **no blockers except `git-remote-absent`**, which is expected until you give it a repository. Warnings such as `never-synced`, `memory-absent` and `no-sync-receipts` are normal on day one. The doctor runs four validators from the framework checkout against the instance: `validate:structure`, `validate:schemas`, `validate:data` and `validate:governance` (`packages/instance-doctor/src/snapshot.mjs`); the last two report `validator-did-not-run` if you skipped the admin install in Step 1. Any other blocker is a framework bug.

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
- **`validate:structure` fails after you set a `daoURI`.** It now requires `.well-known/dao.json`, `members.json` and `projects.json`; run `npm run generate:schemas`.
- **Schema errors.** Check the YAML in `data/` is valid, then `npm run validate:schemas`.
- **Doctor reports a blocker other than `git-remote-absent`.** Run `npm run doctor -- --dir <instance> --json` and report it with the check code.

## Next steps

- [Operator guide](OPERATOR-GUIDE.md): the daily and weekly rhythm
- [Packages](PACKAGES.md): what each package adds
- [EIP-4824 guide](EIP4824-GUIDE.md): the published identity files
- [Federation](FEDERATION.md): connecting instances
- Keeping an instance current: from the framework checkout, `npm run doctor -- sync --dir ../harbor-bakery-os --dry-run` prints the plan; without `--dry-run` it snapshots tracked files (not untracked ones), copies in the sync machinery and the standards generator, overlays framework-owned files, runs the framework's migrations against the instance, regenerates schemas and writes a receipt under `memory/reports/`. When the instance has no `data/visibility.yaml` and its `.well-known/` holds files an earlier generator wrote, it also writes one declaring public what those files already publish, as a commit of its own for the organisation to confirm, edit or revert (`declare-visibility` in `packages/instance-doctor/src/run-sync.mjs`).

Issues and questions: <https://github.com/regen-coordination/org-os-template/issues>
