# Publishing from the knowledge system

The `publish` verb of `@org-os/kms` (`packages/org-os-kms`) sends an instance's published knowledge objects to two places: the account's repository on an AT Protocol server (a PDS), and a static JSON surface. When the standard.site option is switched on, every entry that goes to the PDS is also written as a `site.standard.document`, with one `site.standard.publication` per commons, so that Bluesky and other standard.site readers can show it as long-form writing.

**Status.** The package is `in-dev` in [Modules](MODULES.md). The publication plane is tagged `kms-atproto-v0.1` (the earlier tags `kms-atproto-v0.1-rc1` and `-rc2` were release candidates). The `rc1` and `rc2` tag messages say the opt-in end-to-end test against a real PDS had not been run and that `kms-atproto-v0.1` was reserved until it passed; the `kms-atproto-v0.1` tag message does not say whether that run happened, and no live run is recorded anywhere in the repository. Treat the PDS writes as exercised by tests against a faked server, not as confirmed against a live one. standard.site support (`atproto.standard_site`) is newer than those tags.

Run by hand, from the instance directory:

```bash
node packages/org-os-kms/src/cli.mjs publish --dry     # read-only: plan, no ids minted, no files, no network
node packages/org-os-kms/src/cli.mjs publish           # plan mode (what `close` runs); writes ids and the static surface
node packages/org-os-kms/src/cli.mjs publish --apply   # writes to the PDS; needs credentials
```

The package also declares a `bin` (`org-os-kms`). `--dir <instance>` points the verb at another directory. The result is printed as JSON and the exit code is 1 when the report is `ok: false` (a failed login, a failed record, an invalid standard.site block, a refused mass delete, or a failed static surface).

**Set `publish.base_url` or `publish.static: false` before the first `--apply`.** The static surface is on unless `publish.static` is `false`, and it throws `publish.base_url is required for the static surface` when no `base_url` is set. That step runs last, after the PDS writes and the manifest save, so a PDS-only setup that leaves both out writes its records and then exits 1 with `static: { status: 'failed' }`. The order to configure things in: first `publish.base_url` (or `publish.static: false`), then the `atproto` block, then run `--dry`, then plan mode, then `--apply`.

Where a reader goes next: the two planes and the publication gate are in `docs/KMS-PLANES.md`, the overview in `docs/KMS.md`, extension packs in [Extension packs](KMS-EXTENSION-PACKS.md) and [the territory pack](TERRITORY-PACK.md) (the first two written in the same pass), and the connectors and ingest side is [the connector guide](../packages/org-os-kms/docs/CONNECTORS.md).

## What is implemented, and what needs credentials

| Part | State |
|---|---|
| Plan: which records would be created, updated, deleted or skipped | Implemented, needs no credentials and no network. |
| Static surface (`public/api/**`, `.well-known/knowledge.json`) | Implemented, local files only. On by default; needs `publish.base_url`, or set `publish.static: false`. Without either, the step fails and the run exits 1 (see above). |
| Writing records to the PDS | Implemented. Needs `--apply` (or `publish.apply: true`), `atproto.did`, `atproto.pds`, `atproto.nsid_authority`, and the environment variable `ATPROTO_APP_PASSWORD`. Tested against a fake server only (see Status). |
| standard.site documents | Implemented behind `atproto.standard_site.enabled: true`. Same credentials as the PDS writes. |
| The site HTML tags that point back at the documents | Not built. The manifest holds the AT-URIs; nothing in the package edits a site's HTML. |
| Publishing lexicon records (`com.atproto.lexicon.schema`) or any DNS record | Not built. The lexicons are generated in memory to validate records; none is sent anywhere. |
| Resolving a peer's own PDS, or reading from a relay | Not built. The `atproto` connector reads every peer from the one configured PDS. |

If `ATPROTO_APP_PASSWORD` is not set, the atproto part of the report says `not-configured` and nothing contacts a server. The password is read from `process.env` only; the package loads no `.env` file, so export it in the shell that runs the command. It is an app password for the account, not the account password, and the code replaces it with `***` in the login and network error it reports and in the standard.site apply error. Per-record failure messages (`failures[].error`) and the static-surface error are not scrubbed.

## What `publish` does, in order

1. Loads `kms.yaml` (`loadKmsConfig`). If the instance declares a plane (`planes:`), the plane rules run first: a canon never publishes (the verb returns `refused: canon` and points at `export`), and a public plane re-gates what it holds against its canon before anything else and is refused if it fails. See `docs/KMS-PLANES.md`.
2. Lists the objects in the instance's store and keeps those that pass the publication floor and the instance gate (below).
3. Mints an `id` (UUIDv4) into the source YAML for each object that passes (plus a `grc20Id` when `geo.space` is set), but only when something will consume it: a complete `atproto` target, or the static surface not switched off. `--dry` mints nothing on disk.
4. Plans the entry records (`planPublish`), then, if standard.site is on, plans the documents (`planStandardSite`).
5. In plan mode stops there and reports counts. With `--apply` and a password: logs in (`com.atproto.server.createSession`), writes entries, writes the publication and documents, and saves the manifest after each stage.
6. Writes the static surface, and, if a publication exists, the standard.site verification file.

