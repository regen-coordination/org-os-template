/**
 * B2 — lineage stamps.
 *
 * The machine-readable lineage contract (v3.5+, `scripts/validate-identity.mjs`):
 *   federation.yaml metadata.genesis_commit    40-hex, immutable, set at clone
 *   federation.yaml metadata.last_sync_commit  40-hex or null, set by sync
 *
 * The 2026-08-28 sweep found exactly one instance honouring it (bread-coop-os).
 * The rest carry *prose* pedigree instead — `metadata.scaffolded_from`, or an
 * `upstream[]` entry whose `relationship: fork` and date-shaped `last_sync`
 * describe a lineage no machine ever recorded. Reporting those as "no lineage"
 * would be wrong and would hide the real defect, which is that the fork is
 * real but **unstamped**. So they get their own finding.
 */

import { result, finding } from '../lib/finding.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * Human-readable lineage claims that carry no commit SHA.
 * @returns {string[]} descriptions of each claim found, empty when there are none
 */
export function prosePedigree(snapshot) {
  const fed = snapshot.federation;
  if (!fed) return [];
  const claims = [];

  const scaffolded = fed.metadata?.scaffolded_from;
  if (scaffolded) claims.push(`metadata.scaffolded_from: "${scaffolded}"`);

  const upstreams = Array.isArray(fed.upstream) ? fed.upstream : [];
  upstreams.forEach((u, i) => {
    if (!u || typeof u !== 'object') return;
    const forkish = u.relationship === 'fork' || u.type === 'template';
    // `last_sync` is a date field (often empty) — prose where a SHA belongs.
    const hasProseSync = Object.hasOwn(u, 'last_sync');
    if (forkish || hasProseSync) {
      const repo = u.repository || u.url || '(no repository)';
      claims.push(`upstream[${i}] declares ${u.relationship || u.type || 'a link'} of ${repo}`);
    }
  });

  return claims;
}

export function checkLineage(snapshot) {
  const findings = [];
  const fed = snapshot.federation;

  if (!fed) {
    return result('lineage', 'Lineage', [
      finding.blocker(
        'federation-missing',
        'federation.yaml is absent — the instance has nowhere to record its lineage',
        'this is not an org-os instance, or it was never scaffolded; `doctor sync` cannot run without it',
      ),
    ]);
  }

  const meta = fed.metadata || {};
  const genesis = meta.genesis_commit;
  const lastSync = meta.last_sync_commit;

  if (!genesis) {
    const claims = prosePedigree(snapshot);
    if (claims.length > 0) {
      findings.push(
        finding.warn(
          'unstamped-fork',
          `fork of the framework declared in prose but never stamped: ${claims.join('; ')}`,
          'run `doctor sync` — its lineage stage seeds genesis_commit from the root commit',
        ),
      );
    } else {
      findings.push(
        finding.warn(
          'lineage-absent',
          'metadata.genesis_commit is missing and no upstream pedigree is declared anywhere',
          'run `doctor sync` to establish and stamp the lineage',
        ),
      );
    }
  } else if (!SHA_RE.test(String(genesis))) {
    findings.push(
      finding.blocker(
        'genesis-commit-malformed',
        `metadata.genesis_commit "${genesis}" is not a 40-hex SHA`,
        'replace it with the instance root commit: git rev-list --max-parents=0 HEAD',
      ),
    );
  }

  if (lastSync === null || lastSync === undefined) {
    findings.push(
      finding.warn(
        'never-synced',
        'metadata.last_sync_commit is null — this instance has never completed a framework sync',
        'run `doctor sync` to perform the first sync and record the stamp',
      ),
    );
  } else if (!SHA_RE.test(String(lastSync))) {
    findings.push(
      finding.blocker(
        'last-sync-commit-malformed',
        `metadata.last_sync_commit "${lastSync}" is not a 40-hex SHA (a date belongs in last_updated, not here)`,
        'set it to null and let `doctor sync` record the real commit',
      ),
    );
  } else if (typeof snapshot.commitsBehindFramework === 'number' && snapshot.commitsBehindFramework > 0) {
    const n = snapshot.commitsBehindFramework;
    findings.push(
      finding.warn(
        'sync-stale',
        `${n} commit${n === 1 ? '' : 's'} on the framework since last_sync_commit ${String(lastSync).slice(0, 12)}`,
        'run `doctor sync` to catch up',
      ),
    );
  }

  return result('lineage', 'Lineage', findings);
}
