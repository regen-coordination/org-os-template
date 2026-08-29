import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { postEvent, readChannel, status, loadConfig } =
  await import("../../packages/buzz-integration/lib/buzz.mjs");

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

// Fake CLI that exits non-zero (no JSON on stdout).
function fakeCliExit(dir, code) {
  const bin = path.join(dir, "fake-buzz-cli-exit.mjs");
  writeFileSync(bin, `#!/usr/bin/env node\nprocess.exit(${code});\n`);
  chmodSync(bin, 0o755);
  return bin;
}

// Fake CLI that exits 0 but writes arbitrary (possibly non-JSON, possibly
// empty) raw text to stdout.
function fakeCliRaw(dir, stdout) {
  const bin = path.join(dir, "fake-buzz-cli-raw.mjs");
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)});\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

const cfg = (dir, reply) => ({
  bin: fakeCli(dir, reply),
  relayUrl: "ws://localhost:3000",
  channel: "org-os-dev",
  nsec: "nsec1fake",
});

test("postEvent invokes the CLI with channel + content and parses the reply", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = postEvent(
    { content: "hello", tags: { sha: "abc123" } },
    cfg(dir, { id: "evt1" }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.id, "evt1");
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(argv.includes("org-os-dev"));
  assert.ok(argv.some((a) => a.includes("hello")));
});

test("readChannel passes since and returns events", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = readChannel(
    { since: 1756300000 },
    cfg(dir, {
      events: [{ id: "e", created_at: 1, pubkey: "p", content: "c" }],
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 1);
  // Important 3 fix: actually verify "passes since" — the test's own name
  // was previously unverified (argv.json was never inspected).
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  const sinceIdx = argv.indexOf("--since");
  assert.ok(sinceIdx !== -1, "expected --since flag in argv");
  assert.equal(argv[sinceIdx + 1], "1756300000");
});

test("missing binary → ok:false, never throws", () => {
  const r = status({
    bin: "/nonexistent/buzz-cli",
    relayUrl: "ws://x",
    channel: "c",
    nsec: "n",
  });
  assert.equal(r.ok, false);
});

// Item 5: bin/relay legitimately need the CLI to answer, but key (BUZZ_NSEC
// set?) and channel (BUZZ_CHANNEL set?) are locally knowable from cfg alone
// — status() must not misreport them as false just because the binary is
// missing. Pre-fix, `npm run buzz:doctor` shows "✗ agent key (BUZZ_NSEC)"
// and "✗ channel #org-os-dev" even when both are populated, sending the
// operator hunting for a key problem that doesn't exist.
test("Item 5: missing binary still reports key/channel truthfully (locally knowable, no CLI needed)", () => {
  const r = status({
    bin: "/nonexistent/buzz-cli",
    relayUrl: "ws://x",
    channel: "org-os-dev",
    nsec: "nsec1fake",
  });
  assert.equal(r.ok, false);
  assert.equal(r.checks.bin, false);
  assert.equal(r.checks.relay, false);
  assert.equal(r.checks.key, true);
  assert.equal(r.checks.channel, true);
});

test("loadConfig reads .env lines and env vars override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(
    path.join(dir, ".env"),
    "BUZZ_RELAY_URL=ws://from-file:3000\nBUZZ_CHANNEL=org-os-dev\n",
  );
  const c = loadConfig({
    root: dir,
    env: { BUZZ_RELAY_URL: "ws://from-env:3000" },
  });
  assert.equal(c.relayUrl, "ws://from-env:3000");
  assert.equal(c.channel, "org-os-dev");
});

// --- CRITICAL: loadConfig (and therefore postEvent/readChannel/status) must
// never throw, even when the .env file cannot be read as a text file. ---

test("CRITICAL: loadConfig never throws when .env is a directory (EISDIR)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  mkdirSync(path.join(dir, ".env")); // .env is a directory, not a file
  assert.doesNotThrow(() => {
    const c = loadConfig({ root: dir, env: {} });
    assert.equal(c.relayUrl, "ws://localhost:3000"); // falls back to safe default
    assert.equal(c.channel, "org-os-dev");
  });
});

test("CRITICAL: loadConfig never throws when .env is unreadable (EACCES)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const envPath = path.join(dir, ".env");
  writeFileSync(envPath, "BUZZ_CHANNEL=should-not-be-read\n");
  chmodSync(envPath, 0o000);
  try {
    assert.doesNotThrow(() => {
      const c = loadConfig({ root: dir, env: {} });
      assert.equal(c.channel, "org-os-dev"); // safe default, not "should-not-be-read"
    });
  } finally {
    chmodSync(envPath, 0o644); // restore so mkdtemp cleanup / OS can remove it
  }
});

// --- IMPORTANT 1: .env parsing must handle real-world dotenv conventions. ---

test(".env parsing: quoted values have surrounding quotes stripped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(
    path.join(dir, ".env"),
    `BUZZ_CHANNEL="org-os-dev"\nBUZZ_NSEC='nsec1abc'\n`,
  );
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os-dev");
  assert.equal(c.nsec, "nsec1abc");
});

test(".env parsing: trailing comment on an unquoted value is stripped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(
    path.join(dir, ".env"),
    `BUZZ_CHANNEL=org-os-dev # the dev channel\n`,
  );
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os-dev");
});

