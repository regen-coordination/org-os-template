/**
 * render-page.mjs — pure page renderers (file-contents-derived state in → markdown out).
 *
 * The four table/list renderers (`projects`, `tasks`, `instances`, `this-week`) are verbatim
 * ports of `scripts/page-shim.mjs`'s renderer bodies, with `state` as a parameter instead of a
 * module-scope binding and `fs` reads replaced by the `decisionsRaw` / `plansRaw` state keys.
 * Byte-for-byte output parity with the shim is a gate (see the plan's Task 17), so treat any
 * change to these bodies as a change to the shim's public output.
 *
 * `dashboard` is NOT a port — it is a new composite page for the Cloudflare OS gadget. The shim
 * keeps delegating its own `dashboard` to `initialize.mjs --format=markdown` (the rich banner
 * version); this one is the compact, substrate-renderable summary.
 *
 * Pure: no fs, no network, no clock. All time-dependence is already resolved in `buildState`.
 */

export const SUPPORTED_PAGES = [
  "dashboard",
  "projects",
  "tasks",
  "instances",
  "decisions",
  "plans",
  "this-week",
];

// The table alone, so the dashboard can embed it under its own heading without re-slicing text.
function projectsTable(state) {
  const projects = state.projects || [];
  let out = "| Project | Stage | Lead | Started | Tasks |\n";
  out += "|---|---|---|---|---|\n";
  for (const p of projects) {
    out += `| ${p.name} | ${p.stage} | ${p.lead || "—"} | ${p.startDate || "—"} | ${p.taskCount ?? 0} |\n`;
  }
  return out;
}

function renderProjects(state) {
  const projects = state.projects || [];
  return `# Projects\n\n${projects.length} workstreams.\n\n${projectsTable(state)}`;
}

function renderTasks(state) {
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
}

function renderInstances(state) {
  const instances = state.instances || [];
  let out = `# Instances\n\n${instances.length} tracked instances.\n\n`;
  out += "| ID | Name | Type | Maturity | Framework | Last Sync | Drift |\n";
  out += "|---|---|---|---|---|---|---|\n";
  for (const i of instances) {
    out += `| ${i.id} | ${i.name} | ${i.type} | ${i.maturity} | ${i.framework_version || "—"} | ${i.last_sync || "—"} | ${i.drift_count ?? 0} |\n`;
  }
  return out;
}

function renderDecisions(state) {
  return state.decisionsRaw ?? "# Decisions\n\nDECISIONS.md not found.\n";
}

function renderPlans(state) {
  return state.plansRaw ?? "# Plans\n\nQUEUE.md not found.\n";
}

/**
 * `depth` controls the sub-heading level so the same body can sit under `# This Week` (the
 * standalone page, depth 2 — parity with the shim) or under `## This Week` (the dashboard
 * composite, depth 3) without the subsections escaping their parent section.
 */
function thisWeekBody(state, depth = 2) {
  const h = "#".repeat(depth);
  const events = state.events?.thisWeek || [];
  const meetings = state.meetings?.thisWeek || [];
  const funding = (state.funding?.upcoming || []).filter((f) => {
    if (!f.daysLeft) return false;
    return f.daysLeft <= 7;
  });
  const critical = state.tasks?.critical || [];
  const urgent = state.tasks?.urgent || [];

  let out = "";
  if (!events.length && !meetings.length && !funding.length && !critical.length && !urgent.length) {
    out += "_Nothing scheduled or critical this week._\n";
    return out;
  }
  if (critical.length) {
    out += `${h} Critical tasks\n\n`;
    for (const t of critical) out += `- ⚡ ${t.text}\n`;
    out += "\n";
  }
  if (urgent.length) {
    out += `${h} Urgent tasks\n\n`;
    for (const t of urgent) out += `- ◆ ${t.text}\n`;
    out += "\n";
  }
  if (meetings.length) {
    out += `${h} Meetings\n\n`;
    for (const m of meetings) out += `- ${m.date || "—"} — ${m.title}\n`;
    out += "\n";
  }
  if (events.length) {
    out += `${h} Events\n\n`;
    for (const e of events) out += `- ${e.date || "—"} — ${e.title}\n`;
    out += "\n";
  }
  if (funding.length) {
    out += `${h} Funding deadlines (≤7 days)\n\n`;
    for (const f of funding) out += `- ${f.daysLeft}d left — ${f.title}\n`;
    out += "\n";
  }
  return out;
}

function renderThisWeek(state) {
  return `# This Week\n\n${thisWeekBody(state, 2)}`;
}

function renderDashboard(state) {
  const identity = state.identity || {};
  const tasks = state.tasks || {};
  const federation = state.federation || {};
  const peerCount = (federation.peers || []).length;

  let out = `# ${identity.name || "org-os instance"}\n\n`;
  out += `${identity.type || "Unknown type"}\n\n`;

  out += `## Projects\n\n`;
  out += projectsTable(state) + "\n";

  out += `## Tasks\n\n`;
  out += `${(tasks.critical || []).length} critical · ${(tasks.urgent || []).length} urgent · ${(tasks.upcoming || []).length} upcoming\n\n`;

  out += `## This Week\n\n`;
  out += thisWeekBody(state, 3).trimEnd() + "\n\n";

  out += `## Federation\n\n`;
  out += `${federation.network || "—"} · ${peerCount} peer${peerCount === 1 ? "" : "s"}\n`;

  return out;
}

const RENDERERS = {
  dashboard: renderDashboard,
  projects: renderProjects,
  tasks: renderTasks,
  instances: renderInstances,
  decisions: renderDecisions,
  plans: renderPlans,
  "this-week": renderThisWeek,
};

/**
 * renderPage(pageId, state) → markdown string.
 * Throws on an unrecognised pageId — callers that accept user input should validate against
 * SUPPORTED_PAGES first (the `get_page` capability returns BAD_ARGS rather than propagating).
 */
export function renderPage(pageId, state) {
  const renderer = RENDERERS[pageId];
  if (!renderer) {
    throw new Error(`Unknown page: ${pageId}. Supported: ${SUPPORTED_PAGES.join(", ")}`);
  }
  return renderer(state || {});
}
