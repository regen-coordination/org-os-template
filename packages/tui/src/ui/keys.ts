export type Focus = "rail" | "page" | "agent";
export type Intent =
  | { type: "palette" } | { type: "help" } | { type: "quit" } | { type: "force-quit" }
  | { type: "focus-next" } | { type: "focus-prev" } | { type: "blur" }
  | { type: "move"; delta: number } | { type: "top" } | { type: "bottom" }
  | { type: "open" } | { type: "back" } | { type: "refresh" } | { type: "open-source" }
  | { type: "actions" } | { type: "launch-menu" } | { type: "toggle-agent" }
  | { type: "new-session" } | { type: "abort" } | { type: "jump"; index: number };
export type KeyLike = { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean; sequence?: string };

// OpenTUI delivers every key to useKeyboard even while an <input> has focus
// (VERIFIED.md T1), so global shortcuts must stand down whenever the agent
// input is focused or an overlay owns the keyboard.
export function routeKey(k: KeyLike, s: { focus: Focus; overlay: boolean }): Intent | null {
  if (k.ctrl && k.name === "c") return { type: "force-quit" };
  if (s.overlay) return null;
  if (k.ctrl) {
    if (k.name === "p") return { type: "palette" };
    if (k.name === "a") return { type: "toggle-agent" };
    if (k.name === "n") return { type: "new-session" };
    if (k.name === "x") return { type: "abort" };
    return null;
  }
  if (k.name === "tab") return k.shift ? { type: "focus-prev" } : { type: "focus-next" };
  if (s.focus === "agent") return k.name === "escape" ? { type: "blur" } : null;
  const seq = k.sequence ?? "";
  if (seq === "?" || k.name === "?") return { type: "help" };
  if (seq === ":" || k.name === ":") return { type: "palette" };
  if (k.shift && k.name === "l") return { type: "launch-menu" };
  if (k.shift && k.name === "g") return { type: "bottom" };
  switch (k.name) {
    case "j":
    case "down":
      return { type: "move", delta: 1 };
    case "k":
    case "up":
      return { type: "move", delta: -1 };
    case "pagedown":
      return { type: "move", delta: 10 };
    case "pageup":
      return { type: "move", delta: -10 };
    case "g":
      return { type: "top" };
    case "return":
    case "enter":
    case "l":
    case "right":
      return { type: "open" };
    case "escape":
    case "h":
    case "left":
    case "backspace":
      return { type: "back" };
    case "r":
      return { type: "refresh" };
    case "e":
      return { type: "open-source" };
    case "a":
      return { type: "actions" };
    case "q":
      return { type: "quit" };
  }
  if (/^[1-9]$/.test(k.name)) return { type: "jump", index: Number(k.name) - 1 };
  return null;
}
