// scripts/crew/core.mjs
//
// The crew's rules and verbs. Pure: every effect goes through the herdr and git
// adapters in ctx, or through the trail files under ctx.mainDir.
// See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §5–10.
import { basename, join, sep } from 'node:path';
import { CrewError, loadCircles, loadRole } from './roles.mjs';
import { ACTIVE, freeId, isoLocal, localDate, readRecord, readTrail, slugify, trailDir, updateRecord, writeRecord } from './trail.mjs';

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

// Codes herdr returns before it queues any input to the pane (herdr 0.9.1 source,
// spec 5.3), plus a missing binary: each proves the prompt was not sent. Every
// other failure, herdr_timeout included, may have been typed already.
const PROMPT_NOT_SENT = new Set([
  'herdr_missing',
  'empty_agent_prompt',
  'agent_not_found',
  'agent_target_ambiguous',
  'agent_blocked',
  'agent_not_ready',
]);

const active = (trail) => trail.assignments.filter((a) => ACTIVE.includes(a.status));
const stamp = (ctx) => isoLocal(ctx.now());

/**
 * The assignment of whoever is running the command, or null for the operator.
 *
 * A caller is an agent when it runs from an assignment's worktree, or from the
 * pane recorded for an assignment while herdr still shows that agent, by name,
 * in that pane. The name check keeps a reused pane id from turning the operator
 * into a stale assignment's agent. Closed assignments count too: an agent whose
 * assignment was released but which is still alive is not the operator.
 */
