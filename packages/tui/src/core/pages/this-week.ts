import type { Block, PageData, PageRef } from "../types";
import { makePage, notice, type PageContext } from "./helpers";

export function thisWeekPage(ref: PageRef, ctx: PageContext): PageData {
  if (!ctx.ws?.state) return makePage(ref, "This week", [notice("warn", ctx.ws?.errors[0] ?? "No workspace selected.")]);
  const s = ctx.ws.state;
  const due = [...s.tasks.critical, ...s.tasks.urgent].filter((t: any) => t.due);
  const funding = s.funding.upcoming.filter((f: any) => f.daysLeft <= 30);
  const blocks: Block[] = [];
  const add = (heading: string, items: { key: string; label: string; detail?: string; badge?: string }[]) => {
    if (items.length) blocks.push({ kind: "list", heading, items });
  };
  add("Due soon", due.map((t: any, i: number) => ({ key: `d${i}`, label: t.text, detail: t.due, badge: t.daysLeft <= 0 ? "overdue" : `${t.daysLeft}d` })));
  add("Events", s.events.thisWeek.map((e: any, i: number) => ({ key: `e${i}`, label: e.title, detail: e.date })));
  add("Meetings", s.meetings.thisWeek.map((m: any, i: number) => ({ key: `m${i}`, label: m.title, detail: m.date })));
  add("Funding deadlines (30 days)", funding.map((f: any, i: number) => ({ key: `f${i}`, label: f.title, detail: f.deadline, badge: `${f.daysLeft}d` })));
  if (s.funding.error) blocks.push(notice("warn", s.funding.error));
  if (!blocks.length) blocks.push(notice("info", "Nothing dated this week."));
  return makePage(ref, "This week", blocks);
}
