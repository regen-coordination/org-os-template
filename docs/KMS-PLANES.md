# The two planes and the publication gate

A knowledge instance can keep everything it knows in a private **canon** and let only what passes a gate reach the world, through a second instance, the **public plane**, kept in a separate repository. The canon decides; the plane only holds what the canon let through and publishes it. This page covers the two roles, the gate that stands between them, `export`, `validate`, and the rule that a canon never publishes. It belongs to the knowledge management system described in [KMS](KMS.md).

**Status:** `in-dev`. The code is under test (`packages/org-os-kms/test/planes/`, all green on this branch) and was run end to end against a scratch canon and plane for this page; it is in use by the maintainer's own instances only.

> **Warning: plain `publish` does not keep unfinished material back.** In an instance with no plane role and no canon control data, `publish` applies only the framework floor (the type is publishable, `public_use` is one of the four publishable values, `maturity` is not `held`) and an optional `publish.gate` module. There it does **not** run the canon gate below, and it does not look at `maturity` (other than `held`) or `source_lineage`: an entry with `maturity: draft` and `public_use: ok-with-caveat` is published. The exception is an instance whose knowledge base holds canon control data (a source card that claims or holds corpus paths, or a `public-use-boundary` record): there `publish` also runs the canon gate, reports it as `canonGate`, and a `draft` stays back. Plan mode, without `--apply`, is not harmless either: it mints ids into your YAML and writes `public/`. Only `publish --dry` writes nothing.
>
> **Safe sequence.** Keep the knowledge in a canon and publish only from its plane: (1) `export` in the canon; (2) `validate` in the canon and fix every error; (3) commit both repositories; (4) `publish --dry` in the plane; (5) `publish`, then `publish --apply`, in the plane. Do not run `publish` in an instance whose entries are not all ready to be public.

**Which command runs which check** (the canon gate is the table in "The publication gate" below):

| Command | Where | Canon gate | Framework floor | Field allowlist | Other |
|---|---|---|---|---|---|
| `export` | canon | yes, on every canon object | yes, with the plane's own type policy | yes, applied when writing | lints cards and boundaries first; mints ids in the canon |
| `validate` | canon | yes, re-run on every entry in the plane against the live canon | yes | yes (reports unallowlisted canon fields, leaks, divergence) | lints cards and boundaries |
| `publish` | canon | refused in every mode | | | `refused: canon` |
| `publish` | public plane | yes, first, as a re-gate of the whole plane (the same check as `validate`); a failure refuses the command | yes | no (the plane already holds only allowlisted fields) | then the optional `publish.gate`, AT Protocol, static surface |
| `publish` | no role | **no** | yes | no | optional `publish.gate` only; plan mode still mints ids and writes `public/` |
| `ingest` | canon or no role | no | no | no | pulls only; everything lands `raw`, `not-public-yet` |
| `ingest` | public plane | refused | | | `refused: public-plane` |
| `export`, `validate` | public plane or no role | | | | fail: `no public plane is configured … has no planes.public.instance` |

## The two roles

An instance's role is read from its own `kms.yaml` (`src/planes/role.mjs`):

```yaml
# the canon names its public plane
planes:
  public:
    instance: my-commons-public     # the `instance:` the plane's own kms.yaml must carry
    dir: repos/my-commons-public    # optional; this is the default (repos/<instance>)

# the public plane says what it is
planes:
  role: public
  canon: my-commons                 # informational: not read by any code
  # canon_dir: ../my-canon          # optional: where the canon is, relative to the plane (default ../..)
  # regate: false                   # optional: publish without re-gating (see below)
```

An instance with no `planes` key has no role and behaves as an ordinary kms instance. `planes.role` can only be `public` (anything else throws: `a canon is declared by planes.public, not by a role`), and declaring both `planes.public` and `role: public` throws `an instance is a canon or a public plane, never both`.

`dir` is resolved from the canon root; the environment variable `COMMONS_DIR`, if set, overrides it (for tests and CI) but never the instance name the target must prove.

