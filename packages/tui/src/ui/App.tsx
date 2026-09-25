import { createEffect, createMemo, createSignal, ErrorBoundary, onCleanup, Show } from "solid-js";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { CockpitLike } from "../core/cockpit";
import type { Command, ForegroundEffect } from "../core/types";
import { AgentPane } from "./AgentPane";
import { Header } from "./Header";
import { routeKey, type Focus } from "./keys";
import { computeLayout, regionsFor } from "./layout";
import { navCount, pageLines, targetAt, type PageLine } from "./page-model";
import { actionEntries, buildEntries, launchEntries, type PaletteEntry } from "./palette-model";
import { PageView } from "./PageView";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { createCockpitStore } from "./store";
import { theme } from "./theme";
import { Help } from "./overlays/Help";
import { Palette } from "./overlays/Palette";
import { PermissionDialog } from "./overlays/PermissionDialog";

export type AppProps = {
  cockpit: CockpitLike;
  onQuit: () => void;
  runForeground?: (fx: ForegroundEffect) => Promise<void>;
  initialAgentOpen?: boolean;
};
type Overlay = null | { kind: "palette"; title: string; entries: PaletteEntry[] } | { kind: "help" };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Commands after which a crashed page view is rendered again.
const RECOVERS_PAGE = new Set<Command["type"]>(["refresh", "select-workspace", "open-page", "back"]);

