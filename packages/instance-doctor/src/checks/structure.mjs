/**
 * B5 — structure + schemas.
 *
 * The framework already owns two validators. Neither is importable as a
 * library — both are top-level scripts that run on import — so this check
 * consumes the results of running them as subprocesses (the snapshot layer
 * does that; see src/snapshot.mjs).
 *
 * Crucially it runs the FRAMEWORK's copies against the target directory, never
 * the instance's own: instances carry missing or skewed copies, which is the
 * defect the doctor exists to find. `validate-structure.mjs` has always
 * accepted a target as argv[2]; `validate-identity.mjs` gained the same in this
 * change.
 */

import { result, finding } from '../lib/finding.mjs';

const LABELS = {
  structure: { name: 'structure', script: 'scripts/validate-structure.mjs' },
  schemas: { name: 'schemas', script: 'scripts/validate-identity.mjs' },
};

export function checkStructure(snapshot) {
  const findings = [];

  for (const [key, label] of Object.entries(LABELS)) {
    const v = snapshot.validators?.[key];
    if (!v || !v.ran) {
      findings.push(
        finding.warn(
          'validator-did-not-run',
          `the ${label.name} validator could not be run against this instance${v?.reason ? ` (${v.reason})` : ''}`,
          `run it by hand: node ${label.script} <dir>`,
        ),
      );
      continue;
    }

    if (v.exitCode !== 0) {
      findings.push(
        finding.blocker(
          `${label.name}-invalid`,
          `${label.name} validation failed with ${v.failed ?? '?'} failing check(s)`,
          v.tail || `run node ${label.script} <dir> for the full output`,
        ),
      );
    } else if (v.warnings > 0) {
      findings.push(
        finding.warn(
          `${label.name}-warnings`,
          `${label.name} validation passed with ${v.warnings} warning(s)`,
          `run node ${label.script} <dir> to see them`,
        ),
      );
    }
  }

  return result('structure', 'Structure + schemas', findings);
}
