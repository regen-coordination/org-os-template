import { createSignal, For, Show } from "solid-js";
import type { CockpitSnapshot } from "../core/cockpit";
import { truncate } from "./format";
import { theme } from "./theme";
import { transcriptLines, type TLine } from "./transcript-view";

const COLOR: Record<TLine["style"], string> = {
  user: theme.user,
  assistant: theme.fg,
  "tool-running": theme.accent,
  "tool-ok": theme.ok,
  "tool-error": theme.error,
  info: theme.accent,
  warn: theme.warn,
  error: theme.error,
  dim: theme.dim,
};

export function AgentPane(props: { snap: CockpitSnapshot; focused: boolean; width: number; height: number; onSubmit: (text: string) => void }) {
  const [draft, setDraft] = createSignal("");
  const body = () => Math.max(1, props.height - 3);
  const lines = () => transcriptLines(props.snap.transcript, Math.max(10, props.width - 2));
  const visible = () => lines().slice(-body());
  const title = () => `AGENT · pi${props.snap.agentModel ? ` · ${props.snap.agentModel}` : ""} · ${props.snap.agentStatus}`;
  return (
    <box flexDirection="column" width={props.width} height="100%" border borderColor={props.focused ? theme.borderFocus : theme.border} title={truncate(title(), Math.max(4, props.width - 4))}>
      <box flexDirection="column" flexGrow={1}>
        <Show when={props.snap.agentAvailable} fallback={<text fg={theme.dim}>No agent in this mode.</text>}>
          <Show when={visible().length > 0} fallback={<text fg={theme.dim}>Ask pi about this workspace, or type /close, /initialize, /sync…</text>}>
            <For each={visible()}>{(l) => <text fg={COLOR[l.style]}>{truncate(l.text, Math.max(1, props.width - 2)) || " "}</text>}</For>
          </Show>
        </Show>
      </box>
      <input
        focused={props.focused}
        value={draft()}
        placeholder={props.focused ? "message pi — enter to send" : "tab here to type"}
        onInput={(v: string) => setDraft(v)}
        onSubmit={(v: string) => {
          const text = (v ?? draft()).trim();
          if (text) props.onSubmit(text);
          setDraft("");
        }}
      />
    </box>
  );
}