export function App(props: AppProps) {
  const store = createCockpitStore(props.cockpit);
  onCleanup(store.dispose);
  const snap = store.snap;
  const dims = useTerminalDimensions();
  const [agentOpen, setAgentOpen] = createSignal(dims().width >= 140 ? (props.initialAgentOpen ?? true) : false);
  const layout = createMemo(() => computeLayout(dims().width, agentOpen()));
  const [focus, setFocus] = createSignal<Focus>("page");
  const [railIndex, setRailIndex] = createSignal(0);
  const [cursor, setCursor] = createSignal(0);
  const [overlay, setOverlay] = createSignal<Overlay>(null);
  const [message, setMessage] = createSignal<string | null>(null);
  let quitArmed = false;
  let forceArmed = false;

  const pageWidth = () => Math.max(20, dims().width - layout().rail - (layout().agentOverlay ? 0 : layout().agent));
  const bodyHeight = () => Math.max(3, dims().height - 2);
  // A page that cannot be laid out must land in the page ErrorBoundary, not escape from App: the
  // memo keeps the error, and only the read inside the boundary (pageViewLines) rethrows it.
  const layoutResult = createMemo((): { lines: PageLine[]; error?: unknown } => {
    const page = snap().page;
    if (!page) return { lines: [] };
    try {
      return { lines: pageLines(page, pageWidth() - 2) };
    } catch (error) {
      return { lines: [], error };
    }
  });
  const lines = () => layoutResult().lines;
  const pageViewLines = () => {
    const r = layoutResult();
    if ("error" in r) throw r.error;
    return r.lines;
  };
  // The boundary's reset, captured while its fallback shows; refresh/switch/open retries the view.
  let resetPage: (() => void) | null = null;
  const recoverPage = () => {
    const reset = resetPage;
    resetPage = null;
    reset?.();
  };
  const dialogOpen = () => snap().permissions.length > 0;
  const modal = () => overlay() !== null || dialogOpen();

  let lastPage = "";
  createEffect(() => {
    const key = `${snap().activeId}|${JSON.stringify(snap().page?.ref ?? null)}`;
    if (key !== lastPage) {
      lastPage = key;
      setCursor(0);
    }
  });
  createEffect(() => {
    if (focus() === "rail") return;
    const i = snap().fleet.findIndex((r) => r.info.id === snap().activeId);
    if (i >= 0) setRailIndex(i);
  });
  createEffect(() => {
    if (!regionsFor(layout(), agentOpen()).includes(focus())) setFocus("page");
  });

  const dispatch = async (cmd: Command) => {
    const withCols = cmd.type === "launch" ? { ...cmd, paneCols: dims().width } : cmd;
    let fx: ForegroundEffect | void;
    try {
      fx = await props.cockpit.dispatch(withCols);
    } finally {
      if (RECOVERS_PAGE.has(cmd.type)) recoverPage();
    }
    if (fx && props.runForeground) await props.runForeground(fx);
  };

  const runEntry = (e: PaletteEntry) => {
    setOverlay(null);
    if (e.action.kind === "command") void dispatch(e.action.command);
    else if (e.action.ui === "help") setOverlay({ kind: "help" });
    else toggleAgent();
  };

  const toggleAgent = () => {
    const open = !agentOpen();
    setAgentOpen(open);
    setFocus(open ? "agent" : "page");
    void dispatch({ type: "set-agent-open", open });
  };

  const cycle = (delta: number) => {
    const regions = regionsFor(layout(), agentOpen());
    const i = Math.max(0, regions.indexOf(focus()));
    setFocus(regions[(i + delta + regions.length) % regions.length]);
  };

  useKeyboard((key) => {
    const intent = routeKey(key, { focus: focus(), overlay: modal() });
    if (!intent) return;
    if (intent.type !== "quit") quitArmed = false;
    if (intent.type !== "force-quit") forceArmed = false;
    if (intent.type !== "quit" && intent.type !== "force-quit") setMessage(null);
    switch (intent.type) {
      case "force-quit":
        if (forceArmed) return props.onQuit();
        forceArmed = true;
        setMessage("press ctrl+c again to quit");
        return;
      case "quit":
        if (snap().agentStatus !== "working" || quitArmed) return props.onQuit();
        quitArmed = true;
        setMessage("pi is working — press q again to quit");
        return;
      case "focus-next":
        return cycle(1);
      case "focus-prev":
        return cycle(-1);
      case "blur":
        return setFocus("page");
      case "move":
        if (focus() === "rail") setRailIndex((i) => clamp(i + intent.delta, 0, snap().fleet.length - 1));
        else setCursor((c) => clamp(c + intent.delta, 0, Math.max(0, navCount(lines()) - 1)));
        return;
      case "top":
        return focus() === "rail" ? setRailIndex(0) : setCursor(0);
      case "bottom":
        return focus() === "rail" ? setRailIndex(snap().fleet.length - 1) : setCursor(Math.max(0, navCount(lines()) - 1));
      case "open": {
        if (focus() === "rail") {
          const row = snap().fleet[railIndex()];
          if (row) void dispatch({ type: "select-workspace", id: row.info.id });
          setFocus("page");
          return;
        }
        const target = targetAt(lines(), cursor());
        if (target) void dispatch({ type: "open-page", ref: target });
        return;
      }
      case "back":
        return void dispatch({ type: "back" });
      case "refresh":
        return void dispatch({ type: "refresh" });
      case "open-source":
        return void dispatch({ type: "run-action", actionId: "open-source" });
      case "jump": {
        const row = snap().fleet[intent.index];
        if (row) void dispatch({ type: "select-workspace", id: row.info.id });
        return;
      }
      case "palette":
        return setOverlay({ kind: "palette", title: "Command palette", entries: buildEntries(snap(), props.cockpit.actions()) });
      case "actions":
        return setOverlay({ kind: "palette", title: "Actions", entries: actionEntries(props.cockpit.actions()) });
      case "launch-menu":
        return setOverlay({ kind: "palette", title: "Launch a host", entries: launchEntries(props.cockpit.actions()) });
      case "help":
        return setOverlay({ kind: "help" });
      case "toggle-agent":
        return toggleAgent();
      case "new-session":
        return void dispatch({ type: "agent-new-session" });
      case "abort":
        return void dispatch({ type: "agent-abort" });
    }
  });

  const activeLabel = () => snap().fleet.find((r) => r.info.id === snap().permissions[0]?.workspace)?.info.label ?? snap().permissions[0]?.workspace ?? "";

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header snap={snap()} width={dims().width} />
      <box flexDirection="row" flexGrow={1}>
        <Show when={layout().showRail}>
          <Rail rows={snap().fleet} activeId={snap().activeId} index={railIndex()} focused={focus() === "rail" && !modal()} width={layout().rail} />
        </Show>
        <ErrorBoundary
          fallback={(err: Error, reset: () => void) => {
            resetPage = reset;
            return <text fg={theme.error}>{`This view crashed: ${err?.message ?? err} — press r to reload, or switch workspace.`}</text>;
          }}
        >
          <PageView page={snap().page} lines={pageViewLines()} cursor={cursor()} focused={focus() === "page" && !modal()} width={pageWidth()} height={bodyHeight()} />
        </ErrorBoundary>
        <Show when={layout().agent > 0 && !layout().agentOverlay}>
          <AgentPane snap={snap()} focused={focus() === "agent" && !modal()} width={layout().agent} height={bodyHeight()} onSubmit={(text) => void dispatch({ type: "agent-prompt", text })} />
        </Show>
      </box>
      <StatusBar focus={focus()} toast={store.toasts().at(-1) ?? null} message={message()} width={dims().width} />
      <Show when={layout().agent > 0 && layout().agentOverlay}>
        <box position="absolute" left={dims().width - layout().agent} top={1} width={layout().agent} height={bodyHeight()} zIndex={10} backgroundColor={theme.bg}>
          <AgentPane snap={snap()} focused={focus() === "agent" && !modal()} width={layout().agent} height={bodyHeight()} onSubmit={(text) => void dispatch({ type: "agent-prompt", text })} />
        </box>
      </Show>
      <Show when={overlay()?.kind === "palette"}>
        <Palette title={(overlay() as any).title} entries={(overlay() as any).entries} width={dims().width} height={dims().height} onSelect={runEntry} onClose={() => setOverlay(null)} />
      </Show>
      <Show when={overlay()?.kind === "help"}>
        <Help width={dims().width} height={dims().height} onClose={() => setOverlay(null)} />
      </Show>
      <Show when={dialogOpen()}>
        <PermissionDialog
          request={snap().permissions[0]}
          queued={snap().permissions.length}
          workspaceLabel={activeLabel()}
          width={dims().width}
          onAnswer={(answer) => void dispatch({ type: "permission-answer", id: snap().permissions[0].id, answer })}
        />
      </Show>
    </box>
  );
}
