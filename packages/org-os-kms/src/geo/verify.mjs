// poll the open Geo GraphQL API until each id is visible in the space.
// Reads need no auth. Ids are validated 32-hex before they reach here, so inlining them in the query is safe.
export async function verifyIndexed({ api, space, geoIds, fetchImpl = globalThis.fetch, intervalMs = 5000, timeoutMs = 120000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const pending = new Set(geoIds);
  const start = now();
  while (pending.size) {
    for (const id of [...pending]) {
      const res = await fetchImpl(api, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ entity(id: "${id}") { id spaceIds } }` }) });
      const json = await res.json().catch(() => ({}));
      const e = json?.data?.entity;
      if (e && Array.isArray(e.spaceIds) && e.spaceIds.includes(space)) pending.delete(id);
    }
    if (!pending.size || now() - start >= timeoutMs) break;
    await sleep(intervalMs);
  }
  return { indexed: geoIds.filter((id) => !pending.has(id)), missing: [...pending] };
}
