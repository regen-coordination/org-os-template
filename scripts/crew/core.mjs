// scripts/crew/core.mjs
//
// The crew's rules and verbs. Pure: every effect goes through the herdr and git
// adapters in ctx, or through the trail files under ctx.mainDir.
// See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §5–10.
import { basename, join, sep } from 'node:path';
import { CrewError, loadCircles, loadRole } from './roles.mjs';
import { ACTIVE, freeId, isoLocal, localDate, readTrail, slugify, trailDir, updateRecord, writeRecord } from './trail.mjs';

// How each agent kind takes a model on its command line. A kind not listed here
// is started with no arguments.
const MODEL_ARGS = {
  claude: (model) => ['--model', model],
  codex: (model) => ['--model', model],
  opencode: (model) => ['--model', model],
};

export function requireHerdr(ctx) {
  if (ctx.env.HERDR_ENV !== '1') {
    throw new CrewError('crew runs inside herdr. Open herdr and run this from one of its panes.');
  }
  if (ctx.mainDir === ctx.worktreeRoot || ctx.mainDir.startsWith(ctx.worktreeRoot + sep)) {
    throw new CrewError("This is a crew worktree's own copy of the script. Run the command written in your assignment file instead.");
  }
}

const active = (trail) => trail.assignments.filter((a) => ACTIVE.includes(a.status));
const stamp = (ctx) => isoLocal(ctx.now());

/** The open assignment of whoever is running the command, or null for the operator. */
export function callerAssignment(ctx, trail) {
  const open = active(trail);
  const pane = ctx.env.HERDR_PANE_ID;
  return (
    open.find((a) => pane && a.pane === pane) ||
    open.find((a) => a.worktree && (ctx.cwd === a.worktree || ctx.cwd.startsWith(a.worktree + sep))) ||
    null
  );
}

/** An assignment by id or by agent name. */
export function findActive(trail, target, statuses = ACTIVE) {
  const pool = trail.assignments.filter((a) => statuses.includes(a.status));
  const byId = pool.find((a) => a.id === target);
  if (byId) return byId;
  const byName = pool.filter((a) => a.agent === target);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new CrewError(`More than one open assignment has an agent named "${target}". Use the assignment id: ${byName.map((a) => a.id).join(', ')}.`);
  }
  throw new CrewError(`No open assignment matches "${target}". Run the board to see agent names and assignment ids.`);
}

function freeName(roleId, agents) {
  const taken = new Set(agents.map((a) => a.name).filter(Boolean));
  let name = roleId;
  for (let n = 2; taken.has(name); n += 1) name = `${roleId}-${n}`;
  return name;
}

function firstPrompt(rolePath, file) {
  return (
    `You are seated in the org-os crew. Read ${rolePath} (your role) and ${file} (your assignment) in full, ` +
    'then begin the work in the brief. When you finish, follow the Commands section of the assignment file to report.'
  );
}

function assignmentBody(ctx, brief) {
  return [
    '## Brief',
    '',
    brief.trim(),
    '',
    '## Commands',
    '',
    'Run these exactly as written. They are the only things you do outside your worktree.',
    '',
    `- Report when you finish or cannot continue: \`node "${ctx.scriptPath}" report --file <path to your report>\``,
    `- Ask another role to take something on: \`node "${ctx.scriptPath}" handoff <role> "<brief>" [--branch <branch>]\``,
    '',
    `Shared boundaries and the charter: ${join(ctx.mainDir, 'roles', 'README.md')}`,
    '',
  ].join('\n');
}

export function seat(ctx, { roleId, brief, task = null, base = 'main', on = null }) {
  requireHerdr(ctx);
  const role = loadRole(ctx.mainDir, roleId);
  const { maxAgents } = loadCircles(ctx.mainDir);
  const trail = readTrail(ctx.mainDir);
  const agents = ctx.herdr.listAgents();

  const caller = callerAssignment(ctx, trail);
  if (caller && !loadRole(ctx.mainDir, caller.role).may_seat) {
    throw new CrewError(`The ${caller.role} role may not seat other roles. Write a handoff instead: handoff ${roleId} "<brief>".`);
  }
  const livePanes = new Set(agents.map((a) => a.pane_id));
  const seated = active(trail).filter((a) => livePanes.has(a.pane));
  if (seated.length >= maxAgents) {
    throw new CrewError(`${seated.length} crew agents are already seated and the cap is ${maxAgents}. Release one first.`);
  }
  if (!brief || !brief.trim()) {
    throw new CrewError('A brief is required: say what the agent should do.');
  }
  const ref = on || base;
  if (!ctx.git.resolves(ref)) {
    throw new CrewError(`"${ref}" is not a branch or commit in this repository.`);
  }

  const now = ctx.now();
  const id = freeId(ctx.mainDir, `${localDate(now)}-${role.id}-${slugify(brief)}`);
  const file = join(trailDir(ctx.mainDir), `${id}.md`);
  const worktree = join(ctx.worktreeRoot, basename(ctx.mainDir), id);
  const name = freeName(role.id, agents);
  writeRecord(
    file,
    {
      id,
      role: role.id,
      agent: name,
      kind: role.kind,
      branch: on || `crew/${id}`,
      detached: Boolean(on),
      pane: null,
      workspace: null,
      worktree,
      task,
      handoff: null,
      seated_by: caller ? caller.id : 'operator',
      status: 'seating',
      prompted: false,
      created: isoLocal(now),
      updated: isoLocal(now),
    },
    assignmentBody(ctx, brief),
  );

  let step = 'worktree';
  let prompted = false;
  try {
    let opened;
    if (on) {
      ctx.git.addDetached(worktree, on);
      opened = ctx.herdr.openWorktree({ cwd: ctx.mainDir, path: worktree, label: name });
    } else {
      opened = ctx.herdr.createWorktree({ cwd: ctx.mainDir, branch: `crew/${id}`, base, path: worktree, label: name });
    }
    updateRecord(file, { pane: opened.pane_id, workspace: opened.workspace_id });

    step = 'start';
    const args = role.model && MODEL_ARGS[role.kind] ? MODEL_ARGS[role.kind](role.model) : [];
    let ready = true;
    try {
      ctx.herdr.startAgent({ name, kind: role.kind, pane_id: opened.pane_id, args });
    } catch (err) {
      // The agent is there but stopped at a startup dialog. It is seated; the
      // operator answers the dialog and nudges it.
      if (err.code !== 'agent_not_ready') throw err;
      ready = false;
    }

    if (ready) {
      try {
        ctx.herdr.promptAgent(name, firstPrompt(role.path, file));
        prompted = true;
      } catch {
        // herdr says a failed or timed-out prompt does not prove non-delivery,
        // so the prompt is never resent here. The operator can nudge.
      }
    }
  } catch (err) {
    updateRecord(file, { status: 'failed', failed_step: step, error: String(err.message || err), updated: stamp(ctx) });
    throw new CrewError(`Seating failed at the ${step} step: ${err.message || err}. It is recorded in ${file}; nothing was cleaned up.`);
  }
  return updateRecord(file, { status: 'working', prompted, updated: stamp(ctx) });
}

export function nudge(ctx, { target }) {
  requireHerdr(ctx);
  const a = findActive(readTrail(ctx.mainDir), target);
  if (a.prompted) {
    throw new CrewError(`${a.agent} has already been given its first prompt. Prompt it yourself in its pane if it needs more.`);
  }
  ctx.herdr.promptAgent(a.agent, firstPrompt(loadRole(ctx.mainDir, a.role).path, a.file));
  return updateRecord(a.file, { prompted: true, updated: stamp(ctx) });
}
