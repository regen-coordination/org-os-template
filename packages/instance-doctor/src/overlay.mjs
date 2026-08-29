/**
 * overlay.mjs — the file-level sync that replaces the history-based one.
 *
 * `scripts/sync-upstream.mjs` stage 5 runs `git pull --rebase upstream main`,
 * which assumes the instance is a *fork* of the framework. Every real instance
 * is a *scaffold* with its own root commit (seven-for-seven, verified during
 * the v0.5 fleet sweep), so that rebase replays the instance's entire history
 * onto the framework's, conflicts on essentially every shared filename, and
 * leaves the repository mid-rebase. It did that to refi-med-os on 2026-08-28,
 * and it is why v0.5.0 shipped with its sync claim narrowed to `assess` +
 * `sync --dry-run`.
 *
 * The overlay is the honest primitive for a scaffolded instance:
 *
 *   - copy the framework-owned paths in (the machinery an instance needs to
 *     operate and update itself),
 *   - leave every path the organization owns untouched,
 *   - never delete — the overlay cannot tell an operator's own script from one
 *     the framework removed, so it only adds and updates,
 *   - and let the lineage stamp record which framework commit was applied.
 *     Git history is not the carrier between framework and instance; the stamp
 *     is. `genesis_commit` already worked this way.
 *
 * This module is the pure half — it plans, it does not touch the disk. The
 * effectful half is the `overlay` stage in run-sync.mjs, which takes the
 * injectable `io` bag.
 */

/**
 * Path prefixes the FRAMEWORK owns. These are machinery: an instance runs them
 * but does not author them, so the framework's copy wins.
 *
 * Deliberately narrow. Everything not listed here is left alone, which means a
 * new framework directory is invisible to the overlay until someone adds it on
 * purpose — the safe direction to be wrong.
 */
export const FRAMEWORK_OWNED = ['scripts/', 'templates/'];

/**
 * Paths the INSTANCE owns. The framework repository is itself a running
 * instance, so its tree genuinely contains `data/members.yaml`, `memory/`, a
 * populated `.well-known/` and its own identity files. A naive tree copy would
 * paste the framework's organization over the operator's — the same identity
 * leak the clone engine had, arriving as a sync instead.
 *
 * This list is belt-and-braces: nothing here starts with a FRAMEWORK_OWNED
 * prefix, so it is unreachable by construction. It exists so the intent is
 * explicit and testable rather than an emergent property of the other list.
 */
export const INSTANCE_OWNED = [
  'data/',
  'memory/',
  '.well-known/',
  'repos/',
  'knowledge/',
  'IDENTITY.md',
  'SOUL.md',
  'MASTERPLAN.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
  'DECISIONS.md',
  'README.md',
  'CHANGELOG.md',
  'federation.yaml',
  'package.json',
];

const matches = (path, prefixes) =>
  prefixes.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));

/** True when the framework's copy of `path` should win. */
export function isFrameworkOwned(path) {
  return matches(path, FRAMEWORK_OWNED) && !matches(path, INSTANCE_OWNED);
}

/** True when `path` belongs to the organization and must never be written. */
export function isInstanceOwned(path) {
  return matches(path, INSTANCE_OWNED);
}

/**
 * Plan the overlay.
 *
 * @param {Map<string,string>} frameworkFiles repo-relative path → content
 * @param {Map<string,string>} instanceFiles  repo-relative path → content
 * @returns {{actions: Array<{path: string, action: 'add'|'update'|'unchanged', content?: string}>,
 *            summary: {add: number, update: number, unchanged: number},
 *            removed: string[], changed: boolean, skipped: string[]}}
 */
export function overlayPlan({ frameworkFiles, instanceFiles }) {
  const actions = [];
  const skipped = [];

  for (const [path, content] of frameworkFiles) {
    if (!isFrameworkOwned(path)) {
      // Not ours to carry: either the organization owns it, or it is framework
      // content outside the declared machinery set.
      skipped.push(path);
      continue;
    }
    if (!instanceFiles.has(path)) {
      actions.push({ path, action: 'add', content });
    } else if (instanceFiles.get(path) !== content) {
      actions.push({ path, action: 'update', content });
    } else {
      actions.push({ path, action: 'unchanged' });
    }
  }

  const summary = {
    add: actions.filter((a) => a.action === 'add').length,
    update: actions.filter((a) => a.action === 'update').length,
    unchanged: actions.filter((a) => a.action === 'unchanged').length,
  };

  return {
    actions,
    summary,
    // The overlay adds and updates. It never deletes: an instance-only file in
    // a framework-owned directory is the operator's own tool, and we cannot
    // distinguish it from a file the framework dropped.
    removed: [],
    skipped,
    changed: summary.add + summary.update > 0,
    instanceFilesWritten: actions.filter((a) => isInstanceOwned(a.path)).length,
  };
}
