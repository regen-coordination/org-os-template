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
// `channels list` (the real connectivity/auth probe) returns a top-level
// array — an empty array is a perfectly valid "all-green" reply.
function fakeCli(dir, reply) {
  const bin = path.join(dir, "fake-buzz.mjs");
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

// Fake CLI that exits with a specific code and no stdout — used to simulate
// the verified auth (3) / relay-down (2) exit codes.
function fakeCliExit(dir, code) {
  const bin = path.join(dir, "fake-buzz-exit.mjs");
  writeFileSync(bin, `#!/usr/bin/env node\nprocess.exit(${code});\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function run(env) {
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const baseEnv = (bin) => ({
  BUZZ_CLI_BIN: bin,
  BUZZ_RELAY_URL: "http://localhost:3000",
  BUZZ_CHANNEL: "org-os-dev",
  BUZZ_PRIVATE_KEY: "nsec1fake",
});

test("doctor: all-green fake → exit 0 with four check lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCli(dir, []);

  const r = run(baseEnv(bin));

  assert.equal(r.status, 0);
  const checkLines = r.stdout
    .split("\n")
    .filter((l) => l.trim().startsWith("✓"));
  assert.equal(checkLines.length, 4);
  assert.match(r.stdout, /lane ready/);
});

test("doctor: dead binary → exit 2 and shows a failed buzz check", () => {
  const r = run(baseEnv("/nonexistent/buzz-does-not-exist"));

  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ buzz binary/);
  assert.match(r.stdout, /lane not ready/);
});

test("doctor: auth error (exit 3) reports the key check as failed, not the relay", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCliExit(dir, 3);

  const r = run(baseEnv(bin));

  assert.equal(r.status, 2);
  assert.match(r.stdout, /✓ relay/); // the binary ran and reached the relay
  assert.match(r.stdout, /✗ agent key/); // but auth itself failed
  assert.match(r.stdout, /lane not ready/);
});

test("doctor: relay/network error (exit 2) reports the relay check as failed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCliExit(dir, 2);

  const r = run(baseEnv(bin));

  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ relay/);
  assert.match(r.stdout, /lane not ready/);
});

test("doctor: output names each of the four checks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = fakeCli(dir, []);

  const r = run(baseEnv(bin));

  assert.match(r.stdout, /buzz binary/); // bin
  assert.match(r.stdout, /relay/); // relay
  assert.match(r.stdout, /key/); // key
  assert.match(r.stdout, /channel/); // channel
});

// --- I3: lib/buzz.mjs's status() probes `channels list` (there is no
// `--version` flag — the real CLI rejects it, and no `status` subcommand)
// with a 5s timeout. Against a hanging binary, doctor must still return
// promptly instead of wedging on the 15s timeout used for post/read.
// Bounded with an outer race + hard kill so a genuine regression fails fast
// instead of wedging the test run.

test("I3: doctor does not hang forever against a hanging buzz binary", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-doctor-"));
  const bin = path.join(dir, "hanging-buzz.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nsetInterval(() => {}, 1_000_000);\n`,
  );
  chmodSync(bin, 0o755);

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin) },
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
      `doctor.mjs did not exit within ${outerTimeoutMs}ms against a hanging buzz binary`,
    );
  }
  assert.equal(result.code, 2); // bin check fails → lane not ready
});
