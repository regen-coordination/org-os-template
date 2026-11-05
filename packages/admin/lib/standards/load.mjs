// packages/admin/lib/standards/load.mjs
//
// An instance's records as the standards builder's input (lane L8, spec §3, §5.5, §6): federation.yaml identity,
// data/visibility.yaml, the data/*.yaml registries (aliases resolved as REGISTRIES says), the front matter and body of
// content/{meetings,projects}/*.md, 0.6's contract fallbacks and identity.onchain_registration as Systems, each with
// its warning. It reads files and nothing else: no npm package (the YAML parser is passed in — the CLI passes js-yaml's
// `load`, the server the `yaml` package's `parse`), so an instance's vendored copy runs without admin's dependencies.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTRIES, resolveTopKey } from '../registries.mjs'
import { readPolicy, effectiveLevel } from '../visibility.mjs'

/** @typedef {import('./project.mjs').StandardsInput} StandardsInput */
/** @typedef {import('./project.mjs').Problem} Problem */
/** @typedef {(text: string) => unknown} ParseYaml */

/** The System kinds with an on-chain contract (contracts.mjs). */
const ON_CHAIN = new Set(['safe', 'hats-tree', 'gardens-community', 'gardens-pool', 'daouri-registration'])
/** 0.6's words, kept (scripts/generate-all-schemas.mjs before L8). */
const MOVE_HINT = 'move these to data/systems.yaml (the 0.6 migration does: node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs --dry, then the same without --dry)'
/** What 0.6's federation/governance keys become, with the ids and names the 0.6 migration gives them. */
const FALLBACKS = /** @type {const} */ ([
  ['safe', { id: 'treasury-safe', kind: 'safe', name: 'Treasury' }],
  ['gardens', { id: 'gardens-pool', kind: 'gardens-pool', name: 'Gardens pool' }],
])
const MARKDOWN = /** @type {const} */ (['meetings', 'projects'])
/** `---` front matter `---`, then the body. */
const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {v is string} */
const filled = v => typeof v === 'string' && v.trim() !== ''
/** @param {string} file @param {string} text @returns {Problem} */
const warn = (file, text) => ({ level: 'warn', file, text })
/** @param {unknown} err */
const firstLine = err => String(err instanceof Error ? err.message : err).split('\n')[0]

/**
 * @param {string} root the instance's directory
 * @param {{ parseYaml: ParseYaml }} options
 * @returns {{ input: StandardsInput | null, problems: Problem[] }} input null: no
 *   daoURI (L8-C16), so nothing can be built. `input.records` also holds the registries no document is built from (a
 *   proposal's op may name them); a missing collection is [], a missing document is absent.
 */
