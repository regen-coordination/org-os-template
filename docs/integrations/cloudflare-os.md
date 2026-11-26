# Cloudflare OS Integration

**Module:** `org-os-cloudflare-os`, catalogued `pilot` ([manifest](../../modules/org-os-cloudflare-os/module.yaml), [catalogue entry](../MODULES.md)). Built and verified on a local Cloudflare OS stack; not deployed. Design: [Cloudflare OS integration design](../superpowers/specs/2026-08-08-cloudflare-os-org-os-integration-design.md). Package: [`packages/cloudflare-os-integration`](../../packages/cloudflare-os-integration/README.md).

[Cloudflare OS](https://os.cloudflare.app/) is Cloudflare's workspace product (early access and open-sourced 2026-08-05, per its announcement; upstream claim, not checked here). This module lets a Cloudflare OS workspace read org-os instances: their registries, federation, schemas, rendered pages and a grounding bundle for the workspace agent, so people who never touch git can ask an agent about an org's real state from a browser. The git repository stays canonical; the workspace holds only thin wiring. It is read-only. There is no write path.

The pieces:

- **The core** (`src/page-core`, `src/substrate`, `src/gatekeeper`): pure, runtime-agnostic JavaScript. Page rendering, a substrate interface with an in-memory driver and a GitHub driver, and the five capabilities. `scripts/page-shim.mjs` (`npm run page <id>`) imports the same page renderer.
- **The adapter** (`src/adapter/gatekeeper-org-os`): a Cloudflare Worker, a "gatekeeper" in Cloudflare OS terms, that wires the core to the platform.
- **A gadget blueprint** (`blueprints/org-dashboard/gadget.html`): a dashboard that calls `get_page`.

## What is verified, and what is not

| Level | State |
|---|---|
| Built | The core, the adapter source and the gadget source. `npm run test:cloudflare-os-integration` runs 86 tests. On this branch, 84 pass and 2 fail: the two `daysUntil` tests are time-zone dependent (they pass with `TZ=UTC`). |
| Verified against a live service | On a local Cloudflare OS stack (wrangler and workerd, upstream commit `1cb5e3d`, 2026-08-07), 2026-08-08 and 2026-08-09: `types:check` silent, the `GATEKEEPER_ORG_OS` binding present, `GET /gatekeeper/org-os/` returns 200, and the core read live GitHub data for a public hub (`get_registry` 13 projects, `get_page` rendered) and for a private instance (`get_registry` 27 projects, `get_federation` with 8 peers, `get_page` dashboard), each with a commit sha and `stale: false`. Separately, on 2026-08-09, a model provider was configured and its model list read live. |
| Not verified | The workspace agent calling a capability in chat. Anything in a deployed workspace: no starter fork or deployment is recorded. The org-dashboard gadget installed in a workspace, and its `rpc.mjs` shim (see below). Exporting the gadget to a `.gadget` blueprint archive. The `NO_DEFAULT_CRED_INPUTS` and deploy-wizard behaviour for a credential-free gatekeeper on the upstream deploy path. |
| In production use | No. |

The statements above about the platform come from the adapter's notes of the 2026-08-08 and 2026-08-09 runs and from reading the pinned Cloudflare OS source; they were not re-run in this pass. The repository's tests were.

## What it connects to

- A **Cloudflare account** and a **Cloudflare OS workspace**: the starter (`https://github.com/cloudflare/cloudflare-os-starter`, deployed from its README; upstream location, not checked here). Nothing in this repository deploys it.
- **GitHub**, through its REST API, as the only substrate today: the gatekeeper reads each instance repository's files at a configured ref. The driver sits behind a substrate interface, so another driver can replace it without changing the capabilities.
- A **model provider** configured in the workspace, for the agent. One that works: the workspace's Ollama provider slot, which is a generic OpenAI-compatible client, pointed at a compatible gateway's API URL with an API token. The `openai` slot does not work with compatibility gateways because it speaks the Responses API. A key whose account has no balance fails on completions with a credits error even though the model list loads.

## Capabilities

The Worker's session object (bound in the workspace as `ORG_OS`) has two methods: `listInstances()` and `instance(id)`. `instance(id)` returns a per-instance object with the five read methods: `getRegistry(name)`, `getFederation()`, `getSchema(name)`, `getContextBundle()` and `getPage(pageId)`, for example `session.instance("my-org").getRegistry("projects")`. Each calls the core capability of the same name in snake case:

| Capability | Returns |
|---|---|
| `get_registry` | `data/<name>.yaml`, parsed |
| `get_federation` | the instance's `federation.yaml`, parsed |
| `get_schema` | `.well-known/<name>.json` |
| `get_context_bundle` | identity, agent rules, memory index, the five most recent decisions and registry snapshots, each section cut to 64,000 characters with a flag; a missing file becomes `null` |
| `get_page` | one rendered page: `dashboard`, `projects`, `tasks`, `instances`, `decisions`, `plans` or `this-week` |

The core's `handle()` (in `src/gatekeeper/capabilities.mjs`) answers with an envelope, `{ ok: true, data, provenance: { instance, sha, date, stale } }` or `{ ok: false, error: { code, message } }`. The Worker adapter unwraps it: on success a method returns `{ data, provenance }` (`getPage` returns `{ pageId, markdown, provenance }`); on failure it throws an `Error` carrying only the message, so the error code never reaches the workspace caller. `instance(id)` for an unconfigured id throws "isn't a configured org-os instance" (the core's own code for that case is `UNKNOWN_INSTANCE`). `provenance.sha` is the commit the data was read from, so the agent can say where an answer came from. `stale: true` means the GitHub read failed and a cached copy was served. Names passed to `get_registry` and `get_schema` must be lower-case letters, digits and hyphens. Every read calls `authorizeObservation()` before it fetches, so an observation the user would deny never reaches GitHub. The substrate caches by ETag with a 60-second default TTL and serves last-known-good content if a refresh fails; the cache is an in-memory map inside the Durable Object.

## Setup

Run these in order; each step's check gates the next. All of it needs a Cloudflare account and is outside the repository's tests.

1. **Deploy the starter** into your Cloudflare account. Check that the workspace loads, a document can be created, and the agent chat responds.
2. **Install the adapter.** Follow [the adapter runbook](../../packages/cloudflare-os-integration/src/adapter/README.md): copy `src/adapter/gatekeeper-org-os` into the workspace's `packages/`; there, run `ORG_OS_REPO=<path to this repository> node scripts/sync-core.mjs` (it vendors the core by copy, because the workspace is a separate pnpm workspace and cannot resolve a sibling repository) and `node scripts/sync-types.mjs`; run `pnpm exec wrangler types`; in `worker-configuration.d.ts` point `mainModule` at `./src/org-os` instead of the build output; then `pnpm run types:check`, which must be silent; then, in the workspace root, `pnpm install && pnpm run-local`. The check is that `GATEKEEPER_ORG_OS` appears in the binding list and `GET /gatekeeper/org-os/` returns 200. In local dev, a `gatekeeper-*` directory containing a `wrangler.jsonc` is bound automatically as `GATEKEEPER_ORG_OS`. On the starter's deploy path the slot is `workers.customGatekeeper.name` in `deployment.jsonc`.
3. **Configure the instances.** Set `ORG_OS_INSTANCES` in the adapter's `wrangler.jsonc` `vars`: a JSON array of `{ "id", "owner", "repo", "ref" }`, where `ref` defaults to `main`. Repository coordinates are public, so this is not a secret. Each `id` is lower-case letters, digits and hyphens and unique; `owner` and `repo` use GitHub's character set; a bad entry stops the Worker at startup. The `wrangler.jsonc` in the repository still carries the maintainer's example instances and a work-branch `ref`; replace them with yours.
4. **Set the token.** Put a fine-grained GitHub personal access token with `contents: read` only, as a Wrangler secret: `pnpm exec wrangler secret put ORG_OS_GITHUB_TOKEN --name gatekeeper-org-os`. Do not grant write scopes. A public repository can be read without a token, at GitHub's lower unauthenticated rate limit; a private one needs it. A fine-grained token is limited to one resource owner, so instances under different owners need separate arrangements. For local development, the multi-worker dev server does not read per-package secrets: add `"gatekeeper-org-os": ["ORG_OS_GITHUB_TOKEN"]` to `PASSTHROUGH_GATEKEEPER_VARS` in the workspace's `run-dev-server.js` (a local edit) and put the token in the workspace's gitignored `.dev.vars`.
5. **Configure the model** in the workspace, as above.
6. **Acceptance in chat.** Ask the workspace agent what the active projects are, what the last three decisions were, who the peers in a federation are, and what is urgent now, and compare each answer with the repository. Then ask which commit the answer came from; it should report the provenance sha. The repository records no completed run of this step.
7. **Install the gadget** (optional). Create a gadget in the workspace and paste `blueprints/org-dashboard/gadget.html` as its source. The file imports `callCapability` from `./rpc.mjs`, which is not in the repository, and expects `callCapability(name, args)` to resolve to `{ ok: true, data, provenance }` or `{ ok: false, error: { code, message } }`, with `args = { instance, page_id }`. The adapter does not return that shape, so the shim must do three things: take the injected `ORG_OS` session binding and call `binding.instance(args.instance)` first, then the method with a positional argument (`getPage(args.page_id)`); catch the `Error` the adapter throws and turn it into `{ ok: false, error: { code, message } }`; and wrap a success as `{ ok: true, data: { markdown }, provenance }`. How the workspace injects the binding into a gadget was read from source and has not been observed in a running gadget, so the shim is untested. The gadget's source is the version of record; change it here and reinstall rather than editing it in the workspace. It renders only `error.code` and `error.message`, never `error.detail`, which can carry raw upstream bodies.
8. **When it is live,** update the module's status in [Modules](../MODULES.md) and in `site/src/data/modules.yaml`, which a test requires to agree.

## Security posture

The gatekeeper is provisioned automatically and reads through one deployment-level token, not per-user OAuth. So every signed-in workspace user has the same access to the same repositories; `addObserver()` accepts unconditionally; and the contents of a private instance are readable by every workspace user. The boundary is workspace membership, enforced upstream at sign-in. That is safe only while workspace membership is close to organisation membership. If different users must see different data, the gatekeeper has to move to per-user OAuth and `addObserver()` must gain a real check.

## Commands

```bash
npm run test:cloudflare-os-integration   # the package's tests (node --test)
npm run page -- dashboard                # the same page renderer, from local instance data; runs scripts/initialize.mjs (its output includes a "Checking Notion API" info line) and is a transitional bridge (also: projects, tasks, instances, decisions, plans, this-week)
```

## What it writes and where

Nothing in the repository, and nothing to GitHub: the integration only reads. In the workspace it holds a copy of the core under the adapter's `vendor/org-os-core/` (generated by `sync:core`; never edit it, and re-run the sync after any change to the package's `src`), an in-memory cache, and, if installed, the gadget.
