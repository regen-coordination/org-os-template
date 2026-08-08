# Cloudflare OS Integration — Platform Discovery & Runbook

**Pinned cloudflare-os commit:** `1cb5e3d9096589e38f3fcfaf3f2191aa95a4c592` (2026-08-07) · **Starter fork:** _pending — Task 1_ · **Deployed workspace:** _pending — Task 1_
**Status:** M0 discovery — answers below drive Tasks 13 and 18.

> **Evidence basis.** Everything below was established by **reading the pinned source**
> (`~/code/cloudflare-os`, primarily `AGENTS.md`, `README.md`, `docs/blueprints.md`,
> `packages/workshop-shared/src/gatekeeper.ts` — the 1109-line contract — and
> `packages/gatekeeper-spotify` / `packages/gatekeeper-context`). It has **not** yet been
> confirmed against a running instance: `pnpm install` / `pnpm run-local` and the deploy are
> still pending. Claims marked ⚠️ are the ones a local run should verify first.
>
> Cloudflare OS was open-sourced 2026-08-05 and is explicitly labelled early access ("version 2,
> a complete rewrite"). Treat this document as pinned to the commit above; re-read on upgrade.

---

## D1. Gatekeeper authoring interface

A gatekeeper is a **separate Cloudflare Worker**. The contract is
`packages/workshop-shared/src/gatekeeper.ts`, and it has **three layers**, not one:

| Layer | Type | Role | Key members |
|---|---|---|---|
| Vendor | `GatekeeperVendor extends WorkerEntrypoint` | The Worker entrypoint; the service as a whole | `describe(): VendorDescription`, `connectAccount(callback, options)`, `createAccount?()` |
| Account | `GatekeeperUser extends WorkerEntrypoint` | One connected account | `describe(): AccountDescription`, `getVerifier()`, `startAppUi?(context)` |
| Resource | `Gatekeeper<Session> extends DurableObject` | One bound resource | `describe(): ResourceDescription`, `getTypeScriptTypes()`, `getAutoApprovableActions()`, `startSession(approvalQueue)`, `getAgentCatalog?()`, `addObserver()`, `removeObserver()` |

### ⚠️ The single most important finding for our design

**Capabilities are not declared as named tools with JSON schemas.** The plan (Task 13 Step 2)
assumed an MCP-shaped registry of `{name, description, schema}`. That is not how this platform
works. Instead:

- `startSession(approvalQueue)` returns a **`Session` object whose TypeScript methods _are_ the
  capabilities**, reached over Cap'n Web RPC.
- The agent is handed **type definitions**, via `Gatekeeper.getTypeScriptTypes(): Promise<string>`
  — deliberately only the subset relevant to that resource, "rather than the entire API space of
  the vendor."
- Discovery metadata is separate and optional: `getAgentCatalog()`, bounded by
  `AGENT_CATALOG_MAX_ENTRIES = 25`, id ≤256, title ≤100, description ≤400 chars.

**Consequence for `packages/cloudflare-os-integration`:** our `handle(name, args)` dispatcher and
its `{ok, data, provenance}` envelope remain correct as the *core*, but the adapter is not a
schema registration — it is a thin `Session` class with five methods (`getRegistry`,
`getFederation`, `getSchema`, `getContextBundle`, `getPage`) each delegating to `handle()`, plus a
`types.d.ts` shipped through `getTypeScriptTypes()`. The envelope becomes the method's return
type, which is strictly better: the agent sees `provenance` in the type signature.

### Template to copy

- **`packages/gatekeeper-context`** is the closest analogue and the recommended base: it is
  auto-provisioned (no OAuth), provides an agent singleton session, implements `getAgentCatalog`,
  and ships a management UI. That is nearly our exact shape.
- `packages/gatekeeper-spotify` is the smaller/simpler read if you want the plain OAuth+resource
  pattern without the singleton machinery.
- Both use `capnweb-validate` (`validateRpc`, `skipRpcValidation`) on RPC entry points.

Package files needed: `wrangler.jsonc`, `package.json`, `tsconfig.json`,
`worker-configuration.d.ts`, `src/*.ts`, `src/types.d.ts` (+ `types.txt` for the agent).

## D2. Gatekeeper registration & deployment

**Registration is a binding change — nothing else.** From `AGENTS.md` on `packages/router`:
it routes `/gatekeeper/<name>/*` "to whichever gatekeepers are bound (**discovered by scanning its
own `GATEKEEPER_*` service bindings**, so installing a gatekeeper is purely a binding change)."

✅ **Confirmed by running it (Task 3, 2026-08-08).** In local dev it is even simpler than that:
`run-dev-server.js` (`findGatekeepers`, line 62) scans `packages/` for any directory named
`gatekeeper-*` containing a `wrangler.jsonc`, derives the binding name
(`gatekeeper-helloworld` → `GATEKEEPER_HELLOWORLD`) and writes it into a generated
`wrangler.dev.jsonc`. **Dropping the directory in is the entire install** — no config file to
edit anywhere. Verified end to end:

```
env.GATEKEEPER_HELLOWORLD (gatekeeper-helloworld#GatekeeperVendor)   Worker   local
[wrangler:info] GET /gatekeeper/helloworld/ 200 OK (4ms)
```

