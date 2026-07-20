// Pure parsers over radicle-httpd JSON and rad CLI stdout. Fixture-tested.
// httpd repo doc top-level: { payloads, delegates, threshold, visibility, rid, seeding, refs }
// payloads["xyz.radicle.project"].data = { defaultBranch, name, description }
// payloads["xyz.radicle.project"].meta contains the canonical head commit SHA.
// Confirmed against a live capture (seed.radicle.xyz, heartwood repo, 2026-07-20):
// the head SHA lives at payloads["xyz.radicle.project"].meta.head (a 40-hex string;
// meta also carries `issues`/`patches` counters, not shas) — findHead's first
// branch (`meta.head`) is the one that actually matches in production.
const PROJECT = 'xyz.radicle.project';

function findHead(meta) {
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.head === 'string') return meta.head;
  if (typeof meta.commit === 'string') return meta.commit;
  const sha = Object.values(meta).find((v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v));
  return sha || null;
}

export function parseRepoDoc(doc) {
  const proj = doc?.payloads?.[PROJECT] || {};
  const data = proj.data || {};
  return {
    rid: doc?.rid || null,
    name: data.name || null,
    description: data.description || null,
    defaultBranch: data.defaultBranch || 'main',
    threshold: typeof doc?.threshold === 'number' ? doc.threshold : 1,
    delegates: Array.isArray(doc?.delegates)
      ? doc.delegates.map((d) => ({ id: d.id, alias: d.alias || null }))
      : [],
    visibility: doc?.visibility?.type === 'private' ? 'private' : 'public',
    head: findHead(proj.meta),
    seeding: typeof doc?.seeding === 'number' ? doc.seeding : null,
  };
}

export function parseBlob(blob) {
  if (!blob || blob.binary) return null;
  return typeof blob.content === 'string' ? blob.content : null;
}

// `rad self` prints a "DID  did:key:z6Mk..." line among others.
export function parseRadSelf(stdout) {
  const m = /did:key:z6[1-9A-HJ-NP-Za-km-z]+/.exec(stdout || '');
  return { did: m ? m[0] : null };
}
