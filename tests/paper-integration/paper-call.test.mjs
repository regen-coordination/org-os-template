// tests/paper-integration/paper-call.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakePaper, runScript } from "./helpers/fake-paper.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "../../packages/paper-integration/scripts/call.mjs",
);

test("call: forwards tool + args + fileId, prints result JSON, metered 1", async () => {
  const fake = await startFakePaper({
    handlers: {
      get_basic_info: (a) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ file: a.fileId, artboards: [] }),
          },
        ],
      }),
    },
  });
  try {
    const r = await runScript(SCRIPT, ["get_basic_info", "{}"], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F9",
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(
      out.content[0].text,
      JSON.stringify({ file: "F9", artboards: [] }),
    );
    assert.match(r.stderr, /metered calls: 1/);
    const call = fake.calls.find((c) => c.method === "tools/call");
    assert.deepEqual(call.params, {
      name: "get_basic_info",
      arguments: { fileId: "F9" },
    });
  } finally {
    await fake.close();
  }
});

test("call: --args-file supplies large arguments; --out writes base64 image content", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "paper-call-"));
  const argsFile = path.join(dir, "args.json");
  writeFileSync(argsFile, JSON.stringify({ nodeId: "N1", scale: 1 }));
  const png = Buffer.from("fake-png-bytes").toString("base64");
  const fake = await startFakePaper({
    handlers: {
      get_screenshot: () => ({
        content: [{ type: "image", mimeType: "image/png", data: png }],
      }),
    },
  });
  try {
    const out = path.join(dir, "shot.png");
    const r = await runScript(
      SCRIPT,
      ["get_screenshot", "--args-file", argsFile, "--out", out],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, "utf8"), "fake-png-bytes");
    assert.match(r.stderr, /wrote .*shot\.png/);
    const call = fake.calls.find((c) => c.method === "tools/call");
    assert.deepEqual(call.params.arguments, {
      nodeId: "N1",
      scale: 1,
      fileId: "F9",
    });
  } finally {
    await fake.close();
  }
});

test("call: no file id → exit 2 before any metered call", async () => {
  const fake = await startFakePaper();
  try {
    const r = await runScript(SCRIPT, ["get_basic_info"], {
      PAPER_MCP_URL: fake.url,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /PAPER_FILE_ID/);
    assert.match(r.stderr, /metered calls: 0/);
    assert.ok(!fake.calls.some((c) => c.method === "tools/call"));
  } finally {
    await fake.close();
  }
});

test("call: no tool given → exit 2 with usage and a metered line", async () => {
  const fake = await startFakePaper();
  try {
    const r = await runScript(SCRIPT, [], {
      PAPER_MCP_URL: fake.url,
      PAPER_FILE_ID: "F9",
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: call\.mjs/);
    assert.match(r.stderr, /metered calls: 0/);
    assert.ok(!fake.calls.some((c) => c.method === "tools/call"));
  } finally {
    await fake.close();
  }
});

test("call: malformed --args-file → exit 1, clean message, metered line, no stack trace", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "paper-call-bad-args-"));
  const argsFile = path.join(dir, "args.json");
  writeFileSync(argsFile, "{not valid json");
  const fake = await startFakePaper();
  try {
    const r = await runScript(
      SCRIPT,
      ["get_basic_info", "--args-file", argsFile],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^paper: /m);
    assert.match(r.stderr, /metered calls: 0/);
    assert.doesNotMatch(r.stderr, /at file:\/\//);
    assert.ok(!fake.calls.some((c) => c.method === "tools/call"));
  } finally {
    await fake.close();
  }
});

test("call: rpc error → exit 1 with the message, still metered", async () => {
  const fake = await startFakePaper({
    handlers: { write_html: () => new Error("targetNodeId not found") },
  });
  try {
    const r = await runScript(
      SCRIPT,
      [
        "write_html",
        '{"html":"<div/>","targetNodeId":"X","mode":"insert-children"}',
      ],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /targetNodeId not found/);
    // The call reached Paper and was rejected — it still counts.
    assert.match(r.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

// Paper reports a rejected call as a successful envelope carrying
// `isError: true` (observed live), not a JSON-RPC error. Both tests below
// use the same tool so the exit code is shown to depend on the isError
// flag, not on which tool was called.
test("call: result carrying isError:true → exit 1, prints Paper's message, still metered 1", async () => {
  const message =
    'Invalid fileId "placeholder". Expected a Paper file id, /file/<id> route, or file URL.';
  const fake = await startFakePaper({
    handlers: {
      write_html: () => ({
        content: [{ type: "text", text: message }],
        isError: true,
      }),
    },
  });
  try {
    const r = await runScript(
      SCRIPT,
      [
        "write_html",
        '{"html":"<div/>","targetNodeId":"X","mode":"insert-children"}',
      ],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Invalid fileId/);
    assert.match(r.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});

test("call: same tool, no isError → exit 0 and prints its result (happy path untouched)", async () => {
  const fake = await startFakePaper({
    handlers: {
      write_html: () => ({
        content: [{ type: "text", text: "node-42" }],
      }),
    },
  });
  try {
    const r = await runScript(
      SCRIPT,
      [
        "write_html",
        '{"html":"<div/>","targetNodeId":"X","mode":"insert-children"}',
      ],
      { PAPER_MCP_URL: fake.url, PAPER_FILE_ID: "F9" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).content[0].text, "node-42");
    assert.match(r.stderr, /metered calls: 1/);
  } finally {
    await fake.close();
  }
});
