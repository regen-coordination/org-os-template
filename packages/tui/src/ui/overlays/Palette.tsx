import { createMemo, createSignal, For, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { truncate } from "../format";
import { filterEntries, type PaletteEntry } from "../palette-model";
import { theme } from "../theme";

export function Palette(props: { title: string; entries: PaletteEntry[]; width: number; height: number; onSelect: (e: PaletteEntry) => void; onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [index, setIndex] = createSignal(0);
  const filtered = createMemo(() => filterEntries(props.entries, query()));
  const w = () => Math.max(20, Math.min(72, props.width - 4));
  const rows = () => Math.max(3, Math.min(12, props.height - 8));
  const start = () => Math.max(0, index() - rows() + 1);
  useKeyboard((k) => {
    if (k.name === "escape") return props.onClose();
    if (k.name === "down" || (k.ctrl && k.name === "j")) return setIndex((i) => Math.min(i + 1, Math.max(0, filtered().length - 1)));
    if (k.name === "up" || (k.ctrl && k.name === "k")) return setIndex((i) => Math.max(i - 1, 0));
    if (k.name === "return" || k.name === "enter") {
      const e = filtered()[index()];
      if (e) props.onSelect(e);
    }
  });
  return (
    <box position="absolute" left={Math.floor((props.width - w()) / 2)} top={2} width={w()} height={rows() + 4} zIndex={20} border borderColor={theme.borderFocus} backgroundColor={theme.bg} title={props.title} flexDirection="column">
      <input focused value={query()} placeholder="type to filter" onInput={(v: string) => { setQuery(v); setIndex(0); }} />
      <For each={filtered().slice(start(), start() + rows())}>
        {(e, i) => (
          <text fg={start() + i() === index() ? theme.accent : theme.fg} bg={start() + i() === index() ? theme.selBg : undefined}>
            {truncate(`${e.label}${e.hint ? `  ${e.hint}` : ""}`, w() - 2)}
          </text>
        )}
      </For>
      <Show when={filtered().length === 0}>
        <text fg={theme.dim}>No matches.</text>
      </Show>
    </box>
  );
}
