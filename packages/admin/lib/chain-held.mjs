// packages/admin/lib/chain-held.mjs
//
// What the chain holds of a deployed System (L7 gap B1; PF-R224's words made one rule). A System is deployed when its
// `deployment.status` reads `deployed`: the Hub read it back from the chain (Task 12's flip). Its fields the chain holds
// are the ones its kind's driver reads it by and the read-back's flip writes (server/deploy/readback.ts `flipOps`):
//   - every deployed kind: `kind` and `driver` (which driver reads it: a deployed System read by another driver, or by
//     none, reads nothing of what the chain holds; review I-2), `chain` and `address` (CAIP-10 is the two), and
//     `deployment` but its `on_deploy` (status, read_back, top, network, and whatever composed owners, threshold or
//     settings it still holds); `on_deploy` is the governance to be written, not the chain's;
//   - a Safe: `chains` (the same Safe read on other chains) and `signer_gate` (the gate's wiring and address);
//   - a Hats tree: `hats` (each hat's key, ref, admin, details, supply, mutability, image and wearers); a hat's `role`
//     (where it sits on the map) is not the chain's, and a wearer list may be dropped, as the flip drops it once the gate
//     registers the signers (P9: the chain says the wearers then);
//   - a Snapshot space: `space` and `url` (the space the driver reads, and the hub it reads it on);
//   - a daoURI registration: `ens` (the name whose text record holds the daoURI).
// Everything else (name, description, notes, relates, roles, role, tags, position, order, section, embeddable)
// is the record's own and is edited like any record's. Pure: no node:* import, so the client reads the same list.

import { canonicalJson } from './proposals.mjs'

/** The fields the chain holds, by kind, for a deployed System. */
export const CHAIN_HELD = Object.freeze({
  safe: Object.freeze(['kind', 'driver', 'chain', 'chains', 'address', 'deployment', 'signer_gate']),
  'hats-tree': Object.freeze(['kind', 'driver', 'chain', 'address', 'deployment', 'hats']),
  'snapshot-space': Object.freeze(['kind', 'driver', 'chain', 'space', 'url', 'deployment']),
  'daouri-registration': Object.freeze(['kind', 'driver', 'chain', 'address', 'ens', 'deployment']),
})

/** What is said when a change would write a field the chain holds on a deployed System. @param {string} field */
export const CHAIN_HELD_SENTENCE = field =>
  `${field} of a deployed System is what the chain holds: change it on the chain, then read it back.`

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Absent and null are the same here (an update's null removes a field). */
const absent = v => v === undefined || v === null
const same = (a, b) => (absent(a) && absent(b)) || (!absent(a) && !absent(b) && canonicalJson(a) === canonicalJson(b))

/** Whether `system` is deployed: read back from the chain (`deployment.status: deployed`). @param {unknown} system */
export function isDeployed(system) {
  return isObj(system) && isObj(system.deployment) && system.deployment.status === 'deployed'
}

/** The fields the chain holds of `system`, or [] when it is not deployed or its kind deploys nothing here.
 *  @param {unknown} system @returns {readonly string[]} */
export function chainHeldFields(system) {
  if (!isDeployed(system)) return []
  const s = /** @type {Record<string, unknown>} */ (system)
  return Object.hasOwn(CHAIN_HELD, String(s.kind)) ? CHAIN_HELD[/** @type {keyof typeof CHAIN_HELD} */ (String(s.kind))] : []
}

/** `deployment` without `on_deploy`, by key. */
const deploymentKeys = (d) => (isObj(d) ? Object.keys(d).filter(k => k !== 'on_deploy') : [])

/** Whether a tree's hats as `after` holds them keep what the chain holds of `before`'s: the same hats in the same order,
 *  each the same but for its `role`, and its wearers the same or dropped. */
function sameHats(before, after) {
  if (absent(before) && absent(after)) return true
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false
  return before.every((b, i) => {
    const a = after[i]
    if (!isObj(a) || !isObj(b)) return same(a, b)
    const { role: _ra, ...ra } = a
    const { role: _rb, ...rb } = b
    if (!Object.hasOwn(ra, 'wearers') || absent(ra.wearers)) { delete rb.wearers; delete ra.wearers }
    return same(ra, rb)
  })
}

/**
 * The fields the chain holds of `before` (a deployed System) that `after` changes, each once, in the kind's order:
 * `deployment.<key>` for a key of its deployment (but `on_deploy`), the field's name otherwise. [] when `before` is not
 * deployed, when `after` is absent (a delete is judged elsewhere), or when nothing the chain holds changes.
 * @param {unknown} before @param {unknown} after @returns {string[]}
 */
export function chainHeldChanges(before, after) {
  const fields = chainHeldFields(before)
  if (fields.length === 0 || !isObj(after)) return []
  const b = /** @type {Record<string, unknown>} */ (before)
  /** @type {string[]} */
  const out = []
  for (const field of fields) {
    if (field === 'deployment') {
      const keys = [...new Set([...deploymentKeys(b.deployment), ...deploymentKeys(after.deployment)])]
      const was = isObj(b.deployment) ? b.deployment : {}
      const now = isObj(after.deployment) ? after.deployment : {}
      for (const k of keys) if (!same(was[k], now[k])) out.push(`deployment.${k}`)
      continue
    }
    if (field === 'hats') { if (!sameHats(b.hats, after.hats)) out.push('hats'); continue }
    if (!same(b[field], after[field])) out.push(field)
  }
  return out
}
