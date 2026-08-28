/**
 * assess.mjs — run the whole B1-B6 battery over one snapshot.
 *
 * Pure: every check is a pure function and this composes them, so the entire
 * assessment is testable without a filesystem. All I/O lives in snapshot.mjs.
 */

import { checkIdentity } from './checks/identity.mjs';
import { checkLineage } from './checks/lineage.mjs';
import { checkVersions } from './checks/versions.mjs';
import { checkMachinery } from './checks/machinery.mjs';
import { checkStructure } from './checks/structure.mjs';
import { checkFreshness } from './checks/freshness.mjs';
import { worst, BLOCKER, WARN } from './lib/finding.mjs';

/** Order is the order an operator should read them in: who am I → where did I
 *  come from → what version → does my machinery work → am I well-formed → am I
 *  alive. */
const CHECKS = [
  checkIdentity,
  checkLineage,
  checkVersions,
  checkMachinery,
  checkStructure,
  checkFreshness,
];

export function assessSnapshot(snapshot) {
  const checks = CHECKS.map((fn) => fn(snapshot));
  const findings = checks.flatMap((c) => c.findings);

  return {
    dir: snapshot.dir ?? null,
    name: snapshot.name ?? snapshot.federation?.identity?.name ?? null,
    isFramework: Boolean(snapshot.isFramework),
    frameworkVersion: snapshot.framework?.version ?? null,
    checks,
    status: worst(findings),
    summary: {
      blockers: findings.filter((f) => f.level === BLOCKER).length,
      warnings: findings.filter((f) => f.level === WARN).length,
      checks: checks.length,
    },
  };
}
