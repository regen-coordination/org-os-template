# Packages

A package is a directory under `packages/` holding code, templates or an app that an instance can carry. The framework repository has 22 of them. They are vendored: an instance gets a copy of the ones it enables, and the copy is its own to run. This page lists what is there, what each is, and how an instance gets one. Statuses come from `data/packages-matrix.yaml`; how they change is in [Package lifecycle](PACKAGE-LIFECYCLE.md).

Packages are not the same as modules. A module (`modules/<id>/module.yaml`) is a manifest that switches a capability on and may point at a package; see [Modules](MODULES.md). Five modules exist. `org-os-buzz`, `org-os-paper`, `org-os-cloudflare-os` and `org-os-instance-doctor` each point at the package of the matching name; `org-os-berd` points at none.

An earlier version of this page described a package registry of eight conceptual packages (`knowledge_base`, `meetings`, `projects`, `finances`, `coordination`, `webapps`, `web3`, `egregore`) enabled through `npm run setup`, with a `package.yaml` per package, `npm run check:updates` and `npm run update:package`. `check:updates` and `update:package(s)` do not exist, there is no `package.yaml` anywhere under `packages/`, and `web3`, `finances` and `coordination` have no directory in this repository. That text was removed. One part of it is still live: `npm run setup` (`scripts/setup-org-os.mjs`) offers `meetings`, `projects`, `finances`, `coordination`, `webapps` and `web3` and writes them into `federation.yaml` under `packages:`. Those keys do not match directory names (only `webapps` does), so a map written by `setup` is rejected by `sync:packages`. The clone is the supported route.

## How an instance gets a package

- **At clone time.** `npm run clone:framework` copies the framework and deletes every `packages/<id>/` that the clone config does not set to `true`. This is the supported route for a new instance; the fork-and-`npm run setup` route does not work for a newcomer (see [Setup paths](SETUP-PATHS.md) and the clean-room finding in `README.md`). The same stage copies one part of a package that is not enabled: the pure core of `packages/admin/lib/standards/` and the modules it imports go into the instance's `scripts/lib/`, so its `npm run generate:schemas` works without the admin package (`scripts/lib/standards-vendor.mjs`; the instance doctor's `inject-machinery` stage does the same on sync).
- **Later.** Set `<id>: true` under `packages:` in the instance's `federation.yaml`, then run `npm run sync:packages` (copies from the framework; `--dry` previews, `--prune` removes packages that are not enabled). The key must be a real directory name under the framework's `packages/`. The `packages:` map in this repository's `federation.yaml` has `knowledge_base: true` and `meetings`, `projects`, `finances`, `coordination`, `webapps`, `web3` and `egregore` set to `false`. `knowledge_base` is not a directory under `packages/`, so `npm run sync:packages` run against this file exits with `Package "knowledge_base" enabled but not in framework`; of the other keys only `webapps` matches a directory, and setting `meetings`, `projects`, `finances`, `coordination`, `web3` or `egregore` to `true` fails the same way (confirmed against a scratch directory with `--enabled`). For the meetings and projects templates the id would be `operations`.

## The 23 packages

Lifecycle and promotion are the matrix values; "no entry" means the directory is not in `data/packages-matrix.yaml`.

### Knowledge system

| Package | Lifecycle / promotion | What it is |
|---|---|---|
| `org-os-kms` | active / canonical | `@org-os/kms`: binds the toolkit framework into org-os as a module and a default profile. Lifecycle, registry bridge, CLI, rendering, federation, map builder. [README](../packages/org-os-kms/README.md). |
| `toolkit-framework` | active / canonical | `@regen-commons/toolkit-framework`: the portable, org-os-agnostic knowledge-commons framework (semantic kernel, schemas, skills, adapters) that `org-os-kms` consumes. [README](../packages/toolkit-framework/README.md). |
| `org-os-needs-offers` | no entry | `@org-os/needs-offers`: a kms extension pack (needs kms >= 0.2.0, since 0.7.4) adding `need` and `offer` types, each with a required `visibility` (`private`, `matching-only` or `public`); only `public` is ever published. Its field list and shared lexicon are placeholders. [README](../packages/org-os-needs-offers/README.md). |
| `org-os-territory` | dormant / evaluating | `@org-os/territory`: a kms extension pack adding `territorial-unit` and `data-stream` object types. No instance has adopted it. [README](../packages/org-os-territory/README.md). |
| `org-os-federation-map` | active / canonical | `@org-os/federation-map`: a `<federation-map>` web component that draws the map JSON produced by `org-os-kms` `render map`. [README](../packages/org-os-federation-map/README.md). |

### Instance tooling

