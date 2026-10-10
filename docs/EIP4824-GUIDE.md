# EIP-4824

EIP-4824 (Common Interfaces for DAOs) defines a `daoURI`: a URL that resolves to a JSON-LD document describing an organisation and linking to registries of its members, proposals, activity and contracts. org-os generates that document, and the registries it links to, from the instance's YAML data. This page covers what is generated, from what, how to check it, and how to publish it. Status: off-chain generation and validation are built; on-chain registration is not (see [On-chain](#on-chain)).

## What gets generated

```bash
npm run generate:schemas    # data/*.yaml, content/ → .well-known/*.json
npm run validate:schemas    # structural checks, see below
```

`generate:schemas` runs [`scripts/generate-all-schemas.mjs`](../scripts/generate-all-schemas.mjs). It writes ten files into `.well-known/`:

| File | `type` | Built from |
|---|---|---|
| `dao.json` | `identity.type` (e.g. `Project`, `DAO`) | `.well-known/dao.json.template` filled from `federation.yaml` `identity`; written only when `identity.daoURI` is set |
| `members.json` | `DAO` | `data/members.yaml`; only each member's `id` is published |
| `proposals.json` | `ProposalRegistry` | `data/governance.yaml` → `governance.decisions` (id, title, type, status, date, summary) |
| `activities.json` | `ActivityLog` | the last 20 entries of `data/meetings.yaml` |
| `contracts.json` | none | `identity.safe` and `identity.gardens` of `federation.yaml`, with `identity.chain`; empty otherwise |
| `meetings.json` | `MeetingRegistry` | `data/meetings.yaml` plus `content/meetings/*.md` that have an `id` in their front matter; checklist items become action items |
| `projects.json` | `ProjectRegistry` | `data/projects.yaml` plus `content/projects/*.md` that have an `id` |
| `finances.json` | `FinancialRegistry` | `data/finances.yaml` (`budgets`, `expenses`, `revenues`) |
| `ideas.json` | `IdeaRegistry` | `data/ideas.yaml` |
| `knowledge.json` | `KnowledgeManifest` | `data/knowledge-manifest.yaml` (`knowledge_manifest.domains`, `.exchange`) and `data/sources.yaml` |

A generator whose source file is absent skips its output and leaves any existing file alone (`meetings.json`, `projects.json`, `proposals.json`, `activities.json` and `contracts.json` are always written). A separate command, `npm run generate:skills`, writes `.well-known/skills.json`; it is not part of EIP-4824. Each registry file declares `"@context": "https://www.daostar.org/schemas"`; `dao.json` declares `http://www.daostar.org/schemas` (from its template).

`*.json.template` files in the same directory are what `clone:framework` and `setup` render. A new instance gets its own `dao.json` at clone time; the other generated files are stripped from the clone and come back on its first `npm run generate:schemas`.

## dao.json

The template renders these fields, and these are all of them:

```json
{
  "@context": "http://www.daostar.org/schemas",
  "type": "Organization",
  "name": "{{ORGANIZATION_NAME}}",
  "description": "{{ORGANIZATION_DESCRIPTION}}",
  "membersURI": "https://{{BASE_URL}}/.well-known/members.json",
  "proposalsURI": "https://{{BASE_URL}}/.well-known/proposals.json",
  "activityLogURI": "https://{{BASE_URL}}/.well-known/activities.json",
  "governanceURI": "https://{{BASE_URL}}/governance",
  "contractsURI": "https://{{BASE_URL}}/.well-known/contracts.json",
  "meetingsURI": "https://{{BASE_URL}}/.well-known/meetings.json",
  "projectsURI": "https://{{BASE_URL}}/.well-known/projects.json",
  "financesURI": "https://{{BASE_URL}}/.well-known/finances.json"
}
```

The first five URIs are the ones EIP-4824 names; `meetingsURI`, `projectsURI` and `financesURI` are org-os extensions. There is no `ideasURI` or `knowledgeURI`; those two files are published but not linked from `dao.json`. The generator replaces `type` with `identity.type`, the name with `identity.name`, the description with `identity.short_description` (or `identity.description`, or a generic sentence), and `BASE_URL` with the host of `identity.daoURI`. So the `daoURI` you set in `federation.yaml` decides every URL in the file, and `governanceURI` points to a page (`/governance`) that nothing in this repository generates.

If `identity.daoURI` is empty, `generate:schemas` prints a skip message and keeps the existing `dao.json`. This repository does exactly that: its `dao.json` is hand-written, with URLs on `organizational-os.github.io`.

## Validation

`npm run validate:schemas` runs [`scripts/validate-identity.mjs`](../scripts/validate-identity.mjs). For `.well-known/` it checks that `dao.json`, `members.json`, `projects.json`, `finances.json`, `activities.json`, `proposals.json` and `contracts.json` exist (a missing one is a warning) and parse as JSON, and that `dao.json` has `@context` and `name`. That is all it checks of the registries: it does not check the other required EIP-4824 URI fields, does not fetch any URI to see whether it is reachable, does not validate the JSON-LD context, and does not look at `meetings.json`, `ideas.json` or `knowledge.json`. `npm run validate:structure` additionally requires `.well-known/dao.json`, `members.json` and `projects.json` and parses every `.well-known/*.json`. The same command also checks `IDENTITY.md` against `federation.yaml` and the lineage stamp (see [Federation](FEDERATION.md)).

## Publishing (off-chain)

The files only need to be served over HTTPS at the URLs in `dao.json`. The steps:

1. Set `identity.daoURI` in `federation.yaml` to where `dao.json` will be served (for example `https://example.org/.well-known/dao.json`).
2. `npm run generate:schemas`, then `npm run validate:schemas`.
3. Commit `.well-known/` and push, so the host serves it.

`.github/workflows/generate-schemas.yml` also runs the generator and commits `.well-known/` on any push touching `data/`, `content/meetings/`, `content/projects/` or `federation.yaml`, and once a day. The public org-os site copies this repository's `.well-known/` into its build.

## On-chain

Not built. `federation.yaml` has `identity.onchain_registration` (`enabled`, `chain`, `contract_address`) and the fields `chain`, `safe`, `hats` and `gardens`, but no script reads `onchain_registration` or `hats`, and the repository contains no registration contract, no deployment script and no `packages/web3` directory (an earlier version of this page pointed there). `chain`, `safe` and `gardens` are used only to fill `contracts.json`. To register a `daoURI` on-chain you would use an EIP-4824 registration contract deployed and called outside this repository; nothing here does it or checks it. Likewise, no code in the repository talks to the DAOstar indexer, Snapshot or Tally: whether those tools read your files is a property of the files following the standard, not of any integration.

## Related

- [Federation](FEDERATION.md): the manifest, the lineage stamp, the other `.well-known` files and who reads them.
- [Data model](DATA-MODEL.md): the `data/*.yaml` registries the generator reads.
- The standard: https://eips.ethereum.org/EIPS/eip-4824
