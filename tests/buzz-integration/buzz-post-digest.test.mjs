import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn, execSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/buzz-integration/scripts/post-digest.mjs",
);
const REPO_ROOT = path.resolve(__dirname, "../..");
// Guarded (not top-level-throwing): a git-less checkout must not fail to
// load this entire test file — the two tests that need it skip themselves
// instead.
let expectedSha = null;
try {
  expectedSha = execSync("git rev-parse --short HEAD", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
} catch {
  expectedSha = null;
}

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

function run(args, { env, input, cwd } = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    input: input ?? "",
    cwd,
    env: { ...process.env, ...env },
  });
}

const baseEnv = (bin) => ({
  BUZZ_CLI_BIN: bin,
  BUZZ_CHANNEL: "org-os-dev",
  BUZZ_RELAY_URL: "ws://localhost:3000",
  BUZZ_NSEC: "nsec1fake",
});

test("post-digest: posts stdin content with the real repo HEAD sha tag present in fake-CLI argv", (t) => {
  if (!expectedSha)
    return t.skip("git rev-parse unavailable in this environment");
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt1" });

  const r = run([], { env: baseEnv(bin), input: "session digest content" });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /digest posted/);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(
    argv.some((a) => a.includes("session digest content")),
    "expected content in argv",
  );
  const tags = argv.filter((a, i) => argv[i - 1] === "--tag");
  // M6: assert the *exact* real HEAD sha, not just a "sha=" prefix — a
  // hardcoded fake sha must not be able to pass this test.
  assert.ok(
    tags.includes(`sha=${expectedSha}`),
    `expected sha=${expectedSha} in tags, got: ${tags.join(", ")}`,
  );
  assert.ok(
    tags.includes("source=org-os-session"),
    "expected source=org-os-session tag",
  );
});

test("post-digest: --file variant reads content from a file", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt2" });
  const file = path.join(dir, "digest.md");
  writeFileSync(file, "digest from a file\n");

  const r = run(["--file", file], { env: baseEnv(bin) });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /digest posted/);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(argv.some((a) => a.includes("digest from a file")));
});

test("post-digest: empty digest → skip line, exit 0", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "should-not-happen" });

  const r = run([], { env: baseEnv(bin), input: "   \n  " });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /empty digest.*skipped/);
});

test("post-digest: dead binary → skip line, exit 0", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));

  const r = run([], {
    env: baseEnv("/nonexistent/buzz-cli-does-not-exist"),
    input: "some content to post",
  });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /post failed.*skipped/);
});

// --- I1: a stdin that never sends EOF (an interactive TTY, a stuck upstream
// pipe, a FIFO left open) must not hang the script forever. Bounded with an
// outer race + hard kill so a genuine regression fails fast instead of
// wedging the test run.

test("I1: a stdin that never closes does not hang forever", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "should-not-happen" });

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin), BUZZ_STDIN_TIMEOUT_MS: "300" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.on("error", () => {}); // ignore EPIPE if the child exits first
  // Deliberately never write to or close child.stdin — simulating a stdin
  // that never sends EOF.

  const outerTimeoutMs = 4000;
  const result = await Promise.race([
    new Promise((resolve) => child.on("exit", (code) => resolve({ code }))),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);

  if (result.timedOut) {
    child.kill("SIGKILL");
    child.stdin.destroy();
    assert.fail(
      `post-digest did not exit within ${outerTimeoutMs}ms against a stdin that never closes`,
    );
  }
  child.stdin.destroy();
  assert.equal(result.code, 0);
  assert.match(stdout, /skipped/);
});

// --- I4: a bad --file (missing, a directory, or no value at all) must be
// reported as a read/usage failure, not misreported as an "empty digest" —
// those are different problems with different fixes.

test("I4a: --file pointing at a nonexistent path reports a read failure, not empty digest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "should-not-happen" });
  const missing = path.join(dir, "does-not-exist.md");

  const r = run(["--file", missing], { env: baseEnv(bin) });

  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /empty digest/);
  assert.match(r.stdout, /could not read/);
});

test("I4b: --file pointing at a directory reports a read failure, not empty digest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "should-not-happen" });
  const subdir = path.join(dir, "a-directory");
  mkdirSync(subdir);

  const r = run(["--file", subdir], { env: baseEnv(bin) });

  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /empty digest/);
  assert.match(r.stdout, /could not read/);
});

test("I4c: --file with no value reports a usage error, not empty digest", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "should-not-happen" });

  const r = run(["--file"], { env: baseEnv(bin), input: "" });

  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /empty digest/);
  assert.match(r.stdout, /requires a path/);
});

// --- M3: the sha tag must reflect the script's own repo, not whatever
// directory the caller happened to invoke it from.

