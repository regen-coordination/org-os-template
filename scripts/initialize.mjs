#!/usr/bin/env node

/**
 * org-os Initialize — Data Gatherer
 *
 * Reads all organizational state from local files + optional Notion API,
 * outputs structured JSON for agent consumption or pre-rendered markdown.
 *
 * Usage:
 *   node scripts/initialize.mjs                  # JSON output (for agent)
 *   node scripts/initialize.mjs --format=markdown # Pre-rendered dashboard
 *   node scripts/initialize.mjs --format=json     # Explicit JSON (default)
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const formatArg = args.find((a) => a.startsWith("--format="));
const format = formatArg ? formatArg.split("=")[1] : "json";

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readYamlSafe(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return null;
  try {
    return yaml.load(content);
  } catch {
    return null;
  }
}

function parseMarkdownFrontmatter(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return null;
  try {
    return matter(content);
  } catch {
    return null;
  }
}

function extractCheckboxes(markdownContent) {
  const lines = markdownContent.split("\n");
  const items = [];
  let currentCategory = "";

  for (const line of lines) {
    const categoryMatch = line.match(/^#{2,3}\s+(.+)/);
    if (categoryMatch) {
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    const checkboxMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      const done = checkboxMatch[1] !== " ";
      let text = checkboxMatch[2].trim();

      const dueMatch = text.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)/i);
      const due = dueMatch ? dueMatch[1] : null;

      const assigneeMatch = text.match(/@(\w+)/);
      const assignee = assigneeMatch ? assigneeMatch[1] : null;

      text = text
        .replace(/\(due:\s*\d{4}-\d{2}-\d{2}\)/i, "")
        .replace(/@\w+/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (text.startsWith("_(") && text.endsWith(")_")) continue;

      items.push({
        text,
        done,
        category: currentCategory,
        due,
        assignee,
      });
    }
  }

  return items;
}

function getRelativeAge(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function getFileModifiedAge(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return getRelativeAge(stat.mtime.toISOString());
  } catch {
    return null;
  }
}

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const date = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - now) / 86400000);
}

// ── Identity ─────────────────────────────────────────────────────────────────

function loadIdentity() {
  const federation = readYamlSafe(path.join(rootDir, "federation.yaml"));
  const soulMd = readFileSafe(path.join(rootDir, "SOUL.md"));

  const id = federation?.identity || {};

  let mission = "";
  if (soulMd) {
    const missionMatch = soulMd.match(/##\s*Mission[^\n]*\n+([^\n#]+)/i);
    if (missionMatch) {
      mission = missionMatch[1]
        .trim()
        .replace(/^[>_*]+\s*/, "")
        .replace(/[_*]+$/, "");
    }
  }

  const toolsMd = readFileSafe(path.join(rootDir, "TOOLS.md"));
  let notionWorkspaceUrl = null;
  if (toolsMd) {
    const notionMatch = toolsMd.match(
      /Workspace URL:\s*(https:\/\/notion\.so\/[^\s]+)/i,
    );
    if (
      notionMatch &&
      !notionMatch[1].includes("[") &&
      !notionMatch[1].includes("]")
    ) {
      notionWorkspaceUrl = notionMatch[1];
    }
  }

  return {
    name: id.name || "Organizational OS",
    type: id.type || "Organization",
    emoji: id.emoji || "",
    chain: id.chain || null,
    daoURI: id.daoURI || null,
    mission,
    notionUrl: notionWorkspaceUrl,
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

function loadStatus() {
  const federation = readYamlSafe(path.join(rootDir, "federation.yaml"));
  const memoryDir = path.join(rootDir, "memory");

  let lastMemory = null;
  let lastMemoryAge = null;
  if (fs.existsSync(memoryDir)) {
    const memoryFiles = fs
      .readdirSync(memoryDir)
      .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse();
    if (memoryFiles.length > 0) {
      lastMemory = memoryFiles[0].replace(".md", "");
      lastMemoryAge = getFileModifiedAge(path.join(memoryDir, memoryFiles[0]));
    }
  }

  const schemaAge = getFileModifiedAge(
    path.join(rootDir, ".well-known", "dao.json"),
  );

  const peers = federation?.federation?.peers || federation?.peers || [];
  const runtime = federation?.agent?.runtime || "none";
  const skills = federation?.agent?.skills || [];

  return {
    lastMemory,
    lastMemoryAge,
    schemaAge,
    peerCount: Array.isArray(peers) ? peers.length : 0,
    runtime,
    skillCount: skills.length,
    skills: skills,
  };
}

// ── Projects ─────────────────────────────────────────────────────────────────

function loadProjects() {
  const projects = [];

  // From data/projects.yaml
  const projectsData = readYamlSafe(
    path.join(rootDir, "data", "projects.yaml"),
  );
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

  // From packages/operations/projects/*.md (canonical v2 path)
  for (const projectsDir of [
    path.join(rootDir, "packages", "operations", "projects"),
    path.join(rootDir, "content", "projects"), // fallback for v1 instances
  ]) {
    if (!fs.existsSync(projectsDir)) continue;
    const files = fs.readdirSync(projectsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const parsed = parseMarkdownFrontmatter(path.join(projectsDir, file));
      if (!parsed) continue;
      const { data, content } = parsed;

      const taskMatches = content.match(/- \[ \]/g);
      const taskCount = taskMatches ? taskMatches.length : 0;

      const projName = data.title || data.name || file.replace(".md", "");
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
  }

  return projects;
}

// ── Tasks (from HEARTBEAT.md) ────────────────────────────────────────────────

function loadTasks() {
  const heartbeat = readFileSafe(path.join(rootDir, "HEARTBEAT.md"));
  if (!heartbeat)
    return { critical: [], urgent: [], upcoming: [], completed: [] };

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
      const days = daysUntil(item.due);
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

// ── Events (from data/events.yaml — v2) ─────────────────────────────────────

function loadEvents() {
  const eventsData = readYamlSafe(path.join(rootDir, "data", "events.yaml"));
  if (!eventsData?.events) return { thisWeek: [], upcoming: [] };

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const events = (eventsData.events || [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      title: e.title || e.id,
      date: e.date,
      endDate: e.end_date || null,
      type: e.type || "event",
      location: e.location || null,
      url: e.url || null,
      relatedProject: e.related_project || null,
      status: e.status || "upcoming",
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const thisWeek = events.filter((e) => {
    const d = new Date(e.date);
    return d >= weekStart && d < weekEnd;
  });

  const upcomingEvents = events
    .filter((e) => new Date(e.date) >= weekEnd)
    .slice(0, 5);

  return { thisWeek, upcoming: upcomingEvents };
}

// ── Meetings ─────────────────────────────────────────────────────────────────

function loadMeetings() {
  const meetings = [];

  // From data/meetings.yaml (canonical source)
  const meetingsData = readYamlSafe(
    path.join(rootDir, "data", "meetings.yaml"),
  );
  if (meetingsData?.meetings) {
    for (const m of meetingsData.meetings) {
      meetings.push({
        title: m.title || m.id,
        date: m.date,
        type: m.type || "meeting",
        status: "completed",
        participants: m.participants || [],
        notionUrl: null,
      });
    }
  }

  // From packages/operations/meetings/*.md (canonical v2 path)
  for (const meetingsDir of [
    path.join(rootDir, "packages", "operations", "meetings"),
    path.join(rootDir, "content", "meetings"), // fallback for v1
  ]) {
    if (!fs.existsSync(meetingsDir)) continue;
    const files = fs.readdirSync(meetingsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const parsed = parseMarkdownFrontmatter(path.join(meetingsDir, file));
      if (!parsed) continue;
      const { data } = parsed;
      if (!data.date) continue;

      const mtgTitle = data.title || file.replace(".md", "");
      const existing = meetings.find(
        (m) => m.title.toLowerCase() === mtgTitle.toLowerCase(),
      );
      if (existing) {
        if (data.notion_url) existing.notionUrl = data.notion_url;
        continue;
      }

      meetings.push({
        title: mtgTitle,
        date: data.date,
        type: data.type || "meeting",
        status: data.status || "planned",
        participants: data.participants || [],
        notionUrl: data.notion_url || null,
      });
    }
  }

  meetings.sort((a, b) => new Date(a.date) - new Date(b.date));

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const thisWeek = meetings.filter((m) => {
    const d = new Date(m.date);
    return d >= weekStart && d < weekEnd;
  });

  const upcomingMeetings = meetings
    .filter((m) => new Date(m.date) >= weekEnd)
    .slice(0, 5);

  return { thisWeek, upcoming: upcomingMeetings };
}

// ── Members ──────────────────────────────────────────────────────────────────

function loadMembers() {
  const membersData = readYamlSafe(path.join(rootDir, "data", "members.yaml"));
  return (membersData?.members || []).map((m) => ({
    name: m.name || m.id,
    role: m.role || "member",
    layer: m.layer || null,
    status: m.status || "active",
    joined: m.joined || null,
  }));
}

// ── Ideas ────────────────────────────────────────────────────────────────────

function loadIdeas() {
  const ideasData = readYamlSafe(path.join(rootDir, "data", "ideas.yaml"));
  return (ideasData?.ideas || []).map((i) => ({
    id: i.id,
    title: i.title,
    status: i.status,
    champions: i.champions || [],
  }));
}

// ── Instances (framework-only) ───────────────────────────────────────────────

function loadInstances() {
  const instData = readYamlSafe(path.join(rootDir, "data", "instances.yaml"));
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

// ── Skill promotion candidates (framework-only) ──────────────────────────────

function loadSkillCandidates() {
  const matrix = readYamlSafe(path.join(rootDir, "data", "skills-matrix.yaml"));
  return (matrix?.skills || [])
    .filter((s) => s.promotion_status === "candidate")
    .map((s) => ({
      id: s.id,
      owner: s.owner,
      instances_using: s.instances_using || [],
    }));
}

// ── Funding ──────────────────────────────────────────────────────────────────

function loadFunding() {
  const fundingData = readYamlSafe(
    path.join(rootDir, "data", "funding-opportunities.yaml"),
  );
  // Support both v2 key (funding_opportunities) and v1 key (opportunities)
  const opportunities =
    fundingData?.funding_opportunities || fundingData?.opportunities || [];

  const upcoming = [];
  const active = [];

  for (const opp of opportunities) {
    if (!opp.deadline) {
      if (
        opp.status === "active" ||
        opp.status === "applied" ||
        opp.status === "open"
      ) {
        active.push(opp);
      }
      continue;
    }

    const days = daysUntil(opp.deadline);
    if (days < 0) continue;
    if (opp.status === "applied" || opp.status === "awarded") {
      active.push(opp);
    } else {
      upcoming.push({ ...opp, daysLeft: days });
    }
  }

  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);

  return { upcoming, active };
}

// ── Recent Memory ────────────────────────────────────────────────────────────

function loadRecentMemory() {
  const memoryDir = path.join(rootDir, "memory");
  if (!fs.existsSync(memoryDir)) return [];

  const files = fs
    .readdirSync(memoryDir)
    .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse()
    .slice(0, 3);

  const entries = [];
  for (const file of files) {
    const content = readFileSafe(path.join(memoryDir, file));
    if (!content) continue;

    const lines = content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---"))
      .slice(0, 2)
      .join(" ")
      .trim();

    if (lines) {
      entries.push({
        date: file.replace(".md", ""),
        summary: lines.substring(0, 200),
      });
    }
  }

  return entries;
}

// ── Federation ───────────────────────────────────────────────────────────────

function loadFederation() {
  const federation = readYamlSafe(path.join(rootDir, "federation.yaml"));
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

// ── Key Docs ─────────────────────────────────────────────────────────────────

function loadKeyDocs() {
  const docs = [];
  const keyFiles = [
    { path: "MASTERPLAN.md", label: "Strategic vision & agent activations" },
    { path: "HEARTBEAT.md", label: "Active tasks & system health" },
    { path: "MEMORY.md", label: "Key decisions & context index" },
    { path: "SOUL.md", label: "Values, mission & voice" },
    { path: "IDENTITY.md", label: "Organization identity & addresses" },
    { path: "USER.md", label: "Operator profile & preferences" },
    { path: "federation.yaml", label: "Network config & integrations" },
    { path: "TOOLS.md", label: "Infrastructure & API endpoints" },
    { path: "data/projects.yaml", label: "Project registry" },
    { path: "data/members.yaml", label: "Member registry" },
    {
      path: "data/funding-opportunities.yaml",
      label: "Funding tracker",
    },
    { path: "data/ideas.yaml", label: "Community ideas pipeline" },
    { path: "data/events.yaml", label: "Events registry" },
  ];

  for (const doc of keyFiles) {
    const fullPath = path.join(rootDir, doc.path);
    if (fs.existsSync(fullPath)) {
      docs.push({
        path: doc.path,
        label: doc.label,
        lastModified: getFileModifiedAge(fullPath),
      });
    }
  }

  return docs;
}

// ── Apps & Workspaces ────────────────────────────────────────────────────────

function loadApps() {
  const federation = readYamlSafe(path.join(rootDir, "federation.yaml"));
  const packages = federation?.packages || federation?.agent?.packages || {};
  const apps = [];

  // Check for standard org-os packages
  const packageChecks = [
    {
      dir: "packages/dashboard",
      id: "dashboard",
      name: "Dashboard",
      description: "Organizational health overview",
      command: "cd packages/dashboard && npm run dev",
      icon: "📊",
    },
    {
      dir: "packages/ideation-board",
      id: "ideation-board",
      name: "Ideation Board",
      description: "Community ideas pipeline & voting",
      command: "cd packages/ideation-board && npm run dev",
      icon: "💡",
    },
    {
      dir: "packages/aggregator",
      id: "aggregator",
      name: "Aggregator",
      description: "Content aggregation from sources",
      command: "cd packages/aggregator && npm run dev",
      icon: "📰",
    },
    {
      dir: "packages/system-canvas",
      id: "system-canvas",
      name: "System Canvas",
      description: "Obsidian canvas org visualization",
      command: "npm run generate:canvas",
      icon: "🗺️",
    },
    {
      dir: "packages/knowledge-exchange",
      id: "knowledge-exchange",
      name: "Knowledge Exchange",
      description: "Cross-org knowledge sync",
      command: "cd packages/knowledge-exchange && npm run sync",
      icon: "🔄",
    },
    {
      dir: "packages/webapps/task-manager",
      id: "task-manager",
      name: "Task Manager",
      description: "Visual task board from HEARTBEAT.md",
      command: "open packages/webapps/task-manager/index.html",
      icon: "✅",
    },
  ];

  for (const pkg of packageChecks) {
    const pkgPath = path.join(rootDir, pkg.dir);
    if (fs.existsSync(pkgPath)) {
      apps.push({
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        command: pkg.command,
        url: null,
        status: "available",
        icon: pkg.icon,
      });
    }
  }

  // Built-in skills as invokable agents
  const builtinAgents = [
    {
      id: "research",
      name: "Research",
      description:
        "Deep research — ecosystem scanning, competitive intelligence",
      command: '@explore "Research [topic]"',
      icon: "🔍",
    },
    {
      id: "meeting-processor",
      name: "Meeting Processor",
      description: "Process transcripts into structured meeting notes",
      command: '"Process the meeting notes from [date/title]"',
      icon: "📝",
    },
    {
      id: "funding-scout",
      name: "Funding Scout",
      description: "Scan funding opportunities, track deadlines",
      command: '"Scan for new funding opportunities"',
      icon: "💰",
    },
    {
      id: "schema-generator",
      name: "Schema Generator",
      description: "Regenerate EIP-4824 JSON-LD schemas",
      command: "npm run generate:schemas",
      icon: "⚙️",
    },
  ];

  for (const agent of builtinAgents) {
    apps.push({ ...agent, url: null, status: "available" });
  }

  return apps;
}

// ── Git Status ───────────────────────────────────────────────────────────────

function loadGitStatus() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    const dirty =
      execSync("git status --porcelain 2>/dev/null", {
        cwd: rootDir,
        encoding: "utf-8",
      }).trim().length > 0;
    const lastCommit = execSync('git log -1 --format="%s" 2>/dev/null', {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    const lastCommitAge = execSync('git log -1 --format="%ar" 2>/dev/null', {
      cwd: rootDir,
      encoding: "utf-8",
    }).trim();
    return { branch, dirty, lastCommit, lastCommitAge };
  } catch {
    return null;
  }
}

// ── Skills ───────────────────────────────────────────────────────────────────

function loadSkills() {
  const skillsDir = path.join(rootDir, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const skills = [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;

    const parsed = parseMarkdownFrontmatter(skillMd);
    if (!parsed) continue;

    skills.push({
      name: parsed.data.name || entry.name,
      description: parsed.data.description || "",
    });
  }

  return skills;
}

// ── Notion Client (optional) ─────────────────────────────────────────────────

async function fetchNotionData() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) return null;

  const toolsMd = readFileSafe(path.join(rootDir, "TOOLS.md"));
  if (!toolsMd) return null;

  const dbIds = {};
  const projectsMatch = toolsMd.match(/Projects:\s*([a-f0-9-]{32,36})/i);
  const tasksMatch = toolsMd.match(/Tasks:\s*([a-f0-9-]{32,36})/i);
  const meetingsMatch = toolsMd.match(/Meetings:\s*([a-f0-9-]{32,36})/i);
  const membersMatch = toolsMd.match(/Members:\s*([a-f0-9-]{32,36})/i);

  if (projectsMatch) dbIds.projects = projectsMatch[1];
  if (tasksMatch) dbIds.tasks = tasksMatch[1];
  if (meetingsMatch) dbIds.meetings = meetingsMatch[1];
  if (membersMatch) dbIds.members = membersMatch[1];

  if (Object.keys(dbIds).length === 0) return null;

  try {
    const { Client } = await import("@notionhq/client");
    const notion = new Client({ auth: apiKey });

    const result = { projects: [], tasks: [], meetings: [], members: [] };

    if (dbIds.projects) {
      try {
        const response = await notion.databases.query({
          database_id: dbIds.projects,
          page_size: 50,
        });
        result.projects = response.results.map((page) => ({
          name: extractNotionTitle(page),
          notionUrl: page.url,
          stage:
            extractNotionSelect(page, "Status") ||
            extractNotionSelect(page, "Stage") ||
            "idea",
          lead:
            extractNotionPerson(page, "Lead") ||
            extractNotionPerson(page, "Owner"),
        }));
      } catch (e) {
        // Silently skip if DB not accessible
      }
    }

    if (dbIds.meetings) {
      try {
        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay() + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 14);

        const response = await notion.databases.query({
          database_id: dbIds.meetings,
          filter: {
            property: "Date",
            date: {
              on_or_after: weekStart.toISOString().split("T")[0],
            },
          },
          sorts: [{ property: "Date", direction: "ascending" }],
          page_size: 20,
        });
        result.meetings = response.results.map((page) => ({
          title: extractNotionTitle(page),
          date: extractNotionDate(page, "Date"),
          notionUrl: page.url,
          type: extractNotionSelect(page, "Type") || "meeting",
        }));
      } catch (e) {
        // Silently skip
      }
    }

    return result;
  } catch {
    return null;
  }
}

function extractNotionTitle(page) {
  const props = page.properties || {};
  for (const [, prop] of Object.entries(props)) {
    if (prop.type === "title" && prop.title?.length > 0) {
      return prop.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

function extractNotionSelect(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop) return null;
  if (prop.type === "select") return prop.select?.name || null;
  if (prop.type === "status") return prop.status?.name || null;
  return null;
}

function extractNotionPerson(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "people") return null;
  return prop.people?.[0]?.name || null;
}

function extractNotionDate(page, propName) {
  const prop = page.properties?.[propName];
  if (!prop || prop.type !== "date") return null;
  return prop.date?.start || null;
}

// ── Merge Notion + Local ─────────────────────────────────────────────────────

function mergeData(local, notion) {
  if (!notion) return local;

  if (notion.projects?.length > 0) {
    const merged = [...notion.projects];
    for (const localProj of local.projects) {
      const exists = merged.find(
        (p) => p.name.toLowerCase() === localProj.name.toLowerCase(),
      );
      if (!exists) {
        merged.push(localProj);
      } else {
        if (!exists.lead && localProj.lead) exists.lead = localProj.lead;
        if (localProj.taskCount) exists.taskCount = localProj.taskCount;
      }
    }
    local.projects = merged;
  }

  if (notion.meetings?.length > 0) {
    const merged = [...notion.meetings];
    for (const localMeeting of local.meetings.thisWeek) {
      const exists = merged.find(
        (m) => m.title.toLowerCase() === localMeeting.title.toLowerCase(),
      );
      if (!exists) merged.push(localMeeting);
    }
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    local.meetings.thisWeek = merged.filter((m) => {
      const d = new Date(m.date);
      return d >= weekStart && d < weekEnd;
    });
    local.meetings.upcoming = merged
      .filter((m) => {
        const d = new Date(m.date);
        return d >= weekEnd;
      })
      .slice(0, 5);
  }

  return local;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const identity = loadIdentity();
  const status = loadStatus();
  const projects = loadProjects();
  const tasks = loadTasks();
  const events = loadEvents();
  const meetings = loadMeetings();
  const members = loadMembers();
  const ideas = loadIdeas();
  const instances = loadInstances();
  const skillCandidates = loadSkillCandidates();
  const funding = loadFunding();
  const recentMemory = loadRecentMemory();
  const federation = loadFederation();
  const docs = loadKeyDocs();
  const skills = loadSkills();
  const apps = loadApps();
  const git = loadGitStatus();

  let state = {
    generated: new Date().toISOString(),
    identity,
    status,
    projects,
    tasks,
    events,
    meetings,
    members,
    ideas,
    instances,
    skillCandidates,
    funding,
    recentMemory,
    federation,
    docs,
    skills,
    apps,
    git,
  };

  const notionData = await fetchNotionData();
  if (notionData) {
    state = mergeData(state, notionData);
    state.status.notionConnected = true;
  } else {
    state.status.notionConnected = false;
  }

  if (format === "markdown") {
    console.log(renderMarkdown(state));
  } else {
    console.log(JSON.stringify(state, null, 2));
  }
}

// ── Markdown Renderer ────────────────────────────────────────────────────────

function renderMarkdown(state) {
  const {
    identity,
    status,
    projects,
    tasks,
    events,
    meetings,
    members,
    funding,
    recentMemory,
    federation,
    docs,
    skills,
  } = state;

  const today = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let out = "";

  // Banner
  const orgName = identity.name || "Org OS";
  const notionLink = identity.notionUrl
    ? ` [Notion](${identity.notionUrl})`
    : "";
  out += `\`\`\`\n`;
  out += generateAsciiBanner(orgName);
  out += `\`\`\`\n\n`;
  if (identity.emoji || notionLink) {
    out += `${identity.emoji ? identity.emoji + "  " : ""}**${identity.type}**`;
    if (identity.chain) out += ` · ${identity.chain}`;
    if (notionLink) out += ` ·${notionLink}`;
    out += `\n\n`;
  }

  // Status bar
  const statusParts = [];
  if (status.lastMemoryAge) statusParts.push(`Memory: ${status.lastMemoryAge}`);
  else statusParts.push("Memory: no entries yet");
  statusParts.push(`Peers: ${status.peerCount}`);
  statusParts.push(`Runtime: ${status.runtime}`);
  if (status.schemaAge) statusParts.push(`Schemas: ${status.schemaAge}`);
  if (status.notionConnected) statusParts.push("Notion: connected");
  out += `> ${statusParts.join(" · ")}\n\n`;

  // Projects
  out += `### Active Projects\n\n`;
  if (projects.length === 0) {
    out += `_No projects yet. Add to \`data/projects.yaml\` or run \`npm run setup\`._\n\n`;
  } else {
    out += `| Project | Stage | Lead | Link |\n`;
    out += `|---------|-------|------|------|\n`;
    for (const p of projects) {
      const stageChar = (p.stage || "idea")[0].toUpperCase();
      const stage = `\`[${stageChar}]\` ${p.stage}`;
      const lead = p.lead || "—";
      const link = p.notionUrl ? `[open](${p.notionUrl})` : "—";
      out += `| ${p.name} | ${stage} | ${lead} | ${link} |\n`;
    }
    out += `\n`;
  }

  // Tasks
  out += `### Tasks\n\n`;
  const allPending = [...tasks.critical, ...tasks.urgent, ...tasks.upcoming];
  if (allPending.length === 0 && tasks.completed.length === 0) {
    out += `_No tasks in HEARTBEAT.md yet._\n\n`;
  } else {
    for (const t of tasks.critical) {
      const due = t.due ? ` (${t.due})` : "";
      out += `- [ ] **${t.text}**${due} — \`CRITICAL\`\n`;
    }
    for (const t of tasks.urgent) {
      const due = t.daysLeft != null ? ` (${t.daysLeft}d left)` : "";
      out += `- [ ] ${t.text}${due} — \`URGENT\`\n`;
    }
    for (const t of tasks.upcoming) {
      out += `- [ ] ${t.text}\n`;
    }
    for (const t of tasks.completed.slice(0, 3)) {
      out += `- [x] ~~${t.text}~~\n`;
    }
    out += `\n`;
    out += `> ${allPending.length} pending · ${tasks.critical.length} critical · ${tasks.completed.length} done\n\n`;
  }

  // This Week (merged events + meetings)
  out += `### This Week\n\n`;
  const weekItems = [
    ...meetings.thisWeek.map((m) => ({ ...m, source: "meeting" })),
    ...(events?.thisWeek || []).map((e) => ({ ...e, source: "event" })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  if (weekItems.length === 0) {
    out += `_No meetings or events scheduled this week._\n\n`;
  } else {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1);

    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      const dayStr = dayNames[day.getDay()];
      const dateNum = day.getDate();
      const isToday = day.toDateString() === today.toDateString();
      const marker = isToday ? " **<-**" : "";

      const dayItems = weekItems.filter((m) => {
        const md = new Date(m.date);
        return md.toDateString() === day.toDateString();
      });

      if (dayItems.length > 0) {
        for (const m of dayItems) {
          const time = new Date(m.date).toLocaleTimeString("en", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          const link =
            m.notionUrl || m.url
              ? ` [link](${m.notionUrl || m.url})`
              : "";
          out += `- **${dayStr} ${dateNum}** — ${m.title} ${time}${link}${marker}\n`;
        }
      } else if (isToday) {
        out += `- **${dayStr} ${dateNum}** — _(today)_\n`;
      }
    }
    out += `\n`;
  }

  // Funding
  if (funding.upcoming.length > 0) {
    out += `### Funding Deadlines\n\n`;
    for (const f of funding.upcoming.slice(0, 5)) {
      const urgency = f.daysLeft <= 7 ? " **URGENT**" : "";
      const url = f.url ? ` [apply](${f.url})` : "";
      const name = f.title || f.fund || f.platform || "Unknown";
      out += `- ${name} — ${f.daysLeft}d left${urgency}${url}\n`;
    }
    out += `\n`;
  }

  // Recent Context
  if (recentMemory.length > 0) {
    out += `### Recent Context\n\n`;
    for (const entry of recentMemory) {
      out += `- **${entry.date}**: ${entry.summary}\n`;
    }
    out += `\n`;
  }

  // Cheatsheet
  out += `### Cheatsheet\n\n`;
  out += `| Command | Purpose |\n`;
  out += `|---------|---------|\n`;
  out += `| \`npm run setup\` | Interactive org configuration |\n`;
  out += `| \`npm run generate:schemas\` | Regenerate EIP-4824 schemas |\n`;
  out += `| \`npm run validate:schemas\` | Validate schema compliance |\n`;
  out += `| \`npm run validate:structure\` | Check instance structure |\n`;
  out += `| \`/initialize\` | Open session (this dashboard) |\n`;
  out += `| \`/close\` | Wrap up, write memory & commit |\n`;
  out += `\n`;

  out += `**Agent tips:** `;
  const tips = [];
  if (tasks.critical.length > 0)
    tips.push(`"Help me with ${tasks.critical[0].text}"`);
  if (weekItems.length > 0) tips.push(`"Prepare for ${weekItems[0].title}"`);
  if (funding.upcoming.length > 0)
    tips.push(
      `"Review ${funding.upcoming[0].title || funding.upcoming[0].fund || "funding"} deadline"`,
    );
  if (tips.length === 0)
    tips.push(
      '"Review HEARTBEAT tasks"',
      '"Process latest meeting notes"',
      '"What funding deadlines are coming?"',
    );
  out += tips.join(" · ") + "\n\n";

  // Federation
  if (federation) {
    out += `### Federation\n\n`;
    const parts = [];
    if (federation.upstream?.length > 0)
      parts.push(`Upstream: ${federation.upstream[0].repository}`);
    if (federation.peers.length > 0)
      parts.push(`Peers: ${federation.peers.map((p) => p.name).join(", ")}`);
    parts.push(`Skills: ${status.skillCount} active`);
    if (federation.knowledgeCommons) parts.push("Knowledge Commons: enabled");
    out += `> ${parts.join(" · ")}\n\n`;
  }

  out += `---\n\n`;
  out += `**What would you like to work on?**\n`;

  return out;
}

// ── ASCII Banner Generator ───────────────────────────────────────────────────

function generateAsciiBanner(name) {
  const font = {
    A: ["  █  ", " █ █ ", "█████", "█   █", "█   █"],
    B: ["████ ", "█   █", "████ ", "█   █", "████ "],
    C: [" ████", "█    ", "█    ", "█    ", " ████"],
    D: ["████ ", "█   █", "█   █", "█   █", "████ "],
    E: ["█████", "█    ", "████ ", "█    ", "█████"],
    F: ["█████", "█    ", "████ ", "█    ", "█    "],
    G: [" ████", "█    ", "█  ██", "█   █", " ████"],
    H: ["█   █", "█   █", "█████", "█   █", "█   █"],
    I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
    J: ["█████", "    █", "    █", "█   █", " ███ "],
    K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
    L: ["█    ", "█    ", "█    ", "█    ", "█████"],
    M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
    O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
    P: ["████ ", "█   █", "████ ", "█    ", "█    "],
    Q: [" ███ ", "█   █", "█ █ █", "█  █ ", " ██ █"],
    R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
    S: [" ████", "█    ", " ███ ", "    █", "████ "],
    T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
    V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
    W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
    X: ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
    Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
    Z: ["█████", "   █ ", "  █  ", " █   ", "█████"],
    0: [" ███ ", "█  ██", "█ █ █", "██  █", " ███ "],
    1: ["  █  ", " ██  ", "  █  ", "  █  ", "█████"],
    2: [" ███ ", "█   █", "  ██ ", " █   ", "█████"],
    3: ["████ ", "    █", " ███ ", "    █", "████ "],
    4: ["█   █", "█   █", "█████", "    █", "    █"],
    5: ["█████", "█    ", "████ ", "    █", "████ "],
    6: [" ████", "█    ", "████ ", "█   █", " ███ "],
    7: ["█████", "    █", "   █ ", "  █  ", "  █  "],
    8: [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
    9: [" ███ ", "█   █", " ████", "    █", "████ "],
    " ": ["     ", "     ", "     ", "     ", "     "],
    "-": ["     ", "     ", "█████", "     ", "     "],
    ".": ["     ", "     ", "     ", "     ", "  █  "],
    "+": ["     ", "  █  ", "█████", "  █  ", "     "],
    "/": ["    █", "   █ ", "  █  ", " █   ", "█    "],
  };

  let displayName;
  if (name.length <= 14) {
    displayName = name;
  } else {
    const words = name.split(/[\s-]+/).filter((w) => w.length > 0);
    if (words.length >= 2) {
      displayName = words
        .map((w) => w[0])
        .join("")
        .toUpperCase();
      if (displayName.length < 2) {
        displayName = words.slice(0, 2).join(" ");
      }
    } else {
      displayName = name.substring(0, 12).trim();
    }
  }
  const fullText = displayName.toUpperCase() + " OS";

  const lines = ["", "", "", "", ""];
  for (const char of fullText) {
    const glyph = font[char] || font[" "];
    for (let row = 0; row < 5; row++) {
      lines[row] += glyph[row] + " ";
    }
  }

  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error("Error during initialization:", err.message);
  process.exit(1);
});