export function callerAssignment(ctx, trail, agents) {
  const pane = ctx.env.HERDR_PANE_ID;
  const here = pane ? agents.find((x) => x.pane_id === pane) : null;
  const inPane = (a) => Boolean(here) && a.pane === pane && here.name === a.agent;
  const inWorktree = (a) => Boolean(a.worktree) && (ctx.cwd === a.worktree || ctx.cwd.startsWith(a.worktree + sep));
  const newestFirst = [...trail.assignments].sort((x, y) => String(y.created).localeCompare(String(x.created)));
  const mine = newestFirst.filter((a) => inPane(a) || inWorktree(a));
  return mine.find((a) => ACTIVE.includes(a.status)) || mine[0] || null;
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

// What every seat reads before its brief lives in one section of roles/README.md,
// so an instance changes the list by editing that file. The script only points.
const ONBOARDING = 'Before you begin';

// One sentence, shared by the first prompt and by what an operator types by hand.
// The README path is the main checkout's; the files it lists are read from the
// agent's own worktree, which the sentence says in so many words.
function readingOrder(rolePath, file, readmePath) {
  return (
    `Read ${rolePath} (your role) and ${file} (your assignment) in full, ` +
    `then read the "${ONBOARDING}" section of ${readmePath} and the files it lists, ` +
    'which are at the root of your own worktree (if that section is missing, say so in your report and begin), ' +
    'and only then begin the work in the brief.'
  );
}

function firstPrompt(rolePath, file, readmePath) {
  return (
    `You are seated in the org-os crew. ${readingOrder(rolePath, file, readmePath)} ` +
    'When you finish, follow the Commands section of the assignment file to report.'
  );
}

/** What an operator types into an agent's pane when the first prompt may not have arrived. */
export function typeYourself(ctx, a) {
  const file = join(trailDir(ctx.mainDir), `${a.id}.md`);
  return readingOrder(loadRole(ctx.mainDir, a.role).path, file, join(ctx.mainDir, 'roles', 'README.md'));
}

function assignmentBody(ctx, brief, role, named = null) {
  const cmd = (rest) => `node "${ctx.scriptPath}" ${rest}`;
  // A role that may seat works from its own worktree, where `npm run crew` is
  // refused, so it runs the main checkout's script by absolute path.
  const lead = role.may_seat
    ? [
        `- See who is seated, open handoffs and what needs attention: \`${cmd('board')}\``,
        `- Seat an agent: \`${cmd('seat <role> "<brief>" [--task <id>] [--base <ref>] [--on <branch>] [--handoff <id|file>]')}\``,
        '  A brief that starts with a dash goes after `--`, after any flags: `seat <role> [--task <id>] -- "<brief>"`.',
        '  The new worktree starts from `main` unless you pass `--base <ref>`. If the code to work on is not on `main`, pass `--base` with its branch.',
        '  With `--handoff`, a handoff that names a branch seats a detached copy of it, unless you pass `--base`: then the agent gets a new branch from that base. `--base` and `--on` cannot be combined.',
        `- Send the first prompt to an agent that stopped at a startup dialog: \`${cmd('nudge <agent|assignment>')}\``,
        `- Close an assignment: \`${cmd('release <agent|assignment> [--outcome done|abandoned]')}\``,
        `- Decline an open handoff: \`${cmd('handoff-close <id|file> --reason "<text>"')}\``,
      ]
    : [];
  return [
    '## Brief',
    '',
    brief.trim(),
    '',
    ...(named
      ? [
          '## Handoff',
          '',
          `Handoff ${named.handoff} names branch ${named.branch}. You were not seated on a copy of it: your branch starts from ${named.base}.`,
          '',
        ]
      : []),
    '## Commands',
    '',
    'Run these exactly as written. They are the only things you do outside your worktree.',
    '',
    `- Report when you finish or cannot continue: \`node "${ctx.scriptPath}" report --file <path to your report>\``,
    `- Ask another role to take something on: \`node "${ctx.scriptPath}" handoff <role> "<brief>" [--branch <branch>]\``,
    '  A brief that starts with a dash goes after `--`, after any flags: `handoff <role> [--branch <branch>] -- "<brief>"`.',
    ...lead,
    '',
    `Shared boundaries, the charter and the "${ONBOARDING}" section to read first: ${join(ctx.mainDir, 'roles', 'README.md')}`,
    '',
  ].join('\n');
}

/** A handoff by id or by file path. */
function findHandoff(trail, target) {
  const key = basename(String(target), '.md');
  const h = trail.handoffs.find((x) => x.id === key);
  if (!h) throw new CrewError(`No handoff matches "${target}". Open handoffs are listed on the board.`);
  return h;
}

function handoffBrief(file) {
  return readRecord(file).body.replace(/^\s*## Brief[ \t]*\n+/, '').trim();
}

/**
 * `base` is null when the operator gave none: only then does a handoff's branch
 * decide, and the new branch starts from `main`. An explicit base always wins.
 */
export function seat(ctx, { roleId, brief, task = null, base = null, on = null, handoff: handoffTarget = null }) {
  requireHerdr(ctx);
  if (base !== null && on) {
    throw new CrewError('--base and --on cannot be used together: --on seats a detached copy of an existing branch, --base starts a new branch from a ref. Use one of them.');
  }
  const role = loadRole(ctx.mainDir, roleId);
  const { maxAgents } = loadCircles(ctx.mainDir);
  const trail = readTrail(ctx.mainDir);
  const agents = ctx.herdr.listAgents();

  let taken = null;
  if (handoffTarget) {
    taken = findHandoff(trail, handoffTarget);
    if (taken.status !== 'open') throw new CrewError(`Handoff ${taken.id} is already ${taken.status}.`);
    if (taken.to_role !== role.id) throw new CrewError(`Handoff ${taken.id} is for the ${taken.to_role} role, not ${role.id}.`);
    if (!brief || !brief.trim()) brief = handoffBrief(taken.file);
    // A handoff's branch seats a detached copy, unless the caller asked for a new
    // branch from a base of their own: then the handoff is taken and only named.
    if (!on && taken.branch && base === null) on = taken.branch;
  }
  const handoffBranchNamed = taken && taken.branch && !on ? taken.branch : null;

  const caller = callerAssignment(ctx, trail, agents);
  if (caller && !loadRole(ctx.mainDir, caller.role).may_seat) {
    throw new CrewError(`The ${caller.role} role may not seat other roles. Write a handoff instead: handoff ${roleId} "<brief>".`);
  }
  const livePanes = new Set(agents.map((a) => a.pane_id));
  // A record still in `seating` has no pane yet but is about to take a seat.
  const seated = active(trail).filter((a) => a.status === 'seating' || livePanes.has(a.pane));
  if (seated.length >= maxAgents) {
    throw new CrewError(`${seated.length} crew agents are already seated and the cap is ${maxAgents}. Release one first.`);
  }
  if (!brief || !brief.trim()) {
    throw new CrewError('A brief is required: say what the agent should do.');
  }
  const ref = on || base || 'main';
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
      handoff: taken ? taken.id : null,
      seated_by: caller ? caller.id : 'operator',
      status: 'seating',
      prompted: false,
      created: isoLocal(now),
      updated: isoLocal(now),
    },
    assignmentBody(ctx, brief, role, handoffBranchNamed ? { handoff: taken.id, branch: handoffBranchNamed, base: ref } : null),
  );

  // herdr starts worktree actions from the repository's primary checkout and
  // refuses a linked worktree (linked_worktree_source). ctx.repoDir is that
  // primary checkout when the main checkout is itself a linked worktree.
  const repoDir = ctx.repoDir ?? ctx.mainDir;
  let step = 'worktree';
  // Set just before herdr is asked to create or open the worktree: from then on
  // it may have made things that crew was never told about.
  let herdrAsked = false;
  // true: sent and confirmed. false: never sent. 'unconfirmed': sent, but herdr
  // did not confirm it, which does not prove it did not arrive.
  let prompted = false;
  try {
    let opened;
    if (on) {
      ctx.git.addDetached(worktree, on);
      herdrAsked = true;
      opened = ctx.herdr.openWorktree({ cwd: repoDir, path: worktree, label: name });
    } else {
      herdrAsked = true;
      opened = ctx.herdr.createWorktree({ cwd: repoDir, branch: `crew/${id}`, base: ref, path: worktree, label: name });
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
        ctx.herdr.promptAgent(name, firstPrompt(role.path, file, join(ctx.mainDir, 'roles', 'README.md')));
        prompted = true;
      } catch (err) {
        // herdr says a failed or timed-out prompt does not prove non-delivery,
        // so the prompt is never resent: not here, and not by nudge. Only the
        // codes in PROMPT_NOT_SENT prove nothing was sent.
        prompted = PROMPT_NOT_SENT.has(err.code) ? false : 'unconfirmed';
      }
    }
  } catch (err) {
    // What a failed worktree step may have left, including a herdr workspace
    // whose id crew never received.
    const mayRemain = step === 'worktree' ? worktreeLeftovers({ id, on, worktree, name, herdrAsked }) : null;
    updateRecord(file, {
      status: 'failed',
      failed_step: step,
      error: String(err.message || err),
      ...(err.code ? { error_code: String(err.code) } : {}),
      ...(mayRemain ? { may_remain: mayRemain } : {}),
      updated: stamp(ctx),
    });
    // A call that timed out may still have happened: herdr was asked, and it never said no.
    const maybe =
      err.code === 'herdr_timeout'
        ? ` herdr did not answer, so the ${step === 'start' ? 'agent' : 'worktree'} may exist anyway.` +
          (step === 'start'
            ? ' Look at the board; if this assignment is under "Needs release", run release ' + id + ' to close it.'
            : ' It may still be creating it: wait a little, look at the board, and run release ' + id + ' to close the assignment.')
        : '';
    const left = mayRemain
      ? ` May still exist: ${mayRemain.join('; ')}.` +
        (herdrAsked ? ' crew never learned the id of that herdr workspace, so release cannot close it: close it in herdr yourself.' : '')
      : '';
    throw new CrewError(`Seating failed at the ${step} step: ${err.message || err}. It is recorded in ${file}; nothing was cleaned up.${left}${maybe}`);
  }
  if (taken) updateRecord(taken.file, { status: 'taken', taken_by: id, updated: stamp(ctx) });
  return updateRecord(file, { status: 'working', prompted, updated: stamp(ctx) });
}

