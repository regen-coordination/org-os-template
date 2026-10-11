# Ecosystem

The projects and repositories around org-os, in three groups: org-os instances, related projects, and external systems. Everything here comes from files in this repository: `federation.yaml`, `data/instances.yaml`, `data/ecosystems.yaml` and `repos.manifest.json`. Those files are the source; this page is a reading of them.

Honest scope: every org-os instance listed below is run by the maintainer. There is no independent organisation running an instance yet. "Ecosystem" describes the maintainer's own network of repositories and the communities they serve, not a field of adopters.

Addresses: a public `https://` link appears only where this repository records one under an organisation's account. Some instance repositories have no address given here, either because none is recorded or because it is not published on this page. Names written in code type are recorded in this repository but are not linked: the address was not published, or it did not answer when it was tried.

## Framework repositories

The repository records several names for the framework and its template, and they disagree. `federation.yaml` names this repository's hub as `regen-coordination/org-os-template` (the git remote matches); `package.json` names `organizational-os/organizational-os-template`; `repos.manifest.json` lists [org-os-framework](https://github.com/regen-coordination/org-os-framework) and [org-os-template](https://github.com/regen-coordination/org-os-template); the `federation.yaml` peers list `organizational-os-framework` and `organizational-os`, both with `trust: full`. Which of these is canonical is not settled in the repository.

## Org-os instances

An instance is a repository that carries its own identity files, `data/`, `memory/` and `federation.yaml`, and is registered in `data/instances.yaml` (maintained by `npm run analyze:instances`; see [FEDERATION.md](FEDERATION.md)). The registry's maturity values are `alpha`, `beta` and `production`; they are the maintainer's own judgement.

| Instance | Type | Maturity | Notes |
|---|---|---|---|
| refi-bcn-os (ReFi Barcelona) | LocalNode | production | Cooperative in formation. |
| refi-dao-os (ReFi DAO) | DAO | production | The registry gives it `federation_role: hub` in the `regen-coordination` network. |
| [regen-coordination-os](https://github.com/regen-coordination/regen-coordination-os) (Regen Coordination) | Hub | beta | Hub of the `regen-coordination` network. |
| [refi-med-os](https://github.com/ReFiDAO/refi-med-os) (ReFi Mediterranean) | LocalNode | alpha | Scaffolded from the framework; its bootstrap is not finished (identity, members and projects are placeholder stubs). |
| [regen-toolkit](https://github.com/regen-coordination/regen-toolkit) (Regen Web3 Toolkit) | Project | beta | A nested instance with its own remote. Registered in `data/instances.yaml` as assess-only. |
| bread-coop-os | Cooperative | alpha | A fictional acceptance-test instance for `clone:framework`. No remote. |

`dao-os` is listed in the registry and in `federation.yaml` as a downstream entry. The registry gives it type `Project`, maturity `beta` and `federation_role: dev-platform`, so it is not counted as an operational instance (an instance counts as operational only at maturity `production`). It is where the DAO skills are developed, and the source of the DAO skills that are candidates for promotion into the framework ([SKILL-PROMOTION.md](SKILL-PROMOTION.md)).

## Related projects

Repositories in the same network that are not themselves org-os instances. `repos.manifest.json` lists the ones that `npm run clone:repos` fetches into `repos/`; the repository records no description of them beyond the names below.

| Project | Where it is recorded |
|---|---|
| [Regenerant-Catalunya](https://github.com/refibcn/Regenerant-Catalunya) | `repos.manifest.json` |
| [ReFi-BCN-Website](https://github.com/refibcn/ReFi-BCN-Website) | `repos.manifest.json` |
| `Local-ReFi-Toolkit` | `repos.manifest.json` |
| ReFi-Mediterranean | `data/instances.yaml`: the public website and knowledge base of the Mediterranean node, mounted at `repos/refi-mediterranean/`. |
| grants-os | `federation.yaml`, `integrations.grants`, role `grants-platform`. |
| `quartz-refi-template` | `federation.yaml`, `integrations.publishing`, role `documentation-site`. |

## External systems

Systems org-os talks to or builds on that are not org-os instances, from `federation.yaml` `integrations`, `data/instances.yaml` and `data/ecosystems.yaml`.

| System | Role |
|---|---|
| `openclaw-source` | The primary agent runtime named in `federation.yaml` (`openclaw` appears in the instance registry as an `AgentRuntime` with no repository recorded and no federation manifest). |
| `regen_eliza-refi_dao` | An alternative, ElizaOS-based agent runtime. |
| `koi-net` and `koi-net-integration` | The KOI-net sync protocol and its TypeScript bridge, as named in `federation.yaml`. This repository carries its own client package, `packages/koi-bridge`; whether any instance runs it live was not verified. |
| OPAL | Transcript-to-schema extraction; its code lives in this repository under `integrations/opal/`. |
| [Regen Commons](https://github.com/regen-coordination) | An ecosystem node on the federation map (`data/ecosystems.yaml`): the `regen-coordination` GitHub organisation. |
| [ReFi Network](https://refidao.com) | An ecosystem node on the federation map. |
| [Agent-native standards](https://agentsmd.com) | An ecosystem node on the federation map: the `AGENTS.md` convention org-os follows. |

## How the pieces relate

- The framework (this repository) is the upstream. Instances are cloned from it with `npm run clone:framework` and stamped with a lineage; see [SETUP.md](SETUP.md).
- Instances declare peers, upstream and downstream in their own `federation.yaml`. Relationships are recorded in files; there is no running service connecting them.
- `npm run analyze:instances` reads the registry and reports drift. Entries with `local_path` values describe where the maintainer keeps sibling clones and are only meaningful on the maintainer's machine.
