import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig, loadConfig, loadUiState, saveUiState, configDir, DEFAULT_CONFIG } from "../../src/core/config";

test("mergeConfig keeps defaults and drops invalid entries with errors", () => {
  const { config, errors } = mergeConfig({
    workspaces: [{ path: "/abs/ws", label: "WS" }, { path: "relative" }, { nope: 1 }],
    launch: { prefer: "tmux" },
    herdr: { pollMs: 50 },
  });
  expect(config.workspaces).toEqual([{ path: "/abs/ws", label: "WS" }]);
  expect(config.launch.prefer).toBe("tmux");
  expect(config.herdr).toEqual({ poll: true, pollMs: 1000 });
  expect(errors.length).toBe(2);
  expect(mergeConfig(undefined).config).toEqual(DEFAULT_CONFIG);
  expect(mergeConfig({ launch: { prefer: "warp" } }).errors[0]).toContain("launch.prefer");
});

test("loadConfig tolerates a missing dir and bad JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ck-"));
  expect(loadConfig(dir)).toEqual({ config: DEFAULT_CONFIG, errors: [] });
  writeFileSync(join(dir, "config.json"), "{ nope");
  const r = loadConfig(dir);
  expect(r.config).toEqual(DEFAULT_CONFIG);
  expect(r.errors[0]).toContain("config.json");
});

test("ui state round-trips atomically", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ck-")), "nested");
  expect(loadUiState(dir)).toEqual({});
  expect(saveUiState(dir, { lastWorkspace: "hub", agentOpen: true })).toBe(true);
  expect(loadUiState(dir)).toEqual({ lastWorkspace: "hub", agentOpen: true });
  expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).lastWorkspace).toBe("hub");
});

test("configDir honours overrides", () => {
  expect(configDir({ ORG_OS_COCKPIT_HOME: "/x" })).toBe("/x");
  expect(configDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/org-os/cockpit");
});
