/**
 * run-sync.mjs — the effectful half of `doctor sync` (B8) and the containment
 * rule that governs it (B9).
 *
 * Stages run in the order planSync() declares. The first failure stops forward
 * motion: every later stage is recorded as `skipped`, nothing is re-stamped,
 * and the receipt names the stage that stopped it. That is the whole point —
 * a partially-migrated instance is worse than an unsynced one, because it looks
 * synced.
 *
 * The one thing that always happens first is the snapshot. Even when the run
 * aborts immediately afterwards (a dirty working tree), the operator is left
 * with a recoverable ref.
 */

import path from 'node:path';

import { CANONICAL_MACHINERY, CANONICAL_UPSTREAM_URL, normalizeRepoUrl, CANONICAL_UPSTREAM_SLUG } from './checks/machinery.mjs';
import { planSync, renderReceipt, restampVersionSurfaces, stampLineage } from './sync.mjs';

/** Where a receipt lands. `memory/reports/` matches the framework's convention. */
export function receiptPathFor(dir, today) {
  return path.join(dir, 'memory', 'reports', `sync-receipt-${today}.md`);
}

/**
 * @param {object} snapshot   from readInstance()
 * @param {object} opts
 * @param {boolean} [opts.dryRun]      print the plan, touch nothing
 * @param {string}  [opts.upstreamUrl] override the canonical URL (tests, forks)
 * @param {object} io                  see io.mjs
 */
