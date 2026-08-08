import yaml from "js-yaml";
import { extractCheckboxes, daysUntil, parseFrontmatter } from "./parse-helpers.mjs";

// Port of scripts/initialize.mjs readYamlSafe, adapted to look up in the flat
// `files` map instead of hitting the filesystem.
function loadYaml(files, p) {
  try {
    return files[p] ? yaml.load(files[p]) : null;
  } catch {
    return null;
  }
}

// ── Identity ─────────────────────────────────────────────────────────────────
// Scoped-down relative to initialize.mjs:139-180 (loadIdentity) — this page
// core only needs name/type, not the SOUL.md mission / TOOLS.md notion link.
function loadIdentity(files) {
  const federation = loadYaml(files, "federation.yaml");
  const identity = federation?.identity || {};
  return { name: identity.name ?? null, type: identity.type ?? null };
}

// ── Projects ─────────────────────────────────────────────────────────────────
// Verbatim port of scripts/initialize.mjs:223-286 (loadProjects), minus the
// content/projects v1 fallback (out of scope per plan), with fs reads swapped
// for lookups in the `files` map and gray-matter swapped for parseFrontmatter.
function loadProjects(files) {
  const projects = [];

  const projectsData = loadYaml(files, "data/projects.yaml");
  if (projectsData?.projects) {
    for (const p of projectsData.projects) {
      projects.push({
        name: p.title || p.name || p.id,
        stage: p.status || "idea",
        lead: p.lead || null,
        members: p.contributors || p.members || [],
        startDate: p.started || p.startDate || null,
        notionUrl: p.notion_url || null,
        taskCount: 0,
      });
    }
  }

  const projectKeys = Object.keys(files).filter((k) =>
    /^packages\/operations\/projects\/[^/]+\.md$/.test(k),
  );
  for (const key of projectKeys) {
    const fname = key.split("/").pop();
    // Skip package docs / templates, not actual projects
    if (fname.toLowerCase() === "readme.md" || fname.startsWith("_")) continue;

    const { data, content } = parseFrontmatter(files[key]);

    const taskMatches = content.match(/- \[ \]/g);
    const taskCount = taskMatches ? taskMatches.length : 0;

    const projName = data.title || data.name || fname.replace(".md", "");
    const existing = projects.find(
      (p) => p.name.toLowerCase() === projName.toLowerCase(),
    );
    if (existing) {
      existing.taskCount = taskCount;
      if (data.notion_url) existing.notionUrl = data.notion_url;
      continue;
    }

    projects.push({
      name: projName,
      stage: data.status || "idea",
      lead: data.lead || null,
      members: data.contributors || data.members || [],
      startDate: data.started || data.startDate || null,
      notionUrl: data.notion_url || null,
      taskCount,
    });
  }

  return projects;
}

// ── Tasks (from HEARTBEAT.md) ────────────────────────────────────────────────
// Verbatim port of scripts/initialize.mjs:290-328 (loadTasks), with `now`
// injected into daysUntil instead of the ambient clock.
function loadTasks(files, now) {
  const heartbeat = files["HEARTBEAT.md"] || "";
  if (!heartbeat) return { critical: [], urgent: [], upcoming: [], completed: [] };

  const items = extractCheckboxes(heartbeat);

  const critical = [];
  const urgent = [];
  const upcoming = [];
  const completed = [];

  for (const item of items) {
    if (item.done) {
      completed.push(item);
      continue;
    }

    if (item.due) {
      const days = daysUntil(item.due, now);
      if (days <= 0) {
        critical.push({ ...item, daysLeft: days });
      } else if (days <= 7) {
        urgent.push({ ...item, daysLeft: days });
      } else {
        upcoming.push({ ...item, daysLeft: days });
      }
    } else {
      const cat = item.category.toLowerCase();
      if (cat.includes("fund") || cat.includes("governance")) {
        urgent.push({ ...item, daysLeft: null });
      } else {
        upcoming.push({ ...item, daysLeft: null });
      }
    }
  }

  return { critical, urgent, upcoming, completed };
}

// ── Instances (framework-only) ───────────────────────────────────────────────
// Verbatim port of scripts/initialize.mjs:472-484 (loadInstances).
function loadInstances(files) {
  const instData = loadYaml(files, "data/instances.yaml");
  return (instData?.instances || []).map((i) => ({
    id: i.id,
    name: i.name,
    type: i.type,
    maturity: i.maturity,
    framework_version: i.framework_version,
    last_sync: i.last_sync,
    cloned: i.cloned,
    drift_count: (i.drift || []).length,
  }));
}

// ── Federation ───────────────────────────────────────────────────────────────
// Verbatim port of scripts/initialize.mjs:580-612 (loadFederation). Exported
// separately — Task 12 reuses it for a get_federation capability.
export function loadFederation(files) {
  const federation = loadYaml(files, "federation.yaml");
  if (!federation) return null;

  // Support both v3 (federation.peers) and v1 (peers at root) structures
  const fedSection = federation.federation || {};
  const peers = (fedSection.peers || federation.peers || []).map((p) => ({
    name: p.name || p.id,
    url: p.url || p.repository || null,
    role: p.role || null,
  }));

  const upstream = (fedSection.upstream || federation.upstream || []).map(
    (u) => ({
      repository: u.repository || u.url,
      lastSync: u.last_sync || null,
      syncFrequency: u.sync_frequency || null,
    }),
  );

  const knowledgeCommons = federation["knowledge-commons"] || {};
  const agentSection = federation.agent || {};

  return {
    network: fedSection.network || federation.network || null,
    role: fedSection.role || null,
    peers,
    upstream,
    packages: federation.packages || agentSection.packages || {},
    knowledgeCommons: knowledgeCommons.enabled || false,
    publishedDomains: knowledgeCommons.published_domains || [],
  };
}

// ── Events / Meetings ─────────────────────────────────────────────────────────
// Not a verbatim port of initialize.mjs's loadEvents/loadMeetings (which bucket
// by calendar week, Monday-anchored). Documented simplification per plan: a
// rolling [now, now+7d) window, since the page core has no notion of "today"
// other than the injected `now`. Item shape is deliberately minimal (date,
// title only) — page-core consumers only need these for a "this week" list.
function loadCalendarItems(files, path, arrKey, now) {
  const data = loadYaml(files, path);
  const items = (data?.[arrKey] || []).map((x) => ({
    date: x.date,
    title: x.title || x.name || x.topic || x.id,
  }));

  const weekEnd = new Date(now.getTime() + 7 * 86400000);

  const thisWeek = items.filter((x) => {
    const d = new Date(x.date);
    return now <= d && d < weekEnd;
  });
  const upcoming = items.filter((x) => new Date(x.date) >= weekEnd);

  return { thisWeek, upcoming };
}

// ── buildState ───────────────────────────────────────────────────────────────

export function buildState(files, { now }) {
  return {
    identity: loadIdentity(files),
    projects: loadProjects(files),
    tasks: loadTasks(files, now),
    instances: loadInstances(files),
    federation: loadFederation(files),
    events: loadCalendarItems(files, "data/events.yaml", "events", now),
    meetings: loadCalendarItems(files, "data/meetings.yaml", "meetings", now),
    decisionsRaw: files["DECISIONS.md"] ?? null,
    plansRaw: files["docs/agent-plans/QUEUE.md"] ?? null,
    funding: { upcoming: [] },
  };
}