| | Canon | Public plane |
|---|---|---|
| Holds | Everything: raw captures, drafts, private notes, source cards, boundaries | Only entries the canon exported, with allowlisted fields, plus one self card |
| Where | The instance itself | `repos/<instance>/` under the canon by default (gitignored by it; its own git repository) |
| `export`, `validate` | Run here | Not meant to run |
| `publish` | **Refused in every mode** | Re-gates against its canon first, then publishes |
| `ingest` | Allowed | **Refused** |

The clone creates both for you: a `kms.public_plane:` block in the clone config scaffolds the plane under `repos/`, with `planes.role: public`, a self card in a publishable shape, `publish.apply: false`, and, if you give a `url`, a static surface (see [SETUP-PATHS](SETUP-PATHS.md)). It also gives the canon's own self card `origin_prefixes: [repos/<canon>/]`, `container_role: self` and `public_use: internal-only`. A plain `org-os-kms init` does neither: the plane you `init` by hand has a self card that `validate` rejects until you fix it (see "The plane's own card").

## What may cross, and how

Nothing crosses by copying. Exactly one command moves content from canon to plane, and it moves a *projection*:

```
canon  data/kb/<schema>.yaml  --[ publication gate ]--[ framework floor ]--[ field allowlist ]-->  plane  data/kb/<schema>.yaml
```

An entry reaches the plane only if all three stages accept it:

1. **The canon publication gate** (`src/planes/publication-gate.mjs`): the entry's own editorial state and where it came from.
2. **The framework floor** (`toolkit-framework/src/publishable.mjs`): the type is publish-eligible in *this plane's* `kms.yaml`, `public_use` is one of `ok-with-caveat`, `source-linked-unreviewed`, `reviewed-for-explanation`, `reviewed-for-guidance`, and `maturity` is not `held`.
3. **The field allowlist** (`src/planes/public-fields.mjs`): only named fields are written; everything else is dropped.

## The publication gate

`isPublishable(object, { sourceSystems, boundaries })` returns `{ ok, reason }`. **It never throws**: an unexpected shape becomes a refusal (`gate error: <message>`). Checks run in this order and the first failure wins; a reason is what `export` prints under `skipped`.

**1. What kind of record it is**

| Reason | When |
|---|---|
| `structurally a public-use-boundary record (never rendered)` | The object has a `tier` key, whatever its declared type. |
| `structurally a source-system record (never rendered)` | It has `what_it_curates` or `reuse_conditions`. |
| `missing type` | No `type`. |
| `type <type> is never rendered` | `source-system` or `public-use-boundary` (also with `_` or spaces for `-`). |
| `high_risk` | `high_risk` is set to anything but absent, `false` or the string `false`. |
| `public_use <value>` | `public_use` is `raw-lead` or `internal-only`. |

Source cards and boundary records are the gate's own control data; they never publish.

**2. Where it came from** (every lineage: `source_lineage`, `provenance.origin`, `provenance.adapted_from`, and each entry of `additional_provenance`, which may be a bare string or an object using `source_lineage`, `origin`, `lineage` or `url`)

| Reason | When |
|---|---|
| `no source_lineage` | The primary `source_lineage` is empty. Without one nothing is attributable. |
| `non-canonical source_lineage: "<as written>" — write it as "<canonical>"` | A corpus path written with a leading slash, doubled slashes, `./`, percent-encoding or `..`. The gate does not repair spellings, because a site reading the same field would attribute it to the wrong container. Case is not forced. |
| `source_lineage "<x>" contains "?" or "#", which the lineage key truncates — it cannot be keyed faithfully; rename the file or record a lineage without it` | A `?` or `#` in the path. |
| `boundary: never-publish-without-consent` | A `public-use-boundary` record with `tier: never-publish-without-consent` names exactly this document. |
| `unresolvable source_lineage: <lineage>` | The lineage is not a corpus path `repos/<Repo>/<path>` (a URL, a bare repo root, a `..` escape), or no registered source card claims its `repos/<Repo>/` prefix. |
| `source-system <name> has malformed held_prefixes` | The claiming card's `held_prefixes` is present but nothing in it can hold anything. The card then refuses everything it claims. |
| `held prefix: <entry>` | The path lies under one of the claiming card's `held_prefixes`. |
| `source-system <name> is internal-only/high_risk` | The claiming card has `high_risk`, or `public_use` of `raw-lead` or `internal-only`. |
| `source-system <name> is unassessed (no public_use)` | The claiming card has no `public_use`. A missing decision is a refusal, not a pass. |

