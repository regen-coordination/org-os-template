#!/usr/bin/env node
// call.mjs — generic `tools/call` passthrough. For agents driving the canvas
// from a shell (and for the prototype). Always passes fileId. Prints the
// result JSON on stdout and `metered calls: N` on stderr.
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
if (!tool) {
  console.error(
    "usage: call.mjs <tool> [json-args] [--args-file p] [--file id] [--out p]",
  );
  process.exit(2);
}
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
if (!cfg.fileId) {
  console.error(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
  );
  process.exit(2);
}
let args = {};
if (values["args-file"])
  args = JSON.parse(readFileSync(values["args-file"], "utf8"));
else if (inlineJson) args = JSON.parse(inlineJson);
args = { ...args, fileId: cfg.fileId };

const client = createClient({ url: cfg.url, timeoutMs: 60000 });
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
  console.error(`metered calls: ${client.metered}`);
  process.exit(0);
} catch (e) {
  console.error(`metered calls: ${client.metered}`);
  if (e instanceof PaperError) {
    console.error(`paper: ${e.code} — ${e.message}`);
    process.exit(e.code === "unreachable" ? 2 : 1);
  }
  throw e;
}