test("M3: sha is derived from the script's own repo root, not the caller's cwd", (t) => {
  if (!expectedSha)
    return t.skip("git rev-parse unavailable in this environment");
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-cwd" });
  const otherCwd = mkdtempSync(path.join(tmpdir(), "buzz-cwd-elsewhere-"));

  const r = run([], {
    env: baseEnv(bin),
    input: "digest posted from a different cwd",
    cwd: otherCwd, // not a git repo — a cwd-derived sha would fail/differ here
  });

  assert.equal(r.status, 0);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  const tags = argv.filter((a, i) => argv[i - 1] === "--tag");
  assert.ok(
    tags.includes(`sha=${expectedSha}`),
    `expected sha=${expectedSha} even when invoked from ${otherCwd}, got: ${tags.join(", ")}`,
  );
});

// --- M2: git's own stderr (e.g. "fatal: not a git repository") must never
// leak into post-digest's stdio — it would show up in the /close transcript
// ahead of the correct fail-open "sha unknown" outcome.

test("M2: a failing git invocation does not leak its stderr into post-digest's output", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-git-fail" });
  const fakeGitDir = mkdtempSync(path.join(tmpdir(), "buzz-fake-git-"));
  const fakeGit = path.join(fakeGitDir, "git");
  writeFileSync(
    fakeGit,
    `#!/usr/bin/env bash\necho "boom-from-fake-git-stderr" 1>&2\nexit 1\n`,
  );
  chmodSync(fakeGit, 0o755);

  const r = run([], {
    env: {
      ...baseEnv(bin),
      PATH: `${fakeGitDir}:${process.env.PATH}`,
    },
    input: "digest with a failing git lookup",
  });

  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /boom-from-fake-git-stderr/);
  assert.doesNotMatch(r.stderr, /boom-from-fake-git-stderr/);
});

// --- NEW-2: the I1 stdin timeout must not discard content it has already
// fully buffered. A total (rather than idle) budget throws away a complete
// digest just because the producer held the pipe open afterward, and
// truncates a legitimately slow-but-completing stream mid-flight.

test("NEW-2a: a producer that writes the complete digest then holds the pipe open still gets posted", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-hold-open" });

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin), BUZZ_STDIN_TIMEOUT_MS: "300" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.on("error", () => {}); // ignore EPIPE if the child exits first

  child.stdin.write("the complete digest, written instantly");
  // Deliberately never call child.stdin.end() — the producer holds the pipe
  // open, as if waiting on something else before eventually closing it.

  const outerTimeoutMs = 4000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    child.stdin.destroy();
    assert.fail(`post-digest did not exit within ${outerTimeoutMs}ms`);
  }
  child.stdin.destroy();

  assert.equal(result.code, 0);
  assert.match(stdout, /digest posted/);
  assert.doesNotMatch(stdout, /timed out/);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(
    argv.some((a) => a.includes("the complete digest, written instantly")),
    "expected the fully-buffered content to have been posted, not discarded",
  );
});

test("NEW-2b: a slow stream that finishes normally is not truncated by the idle timer", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-slow-stream" });

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin), BUZZ_STDIN_TIMEOUT_MS: "300" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.on("error", () => {}); // ignore EPIPE if the child exits first

  const chunks = ["slow ", "stream ", "of ", "digest ", "content"];
  for (const chunk of chunks) {
    child.stdin.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 150)); // < 300ms idle window, aggregate > 300ms total
  }
  child.stdin.end();

  const outerTimeoutMs = 5000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    assert.fail(`post-digest did not exit within ${outerTimeoutMs}ms`);
  }

  assert.equal(result.code, 0);
  assert.match(stdout, /digest posted/);
  assert.doesNotMatch(
    stdout,
    /truncat/i,
    "a complete, EOF-terminated post must NOT be flagged as truncated",
  );
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(
    argv.some((a) => a.includes(chunks.join(""))),
    "expected the full streamed content, not a truncated prefix",
  );
});

// --- NEW-A: the idle timer alone has no upper bound. A producer that keeps
// sending a trickle of bytes (each one resetting the idle window) can keep
// readStdin — and therefore /close — alive forever. This harness bounds
// itself with an explicit outer kill; it must never rely on the script
// exiting on its own to end the test.

