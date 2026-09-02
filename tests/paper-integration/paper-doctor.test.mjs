// tests/paper-integration/paper-doctor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/doctor.mjs",
);

test("doctor: all green → exit 0, four ✓ lines, zero metered calls", async () => {
  const fake = await startFakePaper();
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(
      r.stdout.split("\n").filter((l) => l.trim().startsWith("✓")).length,
      4,
    );
    assert.match(r.stdout, /paper: canvas ready/);
    assert.match(r.stderr, /metered calls: 0/);
    assert.ok(
      fake.calls.every((c) => c.method !== "tools/call"),
      "doctor must not spend metered calls",
    );
  } finally {
    await fake.close();
  }
});

test("doctor: unreachable → exit 2, first check ✗ with the fix line", async () => {
  const r = await runScript(SCRIPT, [], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /✗ Paper Desktop MCP/);
  assert.match(r.stdout, /open a file in Paper Desktop/);
  assert.match(r.stdout, /paper: canvas not ready/);
});

test("doctor: wrong server name → exit 2", async () => {
  const fake = await startFakePaper({
    serverInfo: { name: "something-else", version: "0.5.6" },
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /✗ Paper Desktop MCP/);
  } finally {
    await fake.close();
  }
});

test("doctor: newer version → still exit 0 but WARN re-verify", async () => {
  const fake = await startFakePaper({
    serverInfo: { name: "paper-desktop", version: "0.6.0" },
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /⚠ .*0\.6\.0.*pinned 0\.5\.6/);
  } finally {
    await fake.close();
  }
});

test("doctor: missing required tool → exit 2 naming it", async () => {
  const fake = await startFakePaper({
    tools: ["get_tokens", "create_tokens", "export", "write_html"],
  });
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /✗ required tools.*set_tokens/);
  } finally {
    await fake.close();
  }
});

test("doctor: no file id → exit 2 with the fix line; --file satisfies it", async () => {
  const fake = await startFakePaper();
  try {
    const r1 = await runScript(SCRIPT, [], { PAPER_MCP_URL: fake.url });
    assert.equal(r1.status, 2);
    assert.match(r1.stdout, /✗ target file.*set PAPER_FILE_ID/);
    const r2 = await runScript(SCRIPT, ["--file", "abc"], {
      PAPER_MCP_URL: fake.url,
    });
    assert.equal(r2.status, 0);
  } finally {
    await fake.close();
  }
});
