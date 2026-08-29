import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { postEvent, readChannel, status, loadConfig } = await import(
  "../../packages/buzz-integration/lib/buzz.mjs"
);

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
const cfg = (dir, reply) => ({
  bin: fakeCli(dir, reply), relayUrl: "ws://localhost:3000",
  channel: "org-os-dev", nsec: "nsec1fake",
});

test("postEvent invokes the CLI with channel + content and parses the reply", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = postEvent({ content: "hello", tags: { sha: "abc123" } }, cfg(dir, { id: "evt1" }));
  assert.equal(r.ok, true);
  assert.equal(r.id, "evt1");
  const argv = JSON.parse(readFileSync(path.join(dir, "argv.json"), "utf8"));
  assert.ok(argv.includes("org-os-dev"));
  assert.ok(argv.some((a) => a.includes("hello")));
});

test("readChannel passes since and returns events", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  const r = readChannel({ since: 1756300000 }, cfg(dir, { events: [{ id: "e", created_at: 1, pubkey: "p", content: "c" }] }));
  assert.equal(r.ok, true);
  assert.equal(r.events.length, 1);
});

test("missing binary → ok:false, never throws", () => {
  const r = status({ bin: "/nonexistent/buzz-cli", relayUrl: "ws://x", channel: "c", nsec: "n" });
  assert.equal(r.ok, false);
});

test("loadConfig reads .env lines and env vars override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "buzz-"));
  writeFileSync(path.join(dir, ".env"), "BUZZ_RELAY_URL=ws://from-file:3000\nBUZZ_CHANNEL=org-os-dev\n");
  const c = loadConfig({ root: dir, env: { BUZZ_RELAY_URL: "ws://from-env:3000" } });
  assert.equal(c.relayUrl, "ws://from-env:3000");
  assert.equal(c.channel, "org-os-dev");
});
