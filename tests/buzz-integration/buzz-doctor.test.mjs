import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/buzz-integration/scripts/doctor.mjs",
);

// Fake CLI fixture, reused verbatim from tests/buzz-integration/buzz-lib.test.mjs.
function fakeCli(dir, reply) {
  const bin = path.join(dir, "fake-buzz-cli.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(dir, "argv.json"))}, JSON.stringify(process.argv.slice(2)));
console.log(${JSON.stringify(JSON.stringify(reply))});`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function run(env) {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("doctor: all-green fake → exit 0 with four check lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCli(dir, {});

  const r = run({
    BUZZ_CLI_BIN: bin,
    BUZZ_RELAY_URL: "ws://localhost:3000",
    BUZZ_CHANNEL: "org-os-dev",
    BUZZ_NSEC: "nsec1fake",
  });

  assert.equal(r.status, 0);
  const checkLines = r.stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("✓"));
  assert.equal(checkLines.length, 4);
  assert.match(r.stdout, /lane ready/);
});

test("doctor: dead binary → exit 2 and shows a failed buzz-cli check", () => {
  const r = run({
    BUZZ_CLI_BIN: "/nonexistent/buzz-cli-does-not-exist",
    BUZZ_RELAY_URL: "ws://localhost:3000",
    BUZZ_CHANNEL: "org-os-dev",
    BUZZ_NSEC: "nsec1fake",
  });

  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ buzz-cli/);
  assert.match(r.stdout, /lane not ready/);
});

test("doctor: output names each of the four checks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCli(dir, {});

  const r = run({
    BUZZ_CLI_BIN: bin,
    BUZZ_RELAY_URL: "ws://localhost:3000",
    BUZZ_CHANNEL: "org-os-dev",
    BUZZ_NSEC: "nsec1fake",
  });

  assert.match(r.stdout, /buzz-cli/); // bin
  assert.match(r.stdout, /relay/); // relay
  assert.match(r.stdout, /key/); // key
  assert.match(r.stdout, /channel/); // channel
});
