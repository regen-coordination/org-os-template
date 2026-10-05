import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  fieldPolicy,
  DEFAULT_FIELD_POLICY,
  publicEntryFor,
  unexpectedDrops,
  publicFieldsArtifact,
} from "../../src/planes/public-fields.mjs";
import { exportCommons } from "../../src/planes/export-commons.mjs";
import { validateCommons } from "../../src/planes/validate-commons.mjs";
import { makeCanon, makeCommons } from "./helpers.mjs";

// An entry written in Portuguese, with a Spanish bridge summary and a field this commons invented.
const verbete = {
  title: "Comunidades que Sustentam a Agricultura",
  summary: "Famílias financiam a produção de um sítio agroecológico e dividem a colheita.",
  summary_es: "Familias financian la producción y comparten la cosecha.",
  bioma: "mata-atlântica",
  contato: { rede: "csa-brasil", telefone: "privado" },
  notes: "nota interna",
};

test("with no instance configuration the policy is the framework default, unchanged", () => {
  assert.equal(fieldPolicy(), DEFAULT_FIELD_POLICY);
  assert.equal(fieldPolicy({}), DEFAULT_FIELD_POLICY);
  assert.deepEqual(publicEntryFor("resource", verbete), publicEntryFor("resource", verbete, DEFAULT_FIELD_POLICY));
  assert.deepEqual(Object.keys(publicEntryFor("resource", verbete)), ["title", "summary"]);
});

test("'*' adds a field to every schema; a schema key adds it to that schema alone", () => {
  const policy = fieldPolicy({ public_fields: { "*": ["summary_es"], resource: ["bioma"] } });
  assert.deepEqual(Object.keys(publicEntryFor("resource", verbete, policy)), ["title", "summary", "summary_es", "bioma"]);
  assert.deepEqual(Object.keys(publicEntryFor("organization", verbete, policy)), ["title", "summary_es"]);
  // A schema the framework has no list for still gets the '*' fields and its own.
  const novo = fieldPolicy({ public_fields: { "*": ["summary_es"], "saber-tradicional": ["bioma"] } });
  assert.deepEqual(Object.keys(publicEntryFor("saber-tradicional", verbete, novo)), ["title", "summary_es", "bioma"]);
});

test("an object-valued field publishes only through nested_fields, and only the keys named", () => {
  const without = fieldPolicy({ public_fields: { resource: ["contato"] } });
  assert.equal(publicEntryFor("resource", verbete, without).contato, undefined);
  const policy = fieldPolicy({ public_fields: { resource: ["contato"] }, nested_fields: { contato: ["rede"] } });
  assert.deepEqual(publicEntryFor("resource", verbete, policy).contato, { rede: "csa-brasil" });
});

test("the alarm for an un-allowlisted content field follows the policy", () => {
  assert.deepEqual(unexpectedDrops("resource", verbete), ["summary_es", "bioma", "contato"]);
  const policy = fieldPolicy({ public_fields: { "*": ["summary_es"], resource: ["bioma", "contato"] }, nested_fields: { contato: ["rede"] } });
  assert.deepEqual(unexpectedDrops("resource", verbete, policy), ["contato.telefone"]);
});

test("an instance cannot allowlist a field the framework holds private — in any case, top level or nested", () => {
  for (const f of ["notes", "Notes", "surfaced_by", "work_order", "reviewed_by", "geometry_ref"]) {
    assert.throws(() => fieldPolicy({ public_fields: { "*": [f] } }), /private/, f);
    assert.throws(() => fieldPolicy({ public_fields: { resource: [f] } }), /private/, f);
    assert.throws(() => fieldPolicy({ nested_fields: { contato: [f] } }), /private/, f);
  }
});

test("a malformed declaration is refused, never guessed at", () => {
  for (const bad of [
    { public_fields: ["summary_es"] },
    { public_fields: { resource: "bioma" } },
    { public_fields: { resource: [""] } },
    { public_fields: { resource: [7] } },
    { nested_fields: { contato: "rede" } },
    { nested_fields: ["contato"] },
  ]) assert.throws(() => fieldPolicy(bad), /public_fields|nested_fields/, JSON.stringify(bad));
});

test("the generated mirror carries the instance's additions and names no instance", () => {
  const policy = fieldPolicy({ public_fields: { "*": ["summary_es"], resource: ["bioma"] } });
  const a = publicFieldsArtifact(policy);
  assert.ok(a.content.resource.includes("bioma"));
  assert.ok(a.content.resource.includes("summary_es"));
  assert.ok(a.content.organization.includes("summary_es"));
  assert.doesNotMatch(JSON.stringify(a), /lf-work|catalunya/i);
});

const lineage = "repos/ReFi-Barcelona/notes/x.md";
const reviewed = { ...verbete, maturity: "reviewed", public_use: "ok-with-caveat", source_lineage: lineage, ai_assisted: true, contato: undefined };
delete reviewed.contato;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function commonsWithFields(publish) {
  const outDir = makeCommons();
  const file = path.join(outDir, "kms.yaml");
  const cfg = yaml.load(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, yaml.dump({ ...cfg, publish }));
  return outDir;
}

test("end to end: the public plane's own kms.yaml decides the extra fields, for export and re-gate alike", () => {
  const root = makeCanon({ resource: { csa: reviewed } });
  const outDir = commonsWithFields({ public_fields: { "*": ["summary_es"], resource: ["bioma"] } });
  exportCommons({ root, outDir, uuid });
  const out = yaml.load(fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8")).entries.csa;
  assert.equal(out.summary_es, verbete.summary_es);
  assert.equal(out.bioma, "mata-atlântica");
  assert.equal(out.title, verbete.title);
  assert.equal(out.notes, undefined);
  const mirror = JSON.parse(fs.readFileSync(path.join(outDir, "data", "kb", "public-fields.json"), "utf8"));
  assert.ok(mirror.content.resource.includes("bioma"));
  assert.deepEqual(validateCommons({ root, outDir }), { ok: true, errors: [], message: "commons published store valid" });
});

test("end to end: without the declaration the same fields are dropped and the re-gate says so", () => {
  const root = makeCanon({ resource: { csa: reviewed } });
  const outDir = makeCommons();
  exportCommons({ root, outDir, uuid });
  const out = yaml.load(fs.readFileSync(path.join(outDir, "data", "kb", "resource.yaml"), "utf8")).entries.csa;
  assert.equal(out.summary_es, undefined);
  assert.equal(out.bioma, undefined);
  const v = validateCommons({ root, outDir });
  assert.equal(v.ok, false);
  assert.match(v.message, /not on the public allowlist.*summary_es, bioma/);
});
