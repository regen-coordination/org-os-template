// scripts/crew/herdr.mjs
//
// The only file that calls the herdr CLI. Syntax and JSON shapes verified against
// herdr 0.9.1 (docs/superpowers/specs/2026-10-10-org-os-crew-design.md §5.3).
// Success prints {"result": …} on stdout; failure prints {"error": {code, message}}
// on stderr and exits 1.
import { execFileSync } from 'node:child_process';

export class HerdrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function run(args) {
  let out;
  try {
    out = execFileSync('herdr', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HerdrError('herdr_missing', 'the herdr command was not found on PATH');
    }
    const text = String(err.stderr || err.stdout || err.message).trim();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON: fall through with the raw text
    }
    throw new HerdrError(parsed?.error?.code || 'herdr_error', parsed?.error?.message || text);
  }
  try {
    return JSON.parse(out).result ?? {};
  } catch {
    return null; // the command succeeded but did not print JSON
  }
}

/** For answers the crew acts on: a reply that cannot be read is an error, never an empty result. */
function need(result, field, what) {
  if (!result || result[field] === undefined) {
    throw new HerdrError('herdr_output', `herdr gave an answer that could not be read (${what})`);
  }
  return result;
}

const opened = (r) => {
  need(need(r, 'root_pane', 'worktree'), 'workspace', 'worktree');
  return { pane_id: r.root_pane.pane_id, workspace_id: r.workspace.workspace_id };
};

export function createHerdr() {
  return {
    listAgents() {
      return need(run(['agent', 'list']), 'agents', 'agent list').agents.map((a) => ({
        name: a.name ?? null,
        pane_id: a.pane_id,
        workspace_id: a.workspace_id,
        state: a.agent_status,
        kind: a.agent,
      }));
    },
    createWorktree({ cwd, branch, base, path, label }) {
      return opened(
        run(['worktree', 'create', '--cwd', cwd, '--branch', branch, '--base', base, '--path', path, '--label', label, '--no-focus']),
      );
    },
    openWorktree({ cwd, path, label }) {
      return opened(run(['worktree', 'open', '--cwd', cwd, '--path', path, '--label', label, '--no-focus']));
    },
    startAgent({ name, kind, pane_id, args }) {
      run(['agent', 'start', name, '--kind', kind, '--pane', pane_id, ...(args.length > 0 ? ['--', ...args] : [])]);
    },
    promptAgent(name, text) {
      run(['agent', 'prompt', name, text]);
    },
    /** The checkout a workspace is open on, or null when it is not a worktree workspace. */
    workspaceCheckout(workspaceId) {
      return run(['workspace', 'get', workspaceId])?.workspace?.worktree?.checkout_path ?? null;
    },
    removeWorktree(workspaceId) {
      run(['worktree', 'remove', '--workspace', workspaceId]);
    },
  };
}
