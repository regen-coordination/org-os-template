#!/usr/bin/env node
// doctor.mjs — is the Paper canvas ready? Exit 0 green, 2 not-ready.
// ZERO metered calls: only `initialize` and `tools/list`.
import { parseArgs } from "node:util";
import {
  createClient,
  loadConfig,
  PIN,
  REQUIRED_TOOLS,
} from "../lib/paper.mjs";

const { values } = parseArgs({
  options: { file: { type: "string" }, tokens: { type: "string" } },
  strict: false,
});
const cfg = loadConfig({ tokensPath: values.tokens, file: values.file });
const client = createClient({ url: cfg.url, timeoutMs: 5000 });

const checks = []; // { ok, label, fix?, warn? }
let info = null;
try {
  info = await client.initialize();
  const nameOk = info?.serverInfo?.name === PIN.server;
  checks.push({
    ok: nameOk,
    label: `Paper Desktop MCP at ${cfg.url}${nameOk ? ` (${info.serverInfo.name} ${info.serverInfo.version})` : ` answered as "${info?.serverInfo?.name}"`}`,
    fix: nameOk
      ? null
      : "expected paper-desktop — is something else on port 29979?",
  });
} catch (e) {
  checks.push({
    ok: false,
    label: `Paper Desktop MCP at ${cfg.url}`,
    fix: "open a file in Paper Desktop — the app starts the MCP server on file open",
  });
}

if (info) {
  const v = info.serverInfo?.version;
  const same = v === PIN.app;
  checks.push({
    ok: true,
    warn: same
      ? null
      : `running ${v}, pinned ${PIN.app} — re-observe VERIFIED.md before trusting the client`,
    label: `version ${v}${same ? " matches pin" : ""}`,
  });
  try {
    const names = new Set((await client.listTools()).map((t) => t.name));
    const missing = REQUIRED_TOOLS.filter((t) => !names.has(t));
    checks.push({
      ok: missing.length === 0,
      label: `required tools ${missing.length ? `missing: ${missing.join(", ")}` : `present (${REQUIRED_TOOLS.length}/${REQUIRED_TOOLS.length} of ${names.size})`}`,
      fix: missing.length
        ? "Paper surface drifted — update VERIFIED.md, then REQUIRED_TOOLS"
        : null,
    });
  } catch (e) {
    checks.push({
      ok: false,
      label: "required tools",
      fix: `tools/list failed: ${e.message}`,
    });
  }
} else {
  checks.push({ ok: false, label: "version (unknown — server unreachable)" });
  checks.push({
    ok: false,
    label: "required tools (unknown — server unreachable)",
  });
}

checks.push({
  ok: Boolean(cfg.fileId),
  label: `target file ${cfg.fileId ? cfg.fileId : "not configured"}`,
  fix: cfg.fileId
    ? null
    : "set PAPER_FILE_ID in .env (instance or framework) or pass --file <id>",
});

for (const c of checks) {
  console.log(
    ` ${c.ok ? (c.warn ? "⚠" : "✓") : "✗"} ${c.label}${c.warn ? ` — ${c.warn}` : ""}${!c.ok && c.fix ? ` — ${c.fix}` : ""}`,
  );
}
const ok = checks.every((c) => c.ok);
console.log(ok ? "paper: canvas ready" : "paper: canvas not ready");
console.error(`metered calls: ${client.metered}`);
process.exit(ok ? 0 : 2);
