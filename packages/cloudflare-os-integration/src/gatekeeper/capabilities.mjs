// ── capabilities.mjs ─────────────────────────────────────────────────────────
// The gatekeeper's public surface: the read capabilities the Cloudflare OS
// workspace agent and gadgets call, plus the dispatcher that resolves a
// capability name + instance id to a substrate, runs the capability, and
// wraps the result in the envelope every caller depends on.
//
// The envelope is the contract: `handle()` must never throw and never
// reject. Every path — unknown capability, unknown instance, bad args, a
// substrate failure, a parse failure, an arbitrary thrown value — resolves to
// `{ ok: true, data, provenance }` or
// `{ ok: false, error: { code, message, detail? } }`.
//
// `error.message` vs `error.detail`: Task 18's gadget renders `error.message`
// **verbatim to a non-technical org member** in a browser. `message` is
// therefore always operator-facing — plain language, names the instance and
// the argument at fault, never a regex, an HTTP status/body snippet, or an
// internal path shape. `detail`, when present, carries the technical text
// (the original `SubstrateError` message — which may include a raw upstream
// response snippet per `github-substrate.mjs`'s `_errorSnippet` — a parser
// exception message, or the exact validation pattern) for logs/debugging
// only. **Never render `detail` to an operator.**
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

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── CapabilityError ──────────────────────────────────────────────────────────
// The only error type handlers below throw on purpose (as opposed to letting
// a substrate's own SubstrateError or a stray bug propagate). `message` is
// operator-facing per the header note above; `detail` is optional diagnostic
// text. `toErrorEnvelope` unpacks both directly into the envelope.
class CapabilityError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "CapabilityError";
    this.code = code;
    this.detail = detail;
  }
}

function badArgs(message, detail) {
  throw new CapabilityError("BAD_ARGS", message, detail);
}

function validateName(name, kind) {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    badArgs(
      `"${String(name)}" isn't a valid ${kind} name — use lowercase letters, numbers, and hyphens.`,
      `name must match ${NAME_PATTERN}, got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

// Catches a thrown SubstrateError and re-throws it as a CapabilityError with
// an operator-facing message naming `what` (e.g. `the "projects" registry`,
// `the federation config`) and `instanceId`. The original SubstrateError
// message — which for GitHubSubstrate's UPSTREAM case can include a raw
// upstream response snippet (see github-substrate.mjs's _errorSnippet) —
// becomes `detail`, never `message`. Non-SubstrateError throws pass through
// unchanged so the caller's own handling (or the top-level catch-all) can
// deal with them.
function wrapSubstrateError(err, { what, instanceId }) {
  if (!(err instanceof SubstrateError)) throw err;
  if (err.code === "NOT_FOUND") {
    throw new CapabilityError(
      "NOT_FOUND",
      `${cap(what)} doesn't exist for instance "${instanceId}".`,
      err.message,
    );
  }
  // UPSTREAM (or, defensively, any other substrate-defined code) — the
  // backend itself failed. Never surface its raw message to an operator.
  throw new CapabilityError(
    err.code,
    `Couldn't load ${what} for instance "${instanceId}" — the upstream source failed.`,
    err.message,
  );
}

// ── per-capability handlers ──────────────────────────────────────────────────
// Each returns the raw `data` payload (or throws) — dispatch wraps the
// envelope and maps errors uniformly, so handlers don't touch either.
//
// Signature: (substrate, args, ctx) => Promise<data>, where
// `ctx = { now, instanceId }`. `now` is the factory-injected clock (unused by
// all four capabilities here — Task 16's get_page is the first to read it,
// via `buildState(files, { now: now() })`). `instanceId` is the resolved
// instance's id, used to build operator-facing error messages. Adding a
// capability means adding one function with this signature plus one entry
// in HANDLERS and one push onto READ_CAPABILITIES above — no restructuring.

async function getRegistry(substrate, args, ctx) {
  const name = validateName(args?.name, "registry");
  const path = `data/${name}.yaml`;
  let content;
  try {
    content = await substrate.readFile(path);
  } catch (err) {
    wrapSubstrateError(err, { what: `the "${name}" registry`, instanceId: ctx.instanceId });
  }
  try {
    return yaml.load(content);
  } catch (parseErr) {
    throw new CapabilityError(
      "UPSTREAM",
      `The "${name}" registry for instance "${ctx.instanceId}" couldn't be read — it contains invalid data.`,
      `registry parse failed: ${name}: ${parseErr.message}`,
    );
  }
}

