// opencode plugin: exposes org-os pages as tools the orchestrator can call.
// Pattern follows https://opencode.ai/docs/plugins/ — plugins export a function
// that receives context and returns hook implementations including custom tools.
//
// Two tools are registered:
//   - org_os_page(page_id)  → renders the page via `npm run page <id>` and returns text
//   - org_os_tui()          → launches the interactive Ink TUI in a managed pane
//
// Both rely on the org-os repo being the cwd (or directory/worktree from context).
// The TUI itself ships from packages/tui/ in the same repo. If `npm run page` is
// not yet available (TUI not installed), the tool returns an actionable error.

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

function resolveOrgOsRoot(ctx) {
  // Prefer explicit context fields; fall back to cwd.
  const candidates = [
    ctx?.directory,
    ctx?.worktree,
    ctx?.project?.directory,
    process.env.ORG_OS_ROOT,
    process.cwd(),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      const pkgPath = path.join(c, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts && (pkg.scripts.page || pkg.scripts.tui)) return c;
      }
    } catch {
      // ignore
    }
  }
  return candidates[0] || process.cwd();
}

function runPage(pageId, cwd) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "page", "--silent", "--", pageId], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, output: stdout });
      else resolve({ ok: false, error: `npm run page ${pageId} exited ${code}\n${stderr}` });
    });
  });
}

export const OrgOsPlugin = async (ctx) => {
  // Lazy import: lets unit tests load the module without requiring @opencode-ai/plugin.
  let tool;
  try {
    ({ tool } = await import("@opencode-ai/plugin"));
  } catch {
    // Plugin runtime not present (e.g., in our own test env). Return empty.
    return {};
  }

  const cwdResolver = () => resolveOrgOsRoot(ctx);

  return {
    tool: {
      org_os_page: tool({
        description:
          "Render an org-os page (dashboard, projects, project/<id>, instances, this-week, health, decisions, etc.) " +
          "and return the rendered text. Use to inspect organizational state without leaving the agent.",
        args: {
          page_id: tool.schema.string().describe(
            "The page id, e.g. 'dashboard', 'projects', 'project/v2-stabilization', 'this-week'.",
          ),
        },
        async execute({ page_id }) {
          const cwd = cwdResolver();
          const result = await runPage(page_id, cwd);
          if (!result.ok) {
            return `org_os_page error: ${result.error}\n\n` +
              `Verify ORG_OS_ROOT or run from an org-os repo. Current cwd: ${cwd}`;
          }
          return result.output;
        },
      }),

      org_os_tui: tool({
        description:
          "Launch the interactive org-os TUI in a managed pane. opencode's multiplexer (tmux/zellij) " +
          "spawns a sibling pane; the pane runs alongside the agent until the operator quits with q.",
        args: {},
        async execute() {
          const cwd = cwdResolver();
          // Detached spawn — opencode's multiplexer attaches the pane lifecycle.
          const child = spawn("npm", ["run", "tui"], { cwd, detached: true, stdio: "ignore" });
          child.unref();
          return `Launched org-os TUI from ${cwd}. ` +
            `Use the operator's tmux/zellij session to focus the pane. Quit with q.`;
        },
      }),
    },
  };
};

export default OrgOsPlugin;