export function runSync(snapshot, opts = {}, io) {
  const plan = planSync(snapshot);
  const today = io.today();
  const dir = snapshot.dir;
  const upstreamUrl = opts.upstreamUrl ?? CANONICAL_UPSTREAM_URL;

  if (opts.dryRun) {
    const stages = plan.map((s) => ({ ...s, status: 'planned' }));
    return {
      dryRun: true,
      aborted: false,
      abortStage: null,
      stages,
      receiptPath: null,
      receipt: renderReceipt({
        name: snapshot.name,
        today,
        frameworkVersion: snapshot.framework?.version,
        frameworkHead: snapshot.framework?.headSha,
        stages,
        aborted: false,
        dryRun: true,
      }),
    };
  }

  const results = [];
  let aborted = false;
  let abortStage = null;
  let reassess = null;
  let lastSyncCommit = null;

  // Carried between the migrate and receipt stages so federation.yaml is
  // written once, with both the re-stamp and the lineage stamp applied.
  let federationRaw = snapshot.federationRaw ?? io.readText(path.join(dir, 'federation.yaml'));

  const handlers = {
    snapshot() {
      // The safe primitive: this writes a commit object and prints its hash
      // without touching the working tree, the index, or the stash list. Same
      // one scripts/vault-snapshot.mjs uses, reimplemented here because the
      // target instances do not carry that script.
      const created = io.git(dir, ['stash', 'create', '-u', '-m', 'doctor sync']);
      if (!created.ok) {
        return { status: 'failed', detail: `could not snapshot the working tree: ${created.out}` };
      }

      // An empty result means the tree matches HEAD. Point the ref at HEAD
      // anyway, so "there is always a recovery point" holds without exception.
      let target = created.out;
      let note = '';
      if (!target) {
        const head = io.git(dir, ['rev-parse', 'HEAD']);
        if (!head.ok) return { status: 'failed', detail: `could not resolve HEAD: ${head.out}` };
        target = head.out;
        note = ' (tree matches HEAD)';
      }

      const ref = `refs/snapshots/${io.timestamp()}-doctor-sync`;
      const updated = io.git(dir, ['update-ref', ref, target]);
      if (!updated.ok) return { status: 'failed', detail: `could not write ${ref}: ${updated.out}` };

      const detail = `snapshot ref ${ref}${note}`;

      // sync-upstream refuses on a dirty tree (its stage 1). Failing here, with
      // the snapshot already safely written, beats failing four stages later.
      const dirty = snapshot.git?.dirtyCount ?? 0;
      if (dirty > 0) {
        return {
          status: 'failed',
          detail: `${detail} — but the working tree has ${dirty} uncommitted change(s), and sync refuses to run on a dirty tree. Commit or discard them, then re-run.`,
        };
      }
      return { status: 'ok', detail };
    },

    'ensure-upstream'() {
      const current = snapshot.git?.remotes?.upstream ?? null;
      if (!current) {
        const r = io.git(dir, ['remote', 'add', 'upstream', upstreamUrl]);
        return r.ok
          ? { status: 'ok', detail: `added upstream → ${upstreamUrl}` }
          : { status: 'failed', detail: r.out };
      }
      const slug = normalizeRepoUrl(current);
      const wanted = normalizeRepoUrl(upstreamUrl);
      if (slug === wanted || slug === CANONICAL_UPSTREAM_SLUG) {
        return { status: 'ok', detail: `upstream already canonical (${current})` };
      }
      const r = io.git(dir, ['remote', 'set-url', 'upstream', upstreamUrl]);
      return r.ok
        ? { status: 'ok', detail: `rewrote upstream from ${current} to ${upstreamUrl}` }
        : { status: 'failed', detail: r.out };
    },

    fetch() {
      const r = io.git(dir, ['fetch', 'upstream', '--quiet']);
      return r.ok ? { status: 'ok', detail: 'fetched upstream' } : { status: 'failed', detail: r.out };
    },

    'inject-machinery'() {
      const copied = [];
      for (const rel of CANONICAL_MACHINERY) {
        const from = path.join(snapshot.framework.dir, rel);
        if (!io.exists(from)) continue;
        io.copy(from, path.join(dir, rel));
        copied.push(rel);
      }
      return copied.length > 0
        ? { status: 'ok', detail: `installed ${copied.join(', ')}` }
        : { status: 'failed', detail: 'the framework checkout carries none of the sync machinery' };
    },

    'sync-upstream'() {
      const r = io.run('node', ['scripts/sync-upstream.mjs', '--yes'], dir);
      return r.ok ? { status: 'ok', detail: r.out || 'sync-upstream completed' } : { status: 'failed', detail: r.out };
    },

    migrate() {
      const migrated = io.run('npm', ['run', 'migrate', '--if-present'], dir);
      if (!migrated.ok) return { status: 'failed', detail: `migrate failed: ${migrated.out}` };

      // The cross-scheme re-stamp. Without it the final re-assess fails B3:
      // the instance would still claim framework 3.0 after syncing a 0.5 one.
      const restamped = restampVersionSurfaces(
        {
          federationRaw,
          versionMd: snapshot.versionMd ?? io.readText(path.join(dir, 'VERSION.md')),
          packageJson: snapshot.packageJson,
          packageJsonRaw: snapshot.packageJsonRaw ?? io.readText(path.join(dir, 'package.json')),
        },
        snapshot.framework.version,
      );

      if (restamped.federationRaw !== null) federationRaw = restamped.federationRaw;
      if (restamped.changed.includes('federation.yaml')) {
        io.writeText(path.join(dir, 'federation.yaml'), restamped.federationRaw);
      }
      if (restamped.changed.includes('VERSION.md')) {
        io.writeText(path.join(dir, 'VERSION.md'), restamped.versionMd);
      }
      if (restamped.changed.includes('package.json')) {
        io.writeText(path.join(dir, 'package.json'), restamped.packageJsonRaw);
      }

      return {
        status: 'ok',
        detail: restamped.changed.length
          ? `migrations applied; re-stamped ${restamped.changed.join(', ')} to ${snapshot.framework.version}`
          : 'migrations applied; version surfaces already current',
      };
    },

    'generate-schemas'() {
      const r = io.run('npm', ['run', 'generate:schemas', '--if-present'], dir);
      return r.ok
        ? { status: 'ok', detail: 'schemas regenerated' }
        : { status: 'failed', detail: `generate:schemas failed: ${r.out}` };
    },

    're-assess'() {
      reassess = io.reassess(dir);
      if (!reassess) return { status: 'failed', detail: 'the re-assessment produced no result' };
      if (reassess.summary.blockers > 0) {
        return {
          status: 'failed',
          detail: `the instance still has ${reassess.summary.blockers} blocker(s) after syncing — see the scorecard`,
        };
      }
      return {
        status: 'ok',
        detail: `${reassess.status} — ${reassess.summary.blockers} blocker(s), ${reassess.summary.warnings} warning(s)`,
      };
    },

    receipt() {
      const head = snapshot.framework?.headSha ?? null;
      if (federationRaw && head) {
        const rootCommits = io.git(dir, ['rev-list', '--max-parents=0', 'HEAD']);
        const genesis = rootCommits.ok ? rootCommits.out.split('\n').pop().trim() : null;
        federationRaw = stampLineage(federationRaw, {
          genesisCommit: genesis,
          lastSyncCommit: head,
          today,
        });
        io.writeText(path.join(dir, 'federation.yaml'), federationRaw);
        lastSyncCommit = head;
      }
      return { status: 'ok', detail: `stamped last_sync_commit ${String(head ?? '').slice(0, 12)}` };
    },
  };

  for (const stage of plan) {
    if (aborted) {
      results.push({ ...stage, status: 'skipped', detail: `skipped — aborted at \`${abortStage}\`` });
      continue;
    }
    // The receipt stage is bookkeeping; it runs even after an abort so the
    // abort itself is recorded. Everything else is gated.
    const outcome = handlers[stage.id]();
    results.push({ ...stage, status: outcome.status, detail: outcome.detail });
    if (outcome.status === 'failed') {
      aborted = true;
      abortStage = stage.id;
    }
  }

  const receipt = renderReceipt({
    name: snapshot.name,
    today,
    frameworkVersion: snapshot.framework?.version,
    frameworkHead: snapshot.framework?.headSha,
    stages: results,
    aborted,
    abortStage,
    lastSyncCommit,
    reassess,
  });

  const receiptPath = receiptPathFor(dir, today);
  io.writeText(receiptPath, receipt);

  return { dryRun: false, aborted, abortStage, stages: results, reassess, receiptPath, receipt };
}
