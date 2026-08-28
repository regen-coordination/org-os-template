/**
 * B1 — identity coherence and template leakage.
 *
 * `scripts/validate-identity.mjs` already compares IDENTITY.md against
 * federation.yaml. It does not compare either against the *published* identity
 * in `.well-known/dao.json`, and it accepts any non-empty name — which is why
 * bread-coop-os has been serving the framework's own name, "org-os", as its
 * DAO identity since the day it was bootstrapped, with every validator green.
 * That is the clean-room finding this check closes.
 *
 * Two deliberate differences from validate-identity:
 *   - types are compared by head token, so "Hub / Coordination OS" agrees with
 *     "Hub" — a documentation gloss is not drift;
 *   - the framework repo itself is exempt from leakage findings (it is not
 *     leaking the template identity; it *is* the template).
 */

import { result, finding } from '../lib/finding.mjs';

/** Names that belong to the framework and to no instance. */
export const FRAMEWORK_IDENTITY_NAMES = new Set([
  'org-os',
  'org-os-template',
  'organizational-os-template',
  'organizational os template',
  'organizational-os-framework',
]);

/** Scaffold text an operator is meant to replace during the bootstrap interview. */
const PLACEHOLDER_RE = /\bTBD\b|\[Your\b|\bYour Organization\b|\bXXX\b|<[a-z-]+>/i;

/** The declared type, before any parenthetical or slash gloss. */
export function headType(value) {
  if (!value) return null;
  return String(value).split(/[(/]/)[0].trim() || null;
}

function identityMdField(text, field) {
  if (!text) return null;
  const m = new RegExp(`^\\s*-\\s*\\*\\*${field}:\\*\\*\\s*(.+)$`, 'm').exec(text);
  return m ? m[1].trim() : null;
}

/**
 * Every surface that names the organization.
 * `package.json.name` is deliberately absent: it is a package slug, not a
 * display name, so comparing it to "ReFi Barcelona (ReFi BCN)" would only
 * generate noise. It is checked for template leakage instead.
 *
 * @returns {Array<{surface: string, value: string}>}
 */
export function identityNames(snapshot) {
  const names = [];
  const fromMd = identityMdField(snapshot.identityMd, 'Name');
  if (fromMd) names.push({ surface: 'IDENTITY.md', value: fromMd });
  const fromFed = snapshot.federation?.identity?.name;
  if (fromFed) names.push({ surface: 'federation.yaml', value: String(fromFed) });
  const fromDao = snapshot.daoJson?.name;
  if (fromDao) names.push({ surface: '.well-known/dao.json', value: String(fromDao) });
  return names;
}

export function checkIdentity(snapshot) {
  const findings = [];

  if (!snapshot.identityMd) {
    findings.push(
      finding.warn(
        'identity-md-missing',
        'IDENTITY.md is absent — the organization has no authored identity document',
        'run the bootstrap-interviewer skill, or copy templates/ and fill it in',
      ),
    );
  }
  if (!snapshot.daoJson) {
    findings.push(
      finding.warn(
        'dao-json-missing',
        '.well-known/dao.json is absent — the instance publishes no EIP-4824 identity',
        'npm run generate:schemas',
      ),
    );
  }

  // --- coherence across the surfaces that do exist -----------------------
  const names = identityNames(snapshot);
  const distinct = [...new Set(names.map((n) => n.value))];
  if (distinct.length > 1) {
    findings.push(
      finding.blocker(
        'identity-name-disagreement',
        `identity surfaces name different organizations: ${names.map((n) => `${n.surface}="${n.value}"`).join(', ')}`,
        'pick the authoritative name, fix the others, then npm run generate:schemas',
      ),
    );
  }

  const mdType = headType(identityMdField(snapshot.identityMd, 'Type'));
  const fedType = headType(snapshot.federation?.identity?.type);
  if (mdType && fedType && mdType !== fedType) {
    findings.push(
      finding.warn(
        'identity-type-disagreement',
        `IDENTITY.md declares type "${mdType}" but federation.yaml declares "${fedType}"`,
        'reconcile the two; federation.yaml is what federation peers read',
      ),
    );
  }

  // --- template leakage --------------------------------------------------
  if (!snapshot.isFramework) {
    const leaks = [];
    const pkgName = snapshot.packageJson?.name;
    if (pkgName && FRAMEWORK_IDENTITY_NAMES.has(String(pkgName).toLowerCase())) {
      leaks.push(`package.json name="${pkgName}"`);
    }
    for (const n of names) {
      if (FRAMEWORK_IDENTITY_NAMES.has(n.value.toLowerCase())) {
        leaks.push(`${n.surface} name="${n.value}"`);
      }
    }
    if (leaks.length > 0) {
      findings.push(
        finding.blocker(
          'template-leakage',
          `the instance still carries the framework's own identity: ${leaks.join(', ')}`,
          'replace with this organization\'s identity, then npm run generate:schemas — until then the instance publishes the framework as itself',
        ),
      );
    }
  }

  if (snapshot.identityMd && PLACEHOLDER_RE.test(snapshot.identityMd)) {
    findings.push(
      finding.warn(
        'scaffold-placeholder',
        'IDENTITY.md still contains unfilled scaffold placeholders (TBD / [Your …] / <…>)',
        'complete the bootstrap interview before federating',
      ),
    );
  }

  return result('identity', 'Identity coherence', findings);
}
