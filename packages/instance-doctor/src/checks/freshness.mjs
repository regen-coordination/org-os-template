/**
 * B6 — freshness.
 *
 * Purely diagnostic: nothing here ever blocks. It answers "is anyone actually
 * running this instance, and is it safe to sync right now" — the dirty-tree
 * count matters because `sync-upstream.mjs` stage 1 refuses to run on a dirty
 * working tree, so an operator should learn that before starting a sync rather
 * than three stages in.
 */

import { result, finding } from '../lib/finding.mjs';

const DORMANT_DAYS = 90;
const MEMORY_STALE_DAYS = 60;

function ageInDays(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86400_000);
}

export function checkFreshness(snapshot) {
  const findings = [];
  const now = snapshot.now ?? Date.now();

  const commitAge = ageInDays(snapshot.git?.lastCommitISO, now);
  if (commitAge !== null && commitAge > DORMANT_DAYS) {
    findings.push(
      finding.warn(
        'repo-dormant',
        `last commit was ${commitAge} days ago — nobody has worked in this instance for over ${DORMANT_DAYS} days`,
        'confirm the instance is still live before syncing framework changes into it',
      ),
    );
  }

  const dirty = snapshot.git?.dirtyCount ?? 0;
  if (dirty > 0) {
    findings.push(
      finding.warn(
        'working-tree-dirty',
        `${dirty} uncommitted change(s) in the working tree`,
        'sync only refuses when an uncommitted change collides with a file it would overwrite; it names them if so (`doctor sync --dry-run` is safe either way)',
      ),
    );
  }

  const memoryAge = ageInDays(snapshot.memoryLatestISO, now);
  if (snapshot.memoryLatestISO === null || snapshot.memoryLatestISO === undefined) {
    findings.push(
      finding.warn(
        'memory-absent',
        'no dated memory log found — the instance has no recorded operating history',
        'sessions should write memory/YYYY-MM-DD.md; see AGENTS.md',
      ),
    );
  } else if (memoryAge !== null && memoryAge > MEMORY_STALE_DAYS) {
    findings.push(
      finding.warn(
        'memory-stale',
        `newest memory entry is ${memoryAge} days old`,
        'the instance may be dormant, or sessions are not closing properly',
      ),
    );
  }

  const receipts = snapshot.syncReceipts ?? [];
  if (receipts.length === 0) {
    findings.push(
      finding.warn(
        'no-sync-receipts',
        'no sync receipts — this instance has no evidence of ever having been synced from the framework',
        '`doctor sync` writes a dated receipt on every run',
      ),
    );
  }

  return result('freshness', 'Freshness', findings);
}
