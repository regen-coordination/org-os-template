// Publication selection: canon gate (verdicts) ∧ framework floor. Mints ids in the CANON for what
// passes. No grc20Id (no Geo space).
import { getAdapter, isPublishable, PUBLISHABLE_TYPES } from '../framework.mjs';
import { ensureIds } from '../identity.mjs';

/**
 * `types` — the publish-eligible type list of the COMMONS being exported to, from
 * loadCommonsPolicy({ commonsDir: outDir }). Omitted, the framework floor falls back to its own
 * core PUBLISHABLE_TYPES, which knows nothing about extension packs: every pack type
 * (territorial-unit, data-stream) would then be floor-rejected here no matter what the commons
 * opted into, and the rejection would be silent — a reviewed, gate-passed unit simply never
 * appearing in the published store. Which types a commons publishes is ITS kms.yaml's call, so it
 * must be threaded in, not assumed.
 */
export function selectForPublication({ root, verdicts, uuid, types = PUBLISHABLE_TYPES }) {
  const listing = getAdapter('repo-data').list(root);
  const selected = []; const floorRejected = [];
  for (const it of listing) {
    const key = `${it.schema}:${it.ref.slice(it.ref.lastIndexOf('#') + 1)}`;
    if (!verdicts.get(key)?.ok) continue;
    if (!isPublishable(it.object, { schema: it.schema, types })) {
      // Two very different operator to-dos share this bucket, so say which one it is: a type this
      // commons does not publish is a kms.yaml decision, not a missing public_use assessment.
      const reason = types.includes(it.schema)
        ? 'public_use missing or not publishable'
        : `type ${it.schema} is not publish-eligible here (see the commons' kms.yaml publish.types_opt_in)`;
      floorRejected.push({ key, reason }); continue;
    }
    selected.push({ key, ...it });
  }
  const { minted, items } = ensureIds({ adapter: 'repo-data', target: root, items: selected, write: true, mintGeo: false, ...(uuid ? { uuid } : {}) });
  return {
    selected: items.map((it, i) => ({ key: selected[i].key, ...it })),
    minted: minted.length,
    mintedRefs: minted.map((m) => m.ref),
    floorRejected,
  };
}
