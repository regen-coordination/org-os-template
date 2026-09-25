import type { CockpitSnapshot } from "../core/cockpit";
import { displayWidth, truncate } from "./format";
import { theme } from "./theme";

const GLYPH: Record<string, string> = { idle: "○", working: "◐", blocked: "◆", error: "✗" };

export function Header(props: { snap: CockpitSnapshot; width: number }) {
  const left = () => {
    const s = props.snap;
    const g = s.activeGit;
    return `org-os · ${s.activeName}${g ? ` · ${g.branch ?? "?"}${g.dirty ? " ●" : ""}` : ""}${s.activeUrgent ? ` · ${s.activeUrgent} urgent` : ""}${s.loading ? " · loading…" : ""}`;
  };
  const right = () => {
    const s = props.snap;
    const parts: string[] = [];
    if (s.herdr.available) parts.push(`herdr ● ${s.herdr.agents} agents`);
    if (s.agentAvailable) parts.push(`pi ${GLYPH[s.agentStatus] ?? "○"} ${s.agentStatus}`);
    return parts.join(" · ");
  };
  return (
    <box flexDirection="row" height={1} width="100%">
      <text fg={theme.primary}>{truncate(left(), Math.max(10, props.width - displayWidth(right()) - 2))}</text>
      <box flexGrow={1} />
      <text fg={theme.dim}>{right()}</text>
    </box>
  );
}
