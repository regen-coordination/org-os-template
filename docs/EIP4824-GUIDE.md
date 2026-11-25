# EIP-4824

EIP-4824 (Common Interfaces for DAOs) defines a `daoURI`: a URL that resolves to a JSON-LD document describing an organisation and linking to registries of its members, proposals, activity and contracts. org-os generates that document, the registries it links to, and the DAOIP-5 and DAOIP-3 files, from the public part of the instance's records. This page covers what is generated, from what, how to check it, and how to publish it. Status: off-chain generation and validation are built; on-chain registration is not (see [On-chain](#on-chain)).

## What gets generated

```bash
npm run generate:schemas    # federation.yaml, data/*.yaml, content/ → .well-known/; public records only
npm run validate:schemas    # parse checks, schema check and leak scan, see below
```

`generate:schemas` runs [`scripts/generate-all-schemas.mjs`](../scripts/generate-all-schemas.mjs), which loads the builder in `packages/admin/lib/standards/`. Three rules come first:

- **Nothing without a `daoURI`.** Every id in the files is built from `identity.daoURI` in `federation.yaml`, so with no `daoURI` the command writes nothing, names each file an earlier generator left in `.well-known/` ("not refreshed … not removed") and exits 0. This repository leaves `daoURI` empty, so here it writes nothing; its committed `.well-known/*.json` predate this builder and are no longer refreshed. Its `dao.json` was written by hand; its URLs point at the raw files in the `regen-coordination/org-os-template` repository (the governance URL at `data/governance.yaml`), not at a site. A `daoURI` that is not an `https` URL stops every write (exit 1).
- **Public only.** The builder reads the records through one projection (`projectPublic` in `project.mjs`), which keeps only what `data/visibility.yaml` makes public. A collection that file does not list is visible to members only (`DEFAULT_LEVEL` in `lib/visibility.mjs`), so an instance with no `visibility.yaml` publishes no records. What is withheld is counted on the console (`withheld: …`), never written. Members' `email` and `handles` are never public. See [Data model](DATA-MODEL.md), `visibility.yaml`.
- **The leak scan.** Before writing, `checkNoLeak` looks through every built file for any withheld value of six characters or more. One hit, and nothing is written (exit 1).

The framework runs the builder with its schema check (`index.mjs`, which needs `ajv`: `npm ci --prefix packages/admin`). An instance does not receive `packages/admin`; `clone:framework` and the instance doctor's sync copy the builder's pure core (every module of `lib/standards/` except `index.mjs` and `validate.mjs`, plus the modules those import) into the instance's `scripts/lib/` ([`scripts/lib/standards-vendor.mjs`](../scripts/lib/standards-vendor.mjs)). The instance's `generate:schemas` then writes the same files, without the schema check. Neither copy found: exit 2.

The files, in the order the builder writes them (`STANDARD_FILES` in `build.mjs`):

