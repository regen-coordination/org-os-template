import { For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { PAGE_INDEX } from "../../core/pages";
import { theme } from "../theme";

const KEYS: [string, string][] = [
  ["ctrl+p  :", "command palette"],
  ["tab / shift+tab", "move focus: fleet · page · agent"],
  ["j k ↑ ↓  g G", "move · top · bottom"],
  ["enter  esc", "open · back"],
  ["1-9", "jump to workspace"],
  ["a  L  e  r", "actions · launch a host · edit source · refresh"],
  ["ctrl+a  ctrl+n  ctrl+x", "agent pane · new session · abort turn"],
  ["y s n", "approve once · for session · deny (approval dialog)"],
  ["q  ctrl+c ×2", "quit"],
];

export function Help(props: { width: number; height: number; onClose: () => void }) {
  useKeyboard((k) => {
    if (k.name === "escape" || k.name === "q" || k.sequence === "?") props.onClose();
  });
  const w = () => Math.max(30, Math.min(76, props.width - 4));
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={1} width={w()} height={Math.min(props.height - 2, KEYS.length + PAGE_INDEX.length + 6)} zIndex={20} border borderColor={theme.borderFocus} backgroundColor={theme.bg} title="Keys" flexDirection="column">
      <For each={KEYS}>{([key, what]) => <text fg={theme.fg}>{`${key.padEnd(24)}${what}`}</text>}</For>
      <text> </text>
      <text fg={theme.accent}>{`Pages: ${PAGE_INDEX.map((p) => p.label).join(" · ")}`}</text>
    </box>
  );
}
