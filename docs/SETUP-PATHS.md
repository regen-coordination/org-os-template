# Setup Paths for org-os

**Status:** superseded 2026-08-28 (v0.5 release, WS-F5). Reduced to a stub.

---

## There is one setup path

```bash
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml
```

Full first-run sequence: [`BOOTSTRAP.md`](../BOOTSTRAP.md).
Getting started as a newcomer: [`templates/GETTING-STARTED.md`](../templates/GETTING-STARTED.md).

Verify what you got, from the framework:

```bash
npm run doctor -- --dir ../my-new-org
```

A freshly cloned instance should report no blockers except `git-remote-absent`,
which is expected until you create a repository for it. Anything else is a bug —
`tests/clone-framework-health.test.mjs` guards exactly this.

### An instance born as a knowledge system

Add a `kms:` block to the config and the clone also applies the `org-os-kms` profile:
it stamps `kms.yaml` and the instance's own source-system card, with the named
extension packs switched on.

```yaml
packages:
  toolkit-framework: true     # both are required by a kms block,
  org-os-kms: true            # vendored side by side
  org-os-territory: true      # every extension is a package too
kms:
  instance: my-commons        # optional; defaults to a slug of org.name
  extensions: [org-os-territory]
  store: { on_collision: merge }   # optional
  public_plane:                    # optional: a private canon + a separate public repository
    instance: my-commons-public    # scaffolded at repos/my-commons-public, its own git repository
    types_opt_in: [territorial-unit]   # optional: pack types the public plane publishes
    title: "My Commons"            # optional: the plane's own published card
    steward: "Who stewards it"
    return_path: "Where corrections go"
    url: "https://example.org"
```

With `public_plane`, the instance is a **canon**: nothing leaves it except through the
publication gate. `org-os-kms export` projects what passes into the public plane and
`org-os-kms validate` re-checks what is published there against the live canon
(`packages/org-os-kms/docs/CONNECTORS.md`, "Two planes").

A `kms:` block whose packages are not enabled is refused before anything is written.
Fixture: `tests/fixtures/instance-config-kms.yaml`; guard: `tests/clone-kms.test.mjs`.
What it does not do: connectors, AT Proto identity and peers stay hand-edited in
`kms.yaml` (`packages/org-os-kms/docs/CONNECTORS.md`).

### An instance that works in another language

Add `org.language` (a BCP-47 tag; default `en`) and everything the clone writes comes
out in that language — `README.md`, `GETTING-STARTED.md`, `CLAUDE.md`, `AGENTS.md` and
the scaffold files (`IDENTITY.md`, `HEARTBEAT.md`, `DECISIONS.md`, `docs/plans/QUEUE.md`,
`dashboard.yaml` comments, …). The language is recorded as `identity.language` in
`federation.yaml`, and `CLAUDE.md` / `AGENTS.md` tell agents, in that language, to
operate, write documents, memory and commit messages, and reply in it, while schema
field names, record types, vendored `packages/` and code stay in English.

```yaml
org:
  name: "brasil-regenerativo-os"
  type: "Network"
  language: "pt-BR"
```

Each file is looked up as `templates/<lang>/<file>` first and the English
`templates/<file>` otherwise: the four templates, `partials/`, `scaffold/` (which mirrors
the instance root) and `strings.yaml` (short strings, merged key by key). Shipped today:
`pt-BR`. To add a language, add `templates/<lang>/` with whichever of those files you
have translated and commit it — the clone reads committed content only.

- A tag with no `templates/<lang>/` gets English files and a logged note; the language
  is still recorded and agents are still told (in English) to work in it.
- A value that is not a language tag is ignored with a note: English, nothing recorded.
- An instance carries the English base and its own language's set, not the others.
- A few labels stay in English in every language because tooling reads them:
  `**Name:**` / `**Type:**` in `IDENTITY.md` and the first word of the four
  `docs/plans/QUEUE.md` section headings. Copied framework docs (`docs/`, `BOOTSTRAP.md`,
  skills, slash commands) and runtime output such as the `/initialize` dashboard are
  not translated.

Fixture: `tests/fixtures/instance-config-pt-br.yaml`; guard: `tests/clone-locale.test.mjs`.

The in-place alternative, `npm run setup`, is an interactive TTY-only wizard for
converting a fork you have already made. It is not the recommended newcomer path;
see the README for the current caveat.

---

## Why this file is a stub

It described three setup paths — "Egregore-assisted", "Filesystem-native" and
"Hybrid" — in 374 lines, dated 2026-03-21 and marked "applies to org-os v3.1+".
Two of the three never existed as distinct, supported paths. It was aspirational
architecture written before the cloning engine, and it stayed on disk long enough
to become the most detailed setup document in the repo while describing choices a
newcomer does not actually have.

That is the failure mode the v0.5 release set out to remove: documentation that is
confident, thorough, and not true. A newcomer following it would spend their first
hour choosing between options rather than getting an instance running.

The content is not lost — it is in git history, and the ideas that survived live on
as real modules (`packages/egregore-core`, the Cloudflare OS module) with their own
docs. What is gone is the claim that they are setup paths you pick between.

Kept as a stub rather than deleted so existing links keep resolving.
