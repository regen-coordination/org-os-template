import { slug } from "../util";
import type { Block, PageData, PageRef } from "../types";
import { makePage, notice, type PageContext, type Resolver } from "./helpers";

function needState(ref: PageRef, ctx: PageContext): PageData | null {
  if (!ctx.ws) return makePage(ref, ref.page, [notice("warn", "No workspace selected.")]);
  if (!ctx.ws.state) return makePage(ref, ctx.ws.info.label, [notice("warn", ctx.ws.errors[0] ?? "Workspace not loaded.")]);
  return null;
}

function errorBlocks(ctx: PageContext): Block[] {
  return (ctx.ws?.errors ?? []).map((e) => notice("warn", e));
}

const taskBadge = (t: any) => (t.daysLeft === null || t.daysLeft === undefined ? undefined : t.daysLeft <= 0 ? "overdue" : `${t.daysLeft}d`);

const dashboard: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const s = ctx.ws!.state;
  const git = ctx.ws!.git;
  const urgent = [...s.tasks.critical, ...s.tasks.urgent];
  const blocks: Block[] = [
    ...errorBlocks(ctx),
    {
      kind: "kv",
      pairs: [
        ["Type", s.identity.type ?? "—"],
        ["Branch", git ? `${git.branch ?? "?"}${git.dirty ? " (dirty)" : ""}${git.lastCommit ? ` · ${git.lastCommit}` : ""}` : "—"],
        ["Tasks", `${s.heartbeat.open} open · ${s.heartbeat.done} done`],
        ["Last memory", s.memory[0]?.date ?? "—"],
      ],
    },
    {
      kind: "list",
      heading: "Urgent",
      items: urgent.length
        ? urgent.map((t: any, i: number) => ({ key: `u${i}`, label: t.text, detail: t.category, badge: taskBadge(t), target: { page: "tasks" } }))
        : [{ key: "none", label: "Nothing urgent." }],
    },
    {
      kind: "list",
      heading: "This week",
      items: [...s.events.thisWeek, ...s.meetings.thisWeek].map((e: any, i: number) => ({ key: `w${i}`, label: e.title, detail: e.date, target: { page: "this-week" } })),
    },
    {
      kind: "table",
      heading: "Projects",
      columns: ["Project", "Stage", "Lead"],
      rows: s.projects.map((p: any) => ({ key: slug(p.name), cells: [p.name, p.stage, p.lead ?? "—"], target: { page: "project", id: slug(p.name) } })),
    },
    {
      kind: "list",
      heading: "Recent memory",
      items: s.memory.slice(0, 3).map((m: any) => ({ key: m.id, label: m.focus ?? m.title ?? m.id, detail: m.date, target: { page: "memory", id: m.id } })),
    },
  ];
  const fed = s.federation;
  if (fed?.peers?.length) blocks.push({ kind: "list", heading: "Federation", items: fed.peers.map((p: any, i: number) => ({ key: `f${i}`, label: p.name, detail: p.role ?? undefined })) });
  return makePage(ref, s.identity.name ?? ctx.ws!.info.label, blocks.filter((b) => b.kind !== "list" || b.items.length > 0), { subtitle: ctx.ws!.info.kind });
};

const tasks: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const hb = ctx.ws!.state.heartbeat;
  if (!hb.present) return makePage(ref, "Tasks", [notice("info", "No HEARTBEAT.md in this workspace.")]);
  const blocks: Block[] = hb.sections.map((sec: any) => ({
    kind: "list" as const,
    heading: sec.heading,
    items: sec.items.map((t: any, i: number) => ({ key: `${sec.heading}-${i}`, label: `${t.done ? "[x]" : "[ ]"} ${t.text}`, badge: t.due ?? undefined, detail: t.assignee ? `@${t.assignee}` : undefined })),
  }));
  if (!blocks.length) blocks.push(notice("info", "HEARTBEAT.md has no checkbox tasks."));
  return makePage(ref, "Tasks", blocks, { subtitle: `${hb.open} open · ${hb.done} done` });
};

const projects: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const list = ctx.ws!.state.projects;
  if (!list.length) return makePage(ref, "Projects", [notice("info", "No projects in data/projects.yaml.")]);
  return makePage(ref, "Projects", [
    { kind: "table", columns: ["Project", "Stage", "Lead", "Started", "Tasks"], rows: list.map((p: any) => ({ key: slug(p.name), cells: [p.name, p.stage, p.lead ?? "—", p.startDate ?? "—", String(p.taskCount ?? 0)], target: { page: "project", id: slug(p.name) } })) },
  ]);
};

const project: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const p = ctx.ws!.state.projects.find((x: any) => slug(x.name) === ref.id);
  if (!p) return makePage(ref, "Project", [notice("warn", `No project "${ref.id}".`)]);
  return makePage(ref, p.name, [
    { kind: "kv", pairs: [["Stage", p.stage], ["Lead", p.lead ?? "—"], ["Started", p.startDate ?? "—"], ["Members", (p.members ?? []).join(", ") || "—"], ["Open tasks", String(p.taskCount ?? 0)]] },
  ]);
};

const plans: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const q = ctx.ws!.state.queue;
  if (!q) return makePage(ref, "Plans", [notice("info", "No plan queue (docs/agent-plans/QUEUE.md or docs/plans/QUEUE.md).")]);
  return makePage(ref, "Plans", [{ kind: "markdown", text: q.text }], { subtitle: q.path });
};

const decisions: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const list = ctx.ws!.state.decisions;
  if (!list.length) return makePage(ref, "Decisions", [notice("info", "No dated decisions in DECISIONS.md.")]);
  return makePage(ref, "Decisions", [
    { kind: "table", columns: ["Date", "Decision", "Status"], rows: list.map((d: any) => ({ key: String(d.n), cells: [d.date, d.title, d.status ?? "—"], target: { page: "decision", id: String(d.n) } })) },
  ]);
};

const decision: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const d = ctx.ws!.state.decisions.find((x: any) => String(x.n) === ref.id);
  if (!d) return makePage(ref, "Decision", [notice("warn", `No decision #${ref.id}.`)]);
  return makePage(ref, d.title, [{ kind: "markdown", text: d.body }], { subtitle: `${d.date} · ${d.status ?? "no status"}` });
};

const memory: Resolver = (ref, ctx) => {
  const early = needState(ref, ctx);
  if (early) return early;
  const ws = ctx.ws!;
  if (ref.id) {
    const text = ws.files[`memory/${ref.id}.md`];
    if (!text) return makePage(ref, ref.id, [notice("warn", `No memory log ${ref.id}.`)]);
    return makePage(ref, ref.id, [{ kind: "markdown", text }]);
  }
  const list = ws.state.memory;
  if (!list.length) return makePage(ref, "Memory", [notice("info", "No dated logs in memory/.")]);
  return makePage(ref, "Memory", [
    { kind: "list", items: list.map((m: any) => ({ key: m.id, label: m.focus ?? m.title ?? m.id, detail: m.date, target: { page: "memory", id: m.id } })) },
  ]);
};

export const workspacePages: Record<string, Resolver> = { dashboard, tasks, projects, project, plans, decisions, decision, memory };
