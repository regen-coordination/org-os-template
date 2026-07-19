import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instanceShade, monthsAgo, fmtAge, instancePatch, syncLedger,
} from "../scripts/lib/quilt-view.mjs";

const NOW = new Date("2026-07-19");

test("instanceShade maps maturity to shade", () => {
  assert.equal(instanceShade("production"), "█");
  assert.equal(instanceShade("beta"), "▓");
  assert.equal(instanceShade("alpha"), "▒");
  assert.equal(instanceShade("unheard-of"), "▒"); // unknown → forming, warn elsewhere
});

test("monthsAgo and fmtAge", () => {
  assert.equal(fmtAge(monthsAgo("2026-05-16", NOW)), "2mo");
  assert.equal(fmtAge(monthsAgo("2026-04-02", NOW)), "3.5mo");
  assert.equal(fmtAge(monthsAgo(null, NOW)), "∅");
});

test("instancePatch — production gets 3 content lines, alpha gets 2", () => {
  const prod = instancePatch({
    id: "refi-bcn-os", type: "LocalNode", maturity: "production",
    federation_role: "spoke", packages: ["a", "b"], skills_extra: ["s", "t"],
    last_sync: "2026-03-19", drift: [],
  });
  assert.equal(prod.title, "refi-bcn █");
  assert.equal(prod.lines.length, 3);
  assert.equal(prod.lines[0], " LocalNode·production ");
  assert.equal(prod.lines[1], " pkgs ×2 · +2 skills ");
  assert.equal(prod.lines[2], " sync 03-19 · drift ✓ ");

  const alpha = instancePatch({
    id: "refi-med-os", type: "LocalNode", maturity: "alpha",
    federation_role: "spoke", packages: [], skills_extra: [],
    last_sync: "2026-04-28", drift: [],
  });
  assert.equal(alpha.lines.length, 2);
  assert.equal(alpha.lines[1], " sync 04-28 ");
});

test("instancePatch — drift flags render as ☓n, hub role is marked", () => {
  const p = instancePatch({
    id: "regen-coordination-os", type: "Hub", maturity: "beta",
    federation_role: "hub", packages: Array(12).fill("x"), skills_extra: [],
    last_sync: "2026-04-24", drift: ["a", "b", "c"],
  });
  assert.equal(p.title, "regen-coord ▓");
  assert.equal(p.lines[0], " Hub·beta·hub ");
  assert.equal(p.lines.at(-1), " sync 04-24 · drift ☓3 ");
});

test("syncLedger orders by freshness, null last", () => {
  const line = syncLedger([
    { id: "a-os", last_sync: "2026-03-19" },
    { id: "b-os", last_sync: "2026-05-16" },
    { id: "c-os", last_sync: null },
  ], NOW);
  assert.equal(line, "ledger: b 2mo » a 4mo » c ∅");
});