| File | Standard | Built from (public records only) |
|---|---|---|
| `dao.json` | EIP-4824 | `federation.yaml` `identity` (see below) |
| `members.json` | EIP-4824 | `data/members.yaml`: active `person` and `organization` members, each as `{ id }` only; an id without a scheme becomes `https://<host>/members/<id>` |
| `proposals.json` | EIP-4824 | the proposals ledger `data/proposals.yaml`, plus the `decisions` of `data/governance.yaml` not already folded into a proposal; a restricted one is published as "A change to a restricted collection". A decision's `by` and `summary` are never published |
| `activities.json` | EIP-4824 | the events of each published proposal (opened, approve, object, vote, ratify and the rest; not comments) |
| `contracts.json` | EIP-4824 | each public on-chain System in `data/systems.yaml` (`safe`, `hats-tree`, `gardens-community`, `gardens-pool`, `daouri-registration`) with a chain and an address, as a CAIP-10 id. With none, it falls back, with a warning, to `identity.safe` / `identity.gardens`, else `governance.yaml` `infrastructure`; and to `identity.onchain_registration` for the registration contract |
| `governance.md` | EIP-4824 `governanceURI` | `data/governance.yaml`: its `description` and one line per rule; "How … decides is not public." when the document is not public |
| `grant-pools.json` | DAOIP-5 | each public `gardens-pool` System, and any public System with a `grant_pool` block (`grant_pool: false` opts out); absent when there is none |
| `applications.json` | DAOIP-5 | a Gardens pool's proposals, from a live read. Only the admin's live copy has reads, so `generate:schemas` never writes it (and removes one it finds) |
| `attestation-issuers.json` | DAOIP-3 | `identity.attestation_issuers` (`name`, `issuer`); absent when there is none |
| `meetings.json`, `projects.json` | org-os | `data/meetings.yaml`, `data/projects.yaml`, plus `content/meetings/*.md` and `content/projects/*.md` with an `id` in their front matter; people appear only as public member ids |
| `finances.json`, `ideas.json`, `knowledge.json` | org-os | `data/finances.yaml` (`budgets`, `expenses`, `revenues`); `data/ideas.yaml`; `data/knowledge-manifest.yaml` and `data/sources.yaml` |
| `federation.json` | org-os | `federation.yaml`: the instance's networks, its public peers and its join terms (below). Written whenever the others are |

The command writes the files built and removes any of these fifteen it did not build (a pool that is gone, for example). It touches nothing else in `.well-known/`. A separate command, `npm run generate:skills`, writes `.well-known/skills.json`; it is not part of the standards.

`*.json.template` files sit in the same directory. Only `clone:framework` (and the older `setup` script) read one, `dao.json.template`, to render a new instance's first `dao.json` from its config; the builder does not use them. The clone strips the framework's generated `.json` files, so a new instance publishes nothing more until it sets a `daoURI` (see [Setup](SETUP.md)).

## federation.json

Since 0.7.4 (`packages/admin/lib/standards/federation.mjs`, `spec: "org-os/federation/1"`): this instance's own public claims about its networks, its peers and how others join. It holds `name`, `type`, `scope`, `daoURI` and the org's atproto `did` when `federation.yaml` sets them; `networks` (`name`, `hub`, `role`); `peers` (`name`, `url`, `type`, `trust`, `did`); and `join` (`policy`, `types`, `asks`, `where`) when there is one.

- A peer is published only when its `url` is a public `https:` address and it is not `visibility: private`. Every other peer is counted on the console, never named.
- A network's `hub` and the `join.where` are published only as a public `https:` address (`github.com/<owner>/<repo>` written without `https://` counts as one); anything else, such as a local path, is left out, and `validate:schemas` warns.
- A peer's `repo`, `relationship`, `since`, `decision`, notes and contacts never appear. They are added to the leak scan's list, so a built file that held one would stop the write.
- `dao.json` does not link to it. A hub's launcher and the admin app's **Look it up** read it to see how the hub takes requests: from `https://<host>/.well-known/federation.json`, or, for a hub given as `https://github.com/<owner>/<repo>`, from that repository's raw file at `HEAD` (`wellKnownUrlOf` in `packages/admin/server/federation/remote.ts`) (see [Federation: Joining a network](FEDERATION.md#joining-a-network)).

## dao.json

Built by `daoDoc` in `dao.mjs`, not from the template. The fields, all of them:

| Field | Value |
|---|---|
| `@context` | `http://www.daostar.org/schemas` (the other EIP-4824 files use `https://`) |
| `type` | from `identity.type`: `DAO` and `Foundation` stay, `PersonalNode` is `Person`, `Other` is `Entity`, anything else `Organization` |
| `name`, `description` | `identity.name`; `identity.short_description`, else `identity.description` (left out if neither) |
| `membersURI`, `proposalsURI`, `activityLogURI`, `governanceURI`, `contractsURI` | `https://<host>/.well-known/<file>`, where `<host>` is the origin of `identity.daoURI`; `governanceURI` points to `governance.md` |
| `grantPoolsURI`, `attestationIssuersURI` | only when that file was built |
| `meetingsURI`, `financesURI` | org-os extensions |
| `x-org-os` | `{ "generator": "org-os standards (L8)" }`: the mark the instance doctor reads to tell this builder's output from an earlier generator's |

