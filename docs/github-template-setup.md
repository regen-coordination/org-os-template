# GitHub Template Setup

This repo ships with a "Bootstrap from template" workflow
(`.github/workflows/template-cleanup.yml`) and an Issue Form
(`.github/ISSUE_TEMPLATE/bootstrap-instance.yml`) that together let an
operator spin up a new org-os instance entirely through GitHub's UI — no
local `npm` required.

This page covers the **one-time, manual step** that has to happen on the
GitHub side before the flow becomes available.

## 1. Enable Template Repository

1. Open the repo on GitHub.
2. Go to **Settings → General**.
3. Scroll to the **Template repository** section.
4. Tick **Template repository**.

Once enabled, every repo page gains a green **Use this template** button.

## 2. How a downstream operator uses it

1. On the org-os template repo, click **Use this template → Create a new
   repository**. Name it after the new org (e.g. `bread-coop-os`).
2. In the freshly created repo, open **Issues → New issue → Bootstrap a
   new instance**.
3. Fill in name, type, emoji, short description, and your GitHub handle.
   Submit.
4. The `bootstrap` label on the issue triggers
   `.github/workflows/template-cleanup.yml`, which:
   - parses the issue body into `/tmp/bootstrap-config.yaml`,
   - runs `scripts/clone-framework.mjs --non-interactive` inside the
     runner, and
   - posts a comment back on the issue.

## 3. v3.5 limitations (best-effort)

- The workflow runs the cloning engine inside the Actions runner, but it
  does **not** yet commit the generated instance back to the repo or open
  a pull request. v3.6 closes that loop.
- Until then, the CLI path remains primary:
  ```bash
  node scripts/clone-framework.mjs --target ../my-new-org --type project
  ```
  See `BOOTSTRAP.md` and `docs/OPERATOR-GUIDE.md` for the local flow.

## 4. Troubleshooting

- **Workflow doesn't fire** — confirm the issue carries the `bootstrap`
  label (the Issue Form sets it automatically; manual issues won't).
- **Issue Form not visible** — `.github/ISSUE_TEMPLATE/` only renders on
  the default branch. Merge to `main` first.
- **`npm ci` fails on the runner** — check that `package-lock.json` is
  committed and in sync with `package.json`.
