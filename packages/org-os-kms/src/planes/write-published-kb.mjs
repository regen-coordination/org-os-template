// The published store: projected, deterministic, rewritten each run. Preserves source-system.yaml
// (the commons' own self card) — the only file under data/kb/ this writer does not own.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { NEVER_RENDERED_TYPES } from "./publication-gate.mjs";
import { YAML_OPTS, cmp } from "./constants.mjs";
import { PRIVATE_FIELDS } from "../framework.mjs";
import {
  publicEntryFor,
  isPlainObject,
  setOwn,
  publicFieldsArtifact,
} from "./public-fields.mjs";
import { assertInsideCommons } from "./safe-write.mjs";

// Re-exported: the re-gate and the tests walk published-vs-canon values with the SAME plain-object
// predicate the writer uses, so it cannot mean two different things in two files.
export { isPlainObject };

const PRESERVE = new Set(["source-system.yaml"]);

// publicView (vendored, zero-edit) only strips PRIVATE_FIELDS at the top level, plus
// provenance.surfaced_by one level deep. Editorial internals nest arbitrarily
// (provenance.reviewer.consent_note, an array element carrying `notes`, a differently-cased
// `Notes`) and the vendored function cannot be changed, so this repo's own writer strips again,
// recursively, matching keys case-insensitively, after publicView has already run.
//
// `geometry_ref` is this repo's own addition to that set, not the framework's: contract §8 —
// "geometry is never in the canon's published surface". It is a CANON-side pointer at a GeoJSON
// file the commons does not carry (the site keeps its own geometry in public/geo/ and joins on the
// unit's code), so a projected copy would name a path that resolves to nothing there while
// advertising the canon's internal layout. The framework's PRIVATE_FIELDS knows nothing about the
// territory pack, so without this the field would reach the published store untouched.
//
// WHAT THIS SET IS NOW: a DIAGNOSTIC, not the publication rule. The rule is the allowlist in
// public-fields.mjs (its per-schema set is now what decides what may publish, and `leakedPaths`
// below names a private key only as a belt-and-braces alarm). Deleting this set would silence that
// alarm; deleting the allowlist would reopen the hole, so both exist on purpose.
const STRIP_KEYS = new Set(
  [...PRIVATE_FIELDS, "surfaced_by", "geometry_ref"].map((k) =>
    k.toLowerCase(),
  ),
);

// stripPrivateDeep and leakedPaths are the DIAGNOSTIC HALF: they name a private key that reached
// the published store (or the preserved self card) from any writer. The publication rule is
// publicEntryFor's allowlist; these stay because "a known-private field is present" is a louder,
// more specific alarm than "the copy diverges", and because the self card — a file this writer never
// rewrites — is scanned with them alone (validateSourceSystemFile). The plain-object predicate and
// setOwn live in public-fields.mjs now, so the writer, the re-gate and the allowlist share exactly
// one definition of each.

// Exported for direct unit-testing of the prototype check (a real null-prototype object is not
// reachable through the export pipeline's YAML-sourced fixtures — those always parse to ordinary
// Object.prototype maps — so the pin needs a hand-built object).
export function stripPrivateDeep(value) {
  if (Array.isArray(value)) return value.map(stripPrivateDeep);
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (STRIP_KEYS.has(k.toLowerCase())) continue;
      setOwn(out, k, stripPrivateDeep(v));
    }
    return out;
  }
  return value;
}

