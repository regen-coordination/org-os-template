import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/buzz-integration/scripts/read-since.mjs",
);

// Fake CLI fixture, reused verbatim from tests/buzz-integration/buzz-lib.test.mjs:
// records argv to argv.json and prints a canned JSON reply on stdout regardless
// of which intent (post/read/status) it was invoked for.
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

function run(args, env) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, ...env },
  });
}

const baseEnv = (bin) => ({
  BUZZ_CLI_BIN: bin,
  BUZZ_CHANNEL: "org-os-dev",
  BUZZ_RELAY_URL: "ws://localhost:3000",
  BUZZ_NSEC: "nsec1fake",
});

test("read-since: prints event content and advances marker", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [
      { id: "e1", created_at: 1700000000, pubkey: "p", content: "hello world" },
    ],
  });
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  assert.match(r.stdout, /hello world/);
  assert.ok(existsSync(state), "expected marker file to be written");
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(typeof marker.lastRead, "number");
  assert.ok(marker.lastRead > 1700000000);
});

test("read-since: corrupt marker file still works (falls back to 24h window)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [
      { id: "e1", created_at: 1700000000, pubkey: "p", content: "still works" },
    ],
  });
  const state = path.join(dir, "state.json");
  writeFileSync(state, "{ this is not valid json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  assert.match(r.stdout, /still works/);
  // marker gets overwritten with a fresh, valid value after a successful run
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(typeof marker.lastRead, "number");
});

test("read-since: dead binary → exit 0 with skipped in stdout", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const state = path.join(dir, "state.json");

  const r = run(
    ["--state", state],
    baseEnv("/nonexistent/buzz-cli-does-not-exist"),
  );

  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped/);
});

test("read-since: --no-advance leaves marker untouched", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [
      { id: "e1", created_at: 1700000000, pubkey: "p", content: "no advance" },
    ],
  });
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ lastRead: 1234567890 }));

  const r = run(["--state", state, "--no-advance"], baseEnv(bin));

  assert.equal(r.status, 0);
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(marker.lastRead, 1234567890);
});
