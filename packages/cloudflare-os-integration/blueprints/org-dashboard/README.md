# org-dashboard gadget

The canonical source for the M2 dashboard gadget. `gadget.html` in this directory is the
version of record — the copy installed in a Cloudflare OS workspace is a deployment artifact,
so changes are made here and re-installed, never edited in the workspace.

## What it does

Calls the `get_page` gatekeeper capability and renders the returned markdown, with an instance
selector (hub / peer instances) and a page selector across the seven pages the shared page core
supports. The footer shows provenance — the commit sha and date the data came from — and a
STALE badge when the substrate served a cached read because the refresh failed.

## The one seam: `rpc.mjs`

`gadget.html` imports `callCapability` from `./rpc.mjs`, which is **not** in this repo. Its body
is deployment-specific (the workshop RPC session binding) and comes from §D4 of
`docs/integrations/cloudflare-os.md`, which is filled during the M0 platform probe.

Contract it must satisfy:

```js
callCapability(name, args) -> Promise<
  { ok: true, data, provenance: { instance, sha, date, stale } } |
  { ok: false, error: { code, message, detail? } }
>
```

## Display rule

Render `error.code` and `error.message` only. **Never render `error.detail`** — it carries raw
upstream response bodies and parser output, and is for logs and debugging only. See the Task 12
amendment in the M0–M2 plan for why the split exists.

## Install status

**Not yet installed.** Installation (plan Task 18 Step 2) and acceptance (Step 3) require a
deployed Cloudflare OS workspace, which is gated on M0 Tasks 1–3. Record the exact install steps
in §D6 of the discovery doc when they are run.
