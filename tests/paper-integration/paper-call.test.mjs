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
    assert.ok(!fake.calls.some((c) => c.method === "tools/call"));
  } finally {
    await fake.close();
  }
});

test("call: rpc error → exit 1 with the message", async () => {
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
  } finally {
    await fake.close();
  }
});
