/**
 * finding.mjs — the shared result vocabulary every assessment check speaks.
 *
 * A check is a pure function: snapshot → CheckResult. It performs no I/O, so
 * its fixtures are plain objects and its tests never touch the filesystem.
 * All I/O lives in src/snapshot.mjs.
 *
 * Levels, in ascending severity:
 *   OK       — nothing to report
 *   WARN     — real drift, but the instance still works; does not fail `assess`
 *   BLOCKER  — the instance is broken or unsafe to sync; `assess` exits 1
 */

export const OK = 'OK';
export const WARN = 'WARN';
export const BLOCKER = 'BLOCKER';

const RANK = { [OK]: 0, [WARN]: 1, [BLOCKER]: 2 };

/** Severity of the worst finding in the list (OK when the list is empty). */
export function worst(findings) {
  return findings.reduce((acc, f) => (RANK[f.level] > RANK[acc] ? f.level : acc), OK);
}

/**
 * Build a CheckResult.
 *
 * @param {string} id     stable machine id, e.g. "versions"
 * @param {string} title  human scorecard label
 * @param {Array<{level: string, code: string, message: string, hint?: string}>} findings
 * @returns {{id: string, title: string, status: string, findings: Array}}
 */
export function result(id, title, findings) {
  return { id, title, status: worst(findings), findings };
}

export const finding = {
  warn: (code, message, hint) => ({ level: WARN, code, message, ...(hint ? { hint } : {}) }),
  blocker: (code, message, hint) => ({ level: BLOCKER, code, message, ...(hint ? { hint } : {}) }),
};
