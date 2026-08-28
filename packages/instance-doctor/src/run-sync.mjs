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
import {
  planSync,
  reconcileDeclaredUpstream,
  renderReceipt,
  restampVersionSurfaces,
  stampLineage,
} from './sync.mjs';

/** Where a receipt lands. `memory/reports/` matches the framework's convention. */
export function receiptPathFor(dir, today) {
  return path.join(dir, 'memory', 'reports', `sync-receipt-${today}.md`);
}

const RECEIPT_RE = /^memory\/reports\/sync-receipt-\d{4}-\d{2}-\d{2}\.md$/;

/** Paths `doctor sync` writes itself: the machinery it installs and its receipts. */
export function isDoctorOwnedPath(rel) {
  return CANONICAL_MACHINERY.includes(rel) || RECEIPT_RE.test(rel);
}

/**
 * The path out of one `git status --porcelain` line.
 *
 * Deliberately does NOT slice a fixed offset. Porcelain's status column is two
 * characters wide and often begins with a space (` M path`), and every helper
 * here receives output that has been trimmed — which silently eats that leading
 * space on the FIRST line only, so a fixed offset cuts one character off exactly
 * one path per run. That bug made the doctor read its own file as an operator's
 * uncommitted work. Matching the status token instead survives both forms.
 */
export function porcelainPath(line) {
  const rel = String(line).replace(/^[ MADRCU?!]{1,2}\s+/, '');
  // Renames read "old -> new"; the destination is the path that exists now.
  return rel.split(' -> ').pop().replace(/^"|"$/g, '').trim();
}

/**
 * Working-tree entries that are NOT the doctor's own output.
 *
 * A previous aborted run leaves injected machinery and its receipt behind. If
 * those counted as "dirty", the doctor could never retry after its own abort —
 * its debris would block it forever. Operator changes still block, which is the
 * point: sync must not run over work someone has not committed.
 *
 * @param {string} porcelain output of `git status --porcelain -uall`
 * @returns {string[]} the offending entries, verbatim
 */
