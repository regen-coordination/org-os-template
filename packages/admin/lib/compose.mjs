// packages/admin/lib/compose.mjs
//
// Composed Systems (L7 spec §4): records whose `deployment.status` is `composed` are a plan, not a thing on a chain.
// `compositionOf` turns them into one Composition; `compositionProblems` checks it as a whole. Pure; relative imports only.
import { DEPLOYMENTS } from './deployments.mjs'
import { parseHatRef } from './hats.mjs'
import { caip10, isAddress, parseCaip10 } from './caip.mjs'

const SEPOLIA = 'eip155:11155111'

/** @typedef {{ key: string, details: string, admin: string, max_supply: number, mutable: boolean, wearers: string[], role?: 'decides' | 'acts', image?: string, hat: string | null }} ComposedHat */
/** @typedef {{
 *   chain: string,
 *   safes: { id: string, chain: string, deployed?: true, address?: string, owners: string[], threshold: number, salt: string, gate: { hats: string[], threshold: { type: 'absolute' | 'proportional', min: number, target: number }, claimableFor: boolean } | null }[],
 *   trees: { id: string, chain: string, deployed?: true, address?: string, top: { details: string, image: string, wornBy: string, hat?: string }, hats: ComposedHat[] }[],
 *   spaces: { id: string, space: string, network: string, settings: Record<string, unknown>, elects?: string }[],
 *   registrations: { id: string, ens: string }[],
 *   links: string[] }} Composition */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @param {string} d */
const str = (v, d = '') => (typeof v === 'string' ? v : d)
/** @param {unknown} v @param {number} d */
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Whether a System is composed: planned, not deployed.
 * @param {Record<string, unknown>} system @returns {boolean} */
export function isComposed(system) {
  return isObj(system) && isObj(system.deployment) && system.deployment.status === 'composed'
}

/** @param {unknown} hat @returns {ComposedHat} */
function hatOf(hat) {
  const h = isObj(hat) ? hat : {}
  /** @type {ComposedHat} */
  const out = {
    key: str(h.key),
    details: str(h.details),
    admin: str(h.admin, 'top'),
    max_supply: num(h.max_supply, 1),
    mutable: h.mutable !== false,
    wearers: Array.isArray(h.wearers) ? h.wearers.map(String) : [],
    hat: typeof h.hat === 'string' ? h.hat : null,
  }
  if (h.role === 'decides' || h.role === 'acts') out.role = h.role
  if (typeof h.image === 'string') out.image = h.image
  return out
}

/**
 * The composed Systems as one Composition, or null when nothing is composed.
 * @param {Record<string, unknown>[]} systems @returns {Composition | null}
 */
