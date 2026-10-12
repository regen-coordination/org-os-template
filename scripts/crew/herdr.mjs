// scripts/crew/herdr.mjs
//
// The only file that calls the herdr CLI. Syntax and JSON shapes verified against
// herdr 0.9.1 (docs/superpowers/specs/2026-10-10-org-os-crew-design.md §5.3).
// Success prints {"result": …} on stdout; failure prints {"error": {code, message}}
// on stderr and exits 1. Error codes are read from herdr's source; herdr publishes
// no error contract, so each one is an implementation detail of a release.
import { execFileSync } from 'node:child_process';

export class HerdrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Long enough for `agent start`, which waits for the agent to be detected.
const DEFAULT_TIMEOUT_MS = 60000;

// How long `startAgent` keeps asking while a new pane's shell is not yet in the
// foreground, and how often. This is a ceiling, not a guess at how long a shell
// takes: each retry first looks at the pane, and stops at once when it shows an
// agent or cannot be read. It matches herdr's own default agent start timeout.
const DEFAULT_START_WAIT_MS = 30000;
const DEFAULT_START_RETRY_MS = 500;
// The read-only calls made to look at a pane or at the agent list. Short, so a
// herdr that just hung does not hold the command for another minute.
const DEFAULT_LOOK_TIMEOUT_MS = 10000;

// herdr's code for "agent target pane … is not an available shell". It has two
// causes with one message: the pane's shell is not in the foreground yet (worth
// waiting for), or the pane already hosts an agent or a pending start (not).
const PANE_BUSY = 'agent_pane_busy';
// Codes `agent start` returns (herdr 0.9.1 source, spec 5.3). A code on this list
// is never mistaken for a busy pane by its message; only a code not on it is.
const KNOWN_START_CODES = new Set([
  'invalid_agent_name',
  'unsupported_agent_kind',
  'invalid_agent_argument',
  'invalid_agent_timeout',
  'agent_name_taken',
  'agent_pane_not_found',
  PANE_BUSY,
  'agent_pane_unavailable',
  'agent_start_input_failed',
  'agent_not_ready',
  'agent_start_failed',
  'agent_kind_mismatch',
  'agent_name_not_found',
  'timeout',
  'agent_start_transport_failed',
]);
// A start that ended without an answer: the launch command may be running in the
// pane anyway. `timeout` is herdr's own "timed out waiting for agent startup",
// which clears the pending name but does not kill the process.
const CUT_OFF_CODES = new Set(['herdr_timeout', 'timeout', 'agent_start_transport_failed', 'herdr_error']);

const isPaneBusy = (err) =>
  err instanceof HerdrError &&
  (err.code === PANE_BUSY || (!KNOWN_START_CODES.has(err.code) && /not an available shell/i.test(err.message)));

