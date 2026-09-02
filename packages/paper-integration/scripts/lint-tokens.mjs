#!/usr/bin/env node
// lint-tokens.mjs — is the Paper file's token set in sync with brand.yaml?
// Exactly one metered call. Exit 0 in sync, 1 drift, 2 not-ready.
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
    strict: { type: "boolean", default: false },
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
    "usage: lint-tokens.mjs --tokens <brand.yaml> [--file <id>] [--canvas-width 1080] [--strict]",
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
  const byName = new Map(existing.map((t) => [t.name, t]));
  const diff = diffTokens(plan.tokens, existing, { prefix: brand.prefix });
  for (const t of diff.create) console.log(`missing: ${t.name}`);
  for (const u of diff.update)
    console.log(
      `changed: ${u.name} paper=${byName.get(u.name).value} brand=${u.value}`,
    );
  for (const n of diff.extra) console.log(`extra: ${n}`);
  const drift =
    diff.create.length +
    diff.update.length +
    (values.strict ? diff.extra.length : 0);
  if (drift === 0)
    console.log(
      `paper tokens: in sync (${plan.tokens.length} checked)${diff.extra.length ? ` · ${diff.extra.length} extra tolerated (--strict to fail)` : ""}`,
    );
  else
    console.log(
      `paper tokens: DRIFT — ${diff.create.length} missing · ${diff.update.length} changed · ${diff.extra.length} extra`,
    );
  bail(null, drift === 0 ? 0 : 1);
} catch (e) {
  if (e instanceof PaperError)
    bail(`paper: ${e.code} — ${e.message}`, e.code === "unreachable" ? 2 : 1);
  console.error(`metered calls: ${client.metered}`);
  throw e;
}