export function compositionOf(systems) {
  const composed = (Array.isArray(systems) ? systems : []).filter(s => isComposed(s))
  if (composed.length === 0) return null
  /** @type {Composition} */
  const c = { chain: '', safes: [], trees: [], spaces: [], registrations: [], links: [] }
  for (const s of composed) {
    const id = String(s.id)
    const d = /** @type {Record<string, unknown>} */ (s.deployment)
    const own = typeof s.chain === 'string' ? s.chain : ''
    if (!c.chain) c.chain = own || str(d.network)
    if (s.kind === 'safe') {
      const g = isObj(s.signer_gate) ? s.signer_gate : null
      const t = isObj(g?.threshold) ? g.threshold : {}
      c.safes.push({
        id,
        chain: own,
        owners: Array.isArray(d.owners) ? d.owners.map(String) : [],
        threshold: num(d.threshold, 1),
        salt: str(d.salt, '0'),
        gate: g
          ? {
              hats: Array.isArray(g.hats) ? g.hats.map(String) : [],
              threshold: { type: t.type === 'proportional' ? 'proportional' : 'absolute', min: num(t.min, 1), target: num(t.target, 1) },
              claimableFor: g.claimable_for === true,
            }
          : null,
      })
    } else if (s.kind === 'hats-tree') {
      const top = isObj(d.top) ? d.top : {}
      // `deployment.top.hat`: the top hat's ref, recorded by the read-back once "Mint the top hat" reads done (the tree
      // stays composed until all of it is deployed). The plan reads that id first, and searches only without it.
      const recorded = parseHatRef(top.hat)
      c.trees.push({
        id,
        chain: own,
        top: { details: str(top.details), image: str(top.image), wornBy: str(top.worn_by), ...(recorded ? { hat: `${recorded.chain}:${recorded.hatId}` } : {}) },
        hats: Array.isArray(s.hats) ? s.hats.map(hatOf) : [],
      })
    } else if (s.kind === 'snapshot-space') {
      // `elects`: the hat whose wearers vote (`relates` to `<tree>/<key>` labelled `elects`, spec §4.2; L7 Task 13)
      const elects = (Array.isArray(s.relates) ? s.relates : []).find(r => isObj(r) && r.label === 'elects' && typeof r.to === 'string' && r.to.indexOf('/') > 0)
      c.spaces.push({ id, space: str(s.space), network: str(d.network, own), settings: isObj(d.settings) ? d.settings : {}, ...(elects ? { elects: String(elects.to) } : {}) })
    } else if (s.kind === 'daouri-registration') {
      c.registrations.push({ id, ens: str(s.ens) })
    } else {
      c.links.push(id)
    }
  }
  // A deployed System a composed one names (a partly flipped composition, spec §9) still resolves, with its address.
  const all = Array.isArray(systems) ? systems : []
  const named = new Set([
    ...c.trees.map(t => t.top.wornBy),
    ...c.safes.flatMap(s => (s.gate?.hats ?? []).map(h => h.split('/')[0] ?? '')),
    ...c.spaces.flatMap(s => (s.elects ? [s.elects.split('/')[0] ?? ''] : [])),
  ])
  for (const s of all) {
    if (isComposed(s) || !named.has(String(s.id)) || s.chain !== c.chain) continue
    const id = String(s.id)
    const address = typeof s.address === 'string' ? s.address : undefined
    if (s.kind === 'safe') c.safes.push({ id, chain: c.chain, deployed: true, ...(address ? { address } : {}), owners: [], threshold: 1, salt: '0', gate: null })
    else if (s.kind === 'hats-tree') {
      c.trees.push({ id, chain: c.chain, deployed: true, ...(address ? { address } : {}), top: { details: '', image: '', wornBy: '' }, hats: Array.isArray(s.hats) ? s.hats.map(hatOf) : [] })
    }
  }
  return c
}

/** Whether `value` is an account the composition on `chain` can use: a bare 0x address, or a CAIP-10 account on that chain.
 * @param {string} value @param {string} chain @returns {boolean} */
export function accountOn(value, chain) {
  if (isAddress(value)) return true
  const p = parseCaip10(value)
  return !!p && p.chain === chain
}

/** `system` with its composed accounts written as spec §4.1 writes them: CAIP-10 on the System's chain, checksummed
 *  (`deployment.owners` of a Safe, `hats[].wearers` of a Hats tree). A bare 0x address or an account on that chain is
 *  rewritten; anything else is left as written, for `compositionProblems` to refuse. A System that is not composed, or
 *  names no chain, is returned as it is (PF-R152's carry, closed in L7 Task 11).
 * @param {Record<string, unknown>} system @returns {Record<string, unknown>} */
