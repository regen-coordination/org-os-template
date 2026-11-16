// packages/admin/lib/workspace/publishable.mjs
//
// The knowledge commons' floor, as the house judges it (DAO-OS L6 §13, Q69): which public uses kms publishes, and whether
// a knowledge object is publishable by that floor. The list is copied from packages/toolkit-framework/src/publishable.mjs
// (a test fails if the two differ), so the house judges synchronously, without loading kms. Pure; no imports.
//
// The floor here is maturity and public use only. kms's own `isPublishable` also asks the object's kind (the instance's
// `publish.types_opt_in` / `types_opt_out`), and an instance's `publish.gate` can hold more back; both can only narrow it.
// So "would this edit make the object publishable" answered here is a safe superset of what a publish run would publish:
// an edit this floor calls publishing is a publication decision even where the instance's own rule would still hold the
// object back (ruling R-L6-T10-1).

/** The public uses kms's floor publishes (toolkit-framework `PUBLISHABLE_PUBLIC_USE`). @type {readonly string[]} */
export const PUBLISHABLE_PUBLIC_USE = Object.freeze([
  'ok-with-caveat', 'source-linked-unreviewed', 'reviewed-for-explanation', 'reviewed-for-guidance',
])

/** Whether `object` passes the floor: its public use is publishable and its maturity is not `held` (the one maturity the
 *  floor refuses). A missing object passes nothing.
 *  @param {Record<string, unknown> | null | undefined} object @returns {boolean} */
export function floorPublishable(object) {
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return false
  return typeof object.public_use === 'string' && PUBLISHABLE_PUBLIC_USE.includes(object.public_use) && object.maturity !== 'held'
}

/** Whether going from `before` (null: no object yet) to `after` makes a knowledge object publishable by the floor: its
 *  public use moves into the list, its maturity leaves `held` while its public use is publishable, or it is created so.
 *  @param {Record<string, unknown> | null | undefined} before @param {Record<string, unknown> | null | undefined} after
 *  @returns {boolean} */
export function becomesPublishable(before, after) {
  return floorPublishable(after) && !floorPublishable(before)
}
