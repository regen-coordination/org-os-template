#!/usr/bin/env node
/**
 * deny-destructive-git.mjs — PreToolUse guard blocking destructive git ops.
 *
 * Wired from .claude/settings.json as a PreToolUse hook on the Bash tool, so
 * it sees the *actual command string* Claude is about to run. That is the
 * whole point: `permissions.deny` entries like `Bash(git stash:*)` are prefix
 * matches and are trivially evaded by inserting a git global option —
 * `git -c core.pager=cat stash list` and `git reset -q --hard` both sail
 * straight through the deny-list. This repo lives beside an Obsidian vault
 * whose untracked notes have been destroyed by exactly these commands before,
 * so the deny-list alone is not an acceptable boundary. The deny-list stays as
 * cheap defense-in-depth; this guard is the enforcement.
 *
 * Contract (Claude Code 2.1.x — https://code.claude.com/docs/en/hooks):
 *   stdin  = JSON { session_id, hook_event_name, tool_name, tool_input, ... }
 *            for Bash, tool_input.command is the command string
 *   exit 2 = BLOCK the tool call; stderr is fed back to the model
 *   exit 0 = no decision; normal permission flow continues
 *   exit 1 = non-blocking error (i.e. the command still runs) — never used here
 *
 * DESIGN TRADEOFF — conservative matching, in *subcommand position*:
 * We still do NOT parse shell grammar. Quoting, `sh -c`, `env`, `xargs`,
 * command substitution, aliases and heredocs make a correct parser a losing
 * game, and a parser that is 95% correct is a boundary with a 5% hole. What we
 * do instead is coarse splitting: quotes are dissolved, `;` `&&` `|` cut the
 * string into invocations, and in each one every token that *is* the git
 * binary (`git`, `/usr/bin/git`, `./git`) is examined. Global options are
 * skipped the way git itself skips them, and the first non-option token is
 * taken as the subcommand. Chaining, wrappers and inserted global options are
 * therefore all still caught regardless of token order.
 *
 * The one thing that changed (2026-08-28, masterplan WS-A A6): we no longer
 * block on the *bare word* `clean`/`stash` appearing anywhere in a command that
 * also mentions git. `\bclean\b` treats `-` and `/` as word boundaries, so
 * `git add memory/reports/clean-room-bootstrap-2026-08-21.md` and
 * `grep -rn clean scripts/git-hooks/` were blocked — observed twice on
 * 2026-08-28, and the reason six release handoffs had to teach a
 * `git commit -F <file>` workaround. Matching in subcommand position keeps
 * every destructive spelling blocked while letting those through.
 *
 * The fail-closed posture is untouched, and is if anything wider:
 *   - dashed invocations (`git-clean`, `git-stash`, and path-prefixed forms
 *     like `/usr/libexec/git-core/git-clean`) are blocked outright;
 *   - a subcommand slot we cannot resolve because it is a shell expansion
 *     (`git $CMD`, `git $(echo clean)`) is blocked rather than guessed;
 *   - any unexpected failure inside this guard blocks.
 * False positives remain the acceptable direction to be wrong: a false block
 * costs one rephrase, a false allow costs irreplaceable user notes.
 */

const BLOCK = 2;
const ALLOW = 0;

// The git binary as an argv[0]: `git`, `/usr/bin/git`, `./git`.
// Deliberately does NOT match `.git` (as in `ls -la .git/hooks`), `digit`,
// `legit`, `github.com`, or a directory like `scripts/git-hooks/`.
const GIT_BINARY = /^(?:.*\/)?git$/;

// The dashed binaries git installs in libexec. These ARE the destructive
// commands, so they stay blocked even though `-` is no longer a boundary.
const GIT_DASHED_DESTRUCTIVE = /^(?:.*\/)?git-(clean|stash)$/;

// git global options that consume the FOLLOWING token as their argument.
// Attached forms (`--git-dir=/tmp/x/.git`) carry their own value and are
// handled by the generic "starts with -" skip.
const OPT_WITH_ARG = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
  '--config-env',
]);

// A subcommand slot containing a shell expansion cannot be resolved statically.
const EXPANSION = /\$/;

