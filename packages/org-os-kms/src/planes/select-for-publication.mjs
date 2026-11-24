// Publication selection: canon gate (verdicts) ∧ framework floor. Mints ids in the CANON for what
// passes. No grc20Id (no Geo space).
import { getAdapter, isPublishable, PUBLISHABLE_TYPES } from '../framework.mjs';
import { ensureIds } from '../identity.mjs';
import { visibilityFloor, scrubUnpublishedRefs } from '../visibility.mjs';
import { isClaim } from '../claims.mjs';

/**
 * `types` — the publish-eligible type list of the COMMONS being exported to, from
 * loadCommonsPolicy({ commonsDir: outDir }). Omitted, the framework floor falls back to its own
 * core PUBLISHABLE_TYPES, which knows nothing about extension packs: every pack type
 * (territorial-unit, data-stream) would then be floor-rejected here no matter what the commons
 * opted into, and the rejection would be silent — a reviewed, gate-passed unit simply never
 * appearing in the published store. Which types a commons publishes is ITS kms.yaml's call, so it
 * must be threaded in, not assumed. `config` is that commons' kms.yaml, kept for callers; a claim is refused whatever it says (see below).
 */
export function selectForPublication({ root, verdicts, uuid, types = PUBLISHABLE_TYPES, config = {} }) {
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
    // The visibility floor of a gated pack (a matching-only need is never public). Rules are registered by the caller's
    // loadCommonsPolicy before this runs; a type with no rule passes, so core types and ungated packs are unchanged.
    const floor = visibilityFloor(it.object, it.schema);
    if (!floor.ok) { floorRejected.push({ key, reason: floor.reason }); continue; }
    // A claim about a node never leaves through the export. The field policy (public-fields.mjs) drops claim_for, claim_status,
    // claim_node_did and publisher, so an exported claim would reach the public plane looking like the node's OWN record; and the
    // consent date stays home, so the plane's own publish could not re-check the claim floor. A claim is published from the
    // canon's own account (`publish`, with publish.claims on), where the floor and the claim marks both hold.
    if (isClaim(it.object)) { floorRejected.push({ key, reason: 'claims are not exported: a claim is published from the canon\'s own account (publish.claims), never through the export' }); continue; }
    selected.push({ key, ...it });
  }
  const { minted, items: ided } = ensureIds({ adapter: 'repo-data', target: root, items: selected, write: true, mintGeo: false, ...(uuid ? { uuid } : {}) });
  // The commons drops `related` today; should a ref field ever be kept, it never names a canon object that was not selected (spec 6.3).
  const items = scrubUnpublishedRefs(ided, listing);
  return {
    selected: items.map((it, i) => ({ key: selected[i].key, ...it })),
    minted: minted.length,
    mintedRefs: minted.map((m) => m.ref),
    floorRejected,
  };
}
