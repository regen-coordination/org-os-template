// packages/admin/lib/standards/grants.mjs
//
// grant-pools.json and applications.json (DAOIP-5, addendum §5.7 and §5.8, rulings L8-C11, L8-C12, Q-L8-1/Q54):
// the public grant pools (a public Gardens pool, or any public System with a `grant_pool` block) and, from a Gardens
// pool's read, its proposals as applications. Reads only the public projection. No payoutAddress, projectsURI or
// projectId; no beneficiary. Pure; relative imports only (vendored into instances).
import { grantPoolId, applicationId, wellKnown, entityType } from './ids.mjs'
import { MECHANISMS } from './daoip5.mjs'

export { MECHANISMS }

const CONTEXT = 'http://www.daostar.org/schemas'
const POOLS_FILE = 'grant-pools.json'
const APPS_FILE = 'applications.json'

/** Gardens proposal status → DAOIP-5 application status (addendum §5.8). */
export const GARDENS_STATUS = {
  inactive: 'pending', active: 'in_review', paused: 'in_review', disputed: 'in_review',
  executed: 'funded', cancelled: 'rejected', rejected: 'rejected',
}

/**
 * USD stablecoins whose amount counts 1:1 as US dollars (Q54): token CAIP-10s (EIP-55) on the chains the platform
 * supports (server/systems/chains.ts), each read from its issuer's own documentation. No price is ever fetched.
 * Left out, for want of an issuer page that gives the address: USDT on Optimism, Polygon, Arbitrum and Base (the
 * Tether page lists Ethereum and Celo only), any stablecoin on Gnosis, and issuers other than Circle, Tether and Mento.
 * @type {readonly string[]}
 */
export const USD_PEGGED = Object.freeze([
  // Circle USDC, https://developers.circle.com/stablecoins/usdc-contract-addresses
  'eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
  'eip155:10:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // OP Mainnet
  'eip155:137:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon PoS
  'eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
  'eip155:42161:0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One
  'eip155:42220:0xcebA9300f2b948710d2653dD7B07f33A8B32118C', // Celo
  // Tether USDT, https://tether.to/en/supported-protocols/ (the Celo address also on https://docs.celo.org/tooling/contracts/token-contracts)
  'eip155:1:0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
  'eip155:42220:0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', // Celo
  // Mento Dollar (USDm, formerly cUSD), https://docs.celo.org/tooling/contracts/token-contracts (Celo Mainnet)
  'eip155:42220:0x765DE816845861e75A25fCA122bb6898B8B1282a',
])

/** @param {unknown} v @returns {string | null} */
const text = v => (typeof v === 'string' && v.trim() !== '' ? v : null)
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {string} a @param {string} b */
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Base units to a decimal string, by string math (exact for any size): trailing zeros stripped, '0' stays '0'.
 * @param {string} base decimal digits @param {number} decimals @returns {string}
 */
export function formatUnits(base, decimals) {
  if (typeof base !== 'string' || !/^[0-9]+$/.test(base)) throw new TypeError(`formatUnits: ${JSON.stringify(base)} is not a base-unit integer`)
  if (!Number.isInteger(decimals) || decimals < 0) throw new TypeError(`formatUnits: ${decimals} is not a non-negative integer of decimals`)
  const digits = base.replace(/^0+(?=[0-9])/, '')
  if (decimals === 0) return digits
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '')
  return fraction === '' ? whole : `${whole}.${fraction}`
}

/** @param {unknown} base @param {unknown} decimals @returns {string | null} formatUnits, or null when it does not apply */
function units(base, decimals) {
  if (typeof base !== 'string' || typeof decimals !== 'number') return null
  try { return formatUnits(base, decimals) } catch { return null }
}

/** A read that answered: ok is not false and it has facts (an `ok: false` read is no read).
 * @param {unknown} read @returns {Record<string, unknown> | null} its facts */
function factsOf(read) {
  if (!isObj(read) || read.ok === false || !isObj(read.facts)) return null
  return read.facts
}

/** @param {unknown} v @returns {string | null} a number or a non-empty string as a string */
function amountText(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return text(v)
}

