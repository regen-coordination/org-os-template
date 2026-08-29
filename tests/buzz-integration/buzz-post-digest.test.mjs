import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/buzz-integration/scripts/post-digest.mjs",
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

function run(args, { env, input } = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    input: input ?? "",
    env: { ...process.env, ...env },
  });
}

const baseEnv = (bin) => ({
  BUZZ_CLI_BIN: bin,
  BUZZ_CHANNEL: "org-os-dev",
  BUZZ_RELAY_URL: "ws://localhost:3000",
  BUZZ_NSEC: "nsec1fake",
});

test("post-digest: posts stdin content with sha= tag present in fake-CLI argv", () => {
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
  const tagIdx = argv.indexOf("--tag");
  assert.ok(tagIdx !== -1, "expected --tag flag");
  const tags = argv.filter((a, i) => argv[i - 1] === "--tag");
  assert.ok(
    tags.some((t) => t.startsWith("sha=")),
    "expected a sha= tag",
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
