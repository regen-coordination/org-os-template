// src/connectors/koi.mjs — REAL connector. KOI-net as a knowledge source. The deployed node
// (https://regen.gaiaai.xyz/api/koi) exposes a paginated corpus inventory, not an event stream:
// GET /rids?limit=&offset= → { pagination: {total, limit, offset, has_more}, rids: [...] }, each
// entry carrying { rid, context, source, title, url, indexed_at }. pull walks that inventory,
// bounded by max_records (a real node carries 30k+ RIDs) and optionally filtered by context.
// Cursor = the highest indexed_at seen (opaque ISO timestamp); entries at/below it are skipped
// on later pulls. map is pure and handles both the inventory shape (rid-entry) and the KOI-net
// NEW/UPDATE/FORGET event shape, for coordinators that do expose events. RIDs use the opaque
// `orn:` scheme — never parsed — and are preserved as source_lineage so KOI identity survives
// round-trips. Many RIDs are `#chunkN` fragments of one document; consolidation is a follow-on.
// subscribe (live event stream) is declared-but-deferred.
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

  // Live KOI exposes a paginated corpus inventory (GET /rids), not an event stream.
  // Bounded by max_records because a real node carries 30k+ RIDs. Cursor = the highest
  // indexed_at seen (opaque ISO timestamp); items at/below it are skipped on later pulls.
  async pull(config = {}, { cursor } = {}, deps = {}) {
    const getJSON = deps.getJSON || (async (url) => {
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`KOI ${url} failed: ${r.status}`);
      return r.json();
    });
    const base = (config.coordinator || 'https://regen.gaiaai.xyz/api/koi').replace(/\/$/, '');
    const pageSize = config.page_size || 50;
    const max = config.max_records || 200;
    const contexts = config.contexts || null;   // e.g. ['orn:web.page'] — null = all
    const since = cursor || config.since || null;
    const records = [];
    const warnings = [];
    let high = since;
    let offset = 0;
    let total = null;
    while (records.length < max) {
      const page = await getJSON(`${base}/rids?limit=${pageSize}&offset=${offset}`);
      const rids = (page && page.rids) || [];
      if (total === null) total = page && page.pagination ? page.pagination.total : null;
      if (!rids.length) break;
      for (const r of rids) {
        if (contexts && !contexts.includes(r.context)) continue;
        if (since && r.indexed_at && r.indexed_at <= since) continue;
        records.push({ kind: 'rid-entry', ...r });
        if (r.indexed_at && (!high || r.indexed_at > high)) high = r.indexed_at;
        if (records.length >= max) break;
      }
      const hasMore = page && page.pagination ? page.pagination.has_more : false;
      if (!hasMore) break;
      offset += pageSize;
    }
    if (total !== null && records.length >= max && total > max) {
      warnings.push(`koi: bounded pull — took ${records.length} of ${total} RIDs (raise max_records to ingest more)`);
    }
    for (const w of warnings) console.warn(`⚠ ${w}`);
    return { records, cursor: high, warnings };
  },

  // PURE translation. Handles both the live inventory shape (rid-entry) and the KOI-net
  // event shape (NEW/UPDATE/FORGET) for coordinators that expose an event stream.
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
    if (record.kind === 'rid-entry') {
      return [{ schema: 'resource', object: {
        title: record.title || record.rid,
        type: 'resource',
        resource_type: 'document',
        url: record.url || undefined,
        original_source: record.rid,
        source_lineage: record.rid,
        notes: record.context ? `KOI context: ${record.context}` : undefined,
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