`lifecycle close` ends with `publish` then `sync.push`, so `close` runs the plan mode. With `publish.apply: true` in `kms.yaml` the same step writes to the PDS, which is why that key should be set only deliberately. `sync.push` itself only reports that a git commit and push is a draft for you to run.

## What it refuses to publish

The floor is in the toolkit framework (`packages/toolkit-framework/src/publishable.mjs`); the instance can only narrow it.

- Only these types publish by default: `claim-evidence`, `concept-lineage`, `encyclopedia-entry`, `implementation-record`, `option-entry`, `organization`, `relationship-record`, `resource`, `signal`, `track`. `source-system`, `public-use-boundary` and the types of an extension pack join only through `publish.types_opt_in`. `person` is never publishable, and naming it in the lists is an error. `publish.types_opt_out` removes types.
- An object needs a `public_use` of `ok-with-caveat`, `source-linked-unreviewed`, `reviewed-for-explanation` or `reviewed-for-guidance`, and a `maturity` other than `held`. A `held` object that was published earlier is deleted from the PDS on the next apply.
- `publish.gate` names a module in the instance that exports `isPublishable(obj, ctx)`; an object it rejects is dropped and counted under `report.gate.by_reason`.
- Private fields never leave: `publicView()` drops `notes`, `work_order`, `reviewed_by`, `review_needs`, `interpretation`, `uncertainty`, `tensions`, `risks_of_flattening`, `high_risk`, `consent_note`, `salvaged_from`, `legacy_status`, `additional_provenance` and `provenance.surfaced_by`. The projection is applied to entry records, to the static surface, and before any standard.site document is built, so a document cannot carry them either.
- Validation is all-or-nothing: each record is checked against the lexicon generated from its schema, and if any record fails, the plan is `ok: false`, lists the errors and nothing is written.
- Mass delete: an apply whose selection is empty while the manifest still lists published records stops before login (`refusing to delete every published record`). That protects against an unattended `close` with a misconfigured gate or store path.
- A public plane that cannot find its canon will plan but will not apply (set `planes.regate: false` to publish from the plane alone).
- Compare-and-swap: updates send the stored `cid` as `swapRecord`, so a record changed elsewhere is not overwritten; that record fails and is reported, and the manifest keeps its previous entry.

## The records on the PDS

The `kms.yaml` keys the PDS side reads:

```yaml
atproto:
  did: did:plc:...                 # the account's DID (the repo written to)
  handle: example.org              # login identifier; falls back to the did
  pds: https://pds.example         # the server
  nsid_authority: xyz.example.kb   # prefix of every collection name
publish:
  apply: false                     # true: `publish` and `close` write to the PDS
  base_url: https://example.org    # required for the static surface
  static: true                     # false: no static surface
  static_dir: public               # relative path inside the instance
  gate: gate.mjs                   # optional instance gate
  types_opt_in: []                 # e.g. [source-system]
  types_opt_out: []
```

Each published object becomes one record:

- collection `<nsid_authority>.<camelCaseSchema>` (`encyclopedia-entry` gives `xyz.example.kb.encyclopediaEntry`);
- record key: the object's `id`;
- body: the projected object, with references to other entries by slug rewritten to their `at://` URIs when the slug resolves to exactly one published entry.

The client (`src/atproto/client.mjs`) is a plain `fetch` wrapper over XRPC with no SDK. It calls `createSession`, `repo.putRecord` (always `validate: false`, since the package validates for itself), `repo.deleteRecord`, `repo.listRecords` and `sync.getLatestCommit`.

The plan compares a SHA-256 of the record with the hash saved in the manifest: no entry in the manifest means create; same hash means skip; different hash means update; a manifest entry that is no longer selected means delete. Applying is per record, so one failure does not stop the others; failures appear in `report.atproto.failures`.

## standard.site documents

Switch on, in `kms.yaml`:

```yaml
atproto:
  standard_site:
    enabled: true
    title: Brasil Regenerativo          # required: the publication name (`name` also accepted)
    url: https://example.org            # required here or in publish.base_url
    description: ...                    # optional
    language: pt-BR                     # optional BCP-47; never assumed
    language_field: idioma              # optional object field that carries the tag; wins over language
    paths:                              # URL pattern per schema, must start with "/"
      default: /kb/{slug}               # placeholders: {slug} {id} {schema}
    tag_fields: [domain, function]      # default
    fields:                             # description/body fields for a schema not in the built-in map
      territorial-unit: { description: summary, body: [summary] }
    publication_rkey: <TID>             # adopt an existing publication record
    show_in_discover: true              # preferences.showInDiscover
```

Without the block, or with `enabled: false`, none of this code runs; a test checks that the report, PDS calls, manifest and static files are identical to a run that never had the block.

How the two kinds of record relate:

