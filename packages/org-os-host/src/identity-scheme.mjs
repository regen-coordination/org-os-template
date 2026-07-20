// Coherence rule (spec): a member id is a URI whose scheme matches the instance's
// canonical platform. github-canonical → github:<handle>; radicle-canonical → did:<method>.
const SCHEME_FOR = { github: 'github:', radicle: 'did:' };

export function validateMemberIdScheme(members = [], canonical = 'github') {
  if (!Object.prototype.hasOwnProperty.call(SCHEME_FOR, canonical)) {
    return { ok: false, errors: [`unknown canonical platform: ${canonical}`] };
  }
  const wanted = SCHEME_FOR[canonical];
  const errors = [];
  for (const m of members) {
    if (typeof m?.id !== 'string' || !m.id.startsWith(wanted)) {
      errors.push(`member id "${m?.id}" must use scheme "${wanted}" for canonical=${canonical}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
