# BOOTSTRAP.md — First-Run Onboarding

> **Note:** As of v3.5, the bootstrap process is automated. Run the cloning engine
> instead of following manual steps.

## For new instances

```bash
git clone https://github.com/regen-coordination/org-os
cd org-os
node scripts/clone-framework.mjs \
  --target ../my-org \
  --type cooperative \
  --interactive
```

The engine:
1. Copies the framework into your target directory
2. Strips framework-only artifacts
3. Runs the bootstrap interview (identity, packages, skills)
4. Renders README + GETTING-STARTED with your org's context
5. Materializes selected packages
6. Writes federation.yaml
7. Validates the result
8. Initializes git with an initial commit

End state: a working instance at your target directory, ready for your first
`/initialize` session.

Supported `--type` values: `cooperative`, `dao`, `localnode`, `project`, `hub`.
Pass `--non-interactive --config <file>.yaml` for scripted bootstraps.

## For existing instances (post-bootstrap)

If your instance is already initialized, skip this file. The standard session
startup is documented in `AGENTS.md` and your instance's `GETTING-STARTED.md`.

To pull updates from the framework after the initial clone:

```bash
npm run sync:upstream
```

## Web wizard (v3.6+)

A browser-based wrapper over the same engine is planned for v3.6. Until then,
the CLI path above (or the GitHub Template's Issue form) is the entry point.
