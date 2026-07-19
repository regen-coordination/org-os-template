import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "generate-quilt.mjs");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "quilt-"));
  mkdirSync(path.join(root, "data"));
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "memory"));
  writeFileSync(path.join(root, "data", "instances.yaml"), `instances:
  - id: "refi-bcn-os"
    type: "LocalNode"
    maturity: "production"
    federation_role: "spoke"
    packages: ["a", "b"]
    skills_extra: ["s"]
    last_sync: "2026-03-19"
    drift: []
  - id: "openclaw"
    type: "AgentRuntime"
    maturity: "alpha"
    federation_role: "agent-runtime"
    packages: []
    skills_extra: []
    last_sync: null
    drift: ["stub_identity"]
  - id: "refi-dao-os"
    type: "DAO"
    maturity: "production"
    federation_role: "hub"
    packages: ["x"]
    skills_extra: []
    last_sync: "2026-03-06"
    drift: []
  - id: "regen-coordination-os"
    type: "Hub"
    maturity: "beta"
    federation_role: "hub"
    packages: ["x"]
    skills_extra: []
    last_sync: "2026-04-24"
    drift: ["a", "b", "c"]
  - id: "dao-os"
    type: "Project"
    maturity: "beta"
    federation_role: "dev-platform"
    packages: []
    skills_extra: []
    last_sync: "2026-04-02"
    drift: ["no_masterplan"]
  - id: "refi-med-os"
    type: "LocalNode"
    maturity: "alpha"
    federation_role: "spoke"
    packages: []
    skills_extra: []
    last_sync: "2026-04-28"
    drift: []
  - id: "bread-coop-os"
    type: "Cooperative"
    maturity: "alpha"
    federation_role: "spoke"
    packages: []
    skills_extra: []
    last_sync: "2026-05-16"
    drift: []
`);
  writeFileSync(path.join(root, "data", "packages-matrix.yaml"), `packages:
  - id: "org-os-kms"
    in_framework: true
    lifecycle_status: "active"
    promotion_status: "canonical"
    instances_using: ["regen-toolkit"]
    notes: ""
  - id: "koi-bridge"
    in_framework: true
    lifecycle_status: "dormant"
    promotion_status: "canonical"
    instances_using: []
    notes: ""
`);
  writeFileSync(path.join(root, "data", "skills-matrix.yaml"), `skills:
  - id: "initialize"
    promotion_status: "canonical"
  - id: "safe-treasury"
    promotion_status: "candidate"
`);
  writeFileSync(path.join(root, "data", "projects.yaml"), `projects:
  - id: "v2-stabilization"
    status: "Develop"
  - id: "opal-rollout"
    status: "Discovery"
`);
  writeFileSync(path.join(root, "HEARTBEAT.md"), "- [ ] one\n- [ ] two\n- [x] done\n");
  writeFileSync(path.join(root, "memory", "2026-07-16.md"), "log\n");
  return root;
}

test("generator weaves a valid organism from registry data", () => {
  const root = setup();
  const res = spawnSync("node", [scriptPath, "--root", root], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const doc = readFileSync(path.join(root, "docs", "QUILT.md"), "utf8");
  assert.ok(doc.includes("╔═ ORG-OS"));
  assert.ok(doc.includes("refi-bcn █"));           // instance patch, shaded from data
  assert.ok(doc.includes("kms █"));                 // package patch via override
  assert.ok(doc.includes("(koi-bridge)"));          // dormant → sleeping pod
  assert.ok(doc.includes("(openclaw"));             // agent-runtime → substrate pod
  assert.ok(doc.includes("2 open"));                // HEARTBEAT count
  assert.ok(doc.includes("v2-stab ▓"));             // project patch
  assert.ok(doc.includes("(opal)"));                // discovery pod (short id)
  // width invariant: no fenced line wider than organism outer width (88)
  let inFence = false;
  for (const l of doc.split("\n")) {
    if (l.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) assert.ok([...l].length <= 88, `wide line: ${l}`);
  }
  // ledger present and wrapped: with 7 instances the ledger exceeds the federation
  // organ's inner width, so a newline appears between "ledger:" and its trailing
  // drift total (☓). The organism renders continuation lines with a "┃ " box prefix,
  // so a raw line-start indent regex won't match — assert the wrap structurally.
  assert.ok(doc.includes("ledger:"));
  const ledgerTail = doc.split("ledger:")[1] ?? "";
  const ledgerBody = ledgerTail.slice(0, ledgerTail.indexOf("☓") + 1);
  assert.ok(ledgerBody.includes("\n"), "ledger did not wrap");
});

test("--stdout prints instead of writing", () => {
  const root = setup();
  const res = spawnSync("node", [scriptPath, "--root", root, "--stdout"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes("╔═ ORG-OS"));
});

test("--stdout does not write docs/QUILT.md", () => {
  const root = setup();
  const res = spawnSync("node", [scriptPath, "--root", root, "--stdout"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes("╔═ ORG-OS"));
  assert.ok(!existsSync(path.join(root, "docs", "QUILT.md")), "--stdout must not write the file");
});

test("degrades when memory/ is absent", () => {
  const root = setup();
  rmSync(path.join(root, "memory"), { recursive: true });
  const res = spawnSync("node", [scriptPath, "--root", root], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const doc = readFileSync(path.join(root, "docs", "QUILT.md"), "utf8");
  assert.ok(doc.includes("╔═ ORG-OS"));  // no crash; memory age falls back to ∅
});