/** What a failed worktree step may have left behind, in the words the failed record and the message use. */
function worktreeLeftovers({ id, on, worktree, name, herdrAsked }) {
  const out = [];
  if (!on && herdrAsked) out.push(`branch crew/${id}`);
  out.push(`checkout directory ${worktree}`);
  if (herdrAsked) out.push(`a herdr workspace labelled "${name}"`);
  return out;
}

/** What to tell the operator about a first prompt that may or may not have arrived. */
function unconfirmedMessage(ctx, a, why) {
  return (
    `The first prompt to ${a.agent} may already have arrived: ${why}, and a timeout does not prove it was not delivered. ` +
    `Look at ${a.agent}'s pane. If it has not started, type there: ${typeYourself(ctx, a)}`
  );
}

export function nudge(ctx, { target }) {
  requireHerdr(ctx);
  const a = findActive(readTrail(ctx.mainDir), target);
  if (a.prompted === 'unconfirmed') {
    throw new CrewError(unconfirmedMessage(ctx, a, 'nudge would send it a second time'));
  }
  if (a.prompted) {
    throw new CrewError(`${a.agent} has already been given its first prompt. Prompt it yourself in its pane if it needs more.`);
  }
  const rolePath = loadRole(ctx.mainDir, a.role).path;
  try {
    ctx.herdr.promptAgent(a.agent, firstPrompt(rolePath, a.file, join(ctx.mainDir, 'roles', 'README.md')));
  } catch (err) {
    if (err.code === 'herdr_missing') {
      throw new CrewError(`The herdr command was not found on PATH, so nothing was sent to ${a.agent}. Fix that and run nudge again.`);
    }
    if (PROMPT_NOT_SENT.has(err.code)) {
      // herdr refused before queueing any input: the prompt is still unsent and nudge may be run again.
      throw new CrewError(
        `herdr refused the first prompt before sending anything, so nothing was sent to ${a.agent}: ${err.message}. ` +
          `Deal with that in ${a.agent}'s pane (an open dialog, or an agent still starting), then run nudge again.`,
      );
    }
    // Attempted and not confirmed: from here on it is case (b), never resent.
    updateRecord(a.file, { prompted: 'unconfirmed', updated: stamp(ctx) });
    throw new CrewError(unconfirmedMessage(ctx, a, 'herdr did not confirm it'));
  }
  return updateRecord(a.file, { prompted: true, updated: stamp(ctx) });
}

