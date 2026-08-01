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
 * DESIGN TRADEOFF — deliberate over-matching:
 * We do NOT parse shell grammar. Quoting, `sh -c`, `env`, `xargs`, command
 * substitution, aliases and heredocs make a correct parser a losing game, and
 * a parser that is 95% correct is a boundary with a 5% hole. Instead we run
 * conservative regexes over the WHOLE command string, so chaining (`;`, `&&`,
 * `|`), wrappers and inserted git global options are all caught regardless of
 * token order. The cost is false positives: `git log --grep=stash` or
 * `git commit -m "clean up"` get blocked even though they are harmless. That
 * is the right way to be wrong here — a false block costs one rephrase, a
 * false allow costs irreplaceable user notes. Everything below fails closed.
 */

const BLOCK = 2;
const ALLOW = 0;

// `git` as its own token: matches `git`, `/usr/bin/git`, `.git`, `git-stash`;
// does not match `digit`, `legit`, `github.com`.
const GIT = /\bgit\b/;
const STASH = /\bstash\b/;
const CLEAN = /\bclean\b/;
const RESET = /\breset\b/;
// `--hard` plus every unambiguous abbreviation git itself accepts for it
// (`git reset --ha` is exactly as destructive as `git reset --hard`).
// Deliberately does not match `--help` or `--hard-<something>`.
const HARD = /--h(?:a(?:r(?:d)?)?)?(?![\w-])/;

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

function verdict(command) {
  if (!GIT.test(command)) return null;
  if (STASH.test(command)) return 'destructive git operation: `stash` (discards/relocates uncommitted work)';
  if (CLEAN.test(command)) return 'destructive git operation: `clean` (deletes untracked files)';
  if (RESET.test(command) && HARD.test(command)) {
    return 'destructive git operation: `reset --hard` (discards uncommitted work)';
  }
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

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