export function loadStandardsInput(root, { parseYaml }) {
  /** @type {Problem[]} */
  const problems = []

  /** A file's parsed YAML; undefined when absent or unreadable (with a warning). @param {string} rel */
  const readYaml = rel => {
    const full = join(root, rel)
    if (!existsSync(full)) return undefined
    try {
      return parseYaml(readFileSync(full, 'utf8'))
    } catch (err) {
      problems.push(warn(rel, `cannot be read as YAML (${firstLine(err)}); read as missing`))
      return undefined
    }
  }

  // ── identity ──
  if (!existsSync(join(root, 'federation.yaml'))) {
    problems.push(warn('federation.yaml', 'is missing: identity.daoURI is not set — every id is built from it'))
    return { input: null, problems }
  }
  const federation = readYaml('federation.yaml')
  const id = isObj(federation) && isObj(federation.identity) ? federation.identity : {}
  if (!filled(id.daoURI)) {
    problems.push(warn('federation.yaml', 'identity.daoURI is not set — every id is built from it'))
    return { input: null, problems }
  }
  /** @type {StandardsInput['identity']} */
  const identity = {
    name: filled(id.name) ? id.name : 'Organization',
    type: filled(id.type) ? id.type : 'Organization',
    daoURI: id.daoURI,
  }
  if (!filled(id.name)) problems.push(warn('federation.yaml', 'identity.name is not set; published as "Organization"'))
  if (filled(id.short_description)) identity.short_description = id.short_description
  if (filled(id.description)) identity.description = id.description
  if (Array.isArray(id.attestation_issuers)) {
    /** @type {{ name: string, issuer: string }[]} */
    const issuers = []
    id.attestation_issuers.forEach((i, n) => {
      if (isObj(i) && filled(i.name) && filled(i.issuer)) issuers.push({ name: i.name, issuer: i.issuer })
      else problems.push(warn('federation.yaml', `identity.attestation_issuers #${n + 1} has no name or no issuer; not published`))
    })
    identity.attestationIssuers = issuers
  }

  // ── the policy ──
  const visibilityDoc = readYaml('data/visibility.yaml')
  const policyDoc = isObj(visibilityDoc) ? (isObj(visibilityDoc.visibility) ? visibilityDoc.visibility : visibilityDoc) : { collections: {}, defaults: {} }
  // the parsed policy is `input.policy` (I4): readsFor and L9 call isPublic on it, which reads only the parsed form
  const { policy, problems: policyProblems } = readPolicy(policyDoc)
  for (const text of policyProblems) problems.push(warn('data/visibility.yaml', text))

  // ── the registries ──
  /** @type {Record<string, unknown>} */
  const records = {}
  for (const def of REGISTRIES) {
    if (def.name === 'visibility') continue
    const file = `data/${def.name}.yaml`
    const top = readYaml(file)
    if (def.kind === 'collection') records[def.name] = []
    if (top === undefined || top === null) continue
    if (!isObj(top)) { problems.push(warn(file, 'is not a mapping of keys to values at its top level; read as missing')); continue }
    const present = [def.topKey, ...(def.aliases ?? [])].some(k => Object.hasOwn(top, k))
    const key = resolveTopKey(k => Object.hasOwn(top, k), def)
    const block = top[key]
    if (def.kind === 'collection') {
      if (Array.isArray(block)) records[def.name] = block
      else if (block !== undefined && block !== null) problems.push(warn(file, `\`${key}:\` is not a list of entries; read as missing`))
      continue
    }
    if (present) {
      if (isObj(block)) records[def.name] = block
      else if (block !== undefined && block !== null) problems.push(warn(file, `\`${key}:\` is not a mapping; read as missing`))
      continue
    }
    // a document written flat (finances, a hub's governance): the file's own keys
    const { schema_version: _version, ...flat } = top
    if (Object.keys(flat).length > 0) records[def.name] = flat
  }

  // ── Markdown records ──
  for (const collection of MARKDOWN) {
    const dir = join(root, 'content', collection)
    if (!existsSync(dir)) continue
    const list = /** @type {Record<string, unknown>[]} */ (records[collection])
    for (const name of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
      const rel = `content/${collection}/${name}`
      const text = readFileSync(join(dir, name), 'utf8').replace(/^﻿/, '')
      const m = FRONT_MATTER.exec(text)
      let data
      if (m) {
        try { data = parseYaml(m[1] ?? '') } catch (err) { problems.push(warn(rel, `front matter cannot be read as YAML (${firstLine(err)}); not read`)); continue }
      }
      if (!m || !isObj(data) || data.id === undefined || data.id === null || data.id === '') {
        problems.push(warn(rel, 'has no front matter with an id; not read'))
        continue
      }
      list.push({ ...data, body: text.slice(m[0].length) })
    }
  }

  // ── 0.6 contract fallbacks (spec §5.5) and the registration contract (spec §6) ──
  const systems = /** @type {Record<string, unknown>[]} */ ([...(/** @type {unknown[]} */ (records.systems))])
  const onChain = systems.some(s => isObj(s) && ON_CHAIN.has(String(s.kind)) && s.address !== undefined && s.address !== null && s.address !== '')
  if (!onChain) {
    /** @param {Record<string, unknown>} from @param {string} where @param {unknown} chain @param {'public' | 'members'} visibility */
    const take = (from, where, chain, visibility) => {
      /** @type {Record<string, unknown>[]} */
      const out = []
      for (const [key, shape] of FALLBACKS) {
        const value = from[key]
        if (value === undefined || value === null || value === '') continue
        if (typeof value !== 'string') { problems.push(warn('contracts.json', `${where}.${key} is not a string (write it in quotes); skipped`)); continue }
        out.push({ ...shape, ...(filled(chain) ? { chain } : {}), address: value, visibility })
      }
      return out
    }
    const fromIdentity = take(id, 'federation.yaml identity', id.chain, 'public')
    if (fromIdentity.length > 0) {
      systems.push(...fromIdentity)
      problems.push(warn('contracts.json', `read from federation.yaml identity — ${MOVE_HINT}`))
    } else {
      const governance = records.governance
      const infra = isObj(governance) && isObj(governance.infrastructure) ? governance.infrastructure : null
      if (infra) {
        const level = effectiveLevel(policy, 'governance', governance, 'infrastructure') === 'public' ? 'public' : 'members'
        const fromGovernance = take(infra, 'data/governance.yaml infrastructure', filled(infra.chain) ? infra.chain : id.chain, level)
        if (fromGovernance.length > 0) {
          systems.push(...fromGovernance)
          problems.push(warn('contracts.json', `read from data/governance.yaml infrastructure — ${MOVE_HINT}`))
        }
      }
    }
  }
  const registration = id.onchain_registration
  if (isObj(registration) && registration.enabled !== false && !systems.some(s => isObj(s) && s.kind === 'daouri-registration')) {
    const address = registration.contract_address
    if (typeof address === 'string' && address !== '') {
      const chain = filled(registration.chain) ? registration.chain : id.chain
      systems.push({ id: 'daouri-registration', kind: 'daouri-registration', ...(filled(chain) ? { chain } : {}), address, visibility: 'public' })
      problems.push(warn('contracts.json', 'the registration contract is read from federation.yaml identity.onchain_registration — move it to data/systems.yaml as a System of kind daouri-registration (chain and address)'))
    } else if (address !== undefined && address !== null && address !== '') {
      problems.push(warn('contracts.json', 'federation.yaml identity.onchain_registration.contract_address is not a string (write it in quotes); skipped'))
    }
  }
  records.systems = systems

  return {
    input: { identity, policy, records: /** @type {StandardsInput['records']} */ (records), reads: null },
    problems,
  }
}