function requireAgent(ctx, trail, what) {
  const caller = callerAssignment(ctx, trail, ctx.herdr.listAgents());
  if (!caller) {
    throw new CrewError(`Only a seated agent can ${what}. Run this from the agent's own pane or worktree.`);
  }
  return caller;
}

export function report(ctx, { text }) {
  requireHerdr(ctx);
  const caller = requireAgent(ctx, readTrail(ctx.mainDir), 'report');
  if (!text || !text.trim()) {
    throw new CrewError('The report is empty. Write what changed, what you verified and what is left, then run this again.');
  }
  const { data, body } = readRecord(caller.file);
  const when = stamp(ctx);
  const next = { ...data, status: 'reported', updated: when };
  writeRecord(caller.file, next, `${body.trimEnd()}\n\n## Report — ${when}\n\n${text.trim()}\n`);
  return next;
}

export function handoff(ctx, { toRole, brief, branch = null }) {
  requireHerdr(ctx);
  const caller = requireAgent(ctx, readTrail(ctx.mainDir), 'write a handoff');
  const role = loadRole(ctx.mainDir, toRole);
  if (!brief || !brief.trim()) {
    throw new CrewError('A brief is required: say what you need the other role to do.');
  }
  const now = ctx.now();
  const id = freeId(ctx.mainDir, `handoff-${localDate(now)}-${slugify(brief)}`);
  const data = {
    id,
    from: caller.id,
    to_role: role.id,
    branch,
    status: 'open',
    created: isoLocal(now),
    updated: isoLocal(now),
    taken_by: null,
  };
  writeRecord(join(trailDir(ctx.mainDir), `${id}.md`), data, `## Brief\n\n${brief.trim()}\n`);
  return data;
}

