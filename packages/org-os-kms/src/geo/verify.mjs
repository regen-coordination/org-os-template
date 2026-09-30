import { isGeoId } from './ids.mjs';
// poll the open Geo GraphQL API until each id is visible in the space.
// Reads need no auth. Only 32-hex ids are ever inlined in the query; anything else is returned as `invalid`.
export async function verifyIndexed({ api, space, geoIds, fetchImpl = globalThis.fetch, intervalMs = 5000, timeoutMs = 120000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const invalid = geoIds.filter((id) => !isGeoId(id));
  geoIds = geoIds.filter(isGeoId);
  const pending = new Set(geoIds);
  const start = now();
  while (pending.size) {
    for (const id of [...pending]) {
      const remaining = timeoutMs - (now() - start);
      if (remaining <= 0) break;
      try {
        const res = await fetchImpl(api, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: `{ entity(id: "${id}") { id spaceIds } }` }),
          signal: AbortSignal.timeout(Math.min(remaining, 15000)) });
        const json = await res.json().catch(() => ({}));
        const e = json?.data?.entity;
        if (e && Array.isArray(e.spaceIds) && e.spaceIds.includes(space)) pending.delete(id);
      } catch (_err) {
        // request failed or timed out; treat as "not yet" and continue
      }
    }
    if (!pending.size || now() - start >= timeoutMs) break;
    await sleep(Math.min(intervalMs, timeoutMs - (now() - start)));
  }
  return { indexed: geoIds.filter((id) => !pending.has(id)), missing: [...pending], ...(invalid.length ? { invalid } : {}) };
}
