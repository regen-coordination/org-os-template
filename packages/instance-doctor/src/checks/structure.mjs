/**
 * B5 — structure + schemas + data + governance.
 *
 * The framework owns four validators. None is importable as a
 * library — all are top-level scripts that run on import — so this check
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
  // 0.6 F1: every data/*.yaml against the admin schemas. Its last output line
  // above "Results" is its last error, which carries the repair (for example
  // "merge them into one document under `governance:`"); `tail` keeps it.
  data: { name: 'data', script: 'scripts/validate-data.mjs', optional: true },
  // 0.6 F2: the rules are well-formed, and the history agrees with them. The doctor runs it
  // without --strict, so a commit that went around the loop is a warning here (architecture
  // §4.7: an error in CI, a warning locally); rules that cannot work fail it.
  governance: { name: 'governance', script: 'scripts/validate-governance.mjs', optional: true },
};

export function checkStructure(snapshot) {
  const findings = [];

  for (const [key, label] of Object.entries(LABELS)) {
    const v = snapshot.validators?.[key];
    // A snapshot taken before the data validator existed has no `data` key: nothing to say.
    if (!v && label.optional) continue;
    // validate:data exits 2 when it cannot run (admin deps missing, bad root):
    // that is the validator not running, not the data failing.
    if (!v || !v.ran || (label.optional && v.exitCode === 2)) {
      findings.push(
        finding.warn(
          'validator-did-not-run',
          `the ${label.name} validator could not be run against this instance${v?.reason ? ` (${v.reason})` : ''}`,
          v?.ran && v.tail ? v.tail : `run it by hand: node ${label.script} <dir>`,
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
