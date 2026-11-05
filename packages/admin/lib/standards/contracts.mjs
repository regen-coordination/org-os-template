// packages/admin/lib/standards/contracts.mjs
//
// contracts.json (EIP-4824 contracts, addendum §5.5, ruling L8-C10): the public on-chain Systems, one entry per
// contract. Reads only the public projection. A Safe's extensions carry counts, never owners (rule 9).
// Pure; relative imports only (vendored into instances).
import { HATS_V1 } from '../hats.mjs'
import { contractIdsOf } from './ids.mjs'

const CONTEXT = 'https://www.daostar.org/schemas'
const ON_CHAIN = new Set(['safe', 'hats-tree', 'gardens-community', 'gardens-pool', 'daouri-registration'])

/** @param {unknown} v @returns {string | null} */
const text = v => (typeof v === 'string' && v.trim() !== '' ? v : null)
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A Safe's counts on one chain from its read's facts (chains[] for several chains, the top level for one).
 * @param {unknown} read @param {string} chain @returns {Record<string, unknown>} */
function safeFacts(read, chain) {
  if (!isObj(read) || read.ok !== true || !isObj(read.facts)) return {}
  const facts = read.facts
  /** @type {Record<string, unknown> | null} */
  let source = null
  if (Array.isArray(facts.chains)) {
    const hit = facts.chains.find(c => isObj(c) && c.chain === chain)
    if (isObj(hit) && hit.ok !== false) source = hit
  } else if (facts.chain === chain) source = facts
  if (!source) return {}
  const signers = Array.isArray(source.owners) ? source.owners.length : source.owners
  const out = {}
  if (typeof source.threshold === 'number') out['org-os.threshold'] = source.threshold
  if (typeof signers === 'number') out['org-os.signers'] = signers
  if (text(read.readAt)) out['org-os.readAt'] = read.readAt
  return out
}

/**
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ doc: { '@context': string, contracts: Record<string, unknown>[] }, problems: { level: 'error' | 'warn', file: string, text: string }[] }}
 */
export function contractsDoc(pub) {
  /** @type {{ level: 'error' | 'warn', file: string, text: string }[]} */
  const problems = []
  /** @type {Record<string, unknown>[]} */
  const contracts = []
  for (const system of pub.systems) {
    const kind = String(system.kind)
    if (!ON_CHAIN.has(kind)) continue
    const ids = contractIdsOf(system)
    if (ids.length === 0) {
      problems.push({ level: 'warn', file: 'contracts.json', text: `system ${String(system.id)} (${kind}) has no usable chain and address (is the address quoted in YAML?): not listed as a contract` })
      continue
    }
    const name = text(system.name) ?? (kind === 'daouri-registration' ? 'Registration contract' : null)
    const description = text(system.description) ?? (kind === 'daouri-registration' ? 'ERC-4824 registration contract' : null)
    for (const { id, chain } of ids) {
      /** @type {Record<string, unknown>} */
      const extensions = { 'org-os.kind': kind, 'org-os.system': system.id }
      if (kind === 'hats-tree') extensions['org-os.contract'] = `${chain}:${HATS_V1}`
      if (kind === 'safe') Object.assign(extensions, safeFacts(pub.reads?.[String(system.id)], chain))
      contracts.push({ id, ...(name ? { name } : {}), ...(description ? { description } : {}), extensions })
    }
  }
  contracts.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
  return { doc: { '@context': CONTEXT, contracts }, problems }
}

/**
 * L8 §6: a warn per public registration System whose read names a daoURI other than the identity's.
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ level: 'error' | 'warn', file: string, text: string }[]}
 */
export function registrationProblems(pub) {
  const mine = String(pub.identity.daoURI)
  /** @type {{ level: 'error' | 'warn', file: string, text: string }[]} */
  const out = []
  for (const system of pub.systems) {
    if (system.kind !== 'daouri-registration') continue
    const read = pub.reads?.[String(system.id)]
    if (!isObj(read) || read.ok === false || !isObj(read.facts)) continue
    const registered = text(read.facts.daoURI)
    if (registered && registered !== mine) {
      out.push({ level: 'warn', file: 'dao.json', text: `system ${String(system.id)} registers daoURI ${registered}, but this organisation's daoURI is ${mine}` })
    }
  }
  return out
}