export function closeHandoff(ctx, { target, reason }) {
  requireHerdr(ctx);
  const trail = readTrail(ctx.mainDir);
  const caller = callerAssignment(ctx, trail, ctx.herdr.listAgents());
  if (caller && !loadRole(ctx.mainDir, caller.role).may_seat) {
    throw new CrewError(`The ${caller.role} role may not close handoffs. The lead or the operator does that.`);
  }
  const h = findHandoff(trail, target);
  if (h.status !== 'open') throw new CrewError(`Handoff ${h.id} is already ${h.status}.`);
  if (!reason || !reason.trim()) {
    throw new CrewError('A reason is required: say why the handoff is declined.');
  }
  return updateRecord(h.file, { status: 'declined', reason: reason.trim(), updated: stamp(ctx) });
}

const CLOSED = ['released', 'abandoned'];

/**
 * Closed assignments whose recorded removal did not finish. Those whose worktree
 * is still on disk are `leftBehind`; the rest were finished by herdr after
 * release stopped waiting. Their recorded outcome is final; only the removal can
 * be retried, or, for a worktree already gone, the record closed.
 */
const unfinishedRemoval = (trail) => trail.assignments.filter((a) => CLOSED.includes(a.status) && a.worktree_removed === false);
const leftBehind = (ctx, trail) => unfinishedRemoval(trail).filter((a) => ctx.git.worktreeExists(a.worktree));

const OUTCOME_STATUS = { done: 'released', abandoned: 'abandoned' };

/**
 * `outcome` is undefined when the operator gave none: a first release then
 * means done, and a retry keeps whatever was recorded.
 */
export function release(ctx, { target, outcome }) {
  requireHerdr(ctx);
  if (outcome !== undefined && !(outcome in OUTCOME_STATUS)) {
    throw new CrewError(`The outcome must be done or abandoned, not "${outcome}".`);
  }
  const trail = readTrail(ctx.mainDir);
  const agents = ctx.herdr.listAgents();
  const caller = callerAssignment(ctx, trail, agents);
  if (caller && !loadRole(ctx.mainDir, caller.role).may_seat) {
    throw new CrewError(`The ${caller.role} role may not release agents. Report instead; the lead or the operator releases.`);
  }
  const openStatuses = [...ACTIVE, 'failed'];
  let a;
  if (trail.assignments.some((x) => openStatuses.includes(x.status) && (x.id === target || x.agent === target))) {
    a = findActive(trail, target, openStatuses); // may refuse: more than one open one matches
  } else {
    // Nothing open matched: it may be a closed assignment whose worktree release
    // could not remove, or one herdr finished removing after release stopped
    // waiting, so that only its record still says the worktree is there.
    const left = unfinishedRemoval(trail).filter((x) => x.id === target || x.agent === target);
    if (left.length === 0) findActive(trail, target, openStatuses); // throws the no-match error
    if (left.length > 1) {
      throw new CrewError(`More than one closed assignment of "${target}" still has a worktree. Use the assignment id: ${left.map((x) => x.id).join(', ')}.`);
    }
    a = left[0];
  }
  const closed = CLOSED.includes(a.status);
  if (closed && outcome !== undefined && OUTCOME_STATUS[outcome] !== a.status) {
    throw new CrewError(`${a.id} is already ${a.status}; a retry only finishes removing the worktree.`);
  }
  // A closed assignment has no agent: its old pane id may belong to another one now.
  const live = closed ? null : agents.find((x) => a.pane && x.pane_id === a.pane);
  if (live && live.state === 'working') {
    throw new CrewError(`${a.agent} is still working. Wait for it to finish, or stop it in its pane first.`);
  }

  let removed = false;
  let rescueFailed = false;
  let rescued = closed ? a.rescued_branch ?? null : null;
  let left = [];
  const worktreeExisted = ctx.git.worktreeExists(a.worktree);
  if (!worktreeExisted) {
    removed = true;
  } else {
    left = ctx.git.changes(a.worktree);
    if (a.detached) {
      // A detached copy has no branch of its own. Commits made in it would be
      // lost with the worktree, so they are saved to a branch first. A retry
      // asks again: commits made since the last release are on no branch yet.
      // Nothing new to save keeps the branch recorded earlier.
      try {
        rescued = ctx.git.rescueDetached(a.worktree, `crew/${a.id}`) ?? rescued;
      } catch (err) {
        rescueFailed = true;
        left = [`Commits made in the detached copy could not be saved to a branch: ${err.message || err}`, ...left];
      }
    }
    if (left.length === 0) {
      let viaHerdr = false;
      let timedOut = null; // what herdr was being asked when it did not answer
      let asking = 'which worktree its workspace is open on';
      try {
        // herdr removes the worktree and closes the workspace it opened for it,
        // but only while that workspace id still names this worktree: after a
        // herdr restart the id may belong to something else.
        if (a.workspace && ctx.herdr.workspaceCheckout(a.workspace) === a.worktree) {
          asking = 'to remove the worktree';
          ctx.herdr.removeWorktree(a.workspace);
          viaHerdr = true;
        }
      } catch (err) {
        // A timed-out herdr may still be removing the worktree: git must not race
        // it. Anything else falls through to git.
        if (err.code === 'herdr_timeout') timedOut = asking;
      }
      if (timedOut) {
        left = [
          timedOut === 'to remove the worktree'
            ? 'herdr did not answer when asked to remove the worktree and may still be doing it. Wait a little, then run release again.'
            : `herdr did not answer when asked ${timedOut}, so nothing was removed. Wait a little, then run release again.`,
        ];
      } else if (viaHerdr) {
        removed = true;
      } else {
        try {
          ctx.git.removeWorktree(a.worktree);
          removed = true;
        } catch (err) {
          left = [`The worktree could not be removed: ${err.message || err}`];
        }
      }
    }
  }
  // A retry never changes how the assignment ended.
  const status = closed ? a.status : OUTCOME_STATUS[outcome ?? 'done'];
  const assignment = updateRecord(a.file, { status, worktree_removed: removed, rescued_branch: rescued, updated: stamp(ctx) });
  // A closed record whose worktree is gone was finished by herdr: say so, once.
  const alreadyGone = closed && a.worktree_removed === false && !worktreeExisted;
  return { assignment, removed, left, rescued, rescueFailed, worktreeExisted, alreadyGone, branchKept: ctx.git.resolves(a.branch) };
}

