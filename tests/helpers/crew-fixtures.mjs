// tests/helpers/crew-fixtures.mjs
//
// Shared by the crew-*.test.mjs suites: a throwaway repository root with a small
// roster, and fake herdr / git adapters so scripts/crew/core.mjs runs without
// either tool.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

const CIRCLES = `max_agents: 2
circles:
  - { id: lead, name: Coordination, purpose: Coordinates. }
  - { id: engineering, name: Engineering, purpose: Builds. }
`;

export function writeRole(root, id, overrides = {}) {
  // An override of undefined removes the field (YAML cannot write undefined).
  const data = Object.fromEntries(
    Object.entries({ id, circle: 'engineering', kind: 'claude', model: 'sonnet', may_seat: false, ...overrides }).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const path = join(root, 'roles', `${id}.md`);
  mkdirSync(join(root, 'roles'), { recursive: true });
  writeFileSync(path, matter.stringify(`# ${id}\n\n## Mandate\n\nTest role.\n`, data));
  return path;
}

export function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'crew-test-'));
  mkdirSync(join(root, 'roles'), { recursive: true });
  writeFileSync(join(root, 'roles', 'circles.yaml'), CIRCLES);
  writeRole(root, 'lead', { circle: 'lead', model: 'opus', may_seat: true });
  writeRole(root, 'engineer');
  writeRole(root, 'reviewer');
  return root;
}

export function fakeHerdr(initialAgents = []) {
  let n = 0;
  const herdr = {
    agents: initialAgents.map((a) => ({ name: null, state: 'idle', kind: 'claude', ...a })),
    calls: [],
    failOn: null, // { method, code, message }
    fail(method) {
      if (herdr.failOn && herdr.failOn.method === method) {
        const err = new Error(herdr.failOn.message || `${method} failed`);
        err.code = herdr.failOn.code || 'herdr_error';
        throw err;
      }
    },
    listAgents() {
      return herdr.agents.map((a) => ({ ...a }));
    },
    open(method, opts) {
      herdr.calls.push([method, opts]);
      herdr.fail(method);
      n += 1;
      mkdirSync(opts.path, { recursive: true });
      return { pane_id: `x${n}:p1`, workspace_id: `x${n}` };
    },
    createWorktree(opts) {
      return herdr.open('createWorktree', opts);
    },
    openWorktree(opts) {
      return herdr.open('openWorktree', opts);
    },
    startAgent(opts) {
      herdr.calls.push(['startAgent', opts]);
      herdr.fail('startAgent');
      herdr.agents.push({ name: opts.name, pane_id: opts.pane_id, workspace_id: opts.pane_id.split(':')[0], state: 'idle', kind: opts.kind });
    },
    promptAgent(name, text) {
      herdr.calls.push(['promptAgent', { name, text }]);
      herdr.fail('promptAgent');
    },
    removeWorktree(workspaceId, path) {
      herdr.calls.push(['removeWorktree', { workspaceId }]);
      herdr.fail('removeWorktree');
      herdr.agents = herdr.agents.filter((a) => a.workspace_id !== workspaceId);
      if (path) rmSync(path, { recursive: true, force: true });
    },
  };
  return herdr;
}

export function fakeGit({ refs = ['main'] } = {}) {
  const git = {
    refs: new Set(refs),
    dirty: new Map(), // worktree path -> porcelain lines
    calls: [],
    resolves(ref) {
      return git.refs.has(ref);
    },
    addDetached(path, ref) {
      git.calls.push(['addDetached', { path, ref }]);
      mkdirSync(path, { recursive: true });
    },
    worktreeExists(path) {
      return existsSync(path);
    },
    changes(path) {
      return git.dirty.get(path) || [];
    },
    removeWorktree(path) {
      git.calls.push(['removeWorktree', { path }]);
      rmSync(path, { recursive: true, force: true });
    },
  };
  return git;
}

/** The operator's context: inside herdr, in a pane that hosts no crew agent. */
export function makeCtx(root, overrides = {}) {
  return {
    mainDir: root,
    herdr: fakeHerdr(),
    git: fakeGit(),
    env: { HERDR_ENV: '1', HERDR_PANE_ID: 'op:p1' },
    cwd: root,
    now: () => new Date('2026-10-10T12:00:00Z'),
    worktreeRoot: join(root, '.wt'),
    scriptPath: join(root, 'scripts', 'crew.mjs'),
    ...overrides,
  };
}

/** The same context as seen from a seated agent's pane. */
export function asAgent(ctx, assignment) {
  return { ...ctx, env: { ...ctx.env, HERDR_PANE_ID: assignment.pane }, cwd: assignment.worktree };
}
