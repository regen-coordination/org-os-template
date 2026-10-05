// scripts/kms/lib/public-fields.mjs — the published surface's ALLOWLIST.
//
// The canon used to publish by DENY-LIST: publicView() (the framework's PRIVATE_FIELDS), then this
// repo's stripPrivateDeep (PRIVATE_FIELDS ∪ {surfaced_by, geometry_ref}, matched case-insensitively,
// at any depth). Everything not on that list published — at any depth, for every schema — so a
// field the canon gained later reached data/kb/, public/api/*.json and .well-known/knowledge.json
// by default. The site's own src/lib/kb-render.mjs has the other half of the story: an
// operator-approved per-schema ALLOWLIST, whose comment says exactly this ("the gate upstream fails
// closed; this file is the last line of defence and must too"). The HTML pages failed closed; the
// JSON-LD surface did not.
//
// This module is the missing half. One authoring point, one transform, fail closed:
//
//   - a field not named here is DROPPED, at any depth;
//   - an object-valued field with no per-key allowlist is dropped wholesale, never serialized (the
//     same rule the site applies, and the hole `membership` used to ride through);
//   - an array carrying a plain object is dropped unless its key has a nested allowlist — today
//     every array on the surface is scalars (codes, unit_refs, layer_refs, relevant_for), so this
//     is a guard, not a migration;
//   - `unexpectedDrops` names every drop that is NOT a known-private field, so a content field that
//     vanishes is LOUD in the re-gate (validate-published-kb.mjs) rather than a blank page a reader
//     finds later. That is the fail-closed property: adding a content field to the canon without
//     allowlisting it fails validation instead of publishing nothing.
//
// The content sets MIRROR the site's FIELD_ORDER (src/lib/kb-render.mjs), which is the
// operator-approved record of what a reader may see, plus the instance fields the org-os-territory
// layer adds. Two fields are on this list and were not on the site's — `evidence_stance` (claims)
// and `evidence` (organizations) — per the allowlist spec's D5; `covers` (territorial-unit) per D6.
// The site is expected to gain them too, and a commons test asserts each FIELD_ORDER schema's keys
// are a subset of the generated mirror this module writes (see PUBLIC_FIELDS_ARTIFACT).
//
// Decisions applied (docs/superpowers/specs/2026-09-21-rc-export-allowlist-design.md, D1–D7):
//   D1 `public_use` publishes on the JSON-LD surface; the site keeps it off the HTML page (contract
//      amendment 4) — a machine value is for machines.
//   D2 `reviewed_by` (a person's name) is private.
//   D3 citation fields publish as written; a human-readable source label is later work.
//   D4 `additional_provenance` stays private.
//   D5/D6 as above.
//   D7 this module, its generated mirror, and the two drift tests.
import { PRIVATE_FIELDS } from "../framework.mjs";

/** The fields every published object carries whatever its schema — the ones that make an object
 *  citable and auditable rather than content: who wrote it, when it was reviewed, and where it came
 *  from. `provenance` is filtered further by PROVENANCE_FIELDS. */
export const METADATA_FIELDS = [
  "title",
  "id",
  "maturity",
  "ai_assisted",
  "last_reviewed",
  "public_use",
  "source_lineage",
  "provenance",
];

/** Inside `provenance`: the citation, and only the citation. `surfaced_by` is a canon batch label —
 *  `PRIVATE_FIELDS`' own reference does not name it, so the framework strips it one level deep and
 *  this list must not re-admit it. */
export const PROVENANCE_FIELDS = ["origin", "transformation", "authorship"];

/** The public fields of an object-valued key. No entry = the whole object is dropped. */
export const NESTED_FIELDS = {
  membership: ["count", "as_of", "criteria"],
};

/** The org-os-territory instance layer's public fields, appended to each schema the way the site's
 *  FIELD_ORDER does — explicitly, schema by schema, with no "everything else" loop. */
export const INSTANCE_FIELDS = [
  "serves",
  "summary_en",
  "lang",
  "locator",
  "unit_refs",
];