/** @param {unknown} v @returns {string | null} */
function dateText(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  return text(v)
}

/**
 * The pool's size in US dollars (Q54): a USD stablecoin counts 1:1 from the read; otherwise the org's own figure
 * `grant_pool.usd.amount`; otherwise null.
 * @param {Record<string, unknown>} system @param {unknown} read a DriverRead or undefined @returns {string | null}
 */
export function usdOf(system, read) {
  const facts = factsOf(read)
  if (facts && typeof facts.token === 'string' && USD_PEGGED.includes(facts.token)) {
    const exact = units(facts.amount, facts.decimals)
    if (exact !== null) return exact
  }
  const block = system?.grant_pool
  if (isObj(block) && isObj(block.usd)) return amountText(block.usd.amount)
  return null
}

/** @param {Record<string, unknown>} system @returns {boolean} */
const optedOut = system => system.grant_pool === false

/** @param {unknown} v @returns {{ amount: string, denomination: string }[] | null} */
function sizeFromRecord(v) {
  if (!Array.isArray(v)) return null
  const out = []
  for (const e of v) {
    if (!isObj(e)) continue
    const amount = amountText(e.amount), denomination = text(e.denomination)
    if (amount && denomination) out.push({ amount, denomination })
  }
  return out.length > 0 ? out : null
}

/**
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ doc: Record<string, unknown> | null, problems: { level: 'error' | 'warn', file: string, text: string }[] }}
 */
export function grantPoolsDoc(pub) {
  /** @type {{ level: 'error' | 'warn', file: string, text: string }[]} */
  const problems = []
  const warn = (/** @type {string} */ t) => problems.push({ level: 'warn', file: POOLS_FILE, text: t })
  const orgName = String(pub.identity.name)
  /** @type {Record<string, unknown>[]} */
  const grantPools = []
  for (const system of pub.systems) {
    const sid = String(system.id)
    const gardens = system.kind === 'gardens-pool'
    const block = isObj(system.grant_pool) ? system.grant_pool : null
    if (optedOut(system) || (!gardens && !block)) continue
    const read = pub.reads?.[sid]
    const facts = factsOf(read)
    if (facts && facts.type === 'signaling') {
      warn(`pool ${sid} is a signaling pool (it moves no funds): left out of ${POOLS_FILE}`)
      continue
    }
    const id = grantPoolId(system, orgName)
    const name = text(system.name) ?? sid
    const description = text(block?.description) ?? text(system.description)
    if (!description) problems.push({ level: 'error', file: POOLS_FILE, text: `pool ${sid} has no description: DAOIP-5 requires one (set description on the System or in grant_pool)` })
    const mechanism = text(block?.mechanism) ?? (gardens ? 'Conviction Voting' : null)
    if (!mechanism) warn(`pool ${sid} has no grant_pool.mechanism: grantFundingMechanism is absent`)
    /** @type {boolean | null} */
    let isOpen = typeof block?.is_open === 'boolean' ? block.is_open : null
    if (isOpen === null && facts && typeof facts.enabled === 'boolean') isOpen = facts.enabled && facts.archived !== true
    if (isOpen === null) warn(`pool ${sid} has neither grant_pool.is_open nor a live read: isOpen is absent`)

    /** @type {{ amount: string, denomination: string }[] | null} */
    let size = null
    const exact = facts ? units(facts.amount, facts.decimals) : null
    if (facts && exact !== null && text(facts.symbol)) size = [{ amount: exact, denomination: String(facts.symbol) }]
    size ??= sizeFromRecord(block?.size)
    if (!size) warn(`pool ${sid} has neither a live read of its funds nor grant_pool.size: totalGrantPoolSize is absent`)
    const usd = usdOf(system, read)
    if (usd === null) warn(`pool ${sid}: its size in US dollars is unknown (not a USD stablecoin, and no grant_pool.usd.amount): totalGrantPoolSizeInUSD is absent, the output is not DAOIP-5 conformant`)

    /** @type {Record<string, unknown>} */
    const extensions = { 'org-os.system': sid }
    if (gardens) extensions['org-os.source'] = 'unverified'
    if (facts && text(/** @type {any} */ (read).readAt)) extensions['org-os.readAt'] = /** @type {any} */ (read).readAt

    const closeDate = dateText(block?.close_date)
    grantPools.push({
      type: 'GrantPool', id, name,
      ...(description ? { description } : {}),
      ...(mechanism ? { grantFundingMechanism: mechanism } : {}),
      ...(isOpen !== null ? { isOpen } : {}),
      ...(closeDate ? { closeDate } : {}),
      applicationsURI: wellKnown(pub.origin, APPS_FILE),
      governanceURI: wellKnown(pub.origin, 'governance.md'),
      ...(size ? { totalGrantPoolSize: size } : {}),
      ...(usd !== null ? { totalGrantPoolSizeInUSD: usd } : {}),
      ...(text(block?.email) ? { email: block?.email } : {}),
      ...(text(block?.image) ? { image: block?.image } : {}),
      extensions,
    })
  }
  if (grantPools.length === 0) return { doc: null, problems }
  grantPools.sort((a, b) => byId(String(a.id), String(b.id)))
  return { doc: { '@context': CONTEXT, name: orgName, type: entityType(String(pub.identity.type)), grantPools }, problems }
}