// The `--source` crew reports metadata under (spec 5.3 item 13).
const LABEL_SOURCE = 'crew';
const tokenArgs = (tokens) => Object.entries(tokens).flatMap(([name, value]) => ['--token', `${name}=${value}`]);

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runHerdr(args, { bin, timeoutMs }) {
  let out;
  try {
    out = execFileSync(bin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HerdrError('herdr_missing', 'the herdr command was not found on PATH');
    }
    if (err.code === 'ETIMEDOUT') {
      throw new HerdrError(
        'herdr_timeout',
        `herdr did not answer within ${Math.round(timeoutMs / 1000)} seconds (${args.slice(0, 2).join(' ')}), so crew stopped waiting for it`,
      );
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

/** The agent herdr lists on a pane, or null. A read-only call; throws when herdr cannot be asked. */
function agentOnPane(look, paneId, name) {
  const agents = need(look(['agent', 'list']), 'agents', 'agent list').agents;
  const there = agents.find((a) => a.pane_id === paneId);
  // The pane was created for this agent, so another name on it is not ours.
  if (!there || (name && there.name && there.name !== name)) return null;
  return there;
}

/** Whether a foreground process looks like the agent kind: by name, argv0 or argv[0]. */
const runsKind = (proc, kind) =>
  [proc.name, proc.argv0, proc.argv?.[0]].some((x) => typeof x === 'string' && (x === kind || x.split('/').pop() === kind));

/** What is running on a pane, from `pane process-info`; throws when herdr cannot be asked. */
function inspectPane(look, paneId) {
  const info = need(look(['pane', 'process-info', '--pane', paneId]), 'process_info', 'pane process-info').process_info;
  return {
    shellPid: info.shell_pid,
    foregroundPgid: info.foreground_process_group_id,
    procs: Array.isArray(info.foreground_processes) ? info.foreground_processes : [],
  };
}

/** True when an agent is listed on the pane or its kind is in the foreground. */
function paneHasAgent(look, paneId, name, kind) {
  if (agentOnPane(look, paneId, name)) return true;
  return inspectPane(look, paneId).procs.some((p) => runsKind(p, kind));
}

/**
 * Why a pane refused an agent: 'agent' (one is there: do not wait), 'ready' (a
 * bare shell holds the foreground, which is the test herdr applies) or
 * 'starting' (the shell is not yet in the foreground, and no agent is there).
 * `detail` says it in words for the failure message.
 */
function paneState(look, paneId, name, kind) {
  const listed = agentOnPane(look, paneId, name);
  const p = inspectPane(look, paneId);
  if (listed) return { kind: 'agent', detail: `herdr lists ${listed.name ?? 'an agent'} on pane ${paneId}` };
  const running = p.procs.find((x) => runsKind(x, kind));
  if (running) return { kind: 'agent', detail: `${running.argv0 ?? running.name} is in its foreground` };
  const bare = p.foregroundPgid === p.shellPid && p.procs.length > 0 && p.procs.every((x) => x.pid === p.shellPid);
  if (bare) return { kind: 'ready', detail: 'the pane shell is in the foreground' };
  const names = p.procs.map((x) => x.argv0 ?? x.name).filter(Boolean);
  return { kind: 'starting', detail: `the pane's shell was still not in the foreground${names.length ? `; running there: ${names.join(', ')}` : ''}` };
}

/**
 * @param {{bin?: string, timeoutMs?: number}} [options] The binary and the time a
 *   single call may take; both exist so the timeout can be tested without herdr.
 */
export function createHerdr({
  bin = 'herdr',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  startWaitMs = DEFAULT_START_WAIT_MS,
  startRetryMs = DEFAULT_START_RETRY_MS,
} = {}) {
  const run = (args) => runHerdr(args, { bin, timeoutMs });
  const look = (args) => runHerdr(args, { bin, timeoutMs: Math.min(timeoutMs, DEFAULT_LOOK_TIMEOUT_MS) });
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
      const cmd = ['agent', 'start', name, '--kind', kind, '--pane', pane_id, ...(args.length > 0 ? ['--', ...args] : [])];
      const began = Date.now();
      let retriedOnReady = false;
      // Never starts twice: every retry follows a refusal that proves the first
      // request was not accepted, or a look that found no agent.
      for (;;) {
        try {
          run(cmd);
          return;
        } catch (err) {
          if (!(err instanceof HerdrError)) throw err;
          if (err.code === 'agent_name_taken') {
            // On a start we sent twice this means the first one took.
            if (agentOnPane(look, pane_id, name)) return;
            throw err;
          }
          if (CUT_OFF_CODES.has(err.code) && !isPaneBusy(err)) {
            // herdr may have written the launch command into the pane before the
            // call was cut off. Look before deciding anything.
            let seen;
            try {
              seen = paneHasAgent(look, pane_id, name, kind);
            } catch {
              throw err; // could not look: the cut-off is the news
            }
            if (seen) return;
            throw new HerdrError(
              err.code,
              `${err.message}. crew then looked at the pane and saw no agent there, which does not prove none will appear`,
            );
          }
          if (!isPaneBusy(err)) throw err;

          let state;
          try {
            state = paneState(look, pane_id, name, kind);
          } catch (lookErr) {
            throw new HerdrError(err.code, `${err.message} (crew could not look at the pane to see why: ${lookErr.message})`);
          }
          if (state.kind === 'agent') {
            throw new HerdrError(err.code, `${err.message} (the pane already has an agent running in it: ${state.detail}, so waiting would not help)`);
          }
          if (state.kind === 'ready') {
            // The shell got to the foreground between herdr's answer and this look.
            if (retriedOnReady) {
              throw new HerdrError(err.code, `${err.message} (the pane's shell is in the foreground and herdr still refused, so crew stopped rather than guess)`);
            }
            retriedOnReady = true;
            continue;
          }
          const waited = Date.now() - began;
          if (waited + startRetryMs > startWaitMs) {
            throw new HerdrError(
              err.code,
              `${err.message} (crew waited ${+(waited / 1000).toFixed(1)} seconds for the pane to reach its shell, then gave up; ${state.detail})`,
            );
          }
          pause(startRetryMs);
        }
      }
    },
    promptAgent(name, text) {
      run(['agent', 'prompt', name, text]);
    },
    /**
     * Display-only labels, shown where the operator's herdr config lists them.
     * `source` names crew as the reporter; no ttl, so a label lasts as long as
     * the pane. Short timeout: a label is never worth a minute of waiting.
     * The id comes first: herdr 0.9.1 reads options only after the positional
     * id and answers `unknown option: crew` when `--source` precedes it.
     */
    labelPane(paneId, tokens) {
      look(['pane', 'report-metadata', paneId, '--source', LABEL_SOURCE, ...tokenArgs(tokens)]);
    },
    labelWorkspace(workspaceId, tokens) {
      look(['workspace', 'report-metadata', workspaceId, '--source', LABEL_SOURCE, ...tokenArgs(tokens)]);
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