/** Per schema, the only content fields that publish. In the site's render order. */
export const CONTENT_FIELDS = {
  "claim-evidence": [
    "claim",
    "evidence",
    "evidence_stance",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  "option-entry": [
    "category",
    "use_cases",
    "not_for",
    "scale",
    "context",
    "failure_modes",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  "encyclopedia-entry": [
    "summary",
    "known_tensions",
    "audience",
    "page_type",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  organization: [
    "org_type",
    "legal_form",
    "founded",
    "membership",
    "governance",
    "relation_to_public_administration",
    "url",
    "evidence",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  "relationship-record": [
    "subject",
    "predicate",
    "object",
    "evidence",
    "scope",
    "direction",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  resource: [
    "summary",
    "resource_type",
    "link_status",
    "url",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  "territorial-unit": [
    "unit_id",
    "layer",
    "level",
    "part_of",
    "covers",
    "codes",
    "area_km2",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
  "data-stream": [
    "source_system",
    "url",
    "access",
    "format",
    "licence",
    "trust",
    "cadence",
    "layer_refs",
    "relevant_for",
    "caveat",
    ...INSTANCE_FIELDS,
  ],
};

/** A schema with no entry publishes metadata and nothing else. Deliberate: a new schema arriving in
 *  the projection shows its title, its citation and its review state until someone decides, field by
 *  field, what is public — exactly what the site does with a schema it has no component or
 *  FIELD_ORDER entry for. */
export function allowedKeysFor(schema, policy = DEFAULT_FIELD_POLICY) {
  return new Set([...(policy.content[schema] ?? []), ...policy.star, ...METADATA_FIELDS]);
}

/** Loader bookkeeping, never part of what the writer reads from or emits. */
const BOOKKEEPING = new Set(["type", "slug"]);

/** The keys the framework and this repo already treat as private, for the `unexpectedDrops`
 *  diagnostic. Kept as a lowercase set to match stripPrivateDeep's case-insensitive matching.
 *
 *  The five beyond PRIVATE_FIELDS are the instance/pack wiring the SITE's own never-public list
 *  already names (`src/lib/kb-render.mjs`: `geometry_ref`, `node_did`, `node_repo`, `defined_by`,
 *  `steward`, `connector`). None is editorial content, so a drop of one is expected — and the first
 *  real territory export proved the point: without `defined_by` here, all 56 units raised the
 *  alarm, which is the guard refusing to export on data whose visibility nobody had decided. */
const INSTANCE_WIRING = [
  "geometry_ref",
  "node_did",
  "node_repo",
  "defined_by",
  "steward",
  "connector",
];
const KNOWN_PRIVATE = new Set(
  [...PRIVATE_FIELDS, "surfaced_by", ...INSTANCE_WIRING].map((k) =>
    k.toLowerCase(),
  ),
);

/** The framework's own allowlist, with nothing added. Frozen: a policy is a value, never shared state. */
export const DEFAULT_FIELD_POLICY = Object.freeze({
  content: CONTENT_FIELDS,
  star: Object.freeze([]),
  nested: NESTED_FIELDS,
});

function fieldList(value, where) {
  if (!Array.isArray(value) || value.some((f) => typeof f !== "string" || f === ""))
    throw new Error(`publish.${where} must be a list of field names`);
  for (const f of value) {
    if (KNOWN_PRIVATE.has(f.toLowerCase()))
      throw new Error(`publish.${where} names "${f}", a private field — an instance may add public fields, never publish a private one`);
  }
  return value;
}

/**
 * The allowlist a public plane publishes with: the framework's lists plus what that plane's own
 * kms.yaml adds under `publish`:
 *
 *   publish:
 *     public_fields:
 *       "*": [summary_es]          # on every schema
 *       resource: [bioma]          # on this schema alone
 *     nested_fields:
 *       contato: [rede]            # the public keys of an object-valued field
 *
 * An instance can only ADD. It cannot remove a framework field, and it cannot name a field the
 * framework holds private (KNOWN_PRIVATE, case-insensitively) — that is refused here, loudly,
 * rather than silently stripped later by the writer.
 */
export function fieldPolicy(publish = {}) {
  const extra = publish?.public_fields;
  const nestedExtra = publish?.nested_fields;
  if (extra === undefined && nestedExtra === undefined) return DEFAULT_FIELD_POLICY;
  if (extra !== undefined && !isPlainObject(extra))
    throw new Error('publish.public_fields must be a mapping of schema (or "*") to a list of field names');
  if (nestedExtra !== undefined && !isPlainObject(nestedExtra))
    throw new Error("publish.nested_fields must be a mapping of field to a list of its public keys");

  const merge = (base, add) => [...new Set([...(base ?? []), ...add])];
  const content = { ...CONTENT_FIELDS };
  let star = [];
  for (const [schema, fields] of Object.entries(extra ?? {})) {
    const list = fieldList(fields, `public_fields.${schema}`);
    if (schema === "*") star = merge([], list);
    else content[schema] = merge(content[schema], list);
  }
  const nested = { ...NESTED_FIELDS };
  for (const [key, fields] of Object.entries(nestedExtra ?? {}))
    nested[key] = merge(nested[key], fieldList(fields, `nested_fields.${key}`));
  return Object.freeze({ content, star: Object.freeze(star), nested });
}

/** A plain object: prototype is Object.prototype, or null. Anything else (Date, Buffer, RegExp,
 *  Map, Set, a class instance) is a leaf this module passes through unchanged — recursing into it
 *  via Object.entries() would rebuild it as an empty or wrong-shaped object. */
export function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** `out[k] = v` triggers Object.prototype's legacy `__proto__` accessor (Annex B) when `k` is that
 *  literal name, reassigning out's [[Prototype]] instead of creating an own property. js-yaml
 *  defends its own mapping construction against this, so a rebuild that does not would silently
 *  disagree with it. Object.defineProperty never triggers the accessor, and one code path is
 *  easier to trust than a magic-string special case nearby. */
export function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function filterNested(key, value, policy) {
  const allowed = policy.nested[key];
  const out = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(value, k))
      setOwn(out, k, value[k]);
  }
  return out;
}

function filterProvenance(value) {
  const out = {};
  for (const k of PROVENANCE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, k))
      setOwn(out, k, value[k]);
  }
  return out;
}

/** The published form of one canon object. `schema` decides the content set; everything not named
 *  is dropped. Insertion order follows the canon object, so an unchanged object produces an
 *  unchanged file — the diff of a re-export is the change, not a reshuffle. */
export function publicEntryFor(schema, canonObject, policy = DEFAULT_FIELD_POLICY) {
  const allowed = allowedKeysFor(schema, policy);
  const out = {};
  for (const [k, v] of Object.entries(canonObject ?? {})) {
    if (BOOKKEEPING.has(k) || !allowed.has(k)) continue;
    if (k === "provenance") {
      if (!isPlainObject(v)) continue;
      const p = filterProvenance(v);
      if (Object.keys(p).length > 0) setOwn(out, k, p);
      continue;
    }
    if (isPlainObject(v)) {
      // Fail closed: an object-valued content field publishes only through a per-key allowlist.
      if (!policy.nested[k]) continue;
      const filtered = filterNested(k, v, policy);
      if (Object.keys(filtered).length > 0) setOwn(out, k, filtered);
      continue;
    }
    if (Array.isArray(v) && v.some(isPlainObject)) continue; // an array of objects needs a nested rule
    setOwn(out, k, v);
  }
  return out;
}

/** Every key the allowlist drops from `canonObject` that is NOT already a known-private field, as
 *  dotted paths — the re-gate's alarm for a content field nobody allowlisted. A known-private drop
 *  (`notes`, `work_order`, `reviewed_by`, a case variant) is expected and silent; a surprising one
 *  is not. Does not recurse into a dropped key's value: the whole subtree is gone, so its shape is
 *  moot. `type`/`slug` are loader bookkeeping, not a decision. */
export function unexpectedDrops(schema, canonObject, policy = DEFAULT_FIELD_POLICY) {
  const allowed = allowedKeysFor(schema, policy);
  const out = [];
  for (const [k, v] of Object.entries(canonObject ?? {})) {
    if (BOOKKEEPING.has(k)) continue;
    if (!allowed.has(k)) {
      if (!KNOWN_PRIVATE.has(k.toLowerCase())) out.push(k);
      continue;
    }
    if (k === "provenance" && isPlainObject(v)) {
      for (const nk of Object.keys(v)) {
        if (
          !PROVENANCE_FIELDS.includes(nk) &&
          !KNOWN_PRIVATE.has(nk.toLowerCase())
        )
          out.push(`${k}.${nk}`);
      }
      continue;
    }
    if (policy.nested[k] && isPlainObject(v)) {
      for (const nk of Object.keys(v)) {
        if (!policy.nested[k].includes(nk)) out.push(`${k}.${nk}`);
      }
      continue;
    }
    if (isPlainObject(v))
      out.push(`${k} (object-valued with no nested allowlist)`);
    if (Array.isArray(v) && v.some(isPlainObject))
      out.push(`${k} (array of objects with no nested allowlist)`);
  }
  return out;
}

/** The generated mirror of this module, written into the commons as data/kb/public-fields.json by
 *  commons:export. The commons' own tests read it: one asserts nothing in the projected store sits
 *  outside it, another that the site's FIELD_ORDER cannot outrun it. Two lists in two repos would
 *  otherwise drift, and the failure is asymmetric — a field the site renders but the export drops
 *  is a blank block, a field the export allows but the site does not know shows nothing at all. */
export function publicFieldsArtifact(policy = DEFAULT_FIELD_POLICY) {
  const content = {};
  for (const schema of Object.keys(policy.content).sort())
    content[schema] = [...new Set([...policy.content[schema], ...policy.star])];
  return {
    note: "Generated by org-os-kms export from the canon (src/planes/public-fields.mjs + this plane's kms.yaml publish.public_fields). Do not edit here.",
    metadata: [...METADATA_FIELDS],
    provenance: [...PROVENANCE_FIELDS],
    instance: [...INSTANCE_FIELDS],
    nested: Object.fromEntries(
      Object.keys(policy.nested)
        .sort()
        .map((k) => [k, [...policy.nested[k]]]),
    ),
    content,
  };
}