async function getFederation(substrate, args, ctx) {
  let content;
  try {
    content = await substrate.readFile("federation.yaml");
  } catch (err) {
    wrapSubstrateError(err, { what: "the federation config", instanceId: ctx.instanceId });
  }
  // loadFederation looks the file up by name in the `files` map it's given
  // (and parses it internally via js-yaml) — hand it a one-entry map built
  // from the substrate read so we reuse its parsing/shaping logic rather
  // than reimplementing it here (DRY, per the plan).
  const federation = loadFederation({ "federation.yaml": content });
  if (federation === null) {
    // loadFederation swallows YAML parse errors internally and returns null
    // (same as a missing file) — but a missing file can't happen here since
    // readFile already succeeded, so null only means "malformed YAML."
    throw new CapabilityError(
      "UPSTREAM",
      `The federation config for instance "${ctx.instanceId}" couldn't be read — it contains invalid data.`,
      "federation parse failed",
    );
  }
  return federation;
}

async function getSchema(substrate, args, ctx) {
  const name = validateName(args?.name, "schema");
  const path = `.well-known/${name}.json`;
  let content;
  try {
    content = await substrate.readFile(path);
  } catch (err) {
    wrapSubstrateError(err, { what: `the "${name}" schema`, instanceId: ctx.instanceId });
  }
  try {
    return JSON.parse(content);
  } catch (parseErr) {
    throw new CapabilityError(
      "UPSTREAM",
      `The "${name}" schema for instance "${ctx.instanceId}" couldn't be read — it contains invalid data.`,
      `schema parse failed: ${name}: ${parseErr.message}`,
    );
  }
}

async function getContextBundle(substrate, args, ctx) {
  try {
    return await buildContextBundle(substrate);
  } catch (err) {
    wrapSubstrateError(err, { what: "the context bundle", instanceId: ctx.instanceId });
  }
}

// Dispatch table: capability name -> (substrate, args, ctx) => Promise<data>.
// Adding Task 16's get_page is one entry here plus one push onto
// READ_CAPABILITIES above — no restructuring.
const HANDLERS = {
  get_registry: getRegistry,
  get_federation: getFederation,
  get_schema: getSchema,
  get_context_bundle: getContextBundle,
};

// ── error mapping ─────────────────────────────────────────────────────────────
// Every non-envelope throw funnels through here. CapabilityError (thrown by
// the handlers above, always with an operator-safe message) unpacks
// directly. A SubstrateError that escapes *without* having been wrapped by a
// handler (defensive — every current handler wraps its own substrate reads,
// but a future one might not) falls back to a generic operator message so
// its raw text never reaches a display layer, with the original message kept
// as `detail`. Anything else (a raw TypeError from a misbehaving substrate,
// a plain thrown string, thrown `undefined`, ...) maps to UPSTREAM with a
// generic operator message and the best-effort stringified value as detail —
// the catch-all for "something failed that isn't a known, named failure
// mode."
function toErrorEnvelope(err) {
  if (err instanceof CapabilityError) {
    const error = { code: err.code, message: err.message };
    if (err.detail !== undefined) error.detail = err.detail;
    return { ok: false, error };
  }
  if (err instanceof SubstrateError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: "Something failed while loading data from the source instance.",
        detail: err.message,
      },
    };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    error: {
      code: "UPSTREAM",
      message: "An unexpected error occurred while handling this request.",
      detail,
    },
  };
}

// ── createGatekeeper ──────────────────────────────────────────────────────────
// `instances` — raw instance config, validated once at construction so a
//   misconfigured deployment fails loudly here instead of per-request later.
// `substrateFor(instance)` — returns/creates the substrate for a validated
//   instance entry. Memoized per instance id within this gatekeeper instance
//   (not shared across `createGatekeeper` calls) so repeated capability calls
//   in one request reuse the same substrate — and therefore its cache and
//   `lastReadStale` state.
// `now` — injected clock, threaded into every handler call as `ctx.now`.
//   Unused by the four read capabilities here; held (and passed down) for
//   Task 16's `get_page`, which needs `now()` for `buildState`.

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
        return {
          ok: false,
          error: { code: "UNKNOWN_CAPABILITY", message: `"${String(name)}" isn't a capability this gatekeeper supports.` },
        };
      }

      const instanceId = args?.instance;
      const instance = typeof instanceId === "string" ? byId.get(instanceId) : undefined;
      if (!instance) {
        return {
          ok: false,
          error: { code: "UNKNOWN_INSTANCE", message: `"${String(instanceId)}" isn't a configured instance.` },
        };
      }

      const substrate = resolveSubstrate(instance);
      const handler = HANDLERS[name];
      const data = await handler(substrate, args, { now, instanceId: instance.id });

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
