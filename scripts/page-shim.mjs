#!/usr/bin/env node

/**
 * page-shim.mjs — transitional bridge for `npm run page <id>`
 *
 * Until the full TUI renderer ships (see docs/agent-plans/tui-dashboard-implementation.md
 * Task 12), this script provides a minimal markdown rendering for the most common
 * page ids using the existing scripts/initialize.mjs JSON output and DECISIONS.md.
 *
 * When the real renderer (`packages/tui/src/modes/print.mjs`) is wired in,
 * the `page` script in package.json gets retargeted there. This file becomes
 * obsolete and should be removed.
 *
 * Usage:
 *   npm run page <id>                      # dashboard, projects, tasks, instances, decisions, this-week, plans
 *   node scripts/page-shim.mjs <id>
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const SUPPORTED = ["dashboard", "projects", "tasks", "instances", "decisions", "plans", "this-week"];

const pageId = process.argv[2];

if (!pageId) {
  process.stderr.write(
    "Usage: npm run page <id>\n" +
      `Available pages (shim): ${SUPPORTED.join(", ")}\n` +
      "Full page list will be available once the TUI renderer ships (see docs/agent-plans/tui-dashboard-implementation.md).\n",
  );
  process.exit(2);
}

// Dashboard — delegate to the existing rich markdown renderer.
if (pageId === "dashboard") {
  try {
    const out = execSync("node scripts/initialize.mjs --format=markdown", { cwd: rootDir });
    process.stdout.write(out);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`page-shim: dashboard render failed: ${err.message}\n`);
    process.exit(1);
  }
}

// All other pages: derive from the JSON output.
let state;
try {
  const json = execSync("node scripts/initialize.mjs", { cwd: rootDir, encoding: "utf-8" });
  state = JSON.parse(json);
} catch (err) {
  process.stderr.write(`page-shim: could not load state: ${err.message}\n`);
  process.exit(1);
}

const renderers = {
  projects() {
    const projects = state.projects || [];
    let out = `# Projects\n\n${projects.length} workstreams.\n\n`;
    out += "| Project | Stage | Lead | Started | Tasks |\n";
    out += "|---|---|---|---|---|\n";
    for (const p of projects) {
      out += `| ${p.name} | ${p.stage} | ${p.lead || "—"} | ${p.startDate || "—"} | ${p.taskCount ?? 0} |\n`;
    }
    return out;
  },

  tasks() {
    const tasks = state.tasks || { critical: [], urgent: [], upcoming: [], completed: [] };
    let out = `# Tasks\n\n`;
    const tiers = [
      ["Critical", tasks.critical],
      ["Urgent", tasks.urgent],
      ["Upcoming", tasks.upcoming],
      ["Completed", tasks.completed],
    ];
    for (const [label, list] of tiers) {
      if (!list || list.length === 0) continue;
      out += `## ${label} (${list.length})\n\n`;
      for (const t of list) {
        const checkbox = t.done ? "[x]" : "[ ]";
        const cat = t.category ? ` _(${t.category})_` : "";
        out += `- ${checkbox} ${t.text}${cat}\n`;
      }
      out += "\n";
    }
    return out;
  },

  instances() {
    const instances = state.instances || [];
    let out = `# Instances\n\n${instances.length} tracked instances.\n\n`;
    out += "| ID | Name | Type | Maturity | Framework | Last Sync | Drift |\n";
    out += "|---|---|---|---|---|---|---|\n";
    for (const i of instances) {
      out += `| ${i.id} | ${i.name} | ${i.type} | ${i.maturity} | ${i.framework_version || "—"} | ${i.last_sync || "—"} | ${i.drift_count ?? 0} |\n`;
    }
    return out;
  },

  decisions() {
    const decisionsPath = path.join(rootDir, "DECISIONS.md");
    if (!fs.existsSync(decisionsPath)) {
      return "# Decisions\n\nDECISIONS.md not found.\n";
    }
    return fs.readFileSync(decisionsPath, "utf-8");
  },

  plans() {
    const queuePath = path.join(rootDir, "docs/agent-plans/QUEUE.md");
    if (!fs.existsSync(queuePath)) {
      return "# Plans\n\nQUEUE.md not found.\n";
    }
    return fs.readFileSync(queuePath, "utf-8");
  },

  "this-week"() {
    const events = state.events?.thisWeek || [];
    const meetings = state.meetings?.thisWeek || [];
    const funding = (state.funding?.upcoming || []).filter((f) => {
      if (!f.daysLeft) return false;
      return f.daysLeft <= 7;
    });
    const critical = state.tasks?.critical || [];
    const urgent = state.tasks?.urgent || [];

    let out = `# This Week\n\n`;
    if (!events.length && !meetings.length && !funding.length && !critical.length && !urgent.length) {
      out += "_Nothing scheduled or critical this week._\n";
      return out;
    }
    if (critical.length) {
      out += "## Critical tasks\n\n";
      for (const t of critical) out += `- ⚡ ${t.text}\n`;
      out += "\n";
    }
    if (urgent.length) {
      out += "## Urgent tasks\n\n";
      for (const t of urgent) out += `- ◆ ${t.text}\n`;
      out += "\n";
    }
    if (meetings.length) {
      out += "## Meetings\n\n";
      for (const m of meetings) out += `- ${m.date || "—"} — ${m.title}\n`;
      out += "\n";
    }
    if (events.length) {
      out += "## Events\n\n";
      for (const e of events) out += `- ${e.date || "—"} — ${e.title}\n`;
      out += "\n";
    }
    if (funding.length) {
      out += "## Funding deadlines (≤7 days)\n\n";
      for (const f of funding) out += `- ${f.daysLeft}d left — ${f.title}\n`;
      out += "\n";
    }
    return out;
  },
};

const renderer = renderers[pageId];
if (!renderer) {
  process.stderr.write(
    `page-shim: page "${pageId}" is not yet available in shim mode.\n` +
      `Available pages: ${SUPPORTED.join(", ")}\n` +
      `Full page list will arrive when the TUI renderer ships (Task 12 of docs/agent-plans/tui-dashboard-implementation.md).\n`,
  );
  process.exit(2);
}

process.stdout.write(renderer());
process.exit(0);