export function withAccountsOnChain(system) {
  if (!isComposed(system)) return system
  const d = /** @type {Record<string, unknown>} */ (system.deployment)
  const chain = typeof system.chain === 'string' && system.chain !== '' ? system.chain : str(d.network)
  if (!chain) return system
  const on = (/** @type {unknown} */ v) => {
    if (typeof v !== 'string' || !accountOn(v, chain)) return v
    const p = parseCaip10(v)
    return caip10(chain, p ? p.address : v)
  }
  const out = { ...system }
  if (system.kind === 'safe' && Array.isArray(d.owners)) out.deployment = { ...d, owners: d.owners.map(on) }
  if (system.kind === 'hats-tree' && Array.isArray(system.hats)) {
    out.hats = system.hats.map(h => (isObj(h) && Array.isArray(h.wearers) ? { ...h, wearers: h.wearers.map(on) } : h))
  }
  return out
}

/** The sentence for an owner or a wearer that is no account on `chain` (L7 Tasks 19/17 review, M1).
 * @param {string} who `owner "<v>"` or `wearer "<v>" of hat <key>` @param {string} chain */
const notAnAccount = (who, chain) => `${who} is neither a 0x address nor an account on ${chain} (${chain}:0x…).`

/** What a composed Snapshot space's `erc1155-balance-of` strategies name that is not a composed hat on Hats v1 (fix I-2):
 *  an explicit `address` other than Hats v1's on the space's network, or a `tokenId` that is not one `${hat.<tree>/<key>}`.
 *  Such a strategy is refused, never rewritten. `[]` when none (or the space's network has no deployments, said apart).
 * @param {Composition['spaces'][number]} space @returns {string[]} */
export function spaceStrategyProblems(space) {
  const hats = Object.hasOwn(DEPLOYMENTS, space.network) ? DEPLOYMENTS[space.network].hats.address.toLowerCase() : null
  if (!hats) return []
  const listed = Array.isArray(space.settings.strategies) ? space.settings.strategies : []
  /** @type {string[]} */
  const out = []
  listed.forEach((st, i) => {
    if (!isObj(st) || st.name !== 'erc1155-balance-of' || !isObj(st.params)) return
    const { address, tokenId } = st.params
    const which = `strategy ${i + 1} (erc1155-balance-of)`
    if (address !== undefined && (typeof address !== 'string' || address.toLowerCase() !== hats)) {
      out.push(`${which} names the contract ${String(address)}, not Hats v1: it counts a composed hat on Hats v1; leave \`address\` out.`)
    }
    if (tokenId !== undefined && !(typeof tokenId === 'string' && /^\$\{hat\.[^}]+\}$/.test(tokenId))) {
      out.push(`${which} names token id "${String(tokenId)}" itself: name the hat it counts as \${hat.<tree>/<key>}, or leave \`tokenId\` out to count the hat the space elects.`)
    }
  })
  return out
}

/** The fields whose problems are accounts the planner cannot read: nothing is planned while one stands.
 * @param {{ field: string, message: string }} p */
export const isAccountProblem = p => (p.field === 'deployment.owners' || /^hats\.[^.]+\.wearers$/.test(p.field)) && p.message.includes(' is neither a 0x address nor an account on ')

/**
 * What is wrong with the Composition as a whole, in words. `[]` when nothing is.
 * @param {Composition} c @returns {{ system: string, field: string, message: string }[]}
 */
