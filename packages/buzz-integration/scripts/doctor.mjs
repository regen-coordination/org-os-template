#!/usr/bin/env node
// doctor.mjs — is the Buzz lane ready? Exit 0 green, 2 not-ready (warn).
import { status, loadConfig } from "../lib/buzz.mjs";
const cfg = loadConfig();
const s = status(cfg);
const label = {
  bin: "buzz binary on PATH (pinned)",
  relay: `relay ${cfg.relayUrl}`,
  key: "agent key (BUZZ_PRIVATE_KEY)",
  channel: `channel ${cfg.channel}`,
};
for (const [k, ok] of Object.entries(s.checks))
  console.log(` ${ok ? "✓" : "✗"} ${label[k]}`);
console.log(
  s.ok ? "buzz: lane ready" : "buzz: lane not ready — hooks will skip",
);
process.exit(s.ok ? 0 : 2);
