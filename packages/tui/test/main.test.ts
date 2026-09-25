import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFleetFixture } from "./helpers/fixtures";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(PKG, "../..");

async function snapshot(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, "run", "src/main.tsx", "--snapshot", ...args], {
    cwd: PKG,
    env: { ...process.env, ORG_OS_COCKPIT_HOME: env.ORG_OS_COCKPIT_HOME ?? mkdtempSync(join(tmpdir(), "ck-home-")), HERDR_ENV: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("snapshot of a fixture fleet", async () => {
  const { fw, instA } = makeFleetFixture();
  const r = await snapshot(["--framework", fw, "--width", "140", "--height", "32"], { ORG_OS_INVOKED_FROM: instA });
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("FLEET");
  expect(r.out).toContain("Instance A");
  expect(r.out).toContain("Grant report");
}, 30_000);

test("snapshot of this repository's fleet page", async () => {
  const r = await snapshot(["--page", "fleet", "--width", "160", "--height", "40"], { ORG_OS_INVOKED_FROM: REPO });
  expect(r.code).toBe(0);
  expect(r.out).toContain("Fleet");
  expect(r.out).toContain("org-os");
}, 60_000);

test("a config.json error raised before the UI mounts still reaches the status bar", async () => {
  const { fw, instA } = makeFleetFixture();
  const home = mkdtempSync(join(tmpdir(), "ck-home-"));
  writeFileSync(join(home, "config.json"), JSON.stringify({ launch: { prefer: "bogus" } }));
  const r = await snapshot(["--framework", fw, "--width", "140", "--height", "32"], { ORG_OS_INVOKED_FROM: instA, ORG_OS_COCKPIT_HOME: home });
  expect(r.code).toBe(0);
  expect(r.out).toContain("config.json launch.prefer");
}, 30_000);