/**
 * Live copy only: each public Gardens pool's proposals as applications. Null when no pool was read.
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {Record<string, unknown> | null}
 */
export function applicationsDoc(pub) {
  const orgName = String(pub.identity.name)
  /** @type {Record<string, unknown>[]} */
  const entries = []
  for (const system of pub.systems) {
    if (system.kind !== 'gardens-pool' || optedOut(system)) continue
    const sid = String(system.id)
    const read = pub.reads?.[sid]
    const facts = factsOf(read)
    if (!facts || !Array.isArray(facts.proposals)) continue
    const poolId = grantPoolId(system, orgName)
    const poolName = text(system.name) ?? sid
    const signaling = facts.type === 'signaling'
    const symbol = text(facts.symbol)
    const readAt = text(/** @type {any} */ (read).readAt)
    const page = isObj(/** @type {any} */ (read).open) ? text(/** @type {any} */ (read).open.url) : null
    /** @type {Record<string, unknown>[]} */
    const applications = []
    for (const p of facts.proposals) {
      if (!isObj(p) || typeof p.number !== 'number' || !Number.isInteger(p.number)) continue
      const when = typeof p.created === 'number' ? p.created : typeof p.executed === 'number' ? p.executed : null
      const asked = signaling || !symbol ? null : units(p.requested, facts.decimals)
      const status = typeof p.status === 'string' && Object.hasOwn(GARDENS_STATUS, p.status)
        ? GARDENS_STATUS[/** @type {keyof typeof GARDENS_STATUS} */ (p.status)] : null
      /** @type {Record<string, unknown>} */
      const extensions = { 'org-os.system': sid, 'org-os.source': 'unverified' }
      if (readAt) extensions['org-os.readAt'] = readAt
      if (typeof p.status === 'string') extensions['org-os.gardensStatus'] = p.status
      applications.push({
        type: 'GrantApplication', id: applicationId(poolId, p.number), grantPoolId: poolId, grantPoolName: poolName,
        ...(text(p.title) ? { projectName: p.title } : {}),
        ...(when !== null ? { createdAt: new Date(when * 1000).toISOString() } : {}),
        ...(page ? { contentURI: page } : {}),
        ...(asked !== null ? { fundsAsked: [{ amount: asked, denomination: symbol }] } : {}),
        ...(status ? { status } : {}),
        extensions,
      })
    }
    applications.sort((a, b) => byId(String(a.id), String(b.id)))
    entries.push({ type: 'GrantPool', name: poolName, applications })
  }
  if (entries.length === 0) return null
  entries.sort((a, b) => byId(String(a.name), String(b.name)))
  return { '@context': CONTEXT, name: orgName, type: entityType(String(pub.identity.type)), grantPools: entries }
}
