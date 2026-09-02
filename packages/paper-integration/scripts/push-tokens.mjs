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
if (!values.tokens) {
  console.error(`metered calls: 0`);
  console.error(
    "usage: push-tokens.mjs --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--dry-run] [--prune]",
  );
  process.exit(2);
}
const brand = loadBrand(values.tokens);
const plan = planTokens(brand, {
  canvasWidth: Number(values["canvas-width"]),
});
console.log(
  `plan: ${plan.tokens.length} tokens · ${plan.skipped.length} skipped · ${plan.converted.length} converted (prefix --${brand.prefix}, source ${brand.source})`,
);
for (const s of plan.skipped) console.log(`skipped: ${s.name} — ${s.reason}`);

const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
const client = createClient({ url: cfg.url });

if (values["dry-run"]) {
  for (const c of plan.converted)
    console.log(`converted: ${c.name} ${c.from} → ${c.to}`);
  console.log("dry-run: nothing sent");
  console.error(`metered calls: ${client.metered}`);
  process.exit(0);
}
if (!cfg.fileId) {
  console.error(`metered calls: ${client.metered}`);
  console.error(
    "paper: no target file — set PAPER_FILE_ID in .env or pass --file <id>",
  );
  process.exit(2);
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
