import test from "node:test";
import assert from "node:assert/strict";
import {
  publicEntryFor,
  unexpectedDrops,
  publicFieldsArtifact,
  METADATA_FIELDS,
  CONTENT_FIELDS,
  INSTANCE_FIELDS,
  PROVENANCE_FIELDS,
  NESTED_FIELDS,
} from "../../src/planes/public-fields.mjs";

const base = {
  title: "T",
  maturity: "reviewed",
  public_use: "ok-with-caveat",
  ai_assisted: true,
  last_reviewed: "2026-09-21",
  source_lineage: "repos/ReFi-Barcelona/notes/x.md",
  provenance: {
    origin: "repos/ReFi-Barcelona/notes/x.md",
    transformation: "quoted",
    surfaced_by: "agent-7",
  },
};

test("the surface tiers are the documented sets", () => {
  assert.deepEqual(PROVENANCE_FIELDS, [
    "origin",
    "transformation",
    "authorship",
  ]);
  assert.deepEqual(NESTED_FIELDS.membership, ["count", "as_of", "criteria"]);
  assert.deepEqual(INSTANCE_FIELDS, [
    "serves",
    "summary_en",
    "lang",
    "locator",
    "unit_refs",
  ]);
  // Every RC schema this round publishes is named; a schema with no entry publishes metadata only.
  for (const s of [
    "claim-evidence",
    "option-entry",
    "encyclopedia-entry",
    "organization",
    "relationship-record",
    "resource",
    "territorial-unit",
    "data-stream",
  ]) {
    assert.ok(CONTENT_FIELDS[s]?.length, `${s} has a content list`);
  }
  assert.ok(
    METADATA_FIELDS.includes("public_use"),
    "D1: public_use publishes on the JSON-LD surface",
  );
});

test("an object carrying every private field publishes none of them", () => {
  const obj = {
    ...base,
    notes: "INTERNAL",
    work_order: "wo-1",
    reviewed_by: "luiz",
    high_risk: true,
    additional_provenance: [{ origin: "elsewhere" }],
    review_needs: ["x"],
    interpretation: "i",
    uncertainty: "u",
    geometry_ref: "public/geo/x.geojson",
    node_did: "did:plc:x",
    node_repo: "https://github.com/x/y",
    defined_by: "someone",
    steward: "someone",
    connector: "icgc-divisions-administratives",
    consent_note: "secret",
    tier: "never-publish-without-consent",
    review_type: "csis-review",
    held_prefixes: ["repos/x/"],
    origin_prefixes: ["repos/x/"],
    container_role: "source",
    corpus_path: "repos/x",
    extraction_status: "done",
    toolkit_route: "batch-1",
  };
  const out = publicEntryFor("organization", obj);
  const text = JSON.stringify(out);
  // No private KEY survives, and no private VALUE rides along under another key. The value check
  // uses sentinels, never key names: a legitimate value (`repos/ReFi-Barcelona/notes/x.md`) contains
  // the word "notes", which is exactly why a substring scan over key names is the wrong test.
  const privateKeys = [
    "notes",
    "work_order",
    "reviewed_by",
    "high_risk",
    "additional_provenance",
    "review_needs",
    "interpretation",
    "uncertainty",
    "geometry_ref",
    "node_did",
    "node_repo",
    "defined_by",
    "steward",
    "connector",
    "consent_note",
    "tier",
    "review_type",
    "held_prefixes",
    "origin_prefixes",
    "container_role",
    "corpus_path",
    "extraction_status",
    "toolkit_route",
  ];
  for (const k of privateKeys)
    assert.ok(!(k in out), `${k} must not reach the surface`);
  for (const secret of [
    "INTERNAL",
    "wo-1",
    "did:plc:x",
    "icgc-divisions-administratives",
    "never-publish-without-consent",
    "csis-review",
    "public/geo/x.geojson",
  ]) {
    assert.ok(!text.includes(secret), `${secret} leaked`);
  }
  assert.equal(out.reviewed_by, undefined, "D2");
  assert.equal(out.additional_provenance, undefined, "D4");
  assert.equal(out.provenance.surfaced_by, undefined);
  assert.equal(out.provenance.origin, base.provenance.origin);
  assert.equal(out.public_use, "ok-with-caveat", "D1");
});

test("an object-valued field with no per-key allowlist is dropped wholesale", () => {
  const out = publicEntryFor("resource", {
    ...base,
    nested_record: { a: 1, b: 2 },
  });
  assert.equal(out.nested_record, undefined);
});

test("membership narrows to its three keys; a fourth is dropped and reported", () => {
  const obj = {
    ...base,
    membership: {
      count: 3,
      as_of: "2026",
      criteria: "stated",
      internal_note: "x",
    },
  };
  const out = publicEntryFor("organization", obj);
  assert.deepEqual(out.membership, {
    count: 3,
    as_of: "2026",
    criteria: "stated",
  });
  assert.deepEqual(unexpectedDrops("organization", obj), [
    "membership.internal_note",
  ]);
});

test("provenance narrows; a foreign sibling is reported", () => {
  const obj = { ...base, provenance: { origin: "o", reviewer: { name: "x" } } };
  const out = publicEntryFor("resource", obj);
  assert.deepEqual(out.provenance, { origin: "o" });
  assert.deepEqual(unexpectedDrops("resource", obj), ["provenance.reviewer"]);
});

test("an array of objects is dropped; an array of scalars survives", () => {
  const out = publicEntryFor("resource", {
    ...base,
    unit_refs: ["a", "b"],
    mentions: [{ ok: true }],
  });
  assert.deepEqual(out.unit_refs, ["a", "b"]);
  assert.equal(out.mentions, undefined);
});

test("an unknown schema publishes metadata only — fail closed, like the site", () => {
  const out = publicEntryFor("mystery-type", { ...base, something: "content" });
  assert.deepEqual(Object.keys(out).sort(), [
    "ai_assisted",
    "last_reviewed",
    "maturity",
    "provenance",
    "public_use",
    "source_lineage",
    "title",
  ]);
});

test("the two fields D5 added, and D6 covers, are on the surface", () => {
  assert.ok(CONTENT_FIELDS["claim-evidence"].includes("evidence_stance"));
  assert.ok(CONTENT_FIELDS.organization.includes("evidence"));
  assert.ok(CONTENT_FIELDS["territorial-unit"].includes("covers"));
});

test("unexpectedDrops stays silent for known-private and loader keys, and for a clean object", () => {
  const obj = {
    ...base,
    notes: "x",
    work_order: "wo",
    reviewed_by: "luiz",
    type: "resource",
    slug: "x",
    summary: "ok",
  };
  assert.deepEqual(unexpectedDrops("resource", obj), []);
});

test("the generated mirror is deterministic and names every schema", () => {
  const a = publicFieldsArtifact();
  const b = publicFieldsArtifact();
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.content), Object.keys(CONTENT_FIELDS).sort());
  for (const [schema, fields] of Object.entries(a.content)) {
    assert.deepEqual(
      fields,
      [...CONTENT_FIELDS[schema]],
      `${schema} mirror matches the module`,
    );
  }
});