// The re-gate (validate-published-kb.mjs) needs to DETECT exactly what this writer STRIPS, so a
// leak the writer would have caught is never silently missed by the validator, and the two checks
// cannot drift apart. Walks the same shapes stripPrivateDeep does (plain objects and arrays only;
// a Date/Buffer/RegExp/etc. is opaque and cannot carry a leaked key) and reports every matching key
// as a dotted path from the root — `notes`, `provenance.surfaced_by`, `items[0].consent_note`.
// Does not recurse into a matched key's value: stripPrivateDeep would have dropped the whole
// subtree, so anything nested under a leak is moot.
export function leakedPaths(value, prefix = "") {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      out.push(...leakedPaths(v, prefix ? `${prefix}[${i}]` : `[${i}]`)),
    );
    return out;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const kp = prefix ? `${prefix}.${k}` : k;
      if (STRIP_KEYS.has(k.toLowerCase())) out.push(kp);
      else out.push(...leakedPaths(v, kp));
    }
  }
  return out;
}

// The re-gate's other, stronger check: not "did a known-private field leak" but "does this
// published entry match what an export WOULD write today". Applies the same transform this writer
// applies — the allowlist in public-fields.mjs — to a CANON object, so a comparison against the
// actually-published copy is a diff against ground truth rather than another enumerated list of
// fields that can go stale. `type` and `slug` are loadKb's own injected bookkeeping (see
// kb-loader.mjs) — never part of what this writer reads from or emits — so they are dropped before
// the transform; the caller must drop the same two keys from the published side before comparing,
// or every entry will show a spurious diff. The allowlist drops them too (BOOKKEEPING), so the two
// sides cannot disagree about them.
export function expectedPublishedEntry(schema, canonObj, fields) {
  const { type: _type, slug: _slug, ...rest } = canonObj ?? {};
  return publicEntryFor(schema, rest, fields);
}

export function writePublishedKb({ selected, outDir, fields }) {
  const dir = path.join(outDir, "data", "kb");
  // Every write/mkdir/unlink below targets the commons, and each is routed through
  // assertInsideCommons individually — the up-front assertCommonsTarget check in export-commons.mjs
  // only resolved outDir and outDir/data/kb once; it did not and cannot resolve every path this
  // writer later constructs (a schema file name, a preserved-file exclusion). A symlink placed at
  // any intermediate segment (e.g. outDir/data itself) is only caught here, at the moment of the
  // actual write.
  assertInsideCommons(outDir, dir);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".yaml") || PRESERVE.has(f)) continue;
    const target = path.join(dir, f);
    assertInsideCommons(outDir, target);
    fs.unlinkSync(target);
  }
  const bySchema = new Map();
  for (const { schema, ref, object } of selected) {
    if (NEVER_RENDERED_TYPES.includes(schema))
      throw new Error(`never-rendered schema in selection: ${schema}`);
    const slug = ref.slice(ref.lastIndexOf("#") + 1);
    if (!bySchema.has(schema)) bySchema.set(schema, {});
    // The writer and the re-gate's `expectedPublishedEntry` transform must be the SAME call, not
    // two calls that happen to do the same thing — coupled by construction, not by convention.
    bySchema.get(schema)[slug] = expectedPublishedEntry(schema, object, fields);
  }
  const written = [];
  for (const schema of [...bySchema.keys()].sort(cmp)) {
    const entries = Object.fromEntries(
      Object.entries(bySchema.get(schema)).sort(([a], [b]) => cmp(a, b)),
    );
    const rel = path.join("data", "kb", `${schema}.yaml`);
    const target = path.join(outDir, rel);
    assertInsideCommons(outDir, target);
    fs.writeFileSync(target, yaml.dump({ entries }, YAML_OPTS));
    written.push(rel);
  }
  // The allowlist's own mirror, written beside the store it governs: the commons' tests read it to
  // prove nothing in data/kb sits outside it and that the site's FIELD_ORDER cannot outrun it. Not
  // `.yaml`, so the prune loop above never touches it and the store loader never reads it.
  const publicFields = path.join("data", "kb", "public-fields.json");
  const artifactTarget = path.join(outDir, publicFields);
  assertInsideCommons(outDir, artifactTarget);
  fs.writeFileSync(
    artifactTarget,
    `${JSON.stringify(publicFieldsArtifact(fields), null, 2)}\n`,
  );
  return { written, publicFields };
}
