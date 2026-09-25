// Port of scripts/initialize.mjs loadFunding with `now` injected (pure).
import yaml from "js-yaml";
import { daysUntil } from "../parse-helpers.mjs";

const title = (o) => o.name || o.title || o.id || "untitled";

export function loadFunding(files, now) {
  const raw = files["data/funding-opportunities.yaml"];
  if (!raw) return { upcoming: [], active: [] };
  let data;
  try {
    data = yaml.load(raw);
  } catch (e) {
    return { upcoming: [], active: [], error: `data/funding-opportunities.yaml: ${e.message.split("\n")[0]}` };
  }
  const opportunities = data?.funding_opportunities || data?.opportunities || [];
  const upcoming = [];
  const active = [];
  for (const opp of opportunities) {
    if (!opp.deadline) {
      if (["active", "applied", "open"].includes(opp.status)) active.push({ title: title(opp), status: opp.status });
      continue;
    }
    const days = daysUntil(opp.deadline, now);
    if (days < 0) continue;
    if (opp.status === "applied" || opp.status === "awarded") active.push({ title: title(opp), status: opp.status });
    else upcoming.push({ title: title(opp), deadline: opp.deadline, status: opp.status ?? null, daysLeft: days });
  }
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);
  return { upcoming, active };
}
