// src/connectors/koi.mjs — REAL connector. KOI-net as a knowledge source. Wraps the KOI
// coordinator HTTP surface (the same one packages/koi-bridge speaks): POST /events/poll for
// NEW/UPDATE/FORGET events, POST /bundles/fetch for contents. map is pure. Cursor = the KOI
// event sequence watermark (opaque). RID is preserved as source_lineage so KOI identity
// survives round-trips. subscribe (live event stream) is declared-but-deferred.
export const koiConnector = {
  name: 'koi',
  protocol: 'KOI-net',
  capabilities: { ingest: true, subscribe: false, publish: false },

  describe(config = {}) {
    const coordinator = config.coordinator || 'https://regen.gaiaai.xyz/api/koi';
    return {
      title: config.title || `KOI: ${config.rid_scope || coordinator}`,
      type: 'knowledge-garden',
      steward: config.steward || 'KOI federation',
      return_path: config.return_path || coordinator,
      url: coordinator,
    };
  },

  async pull(config = {}, { cursor } = {}) {
    const coordinator = config.coordinator || 'https://regen.gaiaai.xyz/api/koi';
    const pollRes = await fetch(`${coordinator}/events/poll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: cursor || null, rid_scope: config.rid_scope || null }),
    });
    if (!pollRes.ok) throw new Error(`KOI poll failed: ${pollRes.status}`);
    const { events = [], cursor: next } = await pollRes.json();
    const rids = events.filter((e) => e.event_type !== 'FORGET').map((e) => e.rid);
    let bundles = [];
    if (rids.length) {
      const fetchRes = await fetch(`${coordinator}/bundles/fetch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rids }),
      });
      if (fetchRes.ok) bundles = (await fetchRes.json()).bundles || [];
    }
    const byRid = new Map(bundles.map((b) => [b.rid, b]));
    const records = events.map((e) => ({ ...e, ...(byRid.get(e.rid) || {}) }));
    return { records, cursor: next !== undefined ? next : cursor };
  },

  map(record, _config = {}) {
    if (record.event_type === 'FORGET') {
      return [{ schema: 'signal', object: {
        title: `KOI FORGET: ${record.rid}`,
        type: 'signal',
        signal_type: 'source-system',
        proposed_intervention: 'review',
        interpretation: `KOI signalled FORGET for ${record.rid}; review before removing anything.`,
        source_lineage: record.rid,
      } }];
    }
    const c = record.contents || {};
    return [{ schema: 'resource', object: {
      title: c.title || record.rid,
      type: 'resource',
      resource_type: 'document',
      original_source: record.rid,
      source_lineage: record.rid,
      notes: c.text ? String(c.text).slice(0, 500) : undefined,
    } }];
  },
};
