// Maps org-os governance onto Radicle's native identity-doc model.
// Main's quorum IS the identity-doc `threshold` over `delegates` — Radicle synthesizes
// the default-branch rule and DISALLOWS an explicit crefs rule for it. crefs is only
// for ADDITIONAL protected ref patterns (e.g. release tags).
//
// ⚙ Operator-gated: applying a threshold change or a crefs payload runs
// `rad id update --repo <RID> --no-confirm` against a running node with RAD_PASSPHRASE
// set (editor/quorum-driven identity-doc revision). These generators are pure and
// tested; the apply step is a documented operator action, not run here.
const DEFAULT_BRANCH_PATTERNS = new Set(['refs/heads/main', 'refs/heads/master']);

export function mainQuorum(federation) {
  const gov = federation?.governance || {};
  return {
    threshold: typeof gov.proposal_threshold === 'number' ? gov.proposal_threshold : 1,
    delegates: (gov.maintainers || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean),
    mainRuleIsImplicit: true, // enforced by the identity threshold, not a crefs rule
  };
}

export function buildCrefs(rules = []) {
  const out = {};
  for (const r of rules) {
    if (DEFAULT_BRANCH_PATTERNS.has(r.pattern)) {
      throw new Error(`crefs rule for the default branch (${r.pattern}) is disallowed by Radicle; main is governed by the identity threshold`);
    }
    out[r.pattern] = { allow: r.allow, threshold: r.threshold };
  }
  return out;
}
