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
import { FRAMEWORK_OWNED, isInstanceOwned, overlayPlan } from './overlay.mjs';
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
 * Build the overlay plan for `dir` against `frameworkDir`, reading only.
 *
 * Shared by the gate in the snapshot stage and the overlay stage itself, so the
 * question the gate asks ("what will this run write?") is answered by the same
 * code that later does the writing. Returns null when no plan can be computed —
 * no framework checkout, or a framework carrying none of the owned prefixes.
 *
 * Note the instance side is read from the WORKING TREE, not from HEAD. That is
 * deliberate: the gate cares about the bytes the overlay would overwrite, and an
 * uncommitted edit is exactly what is at risk.
 */
export function buildOverlayPlan(dir, frameworkDir, io) {
  if (!frameworkDir) return null;

  const frameworkFiles = new Map();
  for (const prefix of FRAMEWORK_OWNED) {
    for (const rel of io.listFiles(frameworkDir, prefix)) {
      const content = io.readText(path.join(frameworkDir, rel));
      if (content !== null && content !== undefined) frameworkFiles.set(rel, content);
    }
  }
  if (frameworkFiles.size === 0) return null;

  const instanceFiles = new Map();
  for (const rel of frameworkFiles.keys()) {
    const content = io.readText(path.join(dir, rel));
    if (content !== null && content !== undefined) instanceFiles.set(rel, content);
  }

  return overlayPlan({ frameworkFiles, instanceFiles });
}

/**
 * The paths an overlay run would actually write. `unchanged` is not a write.
 *
 * @param {ReturnType<typeof overlayPlan>|null} plan
 * @returns {Set<string>|null} null when there is no plan to reason about
 */
export function plannedWritePaths(plan) {
  if (!plan) return null;
  return new Set(
    plan.actions.filter((a) => a.action === 'add' || a.action === 'update').map((a) => a.path),
  );
}

/**
 * The dirty entries this run would actually overwrite.
 *
 * The v0.5.1 gate. The old one refused on any `foreignDirtyEntries` hit, which
 * was correct when stage 5 was `git pull --rebase` — that rewrites the entire
 * working tree, so every uncommitted file genuinely was at risk. The overlay
 * writes a computed, narrow list, so the honest question is the intersection.
 *
 * A null `planned` set means the plan could not be computed; a gate that cannot
 * see what it is about to write refuses over everything, which is the safe
 * direction to be wrong.
 *
 * @param {string[]} foreign  verbatim porcelain lines from foreignDirtyEntries()
 * @param {Set<string>|null} planned
 */
export function collidingDirtyEntries(foreign, planned) {
  if (planned === null) return foreign;
  return foreign.filter((line) => planned.has(porcelainPath(line)));
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

      // The gate. Failing here, with the snapshot already safely written, beats
      // failing four stages later.
      //
      // Read fresh rather than trusting the pre-run snapshot, and ignore the
      // doctor's own artifacts — otherwise the debris of an aborted run blocks
      // every retry.
      const status = io.git(dir, ['status', '--porcelain', '-uall']);
      const foreign = status.ok ? foreignDirtyEntries(status.out) : [];

      // v0.5.1: ask whether the uncommitted work INTERSECTS what this run will
      // write, not merely whether the tree is clean. The old question belonged
      // to the rebase this overlay replaced. Across the fleet on 2026-08-29 the
      // coarse form was holding seven instances hostage to ~3,250 uncommitted
      // files, exactly one of which the overlay would ever have touched.
      const planned = plannedWritePaths(buildOverlayPlan(dir, snapshot.framework?.dir, io));
      const colliding = collidingDirtyEntries(foreign, planned);

      if (colliding.length > 0) {
        // Name the files. A refusal an operator cannot act on is a bug report
        // addressed to nobody.
        const shown = colliding.slice(0, 5).join(', ');
        const more = colliding.length > 5 ? `, +${colliding.length - 5} more` : '';
        const scope =
          planned === null
            ? `the overlay plan could not be computed, so sync refuses over all ${colliding.length} uncommitted change(s) that are not the doctor's own`
            : `${colliding.length} uncommitted change(s) collide with file(s) this sync would overwrite`;
        return {
          status: 'failed',
          detail: `${detail} — but ${scope} (${shown}${more}). Commit or revert them, then re-run.`,
        };
      }

      // Say what was let through. The operator should be able to read the
      // receipt and see that the gate saw their work and judged it out of scope,
      // rather than wonder whether it looked at all.
      const passed = foreign.length;
      const note2 = passed > 0
        ? ` — ${passed} uncommitted change(s) present, none in this run's write set`
        : '';
      return { status: 'ok', detail: `${detail}${note2}` };
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

    // Replaces the history-based sync (v0.5.1). The old stage shelled out to
    // `scripts/sync-upstream.mjs --yes`, whose `git pull --rebase upstream main`
    // assumes fork lineage; against a scaffolded instance it conflicts on every
    // shared filename and strands the repo mid-rebase. See overlay.mjs.
    overlay() {
      const frameworkDir = snapshot.framework?.dir;
      if (!frameworkDir) {
        return { status: 'failed', detail: 'no framework directory to overlay from' };
      }

      // Same builder the snapshot gate used, so the set of files the gate
      // reasoned about and the set this stage writes cannot drift apart. It is
      // recomputed rather than cached: inject-machinery has committed since,
      // which legitimately turns some `update`s into `unchanged`s.
      const plan = buildOverlayPlan(dir, frameworkDir, io);
      if (!plan) {
        return { status: 'failed', detail: `no framework-owned files found under ${FRAMEWORK_OWNED.join(', ')}` };
      }

      // Belt-and-braces: the planner already refuses instance-owned paths, but
      // this stage is the one that writes, so it re-checks before touching disk.
      // A sync that clobbers data/ or memory/ would destroy the organization it
      // was meant to update — there is no acceptable version of that bug.
      const trespass = plan.actions.filter((a) => isInstanceOwned(a.path));
      if (trespass.length > 0) {
        return {
          status: 'failed',
          detail: `refusing to write instance-owned path(s): ${trespass.map((t) => t.path).join(', ')}`,
        };
      }

      if (!plan.changed) {
        return { status: 'ok', detail: `already current — ${plan.summary.unchanged} framework file(s) match` };
      }

      const written = [];
      for (const action of plan.actions) {
        if (action.action === 'unchanged') continue;
        io.writeText(path.join(dir, action.path), action.content);
        written.push(action.path);
      }

      // Commit it: the stages after this one refuse to run on a dirty tree, so
      // leaving the overlay uncommitted would guarantee the abort it exists to
      // prevent. Explicit paths only — never `-A` — so an operator can see and
      // revert exactly what the framework changed.
      const staged = io.git(dir, ['add', '--', ...written]);
      if (!staged.ok) return { status: 'failed', detail: `could not stage the overlay: ${staged.out}` };

      const committed = io.git(dir, [
        'commit', '-m',
        `chore(sync): overlay framework machinery (${plan.summary.add} added, ${plan.summary.update} updated)`,
      ]);
      if (!committed.ok) {
        return { status: 'failed', detail: `could not commit the overlay: ${committed.out}` };
      }

      const shown = written.slice(0, 6).join(', ');
      const more = written.length > 6 ? `, +${written.length - 6} more` : '';
      return {
        status: 'ok',
        detail: `${plan.summary.add} added, ${plan.summary.update} updated (${shown}${more}); ${plan.summary.unchanged} already current`,
      };
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
