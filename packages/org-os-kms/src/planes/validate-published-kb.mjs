// scripts/kms/lib/validate-published-kb.mjs — re-gates the published store (<commons>/data/kb/)
// against the CANON's live context (kb.sourceSystems, kb.boundaries), independently of
// whatever wrote it. Catches drift: a boundary added to the canon after an object was
// published, a private field that leaked through some other writer, a public_use the
// framework floor no longer accepts, a canon object demoted/retracted after publication,
// or a published copy that no longer matches what an export would write today.
//
// CALLER CONTRACT: `kb` must be the CANON's loadKb(data/kb/) result — never call loadKb
// on <commons>/data/kb itself (the published store has no index.json and is a projection,
// not a second canon).
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  isPublishable as canonIsPublishable,
  validateCards,
  validateBoundaries,
} from "./publication-gate.mjs";
import {
  leakedPaths,
  isPlainObject,
  expectedPublishedEntry,
} from "./write-published-kb.mjs";
import { unexpectedDrops } from "./public-fields.mjs";
import { cmp } from "./constants.mjs";
import {
  isPublishable as frameworkIsPublishable,
  PUBLISHABLE_PUBLIC_USE,
  PUBLISHABLE_TYPES,
} from "../framework.mjs";

const SOURCE_SYSTEM_NAMES = ["source-system.yaml", "source-system.yml"];
const YAML_EXT_RE = /\.ya?ml$/;
const TOP_LEVEL_RE = /^[^.[]+$/;

// ROUND C: fields that mark something as a CONTENT object or an editorial decision about one — a
// self card is neither, so carrying any of these is itself the tell that a content-shaped object
// (or a decision about one) was smuggled into data/kb/source-system.yaml instead of a real
// resource/signal/etc. schema file. Not the same rule as validateCards (which demands a corpus
// prefix a self card must NOT need) — this is a narrower, self-card-specific shape check.
const SELF_CARD_DISALLOWED_FIELDS = [
  "maturity",
  "source_lineage",
  "provenance",
  "additional_provenance",
  "high_risk",
  "publish",
];

/** A self card must look like a card describing the commons itself: a non-empty title and type,
 *  and none of the fields that mark a content object or an editorial decision about one. Returns
 *  error strings (empty = shape is fine) — independent of validateCards, which this path no longer
 *  calls (see the comment on validateSourceSystemFile below). */
function selfCardShapeErrors(key, entry) {
  const errors = [];
  if (typeof entry.title !== "string" || entry.title.trim() === "")
    errors.push(`${key}: self card must have a non-empty "title"`);
  if (typeof entry.type !== "string" || entry.type.trim() === "")
    errors.push(`${key}: self card must have a non-empty "type"`);
  for (const f of SELF_CARD_DISALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(entry, f))
      errors.push(
        `${key}: self card must not carry "${f}" — that marks a content object, not a card describing the commons itself`,
      );
  }
  return errors;
}

function schemaOf(filename) {
  return filename.replace(YAML_EXT_RE, "");
}

