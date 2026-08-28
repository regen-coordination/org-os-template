/**
 * B4 — machinery integrity.
 *
 * Gap #2 of the v0.5 masterplan: *no working sync path into any instance*.
 * The cause was never one bug — it was copy-decay. Sync machinery was injected
 * into instances by hand, then the framework moved on, and nothing compared the
 * two ever again. Every finding below is a defect the 2026-08-28 sweep found:
 *
 *   refi-bcn-os            `sync:upstream` script entry, no such file
 *   refi-dao-os            178-byte console-only stub, and no upstream remote
 *   regen-coordination-os  duplicate `scripts.initialize`, no sync file
 *   refi-med-os            upstream remote points at the divergent legacy repo
 *   bread-coop-os          no git remote at all
 *
 * The skew fingerprint exists so this class of decay is visible next time
 * instead of silent.
 */

import { result, finding } from '../lib/finding.mjs';
import { duplicateJsonKeys } from '../lib/json-dup.mjs';

/** The one true framework repository. Three other names circulate; see below. */
export const CANONICAL_UPSTREAM_URL = 'https://github.com/regen-coordination/org-os-template.git';
export const CANONICAL_UPSTREAM_SLUG = 'regen-coordination/org-os-template';

/**
 * Repository names that have circulated as "the framework" and are not.
 * Keyed by owner/repo slug; the value explains why it is wrong.
 */
export const KNOWN_WRONG_UPSTREAMS = {
  'regen-coordination/organizational-os-framework':
    'a live but divergent legacy repository — its HEAD is not the framework HEAD',
  'luizfernandosg/organizational-os-template':
    'a personal fork of the pre-rename repository, not the canonical origin',
  'regen-coordination/org-os-framework':
    'a name that has never existed as a repository (the stale AGENTS.md §11 link)',
};

/** Files the framework owns and instances carry copies of. */
export const CANONICAL_MACHINERY = [
  'scripts/sync-upstream.mjs',
  'scripts/validate-identity.mjs',
  'scripts/validate-structure.mjs',
  'scripts/doctor.mjs',
];

/** Reduce any git URL form to a lower-cased `owner/repo`. */
export function normalizeRepoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!trimmed) return null;
  const scp = /^[^@\s]+@[^:]+:(.+)$/.exec(trimmed); // git@host:owner/repo
  const path = scp ? scp[1] : trimmed.replace(/^[a-z+]+:\/\/[^/]+\//i, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(-2).join('/').toLowerCase();
}

/**
 * Does this script file do nothing? The dao-os case is a shebang plus two
 * `console.log` calls: it exits 0, so every caller believes sync succeeded.
 */
