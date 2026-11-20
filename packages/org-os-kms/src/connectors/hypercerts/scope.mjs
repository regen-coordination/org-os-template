// packages/org-os-kms/src/connectors/hypercerts/scope.mjs — which accounts a run may read.
// The scope is the accounts `follows_of` follows on Certified, plus any DIDs listed in config. Nothing else: the
// connector never reads the whole directory (about 9,600 candidates on 2026-11-18, nearly all unrelated).

const DID = /^did:(plc:[a-z0-9]{8,}|web:[a-z0-9][a-z0-9.\-]*(:[A-Za-z0-9._%\-]+)*)$/;

function checkDid(value, where) {
  if (typeof value !== 'string' || !DID.test(value)) throw new Error(`hypercerts: ${where} "${String(value)}" is not a DID (expected did:plc:… or did:web:…)`);
  return value;
}

/** @returns {Promise<string[]>} sorted, de-duplicated DIDs. Throws when the scope would be empty. */
export async function resolveScope(config = {}, client) {
  const listed = (config.dids || []).map((d) => checkDid(d, 'dids entry'));
  const followsOf = config.follows_of ? checkDid(config.follows_of, 'follows_of') : null;
  if (!followsOf && !listed.length) throw new Error('hypercerts: config needs follows_of or dids');
  const followed = [];
  if (followsOf) for (const f of await client.listFollowing(followsOf)) followed.push(checkDid(f.did, 'followed account'));
  const scope = [...new Set([...followed, ...listed])].sort();
  if (!scope.length) throw new Error(`hypercerts: ${followsOf} follows nobody on Certified and config has no dids; refusing to read the whole directory (config needs follows_of or dids)`);
  return scope;
}
