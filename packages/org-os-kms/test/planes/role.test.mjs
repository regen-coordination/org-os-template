import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { OPS } from "../../src/ops.mjs";
import { planeRole } from "../../src/planes/role.mjs";
import { exportCommons } from "../../src/planes/export-commons.mjs";
import { makeCanon, makeCommons, readTree } from "./helpers.mjs";

const PLANE = "regenerant-catalunya-commons"; // the name makeCanon's kms.yaml declares
const lineage = "repos/ReFi-Barcelona/notes/x.md";
const reviewed = { title: "Verbete", summary: "ok", maturity: "reviewed", public_use: "ok-with-caveat", source_lineage: lineage, ai_assisted: true };
const ATPROTO = { did: "did:plc:me", handle: "kc.test", pds: "https://pds.test", nsid_authority: "xyz.regencoordination.kb" };
const env = { ATPROTO_APP_PASSWORD: "pw" };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const fakeClient = (log) => () => ({
  async login() { log.push("login"); return { did: "did:plc:me" }; },
  async putRecord(op) { log.push(["put", op.rkey]); return { uri: `at://did:plc:me/${op.collection}/${op.rkey}`, cid: "cid1" }; },
  async deleteRecord(op) { log.push(["del", op.rkey]); },
});
const patchYaml = (file, fn) => { const d = yaml.load(fs.readFileSync(file, "utf8")); fn(d); fs.writeFileSync(file, yaml.dump(d)); };

/** A canon with one reviewed entry, exported into a public plane. `nested` puts the plane where the
 *  clone scaffolds it (<canon>/repos/<name>); otherwise it is a checkout on its own. */
function pair({ nested = true, planes = { role: "public", canon: "lf-work" } } = {}) {
  const root = makeCanon({ resource: { v: reviewed } });
  patchYaml(path.join(root, "kms.yaml"), (c) => { c.atproto = ATPROTO; });
  const outDir = makeCommons(PLANE, nested ? path.join(root, "repos", PLANE) : undefined);
  exportCommons({ root, outDir, uuid });
  patchYaml(path.join(outDir, "kms.yaml"), (c) => { c.atproto = ATPROTO; c.publish = { base_url: "https://t.example" }; if (planes) c.planes = planes; });
  return { root, outDir };
}
const publish = (dir, flags, log = []) => OPS.publish.run({ dir, flags, deps: { createClient: fakeClient(log), env } });

test("planeRole: a canon names its public plane; a public plane says so; anything else has no role", () => {
  assert.equal(planeRole({ planes: { public: { instance: "x" } } }), "canon");
  assert.equal(planeRole({ planes: { role: "public", canon: "c" } }), "public");
  assert.equal(planeRole({}), null);
  assert.equal(planeRole({ planes: {} }), null);
  assert.throws(() => planeRole({ planes: { role: "public", public: { instance: "x" } } }), /both/);
  assert.throws(() => planeRole({ planes: { role: "canon" } }), /planes\.role/);
});

for (const flags of [{ dry: true }, {}, { apply: true }]) {
  test(`publish in a canon is refused and touches nothing (${JSON.stringify(flags)})`, async () => {
    const { root } = pair();
    const before = readTree(path.join(root, "data"));
    const log = [];
    const res = await publish(root, flags, log);
    assert.equal(res.ok, false);
    assert.equal(res.report.refused, "canon");
    assert.match(res.report.reason, /public plane/);
    assert.deepEqual(log, [], "a client was created or used");
    assert.deepEqual(readTree(path.join(root, "data")), before, "the canon was written to");
    assert.equal(fs.existsSync(path.join(root, "public")), false, "a static surface was written in the canon");
  });
}

test("publish in a public plane re-gates against its canon first, and applies when that is clean", async () => {
  const { outDir } = pair();
  const log = [];
  const res = await publish(outDir, { apply: true }, log);
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.regate, { status: "clean" });
  assert.equal(res.report.atproto.status, "applied");
  assert.equal(res.report.atproto.created, 1);
});

