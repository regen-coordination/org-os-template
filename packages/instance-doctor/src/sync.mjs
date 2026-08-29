/**
 * B8/B9 — `doctor sync`: the reliable path from framework to instance.
 *
 * The framework already has a good 10-stage `sync-upstream.mjs`. The reason no
 * instance can use it is that the instance has to *already contain* it — and
 * the sweep found it missing in three instances, a 178-byte no-op in a fourth,
 * and pointed at a divergent repository in a fifth. `doctor sync` is the
 * wrapper that gets an instance into a state where sync-upstream can run, then
 * runs it, then proves the result.
 *
 * Nine stages, aborting on the first failure (B9): no stage may leave the
 * instance half-migrated, and the receipt records the stage that stopped it.
 *
 *   snapshot          a recoverable git ref of the whole working tree
 *   ensure-upstream   add or rewrite the `upstream` remote to the canonical URL
 *   fetch             fetch it
 *   inject-machinery  copy the framework's sync machinery into the instance
 *   overlay           copy framework-owned paths in (replaces the rebase)
 *   migrate           framework migrations + the 3.x→0.5 re-baseline re-stamp
 *   generate-schemas  republish .well-known/
 *   re-assess         run the full B1-B6 battery again
 *   receipt           write the dated receipt and stamp last_sync_commit
 *
 * This module holds the pure half — plan, re-stamp, stamp, receipt. The
 * effectful half is runSync() in run-sync.mjs, which takes an injectable io bag.
 */

import {
  CANONICAL_MACHINERY,
  CANONICAL_UPSTREAM_SLUG,
  CANONICAL_UPSTREAM_URL,
  KNOWN_WRONG_UPSTREAMS,
  normalizeRepoUrl,
} from './checks/machinery.mjs';
import { milestoneOrdinal, TEMPLATE_PACKAGE_NAME } from './checks/versions.mjs';
import { FRAMEWORK_OWNED } from './overlay.mjs';

export const STAGE_IDS = [
  'snapshot',
  'ensure-upstream',
  'fetch',
  'inject-machinery',
  'overlay',
  'migrate',
  'generate-schemas',
  're-assess',
  'receipt',
];