Every lineage must pass every check, so a held or unregistered `provenance.origin` blocks an entry whose primary lineage is clean. `url` is *not* a lineage (it is a link), except inside an `additional_provenance` entry.

Matching is by a normalised key: percent-decoded, query and trailing slash removed, dot segments resolved, Unicode-normalised and lowercased, so `repos/corpus/a.md` matches a card for `repos/Corpus/`. Boundaries match one document exactly; to hold back a directory use the card's `held_prefixes`. A glob (`*`) in `held_prefixes` holds nothing and is reported by `export` as a malformed card.

**3. Editorial state**

| Reason | When |
|---|---|
| `operator publish flag` (passes) | `publish: true` on the object. It overrides only this step, never steps 1 and 2. |
| `maturity is <value>` / `maturity is missing` | Anything but `maturity: reviewed` without the flag. |
| `maturity <value>` (passes) | `reviewed`. |

So the canon gate admits an entry that is `reviewed` (or flagged `publish: true`), whose every lineage resolves under a registered, assessed, non-internal source card, and which is not under a held prefix or a consent boundary. The check is by lineage and card, not by who wrote the text.

### The control data it relies on

Source cards (`data/kb/source-system.yaml`) and boundaries (`data/kb/public-use-boundary.yaml`) are linted by `export` and `validate` before any verdict is computed. A malformed one stops the export with `export-commons: refusing to export — malformed control data:` followed by one line each, for example:

