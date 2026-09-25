import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRenderer } from "@opentui/core";
import { render, testRender } from "@opentui/solid";
import { piBackend } from "./core/agents/pi";
import { parseArgs } from "./core/args";
import { Cockpit } from "./core/cockpit";
import { configDir, loadConfig, loadUiState, saveUiState } from "./core/config";
import { HerdrClient, herdrBin, inHerdr } from "./core/herdr";
import { run } from "./core/proc";
import type { ForegroundEffect } from "./core/types";
import { App } from "./ui/App";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  const args = parseArgs(argv);
  const frameworkRoot = resolve(args.framework ?? resolve(HERE, "../../.."));
  const invokedFrom = env.ORG_OS_INVOKED_FROM || env.INIT_CWD || process.cwd();
  const dir = configDir(env);
  const { config, errors } = loadConfig(dir);
  const uiState = loadUiState(dir);
  const live = !args.snapshot;
  const herdr = live && inHerdr(env) ? new HerdrClient({ run, bin: herdrBin(env) }) : null;

  const cockpit = new Cockpit({
    frameworkRoot,
    invokedFrom,
    flags: { workspace: args.workspace, page: args.page },
    config,
    uiState,
    env,
    backend: live ? piBackend({ frameworkRoot }) : null,
    herdr,
    watch: live ? undefined : null,
    saveUiState: live ? (s) => void saveUiState(dir, s) : undefined,
  });
  // Notices raised before the UI mounts are held by the cockpit and replayed once it subscribes.
  errors.forEach((e) => cockpit.notice("warn", e));
  // Never let a stray async error take the cockpit down: surface it and keep running.
  process.on("unhandledRejection", (e) => cockpit.notice("error", `Unexpected error: ${(e as Error)?.message ?? e}`));
  process.on("uncaughtException", (e) => cockpit.notice("error", `Unexpected error: ${e.message}`));

  if (args.snapshot) {
    await cockpit.start(); // the snapshot prints the whole fleet, so everything loads first
    const setup = await testRender(() => <App cockpit={cockpit} onQuit={() => {}} initialAgentOpen={uiState.agentOpen ?? true} />, { width: args.width, height: args.height });
    await setup.renderOnce();
    await new Promise((r) => setTimeout(r, 10));
    await setup.renderOnce();
    process.stdout.write(setup.captureCharFrame() + "\n");
    await cockpit.stop();
    return 0;
  }

  await cockpit.activateInitial();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 });
  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    try {
      await cockpit.stop();
    } catch (e) {
      cockpit.notice("error", `Failed to stop cleanly: ${(e as Error).message}`);
    } finally {
      try {
        renderer.destroy();
      } finally {
        process.exit(0);
      }
    }
  };
  const runForeground = async (fx: ForegroundEffect) => {
    renderer.suspend();
    try {
      spawnSync(fx.cmd, fx.args, { cwd: fx.cwd, stdio: "inherit" });
    } finally {
      renderer.resume();
    }
  };
  await render(() => <App cockpit={cockpit} onQuit={() => void quit()} runForeground={runForeground} initialAgentOpen={uiState.agentOpen ?? true} />, renderer);
  // The UI is up with the active workspace; the rest of the fleet and herdr load behind it.
  void cockpit.loadRest().catch((e) => cockpit.notice("error", `Loading the fleet failed: ${(e as Error).message}`));
  return null;
}

if (import.meta.main) {
  main()
    .then((code) => {
      if (code !== null) process.exit(code);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