There is no `projectsURI`, `ideasURI` or `knowledgeURI`; those files are published but not linked from `dao.json`.

## Validation

`npm run validate:schemas` runs [`scripts/validate-identity.mjs`](../scripts/validate-identity.mjs). For `.well-known/` it checks that `dao.json`, `members.json`, `projects.json`, `finances.json`, `activities.json`, `proposals.json` and `contracts.json` exist (a missing one is a warning) and parse, and that `dao.json` has `@context` and `name`. When `identity.daoURI` is set it then:

- checks the published files against their JSON Schemas (`validate.mjs`, schemas in `packages/admin/schemas/standards/`: the five EIP-4824 JSON files, the two DAOIP-5 files and the DAOIP-3 file; `governance.md` and the org-os extras have none). A problem is a warning, an error under `--strict`;
- reads the instance's records and scans every `.well-known/*.json` and `*.md` for a value they withhold. A leak always fails.

In an instance the vendored copy has no `ajv`, so only the leak scan runs, and `--strict` cannot pass there. Run the framework's validator against the instance instead: `node scripts/validate-identity.mjs <instance dir> --strict` from the framework checkout. Nothing fetches a URI to see whether it is reachable or resolves the JSON-LD context. `npm run validate:structure` requires `.well-known/dao.json`, `members.json` and `projects.json` only when a `daoURI` is set, and parses every `.well-known/*.json`. The same `validate:schemas` run also checks `IDENTITY.md` against `federation.yaml` and the lineage stamp (see [Federation](FEDERATION.md)).

## Publishing (off-chain)

The files only need to be served over HTTPS at the URLs in `dao.json`. The steps:

1. Set `identity.daoURI` in `federation.yaml` to the `https` URL where `dao.json` will be served (for example `https://example.org/.well-known/dao.json`).
2. Say what is public in `data/visibility.yaml`.
3. `npm run generate:schemas`, then `npm run validate:schemas` (in an instance, run the framework's validator against it for the schema check).
4. Commit `.well-known/` and push; serving it is yours to arrange.

`.github/workflows/generate-schemas.yml` also runs the generator and commits `.well-known/` on any push touching `data/`, `content/meetings/`, `content/projects/` or `federation.yaml`, daily, and on manual dispatch. In the framework it installs `packages/admin`'s dependencies first, for the schema check; in an instance, which has no `packages/admin`, it skips that step. The admin app does not regenerate `.well-known/` after a change; it serves a members' preview of the live copy, with its reads, at `GET /api/standards` (`packages/admin/server/standards/routes.ts`; see [Admin app](ADMIN-APP.md)). The public org-os site does not publish this repository's `.well-known/`: the generator builds every address from the `daoURI`'s origin, and the site is served under a sub-path, so it could not make those files true there.

## On-chain

Registration is not built. Nothing in the repository signs or sends a transaction, deploys a registration contract or calls one to register a `daoURI`. What exists is reading: a `daouri-registration` System (or, as a fallback, `identity.onchain_registration.contract_address`) is listed in `contracts.json`, and the admin's driver for it (`packages/admin/server/systems/registration.ts`) makes one `eth_call` to `daoURI()`; when that read names another `daoURI` than the identity's, the live copy warns. `identity.hats` is not read; a Hats tree is published from a `hats-tree` System. The admin also reads Snapshot spaces through Snapshot's public GraphQL hub, read-only, and the live copy lists their proposals in `proposals.json`. No code talks to the DAOstar indexer or Tally: whether those tools read your files is a property of the files following the standard, not of any integration.

## Related

- [Federation](FEDERATION.md): the manifest, the lineage stamp, the other `.well-known` files and who reads them.
- [Data model](DATA-MODEL.md): the `data/*.yaml` registries the generator reads, `systems.yaml` and `visibility.yaml`.
- The standard: https://eips.ethereum.org/EIPS/eip-4824
