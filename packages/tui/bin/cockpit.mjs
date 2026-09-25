#!/usr/bin/env node
// Node launcher for the org-os cockpit: finds a Bun >= 1.3 (the local
// devDependency first), then runs src/main.tsx under it. Kept in plain Node so
// `npm run tui` gives a clear message instead of a stack trace when Bun is missing.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_BUN = [1, 3, 0];

export function parseVersion(s) {
  const m = String(s ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}

export function atLeast(v, min) {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
}

export function candidateBuns(pkgDir, env) {
  return [join(pkgDir, "node_modules", ".bin", "bun"), env.ORG_OS_BUN, "bun"].filter(Boolean);
}

export function findBun({ pkgDir = PKG, env = process.env, run = spawnSync, exists = existsSync } = {}) {
  for (const bin of candidateBuns(pkgDir, env)) {
    if (bin.includes("/") && !exists(bin)) continue;
    let r;
    try {
      r = run(bin, ["--version"], { encoding: "utf8" });
    } catch {
      continue;
    }
    const v = r && r.status === 0 ? parseVersion(r.stdout) : null;
    if (v && atLeast(v, MIN_BUN)) return { bin, version: v.join(".") };
  }
  return null;
}

export function invokedFrom(env, cwd) {
  return env.ORG_OS_INVOKED_FROM || env.INIT_CWD || cwd;
}

function main() {
  const found = findBun();
  if (!found) {
    process.stderr.write(
      "org-os cockpit needs Bun >= 1.3 (OpenTUI's runtime).\n" +
        "Install the cockpit's pinned dependencies (includes a local Bun):\n\n" +
        "  npm run tui:install\n\n" +
        "or point ORG_OS_BUN at a Bun >= 1.3 binary.\n",
    );
    process.exit(1);
  }
  const child = spawn(found.bin, ["run", join(PKG, "src", "main.tsx"), ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: PKG,
    env: { ...process.env, ORG_OS_INVOKED_FROM: invokedFrom(process.env, process.cwd()) },
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
