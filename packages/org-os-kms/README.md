# @org-os/kms — org-os Knowledge Management System

Binds **`@regen-commons/toolkit-framework`** into **org-os**. It is two things:

- **A module** (`src/bind.mjs`) — maps the framework's schemas → org-os registries, its skills → the `/initialize`–`/close` lifecycle, and federation → RegenOS.
- **An org-os profile** (`profile/profile.yaml`) — a ready-to-run org-os configuration that ships the framework **pre-loaded as the default knowledge system**. Instantiating the profile = an org-os instance that is already a knowledge commons.

**Replaceable by design.** org-os is *one* host. Swap `org-os-kms` for a plain CLI, a SaaS, or another OS — the framework (`toolkit-framework`) is untouched and still works standalone.

```js
import { profileManifest, toOrgOsRegistries } from '@org-os/kms';
profileManifest().default_knowledge_system;   // '@regen-commons/toolkit-framework'
toOrgOsRegistries(frameworkObjects);           // { 'data/resources.yaml': [...], ... }
```

## How instances are born (Loop 3)

1. Instantiate the `org-os-kms` profile → an org-os instance with the framework wired in. From the framework: a `kms:` block in the `clone-framework.mjs` config (`docs/SETUP-PATHS.md`). In an existing instance: vendor the packages and run `init`.
2. Fill the instance slots (identity + domain content).
3. Run the framework's skills (`capture-and-route`, …) over the domain's sources.
4. `/close` runs `csis-review` + emits `contribution-record`s.
5. Federate via RegenOS (upstream/downstream; self-qualifying adoption).

This is the adoption vehicle for ReFi DAO / ReFi BCN / future communities (build-plan SP11 / pipeline P9–P10). See `../toolkit-framework/framework`-side docs: PLACEMENT, FEEDBACK-LOOPS.

## Extension packs

Sibling packages that add typed schemas, entities, connectors and registry bindings without editing the framework — opt in with `kms.yaml` `extensions: [<pack>]`. First pack: [`org-os-territory`](../org-os-territory/README.md). Contract and rules: [`docs/CONNECTORS.md` §13](docs/CONNECTORS.md#13-extension-packs).

## What kms draws

Every page kms writes for people speaks the house element set (tokens generated from the house skin; Fraunces, Geist and Geist Mono vendored and inlined), stays static and self-contained, and requests nothing from any other host:

- **The federation map** (`org-os-kms render map html` → `renders/federation-map.html`) — the steward's copy: the map laid out in layers by the direction knowledge travels, with what needs a steward marked, complete without JavaScript and enhanced by the `<federation-map>` component when it runs. Nodes one hop beyond sit further out from whoever reported them. Beside it, `renders/federation-links.md` lists the map's links, one a node, for the note graph. In `map.json` v1 a node's link is its `portal` key (from `portal_web` / `portal_vault` in `data/source-systems.yaml`): a data key a peer may read, kept until map.json v2; "portal" itself names the house's public site.
- **The commons as pages** (opt-in: `publish.pages: true` in `kms.yaml`) — `publish` writes `index.html`, kind pages under `k/<kind>/` and one read-only page per published entry beside the JSON API. Only what the publication gate let through appears; a reference to anything else is dropped, so a private entry cannot be inferred. Without the flag, `public/` is exactly what it was.
- **The steward's preview** (`org-os-kms render pages --preview` → `renders/preview/`) — the same pages over the whole canon, with internal entries, broken references and the review queue shown. It is never published.

`render.fonts: system` turns the vendored fonts off; `render.labels` renames body field headings. See `docs/CONNECTORS.md`.

## Checking the pages

`scripts/shoot.mjs` is a dev-only page checker: `node scripts/shoot.mjs --html <file.html> --out <dir> --name <surface> [--widths 1440,390] [--themes light,dark] [--reflow 390,320] [--axe] [--full-page]`. It writes one JPEG per width and theme plus `<name>-report.json` (horizontal overflow at the reflow widths, every request that is not `file:` or `data:`, console errors, and with `--axe` the WCAG 2.x A/AA violations), and exits 1 on any finding. It needs `playwright-core` (and `axe-core` for `--axe`) and the installed Chrome; none are dependencies of this package. Set `KMS_SHOOT_MODULES` to a directory containing `node_modules/` with them, otherwise `packages/admin` and then this package are tried; exit code 2 means they were not found.

## Publishing

`org-os-kms publish` (`src/ops.mjs`) selects what passes the framework floor (with the visibility
and claims floors), then narrows it with any instance gate (`publish.gate`). That selection is
`selectPublic` (`src/gate.mjs`), which the steward's preview and kms-admin read too. A canon never
publishes, and a public plane re-gates itself against its canon first. An instance with no plane
role whose knowledge base is canon-shaped (a source card that claims or holds corpus paths, or a
public-use boundary) also runs the canon publication gate, the one `export` runs
(`src/planes/canon-gate.mjs`), in plan mode, `--dry` and `--apply`: a draft entry is neither minted
an id nor written. Malformed cards or boundaries refuse the publish before anything is minted or
written, and the preview and kms-admin call nothing public until they are fixed. Without such data,
publish behaves as it always did. Details: [`docs/CONNECTORS.md`, *Two planes*](docs/CONNECTORS.md#two-planes-a-private-canon-and-a-public-plane-export-validate).
