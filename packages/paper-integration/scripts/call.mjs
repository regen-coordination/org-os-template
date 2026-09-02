#!/usr/bin/env node
// call.mjs — generic `tools/call` passthrough. For agents driving the canvas
// from a shell (and for the prototype). Always passes fileId — so this
// script cannot call file-less tools such as create_file or list_files; use
// lib/paper.mjs directly for those (known limitation, not fixed here). Prints
// the result JSON on stdout and `metered calls: N` on stderr — on EVERY exit
// path, success or error, so an operator watching quota never sees a run
// with no metered line.
//   node scripts/call.mjs <tool> [json-args] [--args-file p] [--file id] [--out p] [--tokens brand.yaml]
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient, loadConfig, PaperError } from "../lib/paper.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    tokens: { type: "string" },
    "args-file": { type: "string" },
    out: { type: "string" },
  },
});
const [tool, inlineJson] = positionals;
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
// Constructed before the early checks so every exit path — including usage
// and no-target-file, neither of which reaches the server — has a count to
// print.
const client = createClient({ url: cfg.url, timeoutMs: 60000 });

// The one process.exit in the file: every exit path prints the metered
// line (plus any extra stderr lines), then exits.
function finish(code, ...stderrLines) {
  console.error(`metered calls: ${client.metered}`);
  for (const line of stderrLines) console.error(line);
  process.exit(code);
}
function bail(message, code) {
  finish(code, message);
}

if (!tool) {
  bail(
    "usage: call.mjs <tool> [json-args] [--args-file p] [--file id] [--out p]",
    2,
  );
}
if (!cfg.fileId) {
  bail(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
    2,
  );
}

let args = {};
try {
  if (values["args-file"])
    args = JSON.parse(readFileSync(values["args-file"], "utf8"));
  else if (inlineJson) args = JSON.parse(inlineJson);
} catch (e) {
  const source = values["args-file"]
    ? `--args-file (${values["args-file"]})`
    : "inline arguments";
  bail(`paper: could not read ${source} — ${e.message}`, 1);
}
args = { ...args, fileId: cfg.fileId };

try {
  const result = await client.call(tool, args);
  if (values.out) {
    const img = result?.content?.find((c) => c.type === "image" && c.data);
    if (img) {
      writeFileSync(values.out, Buffer.from(img.data, "base64"));
      console.error(`wrote ${values.out} (${img.mimeType ?? "image"})`);
    } else {
      console.error(
        `--out given but the reply carries no image content; result printed instead`,
      );
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  // Paper reports a rejected call as a successful envelope carrying
  // `isError: true`, not a JSON-RPC error — the result (Paper's message) is
  // already printed above, but the process must still exit 1: a caller
  // driving the canvas one element at a time must not read this as success.
  finish(result?.isError ? 1 : 0);
} catch (e) {
  if (e instanceof PaperError) {
    finish(e.code === "unreachable" ? 2 : 1, `paper: ${e.code} — ${e.message}`);
  }
  console.error(`metered calls: ${client.metered}`);
  throw e;
}