/** What `release` tells the operator: one sentence per line, only what is true. */
export function releaseLines(r) {
  const x = r.assignment;
  const out = [`${x.id} is ${x.status}.`];
  if (x.detached) {
    // With no worktree there is nothing to say about a copy: a failed seating never made one.
    if (r.worktreeExisted) {
      out.push(
        r.branchKept
          ? `  It worked on a detached copy of ${x.branch}; that branch is untouched.`
          : `  It worked on a detached copy of ${x.branch}, which is not a branch or commit in this repository.`,
      );
    }
  } else {
    out.push(r.branchKept ? `  Its branch ${x.branch} is kept.` : `  Its branch ${x.branch} was never created, so there is no branch to keep.`);
  }
  if (r.rescued) {
    // On a failed retry the branch comes from an earlier release; this run saved nothing.
    out.push(
      r.rescueFailed
        ? `  Commits saved by an earlier release are on branch ${r.rescued}.`
        : `  Commits made in the detached copy were saved as branch ${r.rescued}.`,
    );
  }
  if (x.failed_step === 'worktree' && Array.isArray(x.may_remain) && x.may_remain.some((m) => m.startsWith('a herdr workspace'))) {
    // Seating failed while herdr was creating the worktree, before it gave crew a workspace id.
    out.push(`  crew never learned the id of the herdr workspace that seating may have opened. If one labelled "${x.agent}" is open in herdr, close it there.`);
    if (x.error_code === 'herdr_timeout') {
      out.push(`  herdr did not answer the worktree request and may still have been creating it when this release ran. If the worktree or branch ${x.branch} appears now, run release again.`);
    }
  }
  if (r.removed) {
    if (r.worktreeExisted) out.push('  The worktree was removed.');
    else if (r.alreadyGone) out.push(`  The worktree at ${x.worktree} was already removed, after the earlier release stopped waiting for herdr; the record now says so.`);
    else out.push(`  There was no worktree at ${x.worktree} to remove.`);
  } else {
    out.push(`  The worktree was left at ${x.worktree}:`);
    for (const line of r.left) out.push(`    ${line}`);
  }
  return out;
}

