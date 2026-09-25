import { test, expect } from "bun:test";
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore — Bun imports TOML natively
import manifest from "../herdr/herdr-plugin.toml";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../herdr");

test("manifest declares the cockpit pane and both actions", () => {
  expect(manifest.id).toBe("org-os-cockpit");
  expect(manifest.min_herdr_version).toBe("0.9.0");
  expect(manifest.panes).toEqual([{ id: "cockpit", title: "org-os", placement: "split", command: ["./scripts/cockpit.sh"] }]);
  expect(manifest.actions.map((a: any) => a.id)).toEqual(["open-cockpit", "open-cockpit-tab"]);
});

test("scripts are executable and parse", () => {
  for (const s of ["cockpit.sh", "open-cockpit.sh", "open-cockpit-tab.sh"]) {
    const p = join(DIR, "scripts", s);
    expect(statSync(p).mode & 0o111).not.toBe(0);
    const r = Bun.spawnSync(["bash", "-n", p]);
    expect(r.exitCode).toBe(0);
  }
});