test("NEW-A: a drip-fed stdin that never goes idle is still bounded by a total deadline", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-slow-drip" });

  const child = spawn("node", [SCRIPT], {
    env: {
      ...process.env,
      ...baseEnv(bin),
      BUZZ_STDIN_TIMEOUT_MS: "2000", // idle window: never elapses in this test
      BUZZ_STDIN_TOTAL_TIMEOUT_MS: "300", // total deadline: must fire regardless
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.on("error", () => {}); // ignore EPIPE if the child exits first

  // Drip one byte every 100ms, indefinitely — well past the 300ms total
  // deadline, and each byte keeps resetting the 2000ms idle timer. Only a
  // never-rearmed total deadline can ever end this.
  const dripInterval = setInterval(() => {
    child.stdin.write("x");
  }, 100);

  // Bounded harness kill — do NOT rely on the script exiting on its own.
  const outerTimeoutMs = 6000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  clearInterval(dripInterval);
  child.stdin.destroy();

  if (result.timedOut) {
    child.kill("SIGKILL");
    assert.fail(
      `post-digest did not exit within ${outerTimeoutMs}ms against a drip-fed stdin that never goes idle`,
    );
  }

  assert.equal(result.code, 0);
});

// --- NEW-B: when a timer (idle or total) fires with data already buffered,
// that data may or may not be everything the producer intended to send —
// post-digest cannot tell the difference between "producer is done and is
// holding the pipe open" and "producer stalled mid-digest". Posting the
// partial is correct; announcing it as an unqualified clean success is not.

test("NEW-B: a mid-digest stall posts the truncated content but flags it, not a plain success", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-mid-stall" });

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin), BUZZ_STDIN_TIMEOUT_MS: "300" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.on("error", () => {});

  const partial = "first line of a digest that never finishes writing";
  child.stdin.write(partial);
  // Never write more, never end() — the pipe stalls mid-digest.

  const outerTimeoutMs = 4000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    child.stdin.destroy();
    assert.fail(`post-digest did not exit within ${outerTimeoutMs}ms`);
  }
  child.stdin.destroy();

  assert.equal(result.code, 0);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(
    argv.some((a) => a.includes(partial)),
    "expected the partial content to still be posted",
  );
  assert.match(stdout, /digest posted/);
  assert.match(
    stdout,
    /content may be truncated/i,
    "expected the success message to flag that the content may be incomplete",
  );
});

// --- item 1: the console line doesn't survive the session; the event does.
// The spec calls the Buzz log "a cryptographically signed mirror of session
// history" — a partial digest indistinguishable from a complete one in that
// permanent log falsifies exactly that. Tag the timer path so the event
// itself (not just the terminal output) carries provenance of truncation.

test("item 1: an EOF-terminated post does not carry a truncated tag", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-eof-tag-check" });

  const r = run([], { env: baseEnv(bin), input: "a complete digest via EOF" });

  assert.equal(r.status, 0);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  const tags = argv.filter((a, i) => argv[i - 1] === "--tag");
  assert.ok(
    !tags.some((t) => t.startsWith("truncated=")),
    `expected no truncated tag on a clean EOF post, got: ${tags.join(", ")}`,
  );
});

test("item 1: a timer-truncated post carries a truncated=true tag", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-timer-tag-check" });

  const child = spawn("node", [SCRIPT], {
    env: { ...process.env, ...baseEnv(bin), BUZZ_STDIN_TIMEOUT_MS: "300" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  child.stdin.on("error", () => {});
  child.stdin.write("a digest that stalls before the tag check");
  // Never end() — the pipe stalls, forcing the timer path.

  const outerTimeoutMs = 4000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    child.stdin.destroy();
    assert.fail(`post-digest did not exit within ${outerTimeoutMs}ms`);
  }
  child.stdin.destroy();

  assert.equal(result.code, 0);
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  const tags = argv.filter((a, i) => argv[i - 1] === "--tag");
  assert.ok(
    tags.includes("truncated=true"),
    `expected a truncated=true tag on the timer path, got: ${tags.join(", ")}`,
  );
});

// --- item 3: the sha lookup's `execSync("git rev-parse ...")` had no
// timeout of its own — a hanging or pathologically slow `git` (a stuck
// NFS-mounted .git, a misbehaving hook, an adversarial PATH entry) could
// block the whole script well past whatever bound the stdin read itself
// enforces. A hanging `git` must fall back to sha=unknown, not hang.

test("item 3: a hanging git does not hang the post — falls back to sha=unknown", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-post-"));
  const bin = fakeCli(dir, { id: "evt-hanging-git" });
  const fakeGitDir = mkdtempSync(path.join(tmpdir(), "buzz-fake-git-"));
  const fakeGit = path.join(fakeGitDir, "git");
  writeFileSync(fakeGit, `#!/usr/bin/env bash\nsleep 8\nexit 1\n`);
  chmodSync(fakeGit, 0o755);

  const start = Date.now();
  const child = spawn("node", [SCRIPT], {
    env: {
      ...process.env,
      ...baseEnv(bin),
      PATH: `${fakeGitDir}:${process.env.PATH}`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exitPromise = new Promise((resolve) =>
    child.on("exit", (code) => resolve(code)),
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stdin.end("digest content for the hanging-git test");

  // Bounded harness kill — generous relative to the intended ~5s git
  // timeout, but well under the fake git's own 8s sleep, so a regression
  // (no timeout at all) is caught by SIGKILL rather than an actual
  // multi-minute wait if the fake git were ever made to sleep longer.
  const outerTimeoutMs = 11000;
  const result = await Promise.race([
    exitPromise.then((code) => ({ code, elapsed: Date.now() - start })),
    new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), outerTimeoutMs),
    ),
  ]);
  if (result.timedOut) {
    child.kill("SIGKILL");
    assert.fail(
      `post-digest did not exit within ${outerTimeoutMs}ms against a hanging git`,
    );
  }

  assert.equal(result.code, 0);
  assert.ok(
    result.elapsed < 7000,
    `expected the git call to be bounded well under the fake git's 8s sleep, took ${result.elapsed}ms`,
  );
  assert.match(stdout, /digest posted \(sha unknown/);
});