export function isNoOpStub(content) {
  if (content === null || content === undefined) return false;
  const lines = String(content)
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith('#!') &&
        !l.startsWith('//') &&
        !l.startsWith('/*') &&
        !l.startsWith('*') &&
        l !== '*/',
    );
  if (lines.length === 0) return true; // empty or comment-only
  const body = lines.join('\n');
  if (/\b(import|require|export|await)\b/.test(body)) return false;
  if (/\bprocess\.|readFileSync|writeFileSync|execSync|spawnSync|fetch\(/.test(body)) return false;
  return lines.every((l) => /^console\.(log|info|warn|error|debug)\(/.test(l));
}

/**
 * The local script file each package.json entry invokes, when it invokes one.
 * `npm run` chains, globs and `--prefix` delegations reference no local file
 * of their own and are skipped rather than guessed at.
 */
export function localScriptTargets(packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const targets = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    if (/--prefix\b/.test(command)) continue;
    const m = /(?:^|\s)((?:\.\/)?[\w.@/-]+\.(?:mjs|js|cjs))(?:\s|$)/.exec(command);
    if (!m) continue;
    const file = m[1].replace(/^\.\//, '');
    if (file.includes('*')) continue;
    targets.push({ name, command, file });
  }
  return targets;
}

export function checkMachinery(snapshot) {
  const findings = [];

  // --- package.json ------------------------------------------------------
  if (!snapshot.packageJson) {
    findings.push(
      finding.blocker(
        'package-json-missing',
        'package.json is absent — no scripts, no name, nothing to run',
        'this directory is not an org-os instance',
      ),
    );
  } else {
    for (const key of duplicateJsonKeys(snapshot.packageJsonRaw)) {
      findings.push(
        finding.blocker(
          'package-json-duplicate-key',
          `package.json declares "${key}" more than once — JSON.parse keeps the last, so edits to the first are silently discarded`,
          'delete the redundant entry',
        ),
      );
    }

    for (const target of localScriptTargets(snapshot.packageJson)) {
      const file = snapshot.scriptFiles?.[target.file];
      if (!file || !file.exists) {
        findings.push(
          finding.blocker(
            'script-target-missing',
            `script "${target.name}" runs ${target.file}, which does not exist`,
            '`doctor sync` injects the framework machinery; or remove the dead script entry',
          ),
        );
        continue;
      }
      if (isNoOpStub(file.content)) {
        findings.push(
          finding.blocker(
            'script-is-noop-stub',
            `script "${target.name}" runs ${target.file}, which is a ${file.size ?? '?'}-byte no-op — it prints and exits 0, so callers believe it worked`,
            '`doctor sync` replaces it with the framework implementation',
          ),
        );
      }
    }
  }

  // --- git remotes -------------------------------------------------------
  const git = snapshot.git ?? { isRepo: false, remotes: {} };
  if (!git.isRepo) {
    findings.push(
      finding.blocker(
        'not-a-git-repo',
        'the directory is not a git repository — lineage, sync and rollback are all impossible',
        'git init, or point --dir at the right directory',
      ),
    );
  } else {
    const remotes = git.remotes ?? {};
    const names = Object.keys(remotes);
    if (names.length === 0) {
      findings.push(
        finding.blocker(
          'git-remote-absent',
          'the repository has no git remote at all — nothing to push to and nothing to sync from',
          `git remote add origin <your-instance-repo> && git remote add upstream ${CANONICAL_UPSTREAM_URL}`,
        ),
      );
    } else if (!remotes.upstream) {
      findings.push(
        finding.warn(
          'upstream-remote-missing',
          'no `upstream` remote — the instance cannot fetch the framework',
          '`doctor sync` adds it with the canonical URL',
        ),
      );
    } else {
      const slug = normalizeRepoUrl(remotes.upstream);
      if (slug && slug !== CANONICAL_UPSTREAM_SLUG) {
        const why = KNOWN_WRONG_UPSTREAMS[slug] ?? 'not the canonical framework repository';
        findings.push(
          finding.blocker(
            'upstream-remote-wrong-url',
            `upstream remote points at ${remotes.upstream} (${slug}), not ${CANONICAL_UPSTREAM_SLUG}`,
            `${why} — syncing from it would pull divergent history; \`doctor sync\` rewrites the remote to ${CANONICAL_UPSTREAM_URL}`,
          ),
        );
      }
    }
  }

  // --- federation.yaml's declared upstream -------------------------------
  const declared = (snapshot.federation?.upstream ?? [])[0];
  const declaredSlug = normalizeRepoUrl(declared?.url ?? declared?.repository);
  if (declaredSlug && declaredSlug !== CANONICAL_UPSTREAM_SLUG) {
    const why = KNOWN_WRONG_UPSTREAMS[declaredSlug] ?? 'not the canonical framework repository';
    findings.push(
      finding.warn(
        'upstream-declared-wrong-url',
        `federation.yaml upstream[0] declares ${declared.url ?? declared.repository} (${declaredSlug}), not ${CANONICAL_UPSTREAM_SLUG}`,
        `${why} — the git remote is what sync uses, but a stale declaration misleads every reader`,
      ),
    );
  }

  // --- migrations --------------------------------------------------------
  if (snapshot.dirs && snapshot.dirs.migrations === false) {
    findings.push(
      finding.warn(
        'migrations-dir-missing',
        'no migrations/ directory — framework migrations cannot be applied or tracked',
        '`doctor sync` creates it during the migrate stage',
      ),
    );
  }

  // --- machinery skew ----------------------------------------------------
  for (const [file, prints] of Object.entries(snapshot.machinery ?? {})) {
    if (!prints?.instanceMd5 || !prints?.frameworkMd5) continue; // absence is covered above
    if (prints.instanceMd5 !== prints.frameworkMd5) {
      findings.push(
        finding.warn(
          'machinery-skew',
          `${file} differs from the framework copy (instance ${String(prints.instanceMd5).slice(0, 7)} vs framework ${String(prints.frameworkMd5).slice(0, 7)})`,
          'either an intentional local customization or copy-decay; `doctor sync` refreshes it from the framework',
        ),
      );
    }
  }

  return result('machinery', 'Machinery integrity', findings);
}
