# Idea hatching

## Overview

An org-os instance keeps a registry of ideas, `data/ideas.yaml`, and an agent skill that
fills it from the instance's knowledge. An idea moves through a fixed list of statuses; the
last working step, turning an approved idea into its own repository, is done by hand.

What exists today:

- `data/ideas.yaml` — the registry (a new instance starts with `ideas: []`).
- The `idea-scout` skill (`skills/idea-scout/SKILL.md`) — scans `knowledge/` for gaps and
  writes `surfaced` entries.
- The status vocabulary, which `npm run initialize` shows as an "Ideas" pipeline on the
  dashboard (counts per status).
- `.well-known/ideas.json`, which `npm run generate:schemas` writes with the ideas
  `data/visibility.yaml` makes public (`extraDocs` in `packages/admin/lib/standards/extras.mjs`).
  Ideas are members-only unless that file says otherwise, so by default the list is empty, and
  without `identity.daoURI` nothing is written. See [EIP4824-GUIDE.md](EIP4824-GUIDE.md).

What does not exist: a web app for submitting or voting on ideas, a script that hatches a
repository, or any code that reads `votes`, `comments` or `compensation`. `docs/MODULES.md`
lists the wider ideation system (`org-os-ideas`) as `planned`.

## The pipeline

```
knowledge/  ──(idea-scout)──▶  data/ideas.yaml  ──(review, by people)──▶  a new repo
                                 surfaced → proposed → approved → developing → hatched → archived
```

## Stage 1: knowledge → idea

The `knowledge-curator` skill turns external content (posts, podcasts, meetings, documents)
into pages under `knowledge/`. The `idea-scout` skill then reads
`data/knowledge-manifest.yaml`, `data/ideas.yaml`, `data/projects.yaml`,
`data/relationships.yaml` and the pages in `knowledge/`, and looks for:

- ecosystem gaps ("there is no...", "missing...", "need for...")
- themes repeated across sources
- problems described without a solution
- emerging patterns no project addresses
- cross-domain opportunities

It checks each candidate against existing ideas and projects for duplicates, then appends an
entry with `status: "surfaced"` and `submitted_by: "agent"` to `data/ideas.yaml`. It also writes a
detail page, `docs/ideas/<slug>.md` (the skill's header lists `docs/docs/ideas/`, but its
procedure and template use `docs/ideas/`), and logs the session in `memory/YYYY-MM-DD.md`.
You trigger it by asking ("scout ideas", "find ecosystem gaps"), usually after processing a batch
of new content.

People can add an entry to `data/ideas.yaml` by hand or by asking an agent; there is no other
submission channel in the repository.

## Stage 2: status lifecycle

| Status | Who | Meaning |
|--------|-----|---------|
| `surfaced` | Agent | Detected from knowledge analysis. Needs human review. |
| `proposed` | Community member | Formally proposed with champion(s). Open for discussion. |
| `approved` | Council or community | Approved for development; resources allocated. |
| `developing` | Developers | Active development, possibly a prototype. |
| `hatched` | Operator or agent | Spawned as an independent repo with an org-os workspace. |
| `archived` | Anyone | Completed, abandoned or superseded. |

Nothing enforces the transitions or who may make them; they are a convention. The dashboard
pipeline shows the first five statuses (`archived` entries are not drawn as a stage).

### The entry

The fields `idea-scout` writes. `hatched_repo`, `resources`, `compensation`, `votes` and `comments` are optional fields from the skill's template; no entry in this framework's `data/ideas.yaml` carries them yet, and no code reads them:

```yaml
ideas:
  - id: "idea-042"
    title: "Carbon Credit Verification Toolkit"
    status: "developing"        # surfaced | proposed | approved | developing | hatched | archived
    source: "knowledge/carbon-markets/verification-gaps.md"
    submitted_by: "agent"       # "agent" or a member id
    champions: ["luiz", "monty"]
    ecosystem_gap: "No open-source MRV tools for small-scale projects"
    description: "Build an open-source toolkit for MRV at small scale"
    hatched_repo: null          # fill in when hatched
    skills_needed: ["smart-contracts", "data-science"]
    resources: []
    compensation: { model: null, pool: null }   # idea-scout writes it; no code reads it
    created: "2026-03-15"
    updated: "2026-03-15"
    votes: 0                    # idea-scout writes it; no code reads it
    comments: []
```

The entries in this framework's own `data/ideas.yaml` use only the other fields. The ids there
look like `idea-001-hatching-pipeline`, so the `idea-NNN` id is a convention, not a format.

## Stage 3: hatching, by hand

When an idea is `approved` and someone has capacity to build it, the steps are manual:

1. Create the new instance with `npm run clone:framework -- --target <dir> --config <config.yaml>`
   (see [SETUP.md](SETUP.md)). It generates the identity files, an empty `data/`, and a
   `federation.yaml` with a lineage stamp.
2. Copy over the `knowledge/` pages from the parent that the project needs.
3. Write the project's `IDENTITY.md`, `SOUL.md` and `MASTERPLAN.md` from the idea's description.
4. Link the two instances in their `federation.yaml` files (the parent lists the new repo under
   `downstream`, the new one lists the parent under `upstream`; see [FEDERATION.md](FEDERATION.md)).
5. Set `hatched_repo` and `status: hatched` on the idea in the parent's `data/ideas.yaml`.

None of steps 2–5 is scripted. A `hatched_from` key on a downstream entry would be only a note;
no code reads it.

## Compensation

`compensation.model` (`bounty`, `retroactive`, `grants`, `equity` or `null`) and
`compensation.pool` are free-text fields for recording intent. Nothing in the framework pays,
tracks or validates them. `data/funding-opportunities.yaml` and `data/finances.yaml` are separate
registries; an idea can mention them but no field links them.