/** major.minor of a full framework version — the form version surfaces carry. */
export function majorMinor(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * What `doctor sync` intends to do, stage by stage. Pure — this is exactly
 * what `--dry-run` prints, so the plan an operator reads is the plan that runs.
 */
export function planSync(snapshot) {
  const fwVersion = snapshot.framework?.version ?? '(unknown)';
  const fwShort = majorMinor(fwVersion);
  const declared = snapshot.federation?.metadata?.framework_version ?? null;

  const upstreamUrl = snapshot.git?.remotes?.upstream ?? null;
  const upstreamSlug = normalizeRepoUrl(upstreamUrl);
  let upstreamDetail;
  if (!upstreamUrl) {
    upstreamDetail = `add remote \`upstream\` → ${CANONICAL_UPSTREAM_URL} (${CANONICAL_UPSTREAM_SLUG})`;
  } else if (upstreamSlug === CANONICAL_UPSTREAM_SLUG) {
    upstreamDetail = `leave \`upstream\` as is — already canonical (${CANONICAL_UPSTREAM_SLUG})`;
  } else {
    const why = KNOWN_WRONG_UPSTREAMS[upstreamSlug] ?? 'not the canonical framework repository';
    upstreamDetail = `rewrite \`upstream\` from ${upstreamUrl} to ${CANONICAL_UPSTREAM_URL} — ${why}`;
  }

  const restampNeeded =
    declared !== null && fwShort !== null && milestoneOrdinal(declared) !== milestoneOrdinal(fwShort);
  const migrateDetail = restampNeeded
    ? `run framework migrations, then re-stamp the version surfaces ${declared} → ${fwShort} (the re-baseline; without it the re-assess fails B3)`
    : `run framework migrations; version surfaces already read ${declared ?? '(none)'}`;

  return [
    {
      id: 'snapshot',
      title: 'Snapshot the working tree',
      detail:
        'write refs/snapshots/<timestamp>-doctor-sync from a stash object created without touching the tree, the index or the stash list (the vault-snapshot primitive)',
    },
    { id: 'ensure-upstream', title: 'Ensure the upstream remote', detail: upstreamDetail },
    { id: 'fetch', title: 'Fetch the framework', detail: 'git fetch upstream' },
    {
      id: 'inject-machinery',
      title: 'Install the sync machinery',
      detail: `copy from the framework: ${CANONICAL_MACHINERY.join(', ')}`,
    },
    {
      id: 'overlay',
      title: 'Overlay the framework',
      detail: `copy framework-owned paths (${FRAMEWORK_OWNED.join(', ')}) over the instance's, leaving everything the org owns untouched`,
    },
    { id: 'migrate', title: 'Migrate', detail: migrateDetail },
    { id: 'generate-schemas', title: 'Regenerate schemas', detail: 'npm run generate:schemas' },
    {
      id: 're-assess',
      title: 'Re-assess',
      detail: 'run the full B1-B6 battery again and record the scorecard',
    },
    {
      id: 'receipt',
      title: 'Write the receipt',
      detail: `memory/reports/sync-receipt-<date>.md + stamp last_sync_commit to framework HEAD (${String(snapshot.framework?.headSha ?? '').slice(0, 12) || 'unknown'})`,
    },
  ];
}

/**
 * The 3.x → 0.5 re-baseline re-stamp.
 *
 * Operates on raw text so comments, ordering and formatting survive. Only the
 * surfaces that *claim to state the framework version* are touched — see
 * checks/versions.mjs; an instance's own package.json version is its own.
 *
 * @returns {{federationRaw: string|null, versionMd: string|null, packageJsonRaw: string|null, changed: string[]}}
 */
export function restampVersionSurfaces(surfaces, frameworkVersion) {
  const short = majorMinor(frameworkVersion);
  const changed = [];

  let federationRaw = surfaces.federationRaw ?? null;
  if (federationRaw && short) {
    const next = federationRaw.replace(/^(\s*framework_version:\s*)"?[^"\s#]+"?/m, `$1"${short}"`);
    if (next !== federationRaw) {
      federationRaw = next;
      changed.push('federation.yaml');
    }
  }

  let versionMd = surfaces.versionMd ?? null;
  if (versionMd) {
    const next = versionMd.replace(
      /(\*\*Framework Version:\*\*\s*`?)[0-9]+\.[0-9]+(?:\.[0-9]+)?(`?)/i,
      `$1${frameworkVersion}$2`,
    );
    if (next !== versionMd) {
      versionMd = next;
      changed.push('VERSION.md');
    }
  }

  let packageJsonRaw = surfaces.packageJsonRaw ?? null;
  if (packageJsonRaw && surfaces.packageJson?.name === TEMPLATE_PACKAGE_NAME) {
    const next = packageJsonRaw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${frameworkVersion}$2`);
    if (next !== packageJsonRaw) {
      packageJsonRaw = next;
      changed.push('package.json');
    }
  }

  return { federationRaw, versionMd, packageJsonRaw, changed };
}

/**
 * Stamp the lineage into raw federation.yaml text.
 * `genesis_commit` is immutable: present means never rewritten.
 */
export function stampLineage(federationRaw, { genesisCommit, lastSyncCommit, today }) {
  let out = federationRaw;

  if (genesisCommit && !/^\s*genesis_commit:/m.test(out)) {
    out = out.replace(/^(metadata:)/m, `$1\n  genesis_commit: "${genesisCommit}"`);
  }

  if (lastSyncCommit) {
    out = /^\s*last_sync_commit:/m.test(out)
      ? out.replace(/^(\s*last_sync_commit:\s*).*$/m, `$1"${lastSyncCommit}"`)
      : out.replace(/^(metadata:)/m, `$1\n  last_sync_commit: "${lastSyncCommit}"`);
  }

  if (today) {
    out = /^\s*last_updated:/m.test(out)
      ? out.replace(/^(\s*last_updated:\s*).*$/m, `$1"${today}"`)
      : out.replace(/^(metadata:)/m, `$1\n  last_updated: "${today}"`);
  }

  return out;
}

/**
 * Reconcile `federation.yaml`'s DECLARED upstream to the canonical URL.
 *
 * Fixing the git remote is not enough. `scripts/sync-upstream.mjs` reads
 * `federation.yaml.upstream[0].url` at its stage 3 and exits when that key is
 * absent — and refi-med-os declared `repository:` with no `url:` at all, aimed
 * at the divergent legacy repo. So a doctor that repaired only the remote got
 * exactly as far as invoking sync-upstream and no further.
 *
 * Operates on raw text so comments, ordering and unrelated keys survive.
 *
 * @returns {{raw: string, changed: boolean, note: string}}
 */
export function reconcileDeclaredUpstream(raw, canonicalUrl = CANONICAL_UPSTREAM_URL) {
  const text = String(raw ?? '');
  const quoted = `"${canonicalUrl}"`;

  const entry = [
    'upstream:',
    `  - url: ${quoted}`,
    `    repository: ${quoted}`,
    '    relationship: "template"',
  ].join('\n');

  // No upstream key at all, or an explicitly empty list.
  const emptyList = /^upstream:\s*\[\s*\]\s*$/m;
  if (emptyList.test(text)) {
    return { raw: text.replace(emptyList, entry), changed: true, note: 'declared upstream created (was an empty list)' };
  }
  if (!/^upstream:\s*$/m.test(text)) {
    const appended = text.endsWith('\n') ? `${text}\n${entry}\n` : `${text}\n\n${entry}\n`;
    return { raw: appended, changed: true, note: 'declared upstream created (key was absent)' };
  }

  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^upstream:\s*$/.test(l));
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end += 1;

  const block = lines.slice(start + 1, end);
  const itemIdx = block.findIndex((l) => /^\s*-\s/.test(l));
  if (itemIdx === -1) {
    lines.splice(start + 1, 0, `  - url: ${quoted}`, `    repository: ${quoted}`);
    return { raw: lines.join('\n'), changed: true, note: 'declared upstream entry created' };
  }

  // The first list item runs until the next item or the end of the block.
  let itemEnd = itemIdx + 1;
  while (itemEnd < block.length && !/^\s*-\s/.test(block[itemEnd])) itemEnd += 1;

  let changed = false;
  let sawUrl = false;
  for (let i = itemIdx; i < itemEnd; i += 1) {
    const urlMatch = /^(\s*(?:-\s+)?)url:\s*(.*)$/.exec(block[i]);
    if (urlMatch) {
      sawUrl = true;
      if (urlMatch[2].trim() !== quoted) {
        block[i] = `${urlMatch[1]}url: ${quoted}`;
        changed = true;
      }
      continue;
    }
    const repoMatch = /^(\s*(?:-\s+)?)repository:\s*(.*)$/.exec(block[i]);
    if (repoMatch && repoMatch[2].trim() !== quoted) {
      block[i] = `${repoMatch[1]}repository: ${quoted}`;
      changed = true;
    }
  }

  if (!sawUrl) {
    // Indent the inserted key to match the item's own keys.
    const indent = (/^(\s*)-\s/.exec(block[itemIdx]) || [, '  '])[1] + '  ';
    block.splice(itemIdx + 1, 0, `${indent}url: ${quoted}`);
    changed = true;
  }

  if (!changed) return { raw: text, changed: false, note: 'declared upstream already canonical' };

  lines.splice(start + 1, end - (start + 1), ...block);
  return { raw: lines.join('\n'), changed: true, note: `declared upstream set to ${canonicalUrl}` };
}

const STATUS_ICON = { ok: '✓', failed: '✗', skipped: '·' };

export function renderReceipt({
  name,
  today,
  frameworkVersion,
  frameworkHead,
  stages,
  aborted,
  abortStage,
  lastSyncCommit,
  reassess,
  dryRun = false,
}) {
  const lines = [];
  lines.push(`# Sync receipt — ${today}`);
  lines.push('');
  lines.push(`- **Instance:** ${name}`);
  lines.push(
    `- **Framework:** ${frameworkVersion} @ ${String(frameworkHead ?? '').slice(0, 12) || 'unknown'}`,
  );
  lines.push(
    `- **Tool:** \`@org-os/instance-doctor\` \`doctor sync\`${dryRun ? ' (dry run — nothing was written)' : ''}`,
  );
  if (lastSyncCommit) lines.push(`- **New \`last_sync_commit\`:** \`${lastSyncCommit}\``);
  lines.push(
    `- **Result:** ${aborted ? `**ABORTED at \`${abortStage}\`**` : dryRun ? 'planned only' : 'completed'}`,
  );
  lines.push('');

  lines.push('## Stages');
  lines.push('');
  for (const s of stages) {
    const icon = STATUS_ICON[s.status] ?? '?';
    lines.push(`- ${icon} \`${s.id}\` — ${s.status}${s.detail ? `: ${s.detail}` : ''}`);
  }
  lines.push('');

  if (reassess) {
    lines.push('## Post-sync assessment');
    lines.push('');
    lines.push(
      `- Status: **${reassess.status}** — ${reassess.summary.blockers} blocker(s), ${reassess.summary.warnings} warning(s) across ${reassess.summary.checks} checks`,
    );
    lines.push('');
  }

  if (aborted) {
    lines.push('## What to do next');
    lines.push('');
    lines.push(
      `The sync stopped at \`${abortStage}\` and every later stage was skipped, so the instance was not left half-migrated. Fix the cause above and re-run \`doctor sync\`; the snapshot ref recorded in the first stage restores the tree if anything needs undoing.`,
    );
    lines.push('');
  }

  lines.push('Generated by `packages/instance-doctor`.');
  lines.push('');
  return lines.join('\n');
}
