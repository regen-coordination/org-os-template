// tests/paper-integration/paper-lint-tokens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";
import {
  loadBrand,
  planTokens,
} from "../../packages/paper-integration/lib/tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/lint-tokens.mjs",
);
const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/paper/brand.refi-dao.yaml",
);
const text = (obj) => ({
  content: [{ type: "text", text: JSON.stringify(obj) }],
});
const synced = () =>
  planTokens(loadBrand(FIXTURE)).tokens.map(({ type, name, value }) => ({
    type,
    name,
    value,
  }));

test("lint: in sync → exit 0, one metered call", async () => {
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(synced()) },
  });
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /paper tokens: in sync \(75 checked\)/);
    assert.match(r.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

test("lint: missing and changed → exit 1 naming each", async () => {
  const tokens = synced().filter((t) => t.name !== "--refi-space-4");
  tokens.find((t) => t.name === "--refi-color-blue").value = "#000000";
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(tokens) },
  });
  try {
    const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing: --refi-space-4/);
    assert.match(
      r.stdout,
      /changed: --refi-color-blue paper=#000000 brand=#4571E1/,
    );
    assert.match(
      r.stdout,
      /paper tokens: DRIFT — 1 missing · 1 changed · 0 extra/,
    );
  } finally {
    await fake.close();
  }
});

test("lint: extras are reported but pass unless --strict", async () => {
  const tokens = [
    ...synced(),
    { type: "color", name: "--refi-rogue", value: "#ff0000" },
  ];
  const fake = await startFakePaper({
    handlers: { get_tokens: () => text(tokens) },
  });
  try {
    const r1 = await runScript(SCRIPT, ["--tokens", FIXTURE], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r1.status, 0);
    assert.match(r1.stdout, /extra: --refi-rogue/);
    const r2 = await runScript(SCRIPT, ["--tokens", FIXTURE, "--strict"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F1",
    });
    assert.equal(r2.status, 1);
  } finally {
    await fake.close();
  }
});

test("lint: unreachable → exit 2", async () => {
  const r = await runScript(SCRIPT, ["--tokens", FIXTURE], {
    PAPER_MCP_URL: "http://127.0.0.1:1/mcp",
    PAPER_FILE_ID: "F1",
  });
  assert.equal(r.status, 2);
});

test("lint: --tokens path does not exist → exit 2, clean message, metered line, no stack trace", async () => {
  const r = await runScript(
    SCRIPT,
    [
      "--tokens",
      path.resolve(__dirname, "../fixtures/paper/does-not-exist.yaml"),
    ],
    { PAPER_FILE_ID: "F1" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^paper: /m);
  assert.match(r.stderr, /metered calls: 0/);
  assert.doesNotMatch(r.stderr, /at file:\/\//);
});

test("lint: brand file with no tokens: map → exit 2, clean message, metered line, no stack trace", async () => {
  const r = await runScript(
    SCRIPT,
    ["--tokens", path.resolve(__dirname, "../fixtures/instance-config.yaml")],
    { PAPER_FILE_ID: "F1" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^paper: /m);
  assert.match(r.stderr, /metered calls: 0/);
  assert.doesNotMatch(r.stderr, /at file:\/\//);
});
