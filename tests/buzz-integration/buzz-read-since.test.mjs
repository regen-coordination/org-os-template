import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
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

// --- C1: a reply that parses as JSON but doesn't have a well-formed
// `events` array must never crash the script (was: unguarded `.length` /
// `new Date(...)` access → TypeError/RangeError, exit 1 with a stack trace).

test("C1a: reply with no events key at all does not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, { ok: true, result: "fine" });
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.doesNotMatch(r.stderr, /Error/);
});

test("C1b: null reply does not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, null);
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.doesNotMatch(r.stderr, /Error/);
});

test("C1c: events field that is not an array does not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, { events: "oops" });
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.doesNotMatch(r.stderr, /Error/);
});

test("C1d: malformed event entries (null, bare number) do not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, { events: [null, 5] });
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.doesNotMatch(r.stderr, /Error/);
});

// --- C2: a `--state` path the process cannot write to (nonexistent parent
// dir, or a directory instead of a file) must never crash the script after
// events have already been printed (was: unguarded writeFileSync → EISDIR/
// EACCES/ENOENT, exit 1 with a stack trace).

test("C2a: state path under a nonexistent parent directory does not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [{ id: "e1", created_at: 1700000000, pubkey: "p", content: "hi" }],
  });
  const state = path.join(dir, "no-such-subdir", "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.match(r.stdout, /hi/); // events were still printed before the write attempt
});

test("C2b: state path that is itself a directory does not crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [{ id: "e1", created_at: 1700000000, pubkey: "p", content: "hi" }],
  });
  const state = path.join(dir, "state-is-a-dir");
  mkdirSync(state);

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(
    r.status,
    0,
    `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  );
  assert.match(r.stdout, /hi/);
});

// --- I2: regression defense on marker advancement. Guards against three
// specific mutations: advancing the marker on a failed read, using `0`
// instead of `now - 24h` as the fallback window, and never sending
// `--since` at all.

test("I2a: marker is not advanced when the read fails", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ lastRead: 1111111111 }));

  const r = run(
    ["--state", state],
    baseEnv("/nonexistent/buzz-cli-does-not-exist"),
  );

  assert.equal(r.status, 0);
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(
    marker.lastRead,
    1111111111,
    "marker must not advance on a failed read",
  );
});

test("I2b: with no marker file, --since sent to the CLI is ~(now - 24h) and is actually sent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, { events: [] });
  const state = path.join(dir, "state.json"); // does not exist yet

  const before = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const r = run(["--state", state], baseEnv(bin));
  const after = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

  assert.equal(r.status, 0);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  const sinceIdx = argv.indexOf("--since");
  assert.ok(sinceIdx !== -1, "expected --since to be sent to the CLI");
  const sentSince = Number(argv[sinceIdx + 1]);
  assert.ok(
    sentSince >= before - 5 && sentSince <= after + 5,
    `expected --since ~= now - 24h, got ${sentSince} (window [${before - 5}, ${after + 5}])`,
  );
});

// --- NEW-1: the C1 guard must not conflate "reply shape unrecognized" with
// "genuinely zero new events" — collapsing them both into events=[] means an
// unrecognized shape (e.g. a field rename during buzz-cli preview drift, or
// `{}` from a relay proxy) is reported as "no new messages" AND advances the
// marker, permanently skipping whatever messages were actually there.

test("NEW-1a: an unrecognized reply shape (renamed field) does not advance the marker or claim zero messages", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    messages: [
      {
        id: "e1",
        created_at: 1700000000,
        pubkey: "p",
        content: "IMPORTANT MESSAGE ONE",
      },
      {
        id: "e2",
        created_at: 1700000001,
        pubkey: "p",
        content: "IMPORTANT MESSAGE TWO",
      },
      {
        id: "e3",
        created_at: 1700000002,
        pubkey: "p",
        content: "IMPORTANT MESSAGE THREE",
      },
    ],
  });
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ lastRead: 1700000000 }));

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  assert.doesNotMatch(
    r.stdout,
    /no new messages/,
    "an unrecognized shape must not be reported as zero new messages",
  );
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(
    marker.lastRead,
    1700000000,
    "marker must not advance when the reply shape is unrecognized",
  );
});

test("NEW-1b: an empty-object reply ({}) is also unrecognized, not zero events", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {});
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ lastRead: 1700000000 }));

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.equal(
    marker.lastRead,
    1700000000,
    "marker must not advance when the reply shape is unrecognized",
  );
});

// --- cheap item: a non-string `content` field on an otherwise well-formed
// event must render the content itself, not the whole event object (which
// stringifies to the useless, payload-losing "[object Object]").

test("cheap: non-string content field renders the content, not the whole event", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, {
    events: [
      {
        id: "e1",
        created_at: 1700000000,
        pubkey: "p",
        content: { text: "nested payload" },
      },
    ],
  });
  const state = path.join(dir, "state.json");

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /\[object Object\]/);
  assert.match(r.stdout, /nested payload/);
});

// --- NEW-C: the empty-vs-unrecognized distinction (NEW-1) is only half
// tested without this — a genuinely empty `events: []]` must still advance
// the marker, or a quiet channel's marker freezes forever and every future
// run re-scans an ever-widening window.

test("NEW-C: a genuinely empty events array still advances the marker", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-read-"));
  const bin = fakeCli(dir, { events: [] });
  const state = path.join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ lastRead: 1700000000 }));

  const r = run(["--state", state], baseEnv(bin));

  assert.equal(r.status, 0);
  assert.match(r.stdout, /no new messages/);
  const marker = JSON.parse(readFileSync(state, "utf8"));
  assert.ok(
    marker.lastRead > 1700000000,
    "marker must advance past the seed on a genuinely empty read",
  );
});
