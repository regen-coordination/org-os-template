import type { AgentBackend, AgentSession, GateLike } from "../../src/core/agents/backend";
import type { AgentEvent } from "../../src/core/types";

export const tick = () => new Promise((r) => setTimeout(r, 0));

export function fakeBackend(opts: { failOpen?: boolean } = {}) {
  const prompts: string[] = [];
  let gate: GateLike | null = null;
  const backend: AgentBackend = {
    id: "pi",
    available: async () => ({ ok: true }),
    open: async ({ gate: g }) => {
      if (opts.failOpen) throw new Error("no credentials");
      gate = g;
      const listeners = new Set<(e: AgentEvent) => void>();
      const emit = (e: AgentEvent) => listeners.forEach((fn) => fn(e));
      const session: AgentSession = {
        id: "s1",
        backend: "pi",
        model: "faux/faux-1",
        async prompt(text, display) {
          prompts.push(text);
          emit({ type: "user", text: display ?? text });
          emit({ type: "status", status: "working" });
          emit({ type: "assistant_end", text: "ok" });
          emit({ type: "status", status: "idle" });
        },
        async abort() {},
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        async dispose() {},
      };
      return session;
    },
  };
  return { backend, prompts, gate: () => gate };
}

export function fakeHerdr(agents: any[] = []) {
  const calls: string[] = [];
  const herdr: any = {
    listAgents: async () => agents,
    integrationStatus: async () => ({ pi: false, claude: true, opencode: true }),
    reportAgent: async (o: any) => calls.push(`report ${o.state}`),
    releaseAgent: async () => calls.push("release"),
    reportTitle: async (o: any) => calls.push(`title ${o.title}`),
    notify: async (o: any) => calls.push(`notify ${o.title}`),
    splitPane: async () => "w1:p9",
    runInPane: async (_id: string, cmd: string) => calls.push(`run ${cmd}`),
    focusAgent: async (id: string) => calls.push(`focus ${id}`),
  };
  return { herdr, calls };
}
