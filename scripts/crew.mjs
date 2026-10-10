#!/usr/bin/env node
// scripts/crew.mjs — seat, coordinate and release role-based agents in herdr panes.
//
// Operator guide: docs/CREW.md. Design: docs/superpowers/specs/2026-10-10-org-os-crew-design.md.
// All rules live in scripts/crew/core.mjs; this file parses arguments and wires
// the real herdr and git adapters to it.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { board, closeHandoff, handoff, nudge, release, renderBoard, report, seat } from './crew/core.mjs';
import { createGit } from './crew/git.mjs';
import { createHerdr, HerdrError } from './crew/herdr.mjs';
import { CrewError } from './crew/roles.mjs';

const USAGE = `Usage: npm run crew -- <command>

  board [--json]                                Show seated agents, open handoffs, what needs attention (default)
  seat <role> "<brief>" [--task <id>] [--base <ref>] [--on <branch>] [--handoff <id|file>]
                                                Seat an agent in a role, in its own worktree
  nudge <agent|assignment>                      Send the first prompt to an agent that stopped at a startup dialog
  release <agent|assignment> [--outcome done|abandoned]
                                                Close an assignment; remove its worktree if it has no changes
  report [--file <path>]                        (agents) Append a report to your assignment; reads stdin without --file
  handoff <role> "<brief>" [--branch <branch>]  (agents) Ask another role to take something on
  handoff-close <id|file> --reason "<text>"     Decline an open handoff
`;

class UsageError extends Error {}

// Paths are compared as prefixes, so both sides must be spelled the same way:
// absolute, with symlinks resolved when the directory exists.
function real(path) {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        task: { type: 'string' },
        base: { type: 'string' },
        on: { type: 'string' },
        handoff: { type: 'string' },
        outcome: { type: 'string' },
        branch: { type: 'string' },
        reason: { type: 'string' },
        file: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  const [command = 'board', first, ...rest] = positionals;
  const need = (value, message) => {
    if (!value) throw new UsageError(message);
    return value;
  };

  const mainDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const git = createGit(mainDir);
  const ctx = {
    mainDir,
    repoDir: git.primaryCheckout(),
    herdr: createHerdr(),
    git,
    env: process.env,
    cwd: real(process.cwd()),
    now: () => new Date(),
    worktreeRoot: real(process.env.ORG_OS_WORKTREES || join(homedir(), '.org-os', 'worktrees')),
    scriptPath: join(mainDir, 'scripts', 'crew.mjs'),
  };

  switch (command) {
    case 'board': {
      const b = board(ctx);
      process.stdout.write(values.json ? `${JSON.stringify(b, null, 2)}\n` : renderBoard(b, ctx.now()));
      return;
    }
    case 'seat': {
      need(first, 'seat needs a role: seat <role> "<brief>".');
      const a = seat(ctx, {
        roleId: first,
        brief: rest.join(' '),
        task: values.task ?? null,
        base: values.base ?? 'main',
        on: values.on ?? null,
        handoff: values.handoff ?? null,
      });
      console.log(`Seated ${a.agent} as ${a.role}.`);
      console.log(`  assignment  ${a.id}`);
      console.log(`  branch      ${a.branch}${a.detached ? ' (detached copy)' : ''}`);
      console.log(`  worktree    ${a.worktree}`);
      if (!a.prompted) {
        console.log(`  ${a.agent} has not been given its first prompt. Answer any dialog in its pane, then run: npm run crew -- nudge ${a.agent}`);
      }
      return;
    }
    case 'nudge': {
      const a = nudge(ctx, { target: need(first, 'nudge needs an agent name or assignment id.') });
      console.log(`Sent the first prompt to ${a.agent}.`);
      return;
    }
    case 'release': {
      const r = release(ctx, {
        target: need(first, 'release needs an agent name or assignment id.'),
        outcome: values.outcome ?? 'done',
      });
      console.log(
        r.assignment.detached
          ? `${r.assignment.id} is ${r.assignment.status}. It worked on a detached copy of ${r.assignment.branch}; that branch is untouched.`
          : `${r.assignment.id} is ${r.assignment.status}. Its branch ${r.assignment.branch} is kept.`,
      );
      if (r.rescued) console.log(`  Commits made in the detached copy were saved as branch ${r.rescued}.`);
      if (r.removed) {
        console.log('  The worktree was removed.');
      } else {
        console.log(`  The worktree was left at ${r.assignment.worktree}:`);
        for (const line of r.left) console.log(`    ${line}`);
      }
      return;
    }
    case 'report': {
      const text = values.file ? readFileSync(values.file, 'utf-8') : process.stdin.isTTY ? '' : readFileSync(0, 'utf-8');
      const a = report(ctx, { text });
      console.log(`Report recorded on ${a.id}.`);
      return;
    }
    case 'handoff': {
      need(first, 'handoff needs a role: handoff <role> "<brief>".');
      const h = handoff(ctx, { toRole: first, brief: rest.join(' '), branch: values.branch ?? null });
      console.log(`Handoff ${h.id} is open for the ${h.to_role} role.`);
      return;
    }
    case 'handoff-close': {
      const h = closeHandoff(ctx, {
        target: need(first, 'handoff-close needs a handoff id or file.'),
        reason: values.reason ?? '',
      });
      console.log(`Handoff ${h.id} is declined.`);
      return;
    }
    default:
      throw new UsageError(`Unknown command "${command}".`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    process.stderr.write(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (err instanceof CrewError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  if (err instanceof HerdrError) {
    process.stderr.write(`herdr could not do that: ${err.message} (${err.code}).\n`);
    process.exit(1);
  }
  throw err;
}