function findSourceSystemFile(publishedDir) {
  for (const name of SOURCE_SYSTEM_NAMES) {
    const full = path.join(publishedDir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Reuses the exact matching rule write-published-kb.mjs strips by (PRIVATE_FIELDS ∪
// surfaced_by, matched case-insensitively, at any depth) so the writer and this re-gate
// cannot silently drift apart. A top-level leak is reported as one grouped line (matching
// the vendored publicView's own top-level-only wording); anything nested is its own line,
// dotted-path-qualified, since "leaked at some depth" needs the path to be actionable.
function leakLines(key, entry) {
  const paths = leakedPaths(entry);
  const top = paths.filter((p) => TOP_LEVEL_RE.test(p)).sort(cmp);
  const nested = paths.filter((p) => !TOP_LEVEL_RE.test(p)).sort(cmp);
  const out = [];
  if (top.length)
    out.push(`${key}: private field(s) leaked: ${top.join(", ")}`);
  for (const p of nested) out.push(`${key}: ${p} leaked`);
  return out;
}

// Byte-for-byte equality for Buffer / any TypedArray / DataView — everything ArrayBuffer.isView
// recognises, which is exactly what a !!binary value decodes to. Two independent decodes of the
// same base64 are never the same instance, so reference equality alone always disagrees.
function typedArrayBytesEqual(a, b) {
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength)
    return false;
  const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < av.length; i += 1) if (av[i] !== bv[i]) return false;
  return true;
}

// A value equal to itself for diffing purposes — mirroring stripPrivateDeep's own notion of an
// opaque leaf (Date, Buffer/typed arrays/DataView, RegExp, Map, Set, or any other non-plain-object
// instance), not a blanket `===`. The expected side comes from the canon's own yaml.load, the
// actual side from a second, independent yaml.load of the published file, so identical values are
// NEVER the same instance — `===` alone would flag every one of these as a false divergence on a
// perfectly correct export.
function valuesEqual(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    return (
      ArrayBuffer.isView(a) &&
      ArrayBuffer.isView(b) &&
      typedArrayBytesEqual(a, b)
    );
  }
  if (a instanceof RegExp || b instanceof RegExp) {
    return (
      a instanceof RegExp &&
      b instanceof RegExp &&
      a.source === b.source &&
      a.flags === b.flags
    );
  }
  // Map/Set — and any other non-plain-object instance not called out above, e.g. a class
  // instance — fall through to reference equality via Object.is. This repo's data has no
  // legitimate use for a Map or Set inside a knowledge object, so there is no real fixture to
  // validate a structural comparison against, and guessing at Map/Set equality semantics (key
  // order? per-entry Object.is? nested Maps?) would be worse than being explicit that it is not
  // attempted. Object.is also fixes the plain-scalar case: NaN must equal NaN, which `===` does
  // not agree with even for itself.
  return Object.is(a, b);
}

// Precise structural diff between what an export would write (`expected`) and what is actually
// on disk (`actual`): every dotted/bracketed path at which the two disagree. Empty = identical.
// Walks the same shapes write-published-kb.mjs's own isPlainObject recognises, so a Date/Buffer/
// RegExp/etc. is compared as a value, never mis-walked as an object with no properties (which
// would silently treat "any two dates" as equal).
// Exported for the comparator's own unit tests: several YAML value shapes (a Date, binary, NaN)
// have no place on the allowlisted surface any more, so their round-trip property is pinned here,
// against the comparator directly, rather than through an export that would drop them.
export function diffPaths(expected, actual, prefix = "") {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (
      !Array.isArray(expected) ||
      !Array.isArray(actual) ||
      expected.length !== actual.length
    ) {
      return [prefix || "(root)"];
    }
    const out = [];
    expected.forEach((v, i) =>
      out.push(
        ...diffPaths(v, actual[i], prefix ? `${prefix}[${i}]` : `[${i}]`),
      ),
    );
    return out;
  }
  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual))
      return [prefix || "(root)"];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const out = [];
    for (const k of keys)
      out.push(
        ...diffPaths(expected[k], actual[k], prefix ? `${prefix}.${k}` : k),
      );
    return out;
  }
  return valuesEqual(expected, actual) ? [] : [prefix || "(root)"];
}

/** Human-readable reason the framework floor (packages/.../framework.mjs isPublishable) refused
 *  this published entry — recomputed rather than threaded through, since the floor itself only
 *  returns a boolean. `types` is the same list the floor was called with (see validatePublishedKb),
 *  never the framework's core default: reading PUBLISHABLE_TYPES here while the floor was handed
 *  the commons' own list would make the two disagree about extension-pack types. */
function frameworkFloorReason(entry, schema, types) {
  if (!types.includes(schema)) {
    return `schema ${JSON.stringify(schema)} is not a publishable type here (opt-in types like person/source-system/public-use-boundary, and any extension-pack type this commons has not opted into, are excluded)`;
  }
  if (entry?.maturity === "held") return "maturity is held";
  if (!PUBLISHABLE_PUBLIC_USE.includes(entry?.public_use))
    return `public_use ${JSON.stringify(entry?.public_use)} is not publishable`;
  return "rejected by the framework floor";
}

/** True if the canon holds at least one object of this schema that currently passes the canon
 *  gate — i.e. an empty published file for this schema would be suspicious, not just quiet. */
function canonHasPublishableSchema(kb, schema) {
  return Object.values(kb?.objects ?? {}).some(
    (o) => o?.type === schema && canonIsPublishable(o, kb).ok,
  );
}