export function board(ctx) {
  requireHerdr(ctx);
  const trail = readTrail(ctx.mainDir);
  const byPane = new Map(ctx.herdr.listAgents().map((a) => [a.pane_id, a]));
  const rows = [];
  const needsRelease = [];
  for (const a of trail.assignments) {
    const live = a.pane ? byPane.get(a.pane) : null;
    if (ACTIVE.includes(a.status) && live) {
      rows.push({
        // true, false (never sent) or 'unconfirmed' (sent, not confirmed). An old record without it is not flagged.
        prompted: a.prompted === false || a.prompted === 'unconfirmed' ? a.prompted : true,
        agent: a.agent,
        role: a.role,
        state: live.state,
        status: a.status,
        brief: a.brief.split('\n')[0],
        branch: a.branch,
        id: a.id,
        created: a.created,
      });
    } else if (ACTIVE.includes(a.status) || a.status === 'failed') {
      needsRelease.push({ id: a.id, status: a.status });
    }
  }
  rows.sort((x, y) => (y.state === 'blocked') - (x.state === 'blocked') || String(x.created).localeCompare(String(y.created)));
  const roleOf = new Map(trail.assignments.map((a) => [a.id, a.role]));
  const handoffs = trail.handoffs
    .filter((h) => h.status === 'open')
    .map((h) => ({ id: h.id, from_role: roleOf.get(h.from) || h.from, to_role: h.to_role, brief: h.brief.split('\n')[0] }));
  const leftover = leftBehind(ctx, trail).map((a) => ({ id: a.id, status: a.status, worktree: a.worktree }));
  return { rows, handoffs, needsRelease, leftBehind: leftover, unreadable: trail.unreadable, conflicts: trail.conflicts };
}

function age(created, now) {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(created).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// A seated agent that may never have been told what to do must not look like any other row.
function statusCell(r) {
  if (r.status === 'reported' || r.prompted === true) return r.status;
  return `${r.status} (first prompt ${r.prompted === false ? 'not sent' : 'unconfirmed'})`;
}

export function renderBoard(b, now) {
  const out = [];
  if (b.rows.length === 0) {
    out.push('No crew agents are seated.');
  } else {
    const table = [
      ['AGENT', 'ROLE', 'STATE', 'STATUS', 'ASSIGNMENT', 'BRANCH', 'AGE'],
      ...b.rows.map((r) => [r.agent, r.role, r.state, statusCell(r), clip(r.brief, 32), clip(r.branch, 44), age(r.created, now)]),
    ];
    const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
    for (const row of table) {
      out.push(row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] + 2))).join(''));
    }
  }
  if (b.handoffs.length > 0) {
    out.push('', `Open handoffs: ${b.handoffs.length}`);
    for (const h of b.handoffs) out.push(`  ${h.from_role} → ${h.to_role}: "${clip(h.brief, 60)}"`);
  }
  if (b.needsRelease.length > 0) {
    out.push('', `Needs release: ${b.needsRelease.length}`);
    for (const a of b.needsRelease) {
      out.push(`  ${a.id} (${a.status === 'failed' ? 'seating failed' : `trail says ${a.status}, no live agent`})`);
    }
  }
  if (b.leftBehind.length > 0) {
    out.push('', `Worktrees left behind: ${b.leftBehind.length}`);
    for (const a of b.leftBehind) out.push(`  ${a.id} (${a.status}; its worktree is still at ${a.worktree})`);
  }
  if (b.conflicts?.length > 0) {
    out.push('', `Sync conflict copies: ${b.conflicts.length}`);
    for (const name of b.conflicts) out.push(`  ${name}`);
    out.push('  Syncthing kept these when two machines changed a trail file at once. They are not read as records; merge them by hand and delete them.');
  }
  if (b.unreadable.length > 0) out.push('', `Could not read: ${b.unreadable.join(', ')}`);
  return `${out.join('\n')}\n`;
}