export function compositionProblems(c) {
  /** @type {{ system: string, field: string, message: string }[]} */
  const out = []
  const sepoliaOnly = `Deploying is built for Sepolia (${SEPOLIA}) only.`
  for (const s of [...c.safes, ...c.trees]) {
    if (!s.deployed && !Object.hasOwn(DEPLOYMENTS, s.chain)) out.push({ system: s.id, field: 'chain', message: sepoliaOnly })
  }
  for (const s of c.spaces) {
    if (!Object.hasOwn(DEPLOYMENTS, s.network)) out.push({ system: s.id, field: 'deployment.network', message: sepoliaOnly })
    for (const message of spaceStrategyProblems(s)) out.push({ system: s.id, field: 'deployment.settings.strategies', message })
  }
  for (const safe of c.safes) {
    if (safe.deployed) continue // the chain says its owners now
    const on = safe.chain || c.chain
    for (const o of safe.owners) {
      if (!accountOn(o, on)) out.push({ system: safe.id, field: 'deployment.owners', message: notAnAccount(`owner "${o}"`, on) })
    }
    if (!(safe.threshold >= 1 && safe.threshold <= safe.owners.length)) {
      out.push({ system: safe.id, field: 'deployment.threshold', message: `threshold is ${safe.threshold}, and the Safe has ${safe.owners.length} owners; it is between 1 and the number of owners.` })
    }
    for (const ref of safe.gate?.hats ?? []) {
      const slash = ref.indexOf('/')
      const tree = slash > 0 ? c.trees.find(t => t.id === ref.slice(0, slash)) : undefined
      if (!tree || !tree.hats.some(h => h.key === ref.slice(slash + 1))) {
        out.push({ system: safe.id, field: 'signer_gate.hats', message: `the signer gate names ${ref}, which is not a composed hat.` })
      }
    }
    // The gate's owner hat is the top hat of its first hat's tree: this Safe wears it, or another holds the gate (fix I4).
    // A deployed tree's wearer is the chain's to say (the plan reads it); one worn by no composed Safe is said below.
    const first = safe.gate?.hats[0]
    const owner = first && first.indexOf('/') > 0 ? c.trees.find(t => t.id === first.slice(0, first.indexOf('/'))) : undefined
    const wornBy = owner && !owner.deployed ? owner.top.wornBy : ''
    if (owner && wornBy !== '' && wornBy !== safe.id && c.safes.some(s => s.id === wornBy && s.chain === owner.chain)) {
      out.push({
        system: safe.id, field: 'signer_gate.hats',
        message: `the signer gate's owner hat is the top hat of ${owner.id}, which ${wornBy} wears, not this Safe: the gate's first hat is in a tree whose top hat this Safe wears.`,
      })
    }
  }
  for (const tree of c.trees) {
    if (tree.deployed) continue
    const keys = new Set(tree.hats.map(h => h.key))
    for (const hat of tree.hats) {
      if (hat.admin !== 'top' && !keys.has(hat.admin)) {
        out.push({ system: tree.id, field: `hats.${hat.key}.admin`, message: `hat ${hat.key}'s admin is "${hat.admin}", which is not a hat of this tree.` })
      }
      for (const w of hat.wearers) {
        const on = tree.chain || c.chain
        if (!accountOn(w, on)) out.push({ system: tree.id, field: `hats.${hat.key}.wearers`, message: notAnAccount(`wearer "${w}" of hat ${hat.key}`, on) })
      }
      if (hat.wearers.length > hat.max_supply) {
        out.push({ system: tree.id, field: `hats.${hat.key}.wearers`, message: `hat ${hat.key} has ${hat.wearers.length} wearers and room for ${hat.max_supply} (max_supply).` })
      }
    }
    const worn = tree.top.wornBy
    if (worn !== '' && !c.safes.some(s => s.id === worn && s.chain === tree.chain)) {
      out.push({ system: tree.id, field: 'deployment.top.worn_by', message: `the top hat is worn by "${worn}", which is not a composed Safe on ${tree.chain}.` })
    }
  }
  for (const reg of c.registrations) {
    // the schema's `ens` pattern (systems.schema.json), as lib/ens.mjs reads a name (kept here without importing it:
    // this module is vendored into instances with its imports, tests/clone-manifest.txt)
    if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+eth$/.test(reg.ens)) {
      out.push({ system: reg.id, field: 'ens', message: 'a daoURI registration is named by an ENS name ending in .eth: lower-case letters, digits and hyphens.' })
    }
  }
  for (const space of c.spaces) {
    if (!/^[^\s.]+(\.[^\s.]+)*\.eth$/.test(space.space)) {
      out.push({ system: space.id, field: 'space', message: 'a Snapshot space is named by an ENS name ending in .eth.' })
    }
  }
  return out
}