function validateEntry(key, schema, slug, entry, kb, types) {
  const errors = [];

  // Invariant: the commons' data/kb holds ONLY projected objects that passed both
  // gates. A published entry whose canon counterpart was later deleted/retracted
  // from data/kb/*.yaml is a hard error — the projected copy has no right to exist.
  const canonObj = kb?.objects?.[key];
  if (!canonObj) {
    errors.push(`${key}: no such object in the canon`);
  } else {
    // Re-run the canon gate on the CANON object, not just the stale projected copy —
    // a canon object demoted after publication (maturity back to raw, high_risk set,
    // a new boundary) must fail validation even though the projected copy still
    // looks clean.
    const canonVerdict = canonIsPublishable(canonObj, kb);
    if (!canonVerdict.ok) {
      errors.push(
        `${key}: canon counterpart rejected by the canon gate — ${canonVerdict.reason}`,
      );
    }
    // The canon gate only blocks raw-lead/internal-only outright — a canon public_use that
    // drifts to some OTHER non-floor value (e.g. 'needs-review') still passes the gate (it may
    // still be `publish: true`-eligible) but is not something the framework floor would ever
    // let out. Checked against the CANON value specifically: if the published copy happens to
    // carry the same stale value (nobody has re-exported since), a diff against it would find
    // nothing, and this is the only check left that still catches it.
    if (!PUBLISHABLE_PUBLIC_USE.includes(canonObj.public_use)) {
      errors.push(
        `${key}: canon public_use ${JSON.stringify(canonObj.public_use)} is not publishable`,
      );
    }
    // The strongest check: recompute what an export would write for this canon object today,
    // and diff it against what is actually published. Subsumes "wrong id", "smuggled field",
    // "rewritten title" and any other divergence in one mechanism that cannot go stale field by
    // field — it is the same transform the writer itself applies.
    const { type: _type, slug: _slug, ...actualForDiff } = entry;
    const diffs = diffPaths(
      expectedPublishedEntry(schema, canonObj),
      actualForDiff,
    );
    if (diffs.length) {
      errors.push(
        `${key}: published copy diverges from the canon projection at: ${diffs.join(", ")}`,
      );
    }
    // And the fail-closed alarm the deny-list could not give: name every field the ALLOWLIST drops
    // from this canon object that is not already a known-private one. A content field nobody
    // allowlisted would otherwise publish as nothing at all — silently, and only in the JSON-LD
    // surface and the pages, where a reader would find it missing long after the fact. Making it a
    // validation error means the canon must decide a new field's visibility before it ships.
    const dropped = unexpectedDrops(schema, canonObj);
    if (dropped.length) {
      errors.push(
        `${key}: canon field(s) not on the public allowlist (add to public-fields.mjs or mark private): ${dropped.join(", ")}`,
      );
    }
  }

  const verdict = canonIsPublishable({ ...entry, type: schema, slug }, kb);
  if (!verdict.ok)
    errors.push(`${key}: rejected by the canon gate — ${verdict.reason}`);
  if (!PUBLISHABLE_PUBLIC_USE.includes(entry.public_use)) {
    errors.push(
      `${key}: public_use ${JSON.stringify(entry.public_use)} is not publishable`,
    );
  }
  // The framework floor's type allowlist (PUBLISHABLE_TYPES) is a SEPARATE gate from the canon
  // gate above — the canon gate has no opinion on schema at all, so a `person` (or any opt-in-
  // only/unknown schema) object dropped straight into the published store, with an otherwise
  // spotless public_use and maturity, passes the canon gate cleanly. Only the framework floor
  // refuses it.
  if (!frameworkIsPublishable(entry, { schema, types })) {
    errors.push(
      `${key}: framework floor rejects this entry — ${frameworkFloorReason(entry, schema, types)}`,
    );
  }
  if (!entry.id) errors.push(`${key}: missing id`);
  errors.push(...leakLines(key, entry));
  return errors;
}

// source-system.yaml is the commons' self card — the one file under data/kb/ this repo's own
// writer never rewrites (write-published-kb.mjs PRESERVEs it), so a leak or a smuggled object
// there is permanent until an operator notices by hand. Scanned as thoroughly as any other entry:
// the one-entry rule, public_use, and every leak at any depth.
//
// ROUND B: this path used to also run the entry through validateCards, on the theory that a
// resource-shaped object smuggled in as the sole entry (no origin_prefixes/url) has no corpus
// prefix, which validateCards reports. That theory was wrong for the self card specifically: a
// self card describes the COMMONS ITSELF, not a source container, so it has no corpus to claim a
// prefix over and must not be required to look like one. In production this made commons:validate
// fail against the real, correctly-scaffolded regenerant-catalunya-commons self card with "no
// corpus-path prefix … this card claims nothing" — a false positive on the one file that was never
// supposed to need one. validateCards/validateBoundaries over the CANON's own cards (see
// validatePublishedKb below) is unaffected — only this self-card path drops the call.
//
// ROUND C: dropping validateCards silently dropped its wrongly-shaped-entry rejection too — it was
// the same rule. Without ANY structural check, a resource-shaped sole entry ({title, maturity,
// public_use, source_lineage}) validated clean once smuggled into the one published file the
// exporter never rewrites, making it permanent until an operator noticed by hand. selfCardShapeErrors
// is the narrow, self-card-specific replacement: a real title/type, and none of the fields that mark
// a content object or an editorial decision about one.
function validateSourceSystemFile(publishedDir) {
  const full = findSourceSystemFile(publishedDir);
  if (!full) return { errors: [] };
  const label = path.basename(full);
  let raw;
  try {
    raw = yaml.load(fs.readFileSync(full, "utf8"));
  } catch (e) {
    return { errors: [`${label}: unloadable — ${e.message}`] };
  }
  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    return { errors: [`${label}: document is not a mapping`] };
  }
  const doc = raw ?? {};
  if (doc.entries !== undefined && !isPlainObject(doc.entries)) {
    return { errors: [`${label}: entries is not a mapping`] };
  }
  const errors = [];
  const entries = doc.entries ?? {};
  const slugs = Object.keys(entries);
  if (slugs.length !== 1) {
    errors.push(
      `${label}: expected exactly one entry (the commons' self card), found ${slugs.length}`,
    );
  }
  for (const [slug, rawEntry] of Object.entries(entries)) {
    const entry = rawEntry ?? {};
    const key = `source-system:${slug}`;
    if (!PUBLISHABLE_PUBLIC_USE.includes(entry.public_use)) {
      errors.push(
        `${key}: public_use ${JSON.stringify(entry.public_use)} is not publishable`,
      );
    }
    errors.push(...selfCardShapeErrors(key, entry));
    errors.push(...leakLines(key, entry));
  }
  return { errors };
}