| Record | Collection | Record key | Role |
|---|---|---|---|
| the entry | `<nsid_authority>.<camelCaseSchema>` | the object `id` | The entry itself; what peers pull. Its shape is unchanged by standard.site. |
| its document | `site.standard.document` | a TID computed from the `id` | The readable rendering; points back at the entry and the publication. |
| the publication | `site.standard.publication` | a TID computed from the DID, or `publication_rkey` | One per commons. |

The standard.site lexicons require a TID as record key, so `tidFor` derives a syntactically valid one from a hash. It is stable across republishes; its embedded timestamp is not a real time.

A document carries `site` (the publication's AT-URI), `title`, `path` (the pattern with the slug filled in, percent-encoded), `description`, `textContent`, `tags`, `langs`, `publishedAt`, `updatedAt` and `content`. `content` is an open-union value of type `<nsid_authority>.entryRef` holding a reference (`uri` and `cid`) to the entry record, so a document is only written for an entry already on the PDS. `publishedAt` is kept across updates and `updatedAt` is set on later ones.

What text goes where is a fixed map (`FIELD_MAP` in `src/atproto/standard-site.mjs`) from each of seven schemas to a description field and body fields: for example `encyclopedia-entry` uses `summary` as description and `summary` plus `known_tensions` as body. Body fields are joined as plain paragraphs with no labels, because a label would have to be in some language. A schema outside the map, such as a pack type, gets a title-only document unless `standard_site.fields` maps it. Tags come from `domain` and `function`, with a leading `#` removed.

What it checks and withholds:

- The configuration: a title, an `http(s)` URL, path patterns that start with `/`, `language` and `publication_rkey` in the right shape. A bad block gives `standard_site: { status: 'invalid', errors }` and `ok: false`; the entries are still published and no standard.site record is written.
- Per document, the lexicon limits: title 500 graphemes and 5000 bytes, description 3000 and 30000, tags 128 and 1280, a record under 1 MB; description is cut on a grapheme boundary, then "…". An over-long title or tag is an error for that plan; the description is truncated.
- An entry with no `title` gets no document and is listed under `standard_site.withheld`; its entry record is published as usual.
- With no path pattern a document is created with a warning: it has no web URL and cannot be verified.
- A document follows its entry: it is rewritten when its rendering changed or when the entry has a new version (a new `cid`), and deleted when its entry leaves the selection. If the publication record cannot be written, no document is written.
- Turning standard.site off later leaves its records and the manifest section alone; nothing deletes them.

**The site must point back.** For readers to trust the records, the website has to say so. `publish` writes one file for you, when the static surface is enabled and succeeded: `.well-known/site.standard.publication` (plus the path of the publication's URL, if it has one) under the static directory, containing the publication's AT-URI. That only works if the static directory is served at the root of the publication URL; otherwise copy `standardSite.publication.atUri` from the manifest to wherever the site serves `.well-known`. The per-document `<link rel="site.standard.document" href="at://...">` tag in each page's HTML is not generated; the document AT-URIs are in the manifest under `standardSite.documents` for your site generator to read.

## The files

| File | Written by | Holds |
|---|---|---|
| `kms.yaml` | you | the configuration above |
| `data/kms-published.json` | `publish --apply` | the manifest: per object `slug`, `type`, `rkey`, `atUri`, `cid`, `hash`, `publishedAt`; and `standardSite: { publication, documents }`. Commit it; it is the only record of what is on the PDS. |
| `<static_dir>/api/**` | `publish` (not `--dry`) | JSON-LD per type and per entry, regenerated and wiped each run |
| `<static_dir>/.well-known/knowledge.json`, `dao.json` | `publish` | a manifest of published domains and sources; `dao.json` is copied if present at the instance root |
| `<static_dir>/.well-known/site.standard.publication` | `publish` | the publication's AT-URI |
| `<static_dir>/.well-known/extensions.yaml` | `publish` | the extension-pack entity names and what they map to; written only when the instance has packs, and removed otherwise |
| source YAML under the store | `publish` | minted `id` fields, and a minted `grc20Id` for each object when `geo.space` is set in `kms.yaml` (tracked files change; review the diff) |

Before the first real apply, wipe any test identity's records and reset the manifest, otherwise the manifest describes records that live on the wrong account.

## Pulling the other way

The same module holds an `atproto` ingest connector (`src/atproto/connector.mjs`) that lists a peer's records from the configured PDS (skipping peers whose latest commit `rev` is unchanged), treats them as untrusted (private fields dropped, peer ids discarded, records claiming your own DID as origin ignored) and detects retractions by comparing the full list with the last one seen. It is run with `ingest`, not `publish`; see [the connector guide](../packages/org-os-kms/docs/CONNECTORS.md).

## Tests

All run with `node --test` inside `packages/org-os-kms` and use a fake `fetch`, so none touches the network: `atproto-client`, `atproto-publish`, `atproto-standard-site`, `atproto-connector`, `publish-op`, `standard-site-op`. `e2e-atproto.test.mjs` is the live round trip (publish, pull, retract): it is skipped unless `ATPROTO_E2E=1` and the PDS, handle, app password and DID of a throwaway account are set. In this pass the six suites passed (58 pass, 1 skipped, the live one).
