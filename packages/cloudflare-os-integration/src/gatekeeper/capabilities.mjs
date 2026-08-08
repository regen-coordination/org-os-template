// ── capabilities.mjs ─────────────────────────────────────────────────────────
// The gatekeeper's public surface: the read capabilities the Cloudflare OS
// workspace agent and gadgets call, plus the dispatcher that resolves a
// capability name + instance id to a substrate, runs the capability, and
// wraps the result in the envelope every caller depends on.
//
// The envelope is the contract: `handle()` must never throw and never
// reject. Every path — unknown capability, unknown instance, bad args, a
// substrate failure, a parse failure, an arbitrary thrown value — resolves to
// `{ ok: true, data, provenance }` or `{ ok: false, error: { code, message } }`.
// Task 13's Worker and Task 18's gadget both branch on `r.ok` and render
// `r.error.code`/`r.error.message` straight to the operator, so messages
// name the instance/argument at fault.
//
// Runs inside a Cloudflare Worker: no fs/path/child_process/ambient clock.
// `js-yaml` plus sibling modules only.

import yaml from "js-yaml";
import { SubstrateError } from "../substrate/memory-substrate.mjs";
import { validateInstances } from "./instances.mjs";
import { buildContextBundle } from "./context-bundle.mjs";
import { loadFederation } from "../page-core/build-state.mjs";

// `name` args (`get_registry`, `get_schema`) are interpolated into a
// substrate path (`data/${name}.yaml`, `.well-known/${name}.json`) — this is
// what stops `../SOUL` (or `/`, `.`, empty, uppercase) from escaping the
// intended directory. No leading-char rule needed (unlike instance ids):
// there's no path-segment ambiguity to worry about here.
const NAME_PATTERN = /^[a-z0-9-]+$/;

// ── the four read capabilities, in catalog order ─────────────────────────────
// Task 16 adds a fifth (`get_page`) to this array — appended, not reordered,
// so existing indices/consumers are stable.
export const READ_CAPABILITIES = ["get_registry", "get_federation", "get_schema", "get_context_bundle"];

function badArgs(message) {
  const err = new Error(message);
  err.code = "BAD_ARGS";
  throw err;
}

function validateName(name, label) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    badArgs(`${label}: name must match ${NAME_PATTERN}, got ${JSON.stringify(name)}`);
  }
  return name;
}

// ── per-capability handlers ──────────────────────────────────────────────────
// Each returns the raw `data` payload (or throws) — dispatch wraps the
// envelope and maps errors uniformly, so handlers don't touch either.

async function getRegistry(substrate, args) {
  const name = validateName(args?.name, "get_registry");
  const path = `data/${name}.yaml`;
  const content = await substrate.readFile(path);
  try {
    return yaml.load(content);
  } catch {
    const err = new Error(`registry parse failed: ${name}`);
    err.code = "UPSTREAM";
    throw err;
  }
}

async function getFederation(substrate) {
  const content = await substrate.readFile("federation.yaml");
  // loadFederation looks the file up by name in the `files` map it's given
  // (and parses it internally via js-yaml) — hand it a one-entry map built
  // from the substrate read so we reuse its parsing/shaping logic rather
  // than reimplementing it here (DRY, per the plan).
  const federation = loadFederation({ "federation.yaml": content });
  if (federation === null) {
    // loadFederation swallows YAML parse errors internally and returns null
    // (same as a missing file) — but a missing file can't happen here since
    // readFile already succeeded, so null only means "malformed YAML."
    const err = new Error("federation parse failed");
    err.code = "UPSTREAM";
    throw err;
  }
  return federation;
}

async function getSchema(substrate, args) {
  const name = validateName(args?.name, "get_schema");
  const path = `.well-known/${name}.json`;
  const content = await substrate.readFile(path);
  try {
    return JSON.parse(content);
  } catch {
    const err = new Error(`schema parse failed: ${name}`);
    err.code = "UPSTREAM";
    throw err;
  }
}

async function getContextBundle(substrate) {
  return buildContextBundle(substrate);
}

// Dispatch table: capability name -> (substrate, args) => Promise<data>.
// Adding Task 16's get_page is one entry here plus one push onto
// READ_CAPABILITIES above — no restructuring.
const HANDLERS = {
  get_registry: getRegistry,
  get_federation: getFederation,
  get_schema: getSchema,
  get_context_bundle: getContextBundle,
};

// ── error mapping ─────────────────────────────────────────────────────────────
// Every non-envelope throw funnels through here. SubstrateError and our own
// tagged BAD_ARGS/UPSTREAM errors carry a `.code`; anything else (a raw
// TypeError from a misbehaving substrate, a plain thrown string, etc.) maps
// to UPSTREAM — the catch-all for "something failed that isn't a known,
// named failure mode."
function toErrorEnvelope(err) {
  if (err instanceof SubstrateError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  if (err && typeof err.code === "string" && (err.code === "BAD_ARGS" || err.code === "UPSTREAM")) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: { code: "UPSTREAM", message } };
}

// ── createGatekeeper ──────────────────────────────────────────────────────────
// `instances` — raw instance config, validated once at construction so a
//   misconfigured deployment fails loudly here instead of per-request later.
// `substrateFor(instance)` — returns/creates the substrate for a validated
//   instance entry. Memoized per instance id within this gatekeeper instance
//   (not shared across `createGatekeeper` calls) so repeated capability calls
//   in one request reuse the same substrate — and therefore its cache and
//   `lastReadStale` state.
// `now` — injected clock, unused by the four read capabilities here but held
//   for Task 16's `get_page`, which needs `now()` for `buildState`. Don't
//   remove it as unused.

export function createGatekeeper({ instances, substrateFor, now }) {
  const validated = validateInstances(instances);
  const byId = new Map(validated.map((i) => [i.id, i]));
  const substrateCache = new Map();

  function resolveSubstrate(instance) {
    if (!substrateCache.has(instance.id)) {
      substrateCache.set(instance.id, substrateFor(instance));
    }
    return substrateCache.get(instance.id);
  }

  async function handle(name, args) {
    try {
      if (typeof name !== "string" || !READ_CAPABILITIES.includes(name)) {
        return { ok: false, error: { code: "UNKNOWN_CAPABILITY", message: `unknown capability: ${JSON.stringify(name)}` } };
      }

      const instanceId = args?.instance;
      const instance = typeof instanceId === "string" ? byId.get(instanceId) : undefined;
      if (!instance) {
        return { ok: false, error: { code: "UNKNOWN_INSTANCE", message: `unknown instance: ${JSON.stringify(instanceId)}` } };
      }

      const substrate = resolveSubstrate(instance);
      const handler = HANDLERS[name];
      const data = await handler(substrate, args);

      // Read staleness *after* the capability's reads complete — reading it
      // earlier would report the previous call's staleness, not this one's.
      const head = await substrate.head();
      const stale = substrate.lastReadStale === true;

      return {
        ok: true,
        data,
        provenance: { instance: instance.id, sha: head.sha, date: head.date, stale },
      };
    } catch (err) {
      return toErrorEnvelope(err);
    }
  }

  return { handle };
}