/**
 * Re-gates every entry in the published kb store (<commons>/data/kb/*.yaml) against the
 * CANON's live context. Returns an array of error strings (empty = clean).
 *
 * `publishedDir` — the published store's data/kb directory (e.g. <commons>/data/kb).
 * `kb` — the canon's loadKb(data/kb) result. `.sourceSystems` and `.boundaries` are read
 * as the isPublishable ctx; `.objects` (keyed `${type}:${slug}`, per kb-loader.mjs) is
 * read to enforce the invariant that data/kb holds ONLY projected objects that passed
 * both gates — a published entry with no canon counterpart, or whose canon counterpart
 * no longer passes the canon gate, is a hard error.
 *
 * Also lints the CANON's own control data (validateCards / validateBoundaries) for the
 * same reason export-commons does: a malformed held_prefixes or an unusable boundary
 * record is a silent safety failure, and commons:validate is the standing check an
 * operator runs — it must not depend on someone having just run an export to catch it.
 *
 * `types` — the publish-eligible type list of the commons whose store this is, from
 * loadCommonsPolicy({ commonsDir }). It must be the SAME list the exporter selected with, or the
 * re-gate and the exporter disagree in one of two bad directions: a legitimately opted-in
 * territorial-unit reported as "not a publishable type" on every run, or (if this defaulted
 * wider than the exporter) a type nobody opted into validating clean. Defaulting to the
 * framework's core list keeps every caller that publishes only core types working unchanged.
 */
export function validatePublishedKb({
  publishedDir,
  kb,
  types = PUBLISHABLE_TYPES,
}) {
  const errors = [];
  errors.push(
    ...validateCards(kb?.sourceSystems),
    ...validateBoundaries(kb?.boundaryRecords),
  );

  if (!fs.existsSync(publishedDir)) return errors;

  const { errors: ssErrors } = validateSourceSystemFile(publishedDir);
  errors.push(...ssErrors);

  const sourceSystemFile = findSourceSystemFile(publishedDir);
  const files = fs
    .readdirSync(publishedDir)
    .filter(
      (f) =>
        YAML_EXT_RE.test(f) && path.join(publishedDir, f) !== sourceSystemFile,
    )
    .sort();
  for (const f of files) {
    const schema = schemaOf(f);
    let raw;
    try {
      raw = yaml.load(fs.readFileSync(path.join(publishedDir, f), "utf8"));
    } catch (e) {
      errors.push(`${f}: unloadable — ${e.message}`);
      continue;
    }
    if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
      errors.push(`${f}: document is not a mapping`);
      continue;
    }
    const doc = raw ?? {};
    if (doc.entries !== undefined && !isPlainObject(doc.entries)) {
      errors.push(`${f}: entries is not a mapping`);
      continue;
    }
    const entries = doc.entries ?? {};
    if (Object.keys(entries).length === 0) {
      // An empty published file is legal ONLY if the canon truly has nothing publishable for
      // this schema — write-published-kb.mjs never even emits a file with no entries, so one
      // that exists, is empty, and the canon DOES have a publishable object for, means either a
      // stale file that should have been deleted or an export that silently dropped something.
      if (canonHasPublishableSchema(kb, schema)) {
        errors.push(
          `${f}: entries is empty but the canon has a publishable object of schema ${JSON.stringify(schema)} — this file should not exist, or should project it`,
        );
      }
      continue;
    }
    for (const [slug, entry] of Object.entries(entries)) {
      const key = `${schema}:${slug}`;
      errors.push(...validateEntry(key, schema, slug, entry ?? {}, kb, types));
    }
  }
  return errors;
}