test(".env parsing: '#' inside a quoted value is preserved, not stripped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(path.join(dir, ".env"), `BUZZ_CHANNEL="org-os#dev"\n`);
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os#dev");
});

test(".env parsing: 'export KEY=value' prefix is recognized", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  // Use a value that differs from loadConfig's built-in default so a match
  // failure (falling back to the default) cannot be mistaken for success.
  writeFileSync(path.join(dir, ".env"), `export BUZZ_NSEC=nsec1exported\n`);
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.nsec, "nsec1exported");
});

test(".env parsing: CRLF line endings do not break parsing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(
    path.join(dir, ".env"),
    "BUZZ_CHANNEL=org-os-dev\r\nBUZZ_RELAY_URL=ws://crlf:3000\r\n",
  );
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os-dev");
  assert.equal(c.relayUrl, "ws://crlf:3000");
});

test(".env parsing: blank lines and comment-only lines are ignored", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  // Distinguishing value (not the built-in default) so a silent
  // default-fallback can't masquerade as a real, successful parse.
  writeFileSync(
    path.join(dir, ".env"),
    `\n# a full-line comment\nBUZZ_NSEC=nsec1blanktest\n\n`,
  );
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.nsec, "nsec1blanktest");
});

test(".env parsing: comment with no preceding space is still stripped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(path.join(dir, ".env"), `BUZZ_CHANNEL=org-os-dev# note\n`);
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os-dev");
});

test(".env parsing: quoted value with a trailing comment strips both", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(path.join(dir, ".env"), `BUZZ_CHANNEL="org-os-dev" # note\n`);
  const c = loadConfig({ root: dir, env: {} });
  assert.equal(c.channel, "org-os-dev");
});

// --- IMPORTANT 2: fail-open coverage across postEvent/readChannel, not just
// status(). ---

test("postEvent: non-zero exit CLI → ok:false, never throws", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const bin = fakeCliExit(dir, 1);
  assert.doesNotThrow(() => {
    const r = postEvent(
      { content: "x" },
      { bin, relayUrl: "ws://x", channel: "c", nsec: "n" },
    );
    assert.equal(r.ok, false);
  });
});

test("postEvent: non-JSON stdout → ok:false, never throws", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const bin = fakeCliRaw(dir, "not-json{{{");
  assert.doesNotThrow(() => {
    const r = postEvent(
      { content: "x" },
      { bin, relayUrl: "ws://x", channel: "c", nsec: "n" },
    );
    assert.equal(r.ok, false);
  });
});

test("readChannel: empty stdout → ok:false, never throws", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const bin = fakeCliRaw(dir, "");
  assert.doesNotThrow(() => {
    const r = readChannel(
      { since: 1 },
      { bin, relayUrl: "ws://x", channel: "c", nsec: "n" },
    );
    assert.equal(r.ok, false);
  });
});

test("readChannel: non-zero exit CLI → ok:false, never throws", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const bin = fakeCliExit(dir, 2);
  assert.doesNotThrow(() => {
    const r = readChannel(
      { since: 1 },
      { bin, relayUrl: "ws://x", channel: "c", nsec: "n" },
    );
    assert.equal(r.ok, false);
  });
});

// --- Minor: postEvent with missing content should be caught locally, not
// silently sent to the CLI with a stripped/undefined argument. ---

test("postEvent: missing content → ok:false locally, CLI is never invoked", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = postEvent({}, cfg(dir, { id: "should-not-happen" }));
  assert.equal(r.ok, false);
});

// --- Item 2: pin CLI_MAP's verb + flag names. Mutation testing on the full
// suite found 7/10 mutations caught but all 3 survivors were CLI_MAP
// constants: `post` → `publish`, `--channel` → `-c` (everywhere), and
// dropping `--json` from the post argv — every existing test still passed
// because they only ever asserted that *values* (channel name, content
// text, since timestamp) arrived, never the verb/flag *shape* carrying
// them. These tests pin that shape so a future reconciliation against the
// real buzz-cli (VERIFIED.md step 5, packages/buzz-integration/VERIFIED.md)
// is a red-test-driven diff instead of a manual one. CLI_MAP itself is not
// changed by this fix wave — these assertions pin the current (unverified)
// guesses, not a corrected pin. ---

test("Item 2: CLI_MAP pins the exact verb and flag names for `post`", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  postEvent(
    { content: "hello", tags: { sha: "abc123" } },
    cfg(dir, { id: "evt1" }),
  );
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.equal(argv[0], "post"); // survivor: post → publish
  assert.ok(argv.includes("--channel")); // survivor: --channel → -c
  assert.ok(argv.includes("--content"));
  assert.ok(argv.includes("--tag"));
  assert.ok(argv.includes("--json")); // survivor: --json dropped
});

test("Item 2: CLI_MAP pins the exact verb and flag names for `read`", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  readChannel({ since: 1756300000 }, cfg(dir, { events: [] }));
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.equal(argv[0], "read"); // verb pin
  assert.ok(argv.includes("--channel")); // survivor: --channel → -c
  assert.ok(argv.includes("--since"));
  assert.ok(argv.includes("--json"));
});

test("Item 2: CLI_MAP pins the exact verb and flag names for `status`", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  status(cfg(dir, {}));
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.equal(argv[0], "status"); // verb pin
  assert.ok(argv.includes("--relay"));
  assert.ok(argv.includes("--json"));
});