// `--hard` plus every unambiguous abbreviation git itself accepts for it
// (`git reset --ha` is exactly as destructive as `git reset --hard`).
// Deliberately does not match `--help` or `--hard-<something>`.
const HARD = /^--h(?:a(?:r(?:d)?)?)?$/;

/**
 * Coarse split into invocations, each a token array. Quotes are dissolved —
 * they never bind tokens together for our purposes, so `sh -c 'git stash'`
 * still exposes `git` then `stash`. Grouping characters are dropped so that
 * `$(git rev-list ...)` exposes its inner command. `;` `&&` `||` `|` cut
 * invocations apart so `git status && git clean -fd` is seen as two.
 */
function invocations(command) {
  return command
    .replace(/[`'"]/g, ' ')
    .replace(/[()<>{}]/g, ' ')
    .split(/[;&|]+/)
    .map((part) => part.split(/\s+/).filter(Boolean));
}

/**
 * Given the index of a git binary token, return the index of its subcommand,
 * skipping global options exactly as git does. Returns -1 when the invocation
 * has no subcommand at all (`git --version`, or a trailing bare `git`).
 */
function subcommandIndex(tokens, gitIndex) {
  let i = gitIndex + 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith('-')) return i;
    i += OPT_WITH_ARG.has(token) ? 2 : 1;
  }
  return -1;
}

function verdict(command) {
  for (const tokens of invocations(command)) {
    for (let i = 0; i < tokens.length; i++) {
      const dashed = tokens[i].match(GIT_DASHED_DESTRUCTIVE);
      if (dashed) {
        return dashed[1] === 'clean'
          ? 'destructive git operation: `git-clean` (deletes untracked files)'
          : 'destructive git operation: `git-stash` (discards/relocates uncommitted work)';
      }

      if (!GIT_BINARY.test(tokens[i])) continue;

      const subIndex = subcommandIndex(tokens, i);
      if (subIndex === -1) continue;
      const sub = tokens[subIndex];

      if (EXPANSION.test(sub)) {
        return `git subcommand is a shell expansion (\`${sub}\`) and cannot be inspected`;
      }
      if (sub === 'stash') {
        return 'destructive git operation: `stash` (discards/relocates uncommitted work)';
      }
      if (sub === 'clean') {
        return 'destructive git operation: `clean` (deletes untracked files)';
      }
      if (sub === 'reset' && tokens.slice(subIndex + 1).some((t) => HARD.test(t))) {
        return 'destructive git operation: `reset --hard` (discards uncommitted work)';
      }
    }
  }

  return null;
}

function block(reason) {
  process.stderr.write(
    `BLOCKED by the org-os vault-safety guard (scripts/guards/deny-destructive-git.mjs): ${reason}\n` +
      'This repo sits beside an Obsidian vault full of untracked, irreplaceable notes; ' +
      '`git stash`, `git clean` and `git reset --hard` have destroyed user content here before. ' +
      'Do not attempt to work around this guard. Use `npm run vault:snapshot` to checkpoint, ' +
      'commit what is coherent, or revert file-by-file instead.\n',
  );
  process.exit(BLOCK);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// This file is deliberately a single self-contained script with no exports and
// no "am I the main module?" branch. `packages/multica-bridge/docs/SETUP.md`
// tells operators to copy exactly this file (plus .claude/settings.json) into
// each new instance, and a main-module check would be one more way for the
// boundary to silently become a no-op. The suite in
// tests/guards/deny-destructive-git.test.mjs therefore drives it as a
// subprocess, which is also the only thing that proves the real exit codes.
try {
  const raw = await readStdin();

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Fail closed: if we cannot read the payload we cannot clear the command.
    block('hook payload was not valid JSON, so the command could not be inspected');
  }

  // Configured with matcher "Bash", but be explicit rather than trusting it.
  if (payload?.tool_name !== 'Bash') process.exit(ALLOW);

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') {
    block('Bash tool call carried no inspectable `tool_input.command` string');
  }

  const reason = verdict(command);
  if (reason) block(`${reason} — refused command: ${command}`);

  process.exit(ALLOW);
} catch (err) {
  // Any unexpected failure in the guard itself must not open the boundary.
  block(`guard failed to evaluate the command (${err?.message ?? err})`);
}