export function foreignDirtyEntries(porcelain) {
  return (porcelain || '')
    .split('\n')
    .filter(Boolean)
    .filter((line) => !isDoctorOwnedPath(porcelainPath(line)));
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
      //
      // Read fresh rather than trusting the pre-run snapshot, and ignore the
      // doctor's own artifacts — otherwise the debris of an aborted run blocks
      // every retry.
      const status = io.git(dir, ['status', '--porcelain', '-uall']);
      const foreign = status.ok ? foreignDirtyEntries(status.out) : [];
      if (foreign.length > 0) {
        const shown = foreign.slice(0, 5).join(', ');
        const more = foreign.length > 5 ? `, +${foreign.length - 5} more` : '';
        return {
          status: 'failed',
          detail: `${detail} — but the working tree has ${foreign.length} uncommitted change(s) that are not the doctor's own (${shown}${more}), and sync refuses to run over uncommitted work. Commit or discard them, then re-run.`,
        };
      }
      return { status: 'ok', detail };
    },

    'ensure-upstream'() {
      const notes = [];

      // 1. The git remote — what fetch and pull actually use.
      const current = snapshot.git?.remotes?.upstream ?? null;
      if (!current) {
        const r = io.git(dir, ['remote', 'add', 'upstream', upstreamUrl]);
        if (!r.ok) return { status: 'failed', detail: r.out };
        notes.push(`added remote upstream → ${upstreamUrl}`);
      } else {
        const slug = normalizeRepoUrl(current);
        const wanted = normalizeRepoUrl(upstreamUrl);
        if (slug === wanted || slug === CANONICAL_UPSTREAM_SLUG) {
          notes.push(`remote already canonical (${current})`);
        } else {
          const r = io.git(dir, ['remote', 'set-url', 'upstream', upstreamUrl]);
          if (!r.ok) return { status: 'failed', detail: r.out };
          notes.push(`rewrote remote from ${current} to ${upstreamUrl}`);
        }
      }

      // 2. The DECLARATION in federation.yaml — what sync-upstream.mjs reads.
      // Repairing only the remote leaves sync-upstream unable to run at all
      // when the declaration lacks a `url` key (the refi-med-os case).
      const fedPath = path.join(dir, 'federation.yaml');
      const currentRaw = federationRaw ?? io.readText(fedPath);
      if (currentRaw) {
        const reconciled = reconcileDeclaredUpstream(currentRaw, upstreamUrl);
        if (reconciled.changed) {
          io.writeText(fedPath, reconciled.raw);
          federationRaw = reconciled.raw;

          // Commit it now, for the same reason the machinery is committed: the
          // next stage refuses to run on a dirty tree, so an uncommitted repair
          // would guarantee the abort it was meant to prevent. A standalone
          // commit also lets an operator see and revert exactly this change.
          const staged = io.git(dir, ['add', '--', 'federation.yaml']);
          if (!staged.ok) {
            return { status: 'failed', detail: `could not stage federation.yaml: ${staged.out}` };
          }
          const message =
            `chore(sync): point the declared upstream at the canonical framework repo\n\n` +
            `federation.yaml upstream[0] now reads ${upstreamUrl}.\n\n` +
            `scripts/sync-upstream.mjs reads this declaration, not the git remote, so\n` +
            `a stale or url-less entry stops the sync before it starts. Written by\n` +
            `\`doctor sync\` (@org-os/instance-doctor).`;
          const committed = io.git(dir, ['commit', '-m', message]);
          if (!committed.ok) {
            return { status: 'failed', detail: `could not commit federation.yaml: ${committed.out}` };
          }
          notes.push(`${reconciled.note} (committed)`);
        } else {
          notes.push('declaration already canonical');
        }
      }

      return { status: 'ok', detail: notes.join('; ') };
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
      if (copied.length === 0) {
        return { status: 'failed', detail: 'the framework checkout carries none of the sync machinery' };
      }

      // Commit what we just wrote. Injecting machinery dirties the working
      // tree, and the very next stage (sync-upstream) refuses to run on a dirty
      // tree — so without this the doctor's own repair step guarantees its own
      // failure. Found by the first real acceptance run against refi-med-os.
      //
      // Committing is also the honest record: the instance really did gain
      // these files, from a known framework commit, and an operator can revert
      // that one commit if they disagree. Explicit paths only — never `-A` —
      // so nothing else an operator left in the tree gets swept in.
      // Include any receipt left by an earlier aborted run: it is doctor-owned
      // output, and sync-upstream's own dirty check would otherwise trip on it.
      const status = io.git(dir, ['status', '--porcelain', '-uall']);
      const leftoverReceipts = (status.ok ? status.out : '')
        .split('\n')
        .filter(Boolean)
        .map(porcelainPath)
        .filter((rel) => RECEIPT_RE.test(rel));

      const toStage = [...new Set([...copied, ...leftoverReceipts])];
      const staged = io.git(dir, ['add', '--', ...toStage]);
      if (!staged.ok) return { status: 'failed', detail: `could not stage machinery: ${staged.out}` };

      const pending = io.git(dir, ['diff', '--cached', '--name-only']);
      if (pending.ok && pending.out) {
        const head = String(snapshot.framework?.headSha ?? '').slice(0, 12) || 'unknown';
        const message =
          `chore(sync): install framework sync machinery\n\n` +
          `Copied from the org-os framework at ${head} by \`doctor sync\`\n` +
          `(@org-os/instance-doctor). Files: ${copied.join(', ')}.\n\n` +
          `The instance could not sync itself without these; sync-upstream.mjs was\n` +
          `missing, stubbed, or stale here. Revert this commit to undo the injection.`;
        const committed = io.git(dir, ['commit', '-m', message]);
        if (!committed.ok) {
          return { status: 'failed', detail: `could not commit machinery: ${committed.out}` };
        }
        return { status: 'ok', detail: `installed and committed ${copied.join(', ')}` };
      }

      return { status: 'ok', detail: `${copied.join(', ')} already current — nothing to commit` };
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
