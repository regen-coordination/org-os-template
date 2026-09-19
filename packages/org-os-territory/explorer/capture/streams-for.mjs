// explorer/capture/streams-for.mjs — "data about this place", derived at BUILD time (never in the browser): a stream touches a unit when it
// names the unit, names a unit above it (the real unitsFor walks part_of), or informs the unit's whole layer. First matching reason wins.
import { unitsFor } from '../../src/units.mjs';

export const REASONS = { direct: 'names this place', above: 'names a place above it', layer: 'covers this whole layer' };

export function streamsFor(units, streams, index) {
  const out = {};
  for (const u of units) {
    const chain = unitsFor(u, index).units;
    out[u.unit_id] = streams.flatMap((s) => {
      const refs = s.unit_refs || [];
      const reason = refs.includes(u.unit_id) ? REASONS.direct : refs.some((r) => chain.includes(r)) ? REASONS.above : (s.layer_refs || []).includes(u.layer) ? REASONS.layer : null;
      return reason ? [{ title: s.title, reason }] : [];
    });
  }
  return out;
}
