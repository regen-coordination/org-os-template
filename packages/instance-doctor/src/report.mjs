/**
 * B7 — report. Two output modes over one assessment:
 *   renderScorecard()  human, one line per check plus every finding
 *   toJson()           machine, for CI and for `doctor sync`'s receipts
 *
 * Exit code: 1 when any BLOCKER is present, 0 otherwise. Warnings never fail
 * unless --strict, mirroring scripts/validate-identity.mjs — a doctor that
 * failed on every warning would be one nobody runs.
 */

import { BLOCKER, WARN } from './lib/finding.mjs';

const ICON = { OK: '✓', WARN: '⚠', BLOCKER: '✗' };

export function exitCodeFor(assessment, { strict = false } = {}) {
  if (assessment.summary.blockers > 0) return 1;
  if (strict && assessment.summary.warnings > 0) return 1;
  return 0;
}

export function renderScorecard(assessment) {
  const lines = [];
  const title = assessment.name || assessment.dir || 'instance';
  lines.push('');
  lines.push(`org-os instance doctor — ${title}`);
  if (assessment.dir) lines.push(`  ${assessment.dir}`);
  lines.push(
    `  assessed against framework ${assessment.frameworkVersion ?? '(unknown version)'}${assessment.isFramework ? ' — this IS the framework checkout' : ''}`,
  );
  lines.push('');

  for (const check of assessment.checks) {
    lines.push(`  ${ICON[check.status]} ${check.title.padEnd(24)} ${check.status}`);
    for (const f of check.findings) {
      lines.push(`      ${ICON[f.level]} [${f.code}] ${f.message}`);
      if (f.hint) lines.push(`         → ${f.hint}`);
    }
  }

  lines.push('');
  lines.push('  ' + '─'.repeat(60));
  const { blockers, warnings } = assessment.summary;
  lines.push(`  ${blockers} blocker(s), ${warnings} warning(s) across ${assessment.summary.checks} checks`);
  if (blockers > 0) {
    lines.push('');
    lines.push('  ✗ This instance has blockers. Fix them, or run `doctor sync` where the');
    lines.push('    hint says sync repairs it, before relying on this instance.');
  } else if (warnings > 0) {
    lines.push('');
    lines.push('  ⚠ No blockers. The warnings above are drift worth closing.');
  } else {
    lines.push('');
    lines.push('  ✓ Instance is healthy.');
  }
  lines.push('');
  return lines.join('\n');
}

export function toJson(assessment) {
  return JSON.stringify(
    {
      tool: '@org-os/instance-doctor',
      dir: assessment.dir,
      name: assessment.name,
      isFramework: assessment.isFramework,
      frameworkVersion: assessment.frameworkVersion,
      status: assessment.status,
      summary: assessment.summary,
      checks: assessment.checks.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        findings: c.findings.map((f) => ({
          level: f.level,
          code: f.code,
          message: f.message,
          hint: f.hint ?? null,
        })),
      })),
    },
    null,
    2,
  );
}

export { BLOCKER, WARN };
