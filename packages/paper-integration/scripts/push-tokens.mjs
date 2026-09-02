#!/usr/bin/env node
// push-tokens.mjs — brand.yaml `tokens:` → Paper design tokens. One way.
// get_tokens (1) → diff → create_tokens (≤1) → set_tokens (≤1). --dry-run is free.
import { parseArgs } from "node:util";
import {
  createClient,
  loadConfig,
  extractTokens,
  PaperError,
} from "../lib/paper.mjs";
import { loadBrand, planTokens, diffTokens } from "../lib/tokens.mjs";

const { values } = parseArgs({
  options: {
    tokens: { type: "string" },
    file: { type: "string" },
    "canvas-width": { type: "string", default: "1080" },
    "dry-run": { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
  },
});

// Constructed before any check — including usage, a bad --tokens file, and
// no-target-file, none of which reach the server — so every exit path has a
// live count to print. loadConfig never throws and doesn't require
// values.tokens to point at a real file.
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
const client = createClient({ url: cfg.url });

// Every exit routes through here: one place prints `metered calls: N` (read
// live off the client, never hardcoded) so a new exit path can't add itself
// without it, the way two earlier ones did.
function bail(message, code) {
  console.error(`metered calls: ${client.metered}`);
  if (message) console.error(message);
  process.exit(code);
}

if (!values.tokens) {
  bail(
    "usage: push-tokens.mjs --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--dry-run] [--prune]",
    2,
  );
}

let brand, plan;
try {
  brand = loadBrand(values.tokens);
  plan = planTokens(brand, { canvasWidth: Number(values["canvas-width"]) });
} catch (e) {
  // A typo'd path or a malformed brand file never reaches Paper — local
  // config error, not a rejected write, so exit 2 and no raw stack trace.
  bail(`paper: ${e.message}`, 2);
}

console.log(
  `plan: ${plan.tokens.length} tokens · ${plan.skipped.length} skipped · ${plan.converted.length} converted (prefix --${brand.prefix}, source ${brand.source})`,
);
for (const s of plan.skipped) console.log(`skipped: ${s.name} — ${s.reason}`);

if (values["dry-run"]) {
  for (const c of plan.converted)
    console.log(`converted: ${c.name} ${c.from} → ${c.to}`);
  console.log("dry-run: nothing sent");
  bail(null, 0);
}
if (!cfg.fileId) {
  bail(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
    2,
  );
}

try {
  const existing = extractTokens(
    await client.call("get_tokens", { fileId: cfg.fileId }),
  );
  const diff = diffTokens(plan.tokens, existing, { prefix: brand.prefix });
  console.log(`create: ${diff.create.length}`);
  console.log(`update: ${diff.update.length}`);
  console.log(`unchanged: ${diff.unchanged.length}`);
  console.log(
    `extra: ${diff.extra.length}${diff.extra.length && !values.prune ? " (use --prune to delete)" : ""}`,
  );

  let created = 0;
  let updated = 0;
  let pruned = 0;
  if (diff.create.length) {
    await client.call("create_tokens", {
      fileId: cfg.fileId,
      tokens: diff.create,
    });
    created = diff.create.length;
  }
  const sets = [...diff.update];
  if (values.prune)
    for (const name of diff.extra) sets.push({ name, delete: true });
  if (sets.length) {
    await client.call("set_tokens", { fileId: cfg.fileId, tokens: sets });
    updated = diff.update.length;
    pruned = values.prune ? diff.extra.length : 0;
  }
  console.log(`created: ${created} · updated: ${updated} · pruned: ${pruned}`);
  bail(null, 0);
} catch (e) {
  if (e instanceof PaperError)
    bail(`paper: ${e.code} — ${e.message}`, e.code === "unreachable" ? 2 : 1);
  console.error(`metered calls: ${client.metered}`);
  throw e;
}