For the **starter**, the equivalent slot already exists: `packages/custom-gatekeeper` plus the
`workers.customGatekeeper.name` entry in `deployment.jsonc`, bound by `scripts/deploy.mjs` as
`GATEKEEPER_CUSTOM`.

**Config and secrets:**
- Per-package `wrangler.jsonc` is the source of deployment config.
- The release manifest is generated from it by `scripts/release/manifest-lib.mjs`, with
  account-specific values replaced by placeholders (`$ACCOUNT_ID`, `$WORKER_NAME(...)`,
  `$SECRET(...)`, `$PUBLIC_BASE_URL`).
- **Credential-free provisioning.** The deploy wizard defaults a gatekeeper's inputs to OAuth
  `CLIENT_ID`/`CLIENT_SECRET`, and *"the wizard blocks Install on unfilled secret inputs, so a
  spurious default makes a gatekeeper uninstallable."* org-os uses a GitHub PAT, not an OAuth app.
  On the **upstream** path that means opting out via `NO_DEFAULT_CRED_INPUTS` in
  `manifest-lib.mjs`; on the **starter** path `packages/custom-gatekeeper` already models the
  credential-free shape (`autoProvisionsAccount: true`, `providesAuth: false`, no connect flow),
  so following it avoids the trap by construction. The PAT goes in a Wrangler secret.
- Admin enable/disable is enforced at one chokepoint: `user.ts:getGatekeeperClassFor()`.

**Local dev:** `pnpm run-local` runs the whole stack on wrangler + workerd at
`http://localhost:8787`. `pnpm dev-server` runs the router in dev mode proxying to Vite.
Checks before pushing: `pnpm lint` (= `lint:check` oxlint + `types:check` recursive `tsc --noEmit`).

## D3. Capability invocation from agent chat

**The agent does not call tools — it executes code.** Per `AGENTS.md`:

- An account may declare an **ambient singleton** (`AccountDescription.singleton: { tsType }`).
- The Workshop auto-provides that singleton to the owner's workspaces as an **ambient gatekeeper
  record**, folded into each chat's env as a **named chat binding** — named by the gatekeeper's
  `suggestedBindingName`, assembled in `prepareChatBindings` (`overseer.ts`).
- The agent reads it inside **`executeCode`** via `getSession()` / `getAgentCatalog()`, and **each
  read is recorded as an observation**.

### ⚠️ This settles the open Task 14 question

The plan flagged: *"question 4 is answerable only if the agent calls capabilities mid-conversation
rather than getting one context injection at conversation start."* Because the agent runs code
per turn against a live binding, **it can invoke capabilities mid-conversation**. Acceptance
question 4 ("what tasks are urgent right now?") stands as written — it will route through
`get_page`/`get_registry` on demand. No need to widen the context bundle.

Note the binding is ambient for *chats* but **not bound to any gadget by default**; the agent
wires it into a gadget with `setGadgetBinding` when the gadget's code needs it.

## D4. Gadget → gatekeeper RPC

Transport is **Cap'n Web** over a persistent WebSocket (reference:
`packages/workshop-shared/node_modules/capnweb/README.md`; the frontend↔backend API is
`packages/workshop-shared/src/api.ts`).

The gadget does **not** fetch an endpoint. It receives the `Session` capability — the object
returned by `Gatekeeper.startSession()` — as a **named binding**, and calls methods on it
directly.

### ⚠️ Consequence for `blueprints/org-dashboard/gadget.html`

The gadget as committed imports `callCapability` from a hypothetical `./rpc.mjs` and calls
`callCapability("get_page", {...})`. That indirection is unnecessary here. The real shape is
closer to:

```js
// `orgOs` is the named binding (suggestedBindingName), injected by the Workshop.
const r = await orgOs.getPage({ instance, page_id: page });
```

The `rpc.mjs` seam should therefore become a **~3-line shim** that adapts the injected binding to
the existing `callCapability(name, args)` contract, so `gadget.html` needs no change:

```js
export const callCapability = (name, args) =>
  orgOs[name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())](args);
```

Confirm the exact binding-injection idiom against a running gadget before finalising (⚠️ — read
from source, not yet observed live).

## D5. Context ingestion

**A native mechanism exists, and the plan did not know about it: `packages/gatekeeper-context`,
"The Context Library".**

- An auto-provisioned gatekeeper whose account provides a **singleton read session + a management
  UI**, for authoring **collections of context documents that agents read as observations**.
- Two visibilities: **private** (one account) and **public** (created/edited only by deployment
  admins, **readable by everyone and auto-enabled for all users**).
- State: three Durable Objects (`ContextCollectionDurableObject`, `UserLibraryDurableObject`,
  `LibraryRegistryDurableObject`) plus a KV namespace, all namespaced by `sharingDomain`.

### Recommendation: keep `get_context_bundle`, treat the Context Library as an optional mirror

The plan called the capability route a "fallback". Given what the Context Library actually is,
**the capability is the better primary**, not a fallback:

| | `get_context_bundle` (ours) | Context Library (native) |
|---|---|---|
| Freshness | Live from git at request time | A copy, authored/pasted, drifts |
| Provenance | Every bundle stamped with commit sha | None |
| Federation | Any instance, selected per call | Per-workspace collections |
| Effort | Already built and tested | Manual authoring + upkeep |

Git is canonical in our architecture; a hand-maintained copy of `IDENTITY.md` in a workspace DO
contradicts that. **Decision: primary = `get_context_bundle`.** A public Context Library
collection holding a short "what org-os is / call `get_context_bundle` first" pointer is a cheap,
optional addition that improves cold-start behaviour without duplicating org state.

## D6. Blueprint file format

Yes — blueprints have a file representation, but **not the one we assumed**.

- A blueprint captures a **Yjs source snapshot** (stripped of edit history), **binding
  requirements** (shape only — no credentials), and metadata. It does **not** capture SQLite
  storage, chat history, or live connections.
- Exportable to a **`.gadget` archive**, importable into a different Workshop instance.
- IDs: user blueprints get a 128-bit random hex ID; **bundled** blueprints carry stable readable
  IDs (e.g. `format.document`) and ship as `<name>.gadget` + a `<name>.json` sidecar in
  `packages/workshop-backend/format-blueprints/`, globbed by
  `scripts/build-format-blueprints.mjs`. `FORMAT_BLUEPRINTS_DIR` lets a fork ship its own set
  without touching the submodule. Add one with
  `pnpm import:format-blueprint <export.gadget> --new <name>`.
- Sharing link: `https://<host>/blueprint/<blueprint-id>`. **Never edit a `blueprintId` after
  deploy** — install and promotion are keyed on it and a rename orphans the old entry.

### ⚠️ Consequence for our repo copy

`packages/cloudflare-os-integration/blueprints/org-dashboard/gadget.html` is **not directly
installable**. A `.gadget` archive is produced *from a live gadget*, so the flow is: create the
gadget in the workspace → paste our HTML as its source → export blueprint → commit the `.gadget`
next to the HTML. The HTML stays the human-editable source of truth; the `.gadget` is the
distributable artifact. `blueprints/org-dashboard/README.md` should be updated to say so.

## D7. Human-in-the-loop approval

Deeper than the plan assumed, and **directly relevant to M1**, not just M3.

**Everything goes through the approval queue.** From `Gatekeeper.startSession()`'s contract:
*"Every operation performed through this session must be submitted to the approval queue.
Observations (read-only operations) must be authorized before data is returned to the caller.
Side-effecting actions must not actually be performed until they are approved."*

- **Observations (reads — all of M1):** must call `approvalQueue.authorizeObservation()` **before
  returning data**. Each carries an `ObservationDescription { title, description }` in Markdown.
  Flags: `prohibitAllSharing` (maximally sensitive → gadget drops into lockdown, sharing forever
  prohibited) and `excludeObservers[]`. **Our four read capabilities each need an
  `authorizeObservation()` call — this is required work in Task 13, not optional.** Public repo
  data should set neither flag.
- **Actions (writes — M3):** queued, not executed. The platform's notable innovation is
  **asynchronous approval with simulation**: the gatekeeper simulates the outcome so the agent can
  keep working and queue dependent actions; the user approves later, in bulk or one-by-one.
  Approved → the overseer calls back to apply. `ActionDescription.implementsRevert` tells the UI
  whether revert is offered.
  **Good news for our M3 design:** "open a PR" is cleanly revertable (close it), so
  `implementsRevert: true` is honest — and PR-only writes fit the queue model almost exactly.
- `ActionKind { tag, label }` — `tag` is a stable policy enum; `getAutoApprovableActions()`
  returns the *potential* auto-apply set, while the per-action `autoApprovable` verdict is the
  binding gate.
- **Observer model** (`docs/observers.md`): sharing a gadget requires each new observer to have
  their own connected account with privileges covering everything the gadget has read, verified
  inside the gatekeeper's trust domain via `addObserver(id, verifier)`. For org-os reading
  **public** repos this should be permissive, but `addObserver` must still be implemented — for a
  public repo it can succeed unconditionally; for a private one it must check the observer's token
  actually grants read.

---

## M1 acceptance evidence

_(filled by Task 14 — requires the deployed workspace)_

## Adapter wiring runbook

_(filled by Task 13 — requires the M0 gate)_

Design deltas already known, to fold in when writing it:
1. Capabilities = `Session` methods + `getTypeScriptTypes()`, **not** a name/schema registry (§D1).
2. `NO_DEFAULT_CRED_INPUTS` or a custom `deploy-inputs.json`, or Install is blocked (§D2).
3. Every read capability must call `authorizeObservation()` before returning (§D7).
4. Base the package on `gatekeeper-context`, not a stock OAuth gatekeeper (§D1).
5. `rpc.mjs` is a ~3-line binding shim, not a fetch client (§D4).
6. Instances (corrected 2026-08-08): hub is `regen-coordination/org-os-template` @
   `autopoiesis-phase2-pilot`; peer is `refibcn/refi-bcn-os`. Token: fine-grained,
   `contents:read`, those two repos only. No `pull-requests:write` before M3.