for (const flags of [{}, { apply: true }]) {
  test(`a public plane holding something its canon would not publish is refused before any write (${JSON.stringify(flags)})`, async () => {
    const { outDir } = pair();
    patchYaml(path.join(outDir, "data", "kb", "resource.yaml"), (d) => {
      d.entries.intruso = { id: "urn:uuid:11111111-1111-4111-8111-111111111111", title: "Intruso", maturity: "reviewed", public_use: "ok-with-caveat" };
    });
    const log = [];
    const res = await publish(outDir, flags, log);
    assert.equal(res.ok, false);
    assert.equal(res.report.regate.status, "failed");
    assert.match(res.report.regate.errors.join("\n"), /resource:intruso: no such object in the canon/);
    assert.deepEqual(log, []);
    assert.equal(fs.existsSync(path.join(outDir, "data", "kms-published.json")), false);
  });
}

test("a canon that has since put a hold on the source is enough to stop the plane publishing", async () => {
  const { root, outDir } = pair();
  patchYaml(path.join(root, "data", "kb", "source-system.yaml"), (d) => {
    d.entries["refi-bcn-old-kb"].held_prefixes = ["repos/ReFi-Barcelona/notes/"];
  });
  const log = [];
  const res = await publish(outDir, { apply: true }, log);
  assert.equal(res.ok, false);
  assert.equal(res.report.regate.status, "failed");
  assert.deepEqual(log, []);
});

test("a public plane that cannot find its canon will plan but not apply", async () => {
  const { outDir } = pair({ nested: false });
  const planned = await publish(outDir, {});
  assert.equal(planned.ok, true, JSON.stringify(planned.report));
  assert.deepEqual(planned.report.regate, { status: "canon-not-found" });
  const log = [];
  const applied = await publish(outDir, { apply: true }, log);
  assert.equal(applied.ok, false);
  assert.match(applied.report.reason, /canon/);
  assert.deepEqual(log, []);
});

test("planes.canon_dir tells a plane where its canon is; a directory that is not its canon does not count", async () => {
  const { root, outDir } = pair({ nested: false });
  patchYaml(path.join(outDir, "kms.yaml"), (c) => { c.planes.canon_dir = root; });
  const ok = await publish(outDir, { apply: true });
  assert.equal(ok.ok, true, JSON.stringify(ok.report));
  assert.deepEqual(ok.report.regate, { status: "clean" });

  const stranger = makeCanon();
  patchYaml(path.join(stranger, "kms.yaml"), (c) => { c.planes.public.instance = "someone-else"; });
  patchYaml(path.join(outDir, "kms.yaml"), (c) => { c.planes.canon_dir = stranger; });
  const res = await publish(outDir, { apply: true });
  assert.equal(res.ok, false);
  assert.equal(res.report.regate.status, "canon-not-found");
});

test("planes.regate: false is the operator's explicit way to publish from a plane on its own", async () => {
  const { outDir } = pair({ nested: false, planes: { role: "public", canon: "lf-work", regate: false } });
  const res = await publish(outDir, { apply: true });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.deepEqual(res.report.regate, { status: "disabled" });
  assert.equal(res.report.atproto.status, "applied");
});

test("a public plane takes no ingest: it receives only what its canon exports", async () => {
  const { outDir } = pair();
  const res = await OPS["ingest.pull"].run({ dir: outDir, flags: {}, deps: { registry: {} } });
  assert.equal(res.ok, false);
  assert.equal(res.report.refused, "public-plane");
});

test("an instance with no planes configured publishes as it always did", async () => {
  const { outDir } = pair({ nested: false, planes: null });
  const res = await publish(outDir, { apply: true });
  assert.equal(res.ok, true, JSON.stringify(res.report));
  assert.equal(res.report.regate, undefined);
  assert.equal(res.report.atproto.status, "applied");
});
