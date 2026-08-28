/**
 * B3 — version surfaces, cross-scheme aware.
 *
 * org-os re-baselined its version scheme once, deliberately and non-SemVer-ly:
 * the line numbered `1.x → 2.x → 3.x → 3.5` (four milestones) was renumbered to
 * `0.5` — the fifth milestone. **Source of truth: the `[0.5.0]` re-baseline
 * paragraph in CHANGELOG.md** (2026-06-17). `docs/VERSIONING.md` formalises the
 * same map; there is deliberately no second map anywhere in this package.
 *
 * Consequence: a plain semver compare reads an instance stamped `3.0` as
 * *ahead* of a framework on `0.5`, so every comparison here goes through
 * milestone ordinals instead.
 */

import { result, finding } from '../lib/finding.mjs';

/** The framework's own package.json name; when an instance still carries it,
 *  the template leaked and its package.json version is a framework claim. */
export const TEMPLATE_PACKAGE_NAME = 'organizational-os-template';

/**
 * Milestone ordinal for a version string, across both schemes.
 *
 *   1.x → 1 · 2.x → 2 · 3.0 → 3 · 3.5 → 4      (legacy line)
 *   0.n → n                                      (0.x pre-beta line: 0.5 = 5)
 *
 * @returns {number|null} null when unparseable or outside the mapped schemes
 */
export function milestoneOrdinal(version) {
  if (version === null || version === undefined) return null;
  const m = /^(\d+)\.(\d+)/.exec(String(version).trim());
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 0) return minor; // 0.x pre-beta: the minor IS the milestone
  if (major === 1) return 1;
  if (major === 2) return 2;
  if (major === 3) return minor >= 5 ? 4 : 3;
  return null; // 4.x+ never existed — flag it rather than guess
}

/** Pull the `**Framework Version:** \`x.y.z\`` line out of a VERSION.md body. */
function versionMdClaim(text) {
  if (!text) return null;
  const m = /\*\*Framework Version:\*\*\s*`?([0-9]+\.[0-9]+(?:\.[0-9]+)?)`?/i.exec(text);
  return m ? m[1] : null;
}

/** Newest released heading in a CHANGELOG body, skipping `[Unreleased]`. */
function changelogClaim(text) {
  if (!text) return null;
  const m = /^##\s*\[([0-9]+\.[0-9]+(?:\.[0-9]+)?)\]/m.exec(text);
  return m ? m[1] : null;
}

/**
 * The surfaces that actually *claim to state the framework version*.
 *
 * `package.json.version` is the instance's own version and is deliberately
 * excluded — unless the package is still named after the template, in which
 * case the file was inherited wholesale and its version is a framework claim
 * (the regen-coordination-os signature).
 *
 * @returns {Array<{surface: string, value: string}>}
 */
export function frameworkVersionSurfaces(snapshot) {
  const surfaces = [];
  const fv = snapshot.federation?.metadata?.framework_version;
  if (fv) surfaces.push({ surface: 'federation.yaml', value: String(fv) });

  const pkg = snapshot.packageJson;
  if (pkg?.version && pkg?.name === TEMPLATE_PACKAGE_NAME) {
    surfaces.push({ surface: 'package.json', value: String(pkg.version) });
  }

  const vmd = versionMdClaim(snapshot.versionMd);
  if (vmd) surfaces.push({ surface: 'VERSION.md', value: vmd });

  const chg = changelogClaim(snapshot.changelog);
  if (chg) surfaces.push({ surface: 'CHANGELOG.md', value: chg });

  return surfaces;
}

export function checkVersions(snapshot) {
  const findings = [];
  const surfaces = frameworkVersionSurfaces(snapshot);
  const declared = snapshot.federation?.metadata?.framework_version;

  if (!declared) {
    findings.push(
      finding.blocker(
        'framework-version-missing',
        'federation.yaml metadata.framework_version is absent — the instance makes no framework-version claim at all',
        'add metadata.framework_version to federation.yaml, or run `doctor sync` which stamps it',
      ),
    );
  }

  // Every surface must resolve to a milestone; an unmapped one is reported.
  const resolved = [];
  for (const s of surfaces) {
    const ordinal = milestoneOrdinal(s.value);
    if (ordinal === null) {
      findings.push(
        finding.warn(
          'version-scheme-unknown',
          `${s.surface} declares "${s.value}", which belongs to neither the legacy (1.x-3.5) nor the 0.x line`,
          'see the [0.5.0] re-baseline paragraph in CHANGELOG.md for the mapped schemes',
        ),
      );
      continue;
    }
    resolved.push({ ...s, ordinal });
  }

  // Contradiction: two surfaces claiming different milestones.
  const distinct = [...new Set(resolved.map((s) => s.ordinal))];
  if (distinct.length > 1) {
    const detail = resolved.map((s) => `${s.surface}=${s.value}`).join(', ');
    findings.push(
      finding.blocker(
        'version-surfaces-contradict',
        `framework-version surfaces disagree: ${detail}`,
        'reconcile every surface to the same milestone; `doctor sync` re-stamps them during its migrate stage',
      ),
    );
  }

  // Staleness against the framework we are being run from.
  const frameworkOrdinal = milestoneOrdinal(snapshot.framework?.version);
  if (frameworkOrdinal !== null && resolved.length > 0) {
    const behind = frameworkOrdinal - Math.max(...resolved.map((s) => s.ordinal));
    if (behind > 0) {
      findings.push(
        finding.warn(
          'framework-version-stale',
          `instance is ${behind} milestone${behind === 1 ? '' : 's'} behind the framework (${declared ?? '?'} → ${snapshot.framework.version})`,
          'run `doctor sync` to pull the framework forward and re-stamp the version surfaces',
        ),
      );
    }
  }

  return result('versions', 'Version surfaces', findings);
}