| Package | Lifecycle / promotion | What it is |
|---|---|---|
| `instance-doctor` | active / canonical | `@org-os/instance-doctor`: assesses an instance and syncs it from the framework. Run as `npm run doctor`. [README](../packages/instance-doctor/README.md). |
| `admin` | no entry | `@org-os/admin`: the local platform for an instance since 0.6 (records, the rules that decide changes, proposals, boards, outside systems, optional Sign-in with Ethereum); 0.6.1 added hosting it as a members' Hub, 0.7 the workspace and compose and deploy. Run from the framework checkout as `npm run admin -- --repo <instance>`; binds `127.0.0.1` locally. Its `lib/standards/` is the `.well-known/` builder. See [Admin app](ADMIN-APP.md). |
| `dashboard` | planned / candidate | Static HTML organisational-health dashboard built from `scripts/initialize.mjs` output (`npm run generate:dashboard`). The matrix lists it as instance-owned and not yet promoted, though the directory is here; its README still carries a template placeholder and names one organisation. [README](../packages/dashboard/README.md). |
| `operations` | active / canonical | Templates and scripts for meetings (`operations/meetings`) and projects (`operations/projects`, an Integrate, Develop, Execute, Archive framework). No `package.json`. |
| `webapps` | active / canonical | Holds one page, `task-manager/` (`index.html`, `script.js`, `style.css`, `SPEC.md`): a small task viewer. No `package.json`. |

### Agents

| Package | Lifecycle / promotion | What it is |
|---|---|---|
| `agents-app` | dormant / canonical | `@org-os/agents-app`: Paperclip-based dashboard for operating agents over an org-os filesystem. [README](../packages/agents-app/README.md). |
| `paperclip-agents-app` | dormant / canonical | `@org-os/paperclip-agents-app`: Paperclip as the agents application across instances. The matrix records that one instance's fork is ahead of this copy and a backport review is pending. [README](../packages/paperclip-agents-app/README.md). |
| `regen-agents` | active / canonical | `@org-os/regen-agents`: four specialist agents for regenerative coordination (agriculture, commons governance, impact measurement, bioregional intelligence). [README](../packages/regen-agents/README.md). |
| `multica-bridge` | no entry | `@org-os/multica-bridge`: an operator persona for the multica agent platform (phase 1, present) and a yaml-to-multica sync (phase 2, planned, not built). [README](../packages/multica-bridge/README.md). |
| `egregore-core` | dormant / canonical | No upstream code: a README and an OpenCode adapter script (`opencode-adapter/`) for the Egregore shared-memory tool from Curve Labs. The upstream tool is not vendored here. [README](../packages/egregore-core/README.md). |

### Host and tool integrations

| Package | Lifecycle / promotion | What it is |
|---|---|---|
| `hermes-integration` | active / evaluating | Skill and Python tool that expose `org_os_page` to Hermes sessions. [README](../packages/hermes-integration/README.md). |
| `opencode-integration` | active / evaluating | opencode plugin registering the `org_os_page` and `org_os_tui` tools and five slash-command templates. [README](../packages/opencode-integration/README.md). |
| `buzz-integration` | active / evaluating | Wrapper over the pinned `buzz` binary for a signed session-digest lane: `npm run buzz:post`, `buzz:read`, `buzz:doctor`. Verification record: [VERIFIED.md](../packages/buzz-integration/VERIFIED.md). No README, no `package.json`. |
| `paper-integration` | active / evaluating | Client for Paper Desktop's local MCP server plus a brand-token planner: `npm run paper:doctor`, `paper:push-tokens`, `paper:lint-tokens`, `paper:call`. Verification record: [VERIFIED.md](../packages/paper-integration/VERIFIED.md). No README, no `package.json`. |
| `cloudflare-os-integration` | no entry | `@org-os/cloudflare-os-integration`: the org-os side of the Cloudflare OS integration (gatekeeper core, storage drivers, page core, blueprints). Test: `npm run test:cloudflare-os-integration`. [README](../packages/cloudflare-os-integration/README.md). |

### Knowledge-network bridges

| Package | Lifecycle / promotion | What it is |
|---|---|---|
| `koi-bridge` | dormant / canonical | `@org-os/koi-bridge`: KOI-net bridge for distributed knowledge graphs. Its README describes it as a skeleton needing testing. [README](../packages/koi-bridge/README.md). |
| `koi-opal-bridge` | dormant / canonical | `@org-os/koi-opal-bridge`: bridge between OPAL knowledge gardens and KOI. [README](../packages/koi-opal-bridge/README.md). |
| `opal-bridge` | planned / canonical | Only `scripts/deploy-to-node.sh`; the matrix marks the rollout as planned. |

The lifecycle states are `active`, `dormant`, `planned` and `retired`. "Active" in the matrix header means used by at least one instance; several packages are marked active with no instance listed, so read it as "used or in active framework use"; it does not mean production-hardened. Today every instance is run by the maintainer.

## What a package contains

There is no required layout. Of the 22 directories, 16 have both a `package.json` and a `README.md`, `egregore-core` has only a README, and five have neither: `buzz-integration`, `paper-integration`, `opal-bridge`, `operations` (its READMEs are one level down) and `webapps`. There is no `package.yaml` manifest: a package is switched on by its key under `packages:` in `federation.yaml`, and a capability that needs more than copying (for example buzz or paper) also has a module manifest under `modules/`.

To add a package to the framework: create `packages/<id>/` with a README, add a row to `data/packages-matrix.yaml` (`owner`, `in_framework: true`, `promotion_status`, `lifecycle_status`), and run `npm run validate:structure`, which rejects an unknown `lifecycle_status`. Whether it reaches other instances is then up to each instance's `packages:` map.

## Troubleshooting

- **`Package "x" enabled but not in framework`**: `x` is not a directory name under `packages/`. Use one of the names above.
- **A package is present locally but you do not want it**: set it to `false` or remove it from `packages:`, then `npm run sync:packages -- --prune`.
