import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
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

// --- I3: lib/buzz.mjs's status() probes `buzz-cli --version` with no
// timeout, unlike invoke()'s 15s timeout. Against a hanging binary, doctor
// never returns at all — and since the session hooks branch on doctor's
// exit code, a hang there yields no code whatsoever. Bounded with an outer
// race + hard kill so a genuine regression fails fast instead of wedging
// the test run.

test("I3: doctor does not hang forever against a hanging buzz-cli binary", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = path.join(dir, "hanging-buzz-cli.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nsetInterval(() => {}, 1_000_000);\n`,
  );
  chmodSync(bin, 0o755);

  const child = spawn("node", [SCRIPT], {
    env: {
      ...process.env,
      BUZZ_CLI_BIN: bin,
      BUZZ_RELAY_URL: "ws://localhost:3000",
      BUZZ_CHANNEL: "org-os-dev",
      BUZZ_NSEC: "nsec1fake",
    },
  });

  const outerTimeoutMs = 8000;
  const result = await Promise.race([
    new Promise((resolve) => child.on("exit", (code) => resolve({ code }))),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);

  if (result.timedOut) {
    child.kill("SIGKILL");
    assert.fail(
      `doctor.mjs did not exit within ${outerTimeoutMs}ms against a hanging buzz-cli binary`,
    );
  }
  assert.equal(result.code, 2); // bin check fails → lane not ready
});
