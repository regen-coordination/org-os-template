# Connectors

A **connector** is a source driver for one external protocol. It presents itself as a
`source-system` peer (`describe`), fetches foreign records since an opaque cursor (`pull`),
and translates each record into framework KB candidates (`map`). Connectors feed the
framework's `ingest → store → review` pipeline — they do not replace storage or federation.

## Composing a knowledge base

Declare connectors in your instance's `kms.yaml`:

```yaml
connectors:
  - name: github
    config:
      repos: ["ORG/repo-a", "ORG/repo-b"]
      include: [issues, releases]
    cursor: null            # written back after each pull (incremental)
  - name: koi
    config:
      coordinator: "https://regen.gaiaai.xyz/api/koi"
      rid_scope: "rid:orgos:org:your-org"
    cursor: null
```

`ingest.pull` runs on `/close` (first, so pulled objects are reviewed the same session and
bridged only after review). Or run it manually:

```bash
node src/cli.mjs ingest --connector github     # one connector
node src/cli.mjs ingest                         # all declared connectors
```

## Contract

| method | purpose |
|---|---|
| `describe(config)` | this source AS a `source-system` card (identity/peer) |
| `pull(config, {cursor})` | fetch records since cursor → `{ records, cursor }` (network; may be async) |
| `map(record, config)` | PURE: one record → `[{ schema, object }]` KB candidates |
| `capabilities` | `{ ingest, subscribe, publish }` — only `ingest` is built today |

Cursors are connector-opaque tokens — the orchestrator stores and replays them, never inspects.
All KB candidates are stamped `maturity: raw` and pass `csis-review` before becoming canonical.
Outbound (`publish`) is draft-and-present only.

## Status

| connector | status | notes |
|---|---|---|
| `github` | active | issues → signal, releases → resource (via `gh` CLI) |
| `koi` | active | GET /rids corpus inventory → resource; bounded + paginated; FORGET → review signal |
| `geo` | stub | read side of the Geo graph; spec in `src/connectors/geo.mjs` |
| `radicle` | stub | p2p-git COBs; spec in `src/connectors/radicle.mjs` |
| `atproto` | stub | Bluesky lexicon records; spec in `src/connectors/atproto.mjs` |
| `synthefy` | stub | OPEN — needs protocol docs; spec in `src/connectors/synthefy.mjs` |

Stubs are registered and discoverable; their `pull` throws `NOT_IMPLEMENTED` and the docstring
is the implementation spec. Building one = fill in `pull`/`map`, flip status to active.

## Known limitations (follow-ons)

- **GitHub incremental pull** uses a bounded window (issues 500, releases 200) with a server-side
  `updated:>=` date filter. Repos with more changed items than the window between pulls may miss the
  tail; a saturation warning is emitted when a window fills. Full server-side pagination is a follow-on.
- **KOI** pulls the paginated `/rids` corpus inventory (bounded by `max_records`, default 200 of
  30k+ upstream RIDs; filter with `contexts`). The deployed node exposes no event stream, so
  `subscribe` remains unavailable there; the `FORGET → review signal` path is kept for KOI-net
  coordinators that do. Many RIDs are `#chunkN` fragments — chunk consolidation is a follow-on.
- `subscribe` (live events) and `publish` (contribute-back) are declared but not implemented.
