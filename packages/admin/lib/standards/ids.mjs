// packages/admin/lib/standards/ids.mjs
//
// Entity types, URIs and CAIP ids shared by the standards document builders (lane L8).
// Pure; imports only relative modules (it is vendored into instances without admin's npm deps).
import { caip10 } from '../caip.mjs'
import { treeRef } from '../hats.mjs'

/** L8-C5. @param {string} identityType @returns {'DAO'|'Foundation'|'Person'|'Entity'|'Organization'} */
export function entityType(identityType) {
  switch (identityType) {
    case 'DAO': return 'DAO'
    case 'Foundation': return 'Foundation'
    case 'PersonalNode': return 'Person'
    case 'Other': return 'Entity'
    default: return 'Organization'
  }
}

/** @param {unknown} daoURI @returns {string | null} 'https://host' or null when not an https URL */
export function originOf(daoURI) {
  if (typeof daoURI !== 'string') return null
  let u
  try { u = new URL(daoURI) } catch { return null }
  return u.protocol === 'https:' && u.host ? u.origin : null
}

/** @param {string} origin @param {string} file @returns {string} */
export function wellKnown(origin, file) { return `${origin}/.well-known/${file}` }

/** The id when it has a scheme, else a URL under the origin (L8-C6).
 * @param {string} id @param {string} origin @returns {string} */
export function memberUri(id, origin) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(id) ? id : `${origin}/members/${encodeURIComponent(id)}`
}

/** @param {string} daoURI @param {string} id @returns {string} */
export function proposalUri(daoURI, id) { return `${daoURI}?proposalId=${encodeURIComponent(id)}` }

/** @param {string} space @param {string} id @returns {string} */
export function snapshotProposalUri(space, id) { return `https://snapshot.box/#/s:${space}/proposal/${id}` }

/** The record's `chain`, then its `chains`, without repeats (mirrors server/systems/safe.ts chainsOf, minus its throws).
 * @param {Record<string, unknown>} system @returns {string[]} */
export function systemChains(system) {
  const out = []
  if (typeof system.chain === 'string' && system.chain) out.push(system.chain)
  if (Array.isArray(system.chains)) {
    for (const c of system.chains) if (typeof c === 'string' && c && !out.includes(c)) out.push(c)
  }
  return out
}

/** @param {() => string} f @returns {string | null} */
function attempt(f) { try { return f() } catch { return null } }

/** The on-chain identifiers of a system (L8-C10); [] for kinds with no contract. Never throws.
 * @param {Record<string, unknown>} system @returns {{ id: string, chain: string }[]} */
export function contractIdsOf(system) {
  const address = system.address
  const chains = systemChains(system)
  const kind = system.kind
  /** @type {{ id: string, chain: string }[]} */
  const out = []
  if (kind === 'safe') {
    if (typeof address !== 'string') return out
    for (const chain of chains) { const id = attempt(() => caip10(chain, address)); if (id) out.push({ id, chain }) }
  } else if (kind === 'hats-tree') {
    const chain = chains[0]
    if (!chain || (typeof address !== 'string' && typeof address !== 'number')) return out
    const id = attempt(() => treeRef(chain, address))
    if (id) out.push({ id, chain })
  } else if (kind === 'gardens-community' || kind === 'gardens-pool' || kind === 'daouri-registration') {
    const chain = chains[0]
    if (!chain || typeof address !== 'string') return out
    const id = attempt(() => caip10(chain, address))
    if (id) out.push({ id, chain })
  }
  return out
}

/** The pool's own CAIP-10 (L8-C11), or `daoip-5:<org>:grantPool:<id>` off chain.
 * @param {Record<string, unknown>} system @param {string} orgName @returns {string} */
export function grantPoolId(system, orgName) {
  const first = contractIdsOf(system)[0]
  return first ? first.id : `daoip-5:${orgName}:grantPool:${String(system.id)}`
}

/** @param {string} poolAccount @param {number | string} number @returns {string} */
export function applicationId(poolAccount, number) { return `${poolAccount}?proposalId=${number}` }
