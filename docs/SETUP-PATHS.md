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
