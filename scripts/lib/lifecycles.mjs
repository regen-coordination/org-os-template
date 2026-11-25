// The lifecycles of the instance's records, declared once. Each status/stage/coverage field in
// data/*.yaml and docs/plans/*.md moves through the states listed here. The dashboard
// (scripts/initialize.mjs) and the validators (scripts/lib/registry-schemas.mjs,
// scripts/validate-identity.mjs) read their value lists from this file instead of keeping their own
// copies. An agent about to write a status reads it here.
//
// Per lifecycle:
//   where     the file and field that hold the state
//   initial   the value an entry has when the field is left out
//   line      the states in order. The dashboard draws these as  a → b → c
//   aside     live states that are not steps on the line (shown as "also: …")
//   terminal  where an entry ends. Counted in the total, never shown as live
//   next      the moves the docs allow, where the docs name them. Nothing enforces these yet:
//             no lifecycle keeps a history to check a move against. They are the reference for
//             skills and agents.
//   alias     values from older vocabularies (Notion, the framework) mapped onto this one.
//             Matching ignores case.
//   source    the doc that defines the vocabulary

export const LIFECYCLES = {
  ideas: {
    where: "data/ideas.yaml · ideas[].status",
    initial: "surfaced",
    line: ["surfaced", "proposed", "approved", "developing", "hatched"],
    aside: [],
    terminal: ["archived"],
    next: {
      surfaced: ["proposed", "archived"],
      proposed: ["approved", "archived"],
      approved: ["developing", "archived"],
      developing: ["hatched", "archived"],
      hatched: ["archived"],
      archived: [],
    },
    source: "docs/IDEA-HATCHING.md",
  },
  funding: {
    where: "data/funding-opportunities.yaml · opportunities[].status",
    initial: "monitoring",
    line: ["monitoring", "researching", "preparing", "applied", "awarded"],
    aside: ["open"],
    terminal: ["declined", "closed"],
    // the framework template's words (pending | applied | approved | rejected | expired) and the
    // funding-scout skill's "pending" for a new find
    alias: { active: "open", pending: "monitoring", approved: "awarded", rejected: "declined", expired: "closed" },
    source: "data/funding-opportunities.yaml (header)",
  },
  projects: {
    where: "data/projects.yaml · projects[].status",
    initial: "Discovery",
    line: ["Discovery", "Develop", "Deploy", "Sunset"],
    aside: ["Integrate", "Execute"],
    terminal: ["Archive"],
    // Notion's Status column and the framework's lowercase stages
    alias: { idea: "Discovery", backlog: "Discovery", planning: "Discovery", icebox: "Discovery", active: "Develop", "in-progress": "Develop", "on-going": "Develop", integrate: "Integrate", archived: "Archive", done: "Archive", canceled: "Archive", cancelled: "Archive" },
    working: ["Develop", "Deploy", "Integrate", "Execute"],
    source: "data/projects.yaml (header)",
  },
  plans: {
    where: "docs/plans/*.md · frontmatter status",
    initial: null,
    line: ["scoping", "queued", "active", "completed"],
    aside: [],
    terminal: ["cancelled"],
    next: { scoping: ["queued", "cancelled"], queued: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: [] },
    source: "docs/PLANS.md",
  },
  knowledge: {
    where: "data/knowledge-manifest.yaml · knowledge_manifest.domains[].coverage",
    initial: "none",
    line: ["none", "partial", "comprehensive"],
    aside: [],
    terminal: [],
    alias: { stub: "none" },
    source: "scripts/update-knowledge-index.mjs (derived from page counts)",
  },
};

/** Every value a lifecycle knows, in order: the line, then aside, then terminal. */
export function valuesOf(id) {
  const l = LIFECYCLES[id];
  return [...l.line, ...l.aside, ...l.terminal];
}

/** A raw value → the lifecycle's canonical spelling, or null if the lifecycle does not know it. */
export function canonical(id, value) {
  const l = LIFECYCLES[id];
  if (value === undefined || value === null || value === "") return l.initial;
  const v = String(value).trim();
  const lower = v.toLowerCase();
  const known = valuesOf(id).find((s) => s.toLowerCase() === lower);
  if (known) return known;
  const alias = l.alias && Object.entries(l.alias).find(([k]) => k.toLowerCase() === lower);
  return alias ? alias[1] : null;
}