- `source-system <slug>: no corpus-path prefix — add an origin_prefixes entry of the form repos/<Repo>/ (the upstream URL belongs in url:); this card claims nothing, so its held_prefixes and public_use hold nothing`
- `source-system <slug>: origin_prefixes entry "<x>" is not a corpus path of the form repos/<Repo>/ — an upstream URL belongs in url:`
- `source-system <slug>: held_prefixes entry "<x>" contains a glob — * is not supported, a prefix is a prefix — it holds nothing` (other causes: not a non-empty string, does not normalise, resolves outside this card's corpus prefixes)
- `source-system <slug>: held_prefixes is present but nothing in it holds anything — the card refuses EVERYTHING it claims until this is fixed`
- `boundary record <key>: source_lineage "<x>" is not corpus-path form — a lineage must be repos/<Repo>/<path>; this record indexes nothing and protects nothing`
- `boundary record <key>: source_lineage "<x>" ends in / — a boundary names one document, matched exactly; use a card's held_prefixes to hold a directory back`

A card without `origin_prefixes` falls back to its GitHub `url` (`repos/<repo>/`). A card with `container_role: provider` (someone whose captures live in another container) must have a `url` and must carry no `origin_prefixes`, no `held_prefixes` and no blocking `public_use`: it claims nothing.

## `export`

```bash
node packages/org-os-kms/src/cli.mjs export --dir <canon>
```

In order: resolve the plane from `planes.public`; prove the target (below); load the plane's own policy (its `extensions`, `publish.types_opt_in`, `publish.public_fields`); lint the control data; run the gate on every object; apply the framework floor; **mint an `id` (UUID) in the canon** for what passed, writing it into the canon YAML; write the projection.

Refusals before anything is written (the canon is left byte-identical): the target is the canon itself (`refusing to export into the canon itself`); has no `kms.yaml` (`is the commons repo scaffolded?`); is a different instance (`<dir> is instance "<x>", not the commons instance "<y>"`); resolves into the canon outside `repos/` through a symlink; `repos/` is a symlink; or any path it would write is a symlink or a hard link. Containment is checked before the first id is minted, so a refused export does not change the canon.

It writes, in the plane: `data/kb/<schema>.yaml` for every schema that has at least one passing entry, sorted by slug, with no timestamps (so `git diff` in the plane is the publication change feed), and `data/kb/public-fields.json`, a generated copy of the allowlist. It **deletes every other `data/kb/*.yaml` in the plane first**, except `source-system.yaml`, which is the plane's own card and is never touched. It writes nothing else.

The result lists `written`, `minted`, `skipped` (each `{ key, reason }` with the gate's reason above; cards and boundaries are not listed), `floorRejected` (passed the gate but not the floor: `public_use missing or not publishable`, or `type <schema> is not publish-eligible here (see the commons' kms.yaml publish.types_opt_in)`) and `mintedFiles`. A type that a pack adds publishes only if the plane's `kms.yaml` lists the pack under `extensions` *and* the type under `publish.types_opt_in`; declaring a pack never widens what is published.

### What a published entry contains

Only the allowlist: `title`, `id`, `maturity`, `ai_assisted`, `last_reviewed`, `public_use`, `source_lineage`, and `provenance` reduced to `origin`, `transformation`, `authorship`; plus, per schema, the content fields named in `public-fields.mjs` (for example `summary`, `known_tensions`, `caveat` for an `encyclopedia-entry`; `claim`, `evidence` for `claim-evidence`; `summary`, `url` for a `resource`) and the instance fields `serves`, `summary_en`, `lang`, `locator`, `unit_refs`. A schema with no entry in the allowlist publishes metadata only. Object-valued fields are dropped unless a nested rule names their public keys (`membership`: `count`, `as_of`, `criteria`).

The plane can add fields in its own `kms.yaml`; it can never remove one or publish a private field:

```yaml
publish:
  types_opt_in: [territorial-unit]
  public_fields:
    "*": [summary_es]        # on every schema
    resource: [bioma]        # on one schema
  nested_fields:
    contato: [rede]          # public keys of an object-valued field
```

Naming a private field fails the whole command, for example `publish.public_fields.* names "notes", a private field — an instance may add public fields, never publish a private one`. Private means the framework's list (`notes`, `work_order`, `reviewed_by`, `review_needs`, `interpretation`, `uncertainty`, `tensions`, `risks_of_flattening`, `high_risk`, `consent_note`, `salvaged_from`, `legacy_status`, `additional_provenance`) plus `surfaced_by`, `geometry_ref`, `node_did`, `node_repo`, `defined_by`, `steward`, `connector`. A canon field that is on no allowlist is dropped silently by `export`, and reported by `validate` until someone decides its visibility.

## `validate`

```bash
node packages/org-os-kms/src/cli.mjs validate --dir <canon>
```

`validate` re-gates what is *in the plane* against the **live canon**, never against the plane itself (a projection is not a second canon, and the plane runs no gate of its own). It exits 1 with `{ ok: false, errors }` on any of these, and `{ ok: true, message: "commons published store valid" }` otherwise; if the plane has no `data/kb/` yet it says `nothing to validate yet`. Per entry:

- `<key>: no such object in the canon`
- `<key>: canon counterpart rejected by the canon gate — <reason>` and `<key>: rejected by the canon gate — <reason>` (a hold or a downgrade added in the canon since the export)
- `<key>: canon public_use "<v>" is not publishable` and `<key>: public_use "<v>" is not publishable`
- `<key>: framework floor rejects this entry — <reason>` (`schema "<s>" is not a publishable type here …`, `maturity is held`, or `public_use … is not publishable`)
- `<key>: published copy diverges from the canon projection at: <paths>` (an entry edited by hand in the plane)
- `<key>: canon field(s) not on the public allowlist (add to this plane's kms.yaml publish.public_fields or mark private): <fields>`
- `<key>: private field(s) leaked: <fields>` (also nested, as `<path> leaked`)
- `<key>: missing id`
- `<file>: unloadable — …`, `<file>: document is not a mapping`, `<file>: entries is not a mapping`
- `<file>: entries is empty but the canon has a publishable object of schema "<s>" — this file should not exist, or should project it`

and it repeats the control-data lint of `export` (cards and boundaries), so a broken hold is caught without an export.

### The plane's own card

The plane's `data/kb/source-system.yaml` must hold exactly one entry, the commons itself, and it is published as it stands. `validate` requires a publishable `public_use`, a non-empty `title` and `type`, and none of `maturity`, `source_lineage`, `provenance`, `additional_provenance`, `high_risk`, `publish`, nor any private field. The draft card `init` writes fails this (`public_use undefined is not publishable`, `self card must not carry "maturity"`, `private field(s) leaked: notes`); the clone writes a correct one from the `public_plane` config.

## Publishing, and the rule that a canon never publishes

`publish` in a **canon** returns, before listing, minting or writing anything, in every mode (`--dry`, plan, `--apply`):

```json
{ "ok": false, "report": { "refused": "canon", "reason": "this instance is a canon: it publishes nothing itself. Run `export` here, then `publish` in its public plane (<instance>)." } }
```

and exits 1. The `publish` step of `lifecycle close` ends in the same refusal (though `lifecycle close` run from the CLI stops earlier, at `bridge`; see [KMS](KMS.md)). What leaves a canon leaves through `export`.

`publish` in a **public plane** first re-gates the plane against its canon: the same check as `validate`. The canon is looked for two levels up (`<canon>/repos/<plane>`, where the clone puts it) or at `planes.canon_dir`, and it counts only if its own `kms.yaml` names *this* plane. The report's `regate` is one of:

- `clean`: proceed.
- `failed`: refused in every mode with `this public plane holds something its canon would not publish today — run `validate` in the canon`. Verified: adding a `held_prefixes` entry in the canon after an export made the next plane `publish --dry` refuse, naming `held prefix: …`.
- `canon-not-found`: `--dry` and plan mode proceed; `--apply` is refused with `this public plane cannot find its canon to re-gate against (planes.canon_dir), so it will not write. Set planes.regate: false to publish from the plane on its own.`
- `disabled`: `planes.regate: false`; reported as such.

Then the ordinary `publish` runs from the plane's `kms.yaml`: the framework floor and an optional `publish.gate` module, AT Protocol records, the static surface, the manifest. See [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md). `ingest` in a plane returns `{ ok: false, report: { refused: "public-plane", error: "this instance is a public plane: it receives only what its canon exports. Ingest in the canon." } }`.

## The sequence, with every file that changes

The plane needs `publish.base_url` (or `publish.static: false`) in its `kms.yaml`; the clone sets it only when the `public_plane` config gives a `url`.

```bash
# in the canon
node packages/org-os-kms/src/cli.mjs export          # writes the plane; mints ids INTO the canon
node packages/org-os-kms/src/cli.mjs validate        # must be ok before you go on
git add -A && git commit -m "kms: mint ids"          # the canon: ids were written into data/kb/*.yaml
cd repos/<plane>
git add -A && git commit -m "kms: export"            # the plane: data/kb/*.yaml, data/kb/public-fields.json
node ../../packages/org-os-kms/src/cli.mjs publish --dry --dir .
node ../../packages/org-os-kms/src/cli.mjs publish --dir .          # plan; add --apply to write to the server
git add -A && git commit -m "kms: publish"           # plan mode wrote public/ (static surface); --apply also writes data/kms-published.json
git push                                              # from the plane's repository, never from the canon's
```

(Adjust the relative path to `cli.mjs` to wherever the plane's own `packages/` is. The plane has no `packages/` of its own unless you vendor them there; running the canon's copy with `--dir <plane>` works.) Two repositories change on an export: the canon (minted ids) and the plane. Committing only the plane leaves the canon's ids uncommitted, and the next export would mint different ones.

## What it does not do

- It does not decide what is *true* or whether a person consented; the gate only enforces the holds and boundaries someone recorded. A missing hold is a pass.
- The plane's `planes.canon` name is not read; only `canon_dir` and the canon's own `planes.public.instance` link the two.
- Plain `publish` in an instance with **no** plane role and no canon control data applies only the framework floor, not this gate, so a `draft` with a publishable `public_use` goes out (see the warning at the top). The canon gate runs in `export` and `validate`, in a public plane's `publish` through its re-gate, and in the `publish` of an instance with no plane role that holds canon control data; nowhere else.

See also [KMS](KMS.md), [SETUP-PATHS](SETUP-PATHS.md) and [CONNECTORS](../packages/org-os-kms/docs/CONNECTORS.md). Extension packs ([KMS-EXTENSION-PACKS](KMS-EXTENSION-PACKS.md)), the territory pack ([TERRITORY-PACK](TERRITORY-PACK.md)), publishing to standard.site and AT Protocol ([KMS-PUBLISHING](KMS-PUBLISHING.md)) and the federation map ([FEDERATION-MAP](FEDERATION-MAP.md)) are covered on their own pages.