export const isTerminal = (id, value) => LIFECYCLES[id].terminal.includes(canonical(id, value));

/**
 * Count raw values against a lifecycle so that every entry is accounted for.
 * Returns { line: {stage: n}, aside: {state: n}, terminal: {state: n}, unknown: {raw: n}, total }.
 * total counts every entry. The dashboard prints it, so nothing goes missing silently.
 */
export function tally(id, values) {
  const l = LIFECYCLES[id];
  const out = { line: {}, aside: {}, terminal: {}, unknown: {}, total: 0 };
  for (const s of l.line) out.line[s] = 0;
  for (const raw of values) {
    out.total += 1;
    const c = canonical(id, raw);
    const bucket = c === null ? "unknown" : l.line.includes(c) ? "line" : l.aside.includes(c) ? "aside" : "terminal";
    const key = c ?? String(raw).trim().split(/\s+/)[0].slice(0, 24);
    out[bucket][key] = (out[bucket][key] ?? 0) + 1;
  }
  return out;
}

/**
 * Funding on the dashboard. A dated, unexpired entry is upcoming unless it has been applied for or
 * awarded (then it is active) or has ended (terminal: closed, declined, never shown). An undated
 * entry shows only while open or applied.
 */
export function classifyFunding(opps, daysUntil) {
  const upcoming = [];
  const active = [];
  for (const opp of opps) {
    const status = canonical("funding", opp.status);
    if (isTerminal("funding", opp.status)) continue;
    if (!opp.deadline) {
      if (status === "open" || status === "applied") active.push(opp);
      continue;
    }
    const days = daysUntil(opp.deadline);
    if (days < 0) continue;
    if (status === "applied" || status === "awarded") active.push(opp);
    else upcoming.push({ ...opp, daysLeft: days });
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);
  return { upcoming, active };
}

/** Projects: order for display (working first, then along the line), and whether one is hidden or working. */
export function projectRank(stage) {
  const l = LIFECYCLES.projects;
  const c = canonical("projects", stage);
  if (c === null) return 99;
  const order = [...l.working, ...l.line.filter((s) => !l.working.includes(s)), ...l.terminal];
  return order.indexOf(c);
}
export const projectIsWorking = (stage) => LIFECYCLES.projects.working.includes(canonical("projects", stage));
export const projectIsHidden = (stage) => isTerminal("projects", stage);

/**
 * docs/plans/QUEUE.md: the plans lifecycle's other half. Its ## Active / Queued / Backlog /
 * Completed sections hold items in two shapes:
 *   - [title](file.md) — description                       (the framework's)
 *   - **Title** (notes…). Plan: [`file.md`](file.md) …     (this instance's, wrapped over lines)
 * The plan link of the second shape can sit on a continuation line.
 */
export function parseQueue(md) {
  const result = { active: [], queued: [], backlog: [], completed: [] };
  let section = null;
  let item = null;
  for (const line of String(md ?? "").split("\n")) {
    const head = line.match(/^##\s+(Active|Queued|Backlog|Completed)\b/i);
    if (head) {
      section = head[1].toLowerCase();
      item = null;
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      section = null;
      item = null;
      continue;
    }
    if (!section) continue;
    const linked = line.match(/^(?:[-*]|\d+\.)\s+\[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)/);
    if (linked) {
      item = { title: linked[1], file: linked[2], description: linked[3].trim() };
      result[section].push(item);
      continue;
    }
    const bold = line.match(/^(?:[-*]|\d+\.)\s+\*\*(.+?)\*\*/);
    if (bold) {
      item = { title: bold[1].replace(/[.:]$/, ""), file: null, description: "" };
      result[section].push(item);
    } else if (!/^\s+\S/.test(line)) {
      item = null; // a blank or unindented line ends the item
    }
    if (item && item.file === null) {
      const plan = line.match(/Plans?:\s*\[[^\]]*\]\(([^)\s]+\.md)\)/) ?? line.match(/\]\(([^)\s]+\.md)\)/);
      if (plan) item.file = plan[1];
    }
  }
  return result;
}
