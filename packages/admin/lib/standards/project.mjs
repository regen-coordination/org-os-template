// packages/admin/lib/standards/project.mjs
//
// The public projection (DAO-OS L8 spec §4): the only code that reads raw records. Every standards document builder
// takes its output, which holds nothing stricter than public, and `checkNoLeak` scans what they built for any string
// the projection withheld. Pure; imports only relative modules (it is vendored into instances without admin's deps).
import { readPolicy, isPublic, publicView, recordVisibilityProblem, effectiveLevel } from '../visibility.mjs'
import { REGISTRIES } from '../registries.mjs'
import { parseRecord } from '../ops.mjs'
import { caip10, parseCaip10, isAddress } from '../caip.mjs'
import { parseHatRef, treeIdOf, inTree, hatRef } from '../hats.mjs'
import { originOf, memberUri, systemChains, snapshotProposalUri, applicationId, contractIdsOf } from './ids.mjs'
import { MECHANISMS, APPLICATION_STATUSES } from './daoip5.mjs'
import { GENERATOR_MARK_KEY, GENERATOR_MARK } from './dao.mjs'

/** @typedef {import('../visibility.mjs').VisibilityPolicy} VisibilityPolicy */
/** @typedef {{ level: 'error' | 'warn', file: string, text: string }} Problem */
/** @typedef {{ ok: boolean, readAt: string | null, error?: string, facts: Record<string, unknown>, sections: unknown[], open: { url: string, embeddable: boolean } | null, state?: string }} DriverRead */
/**
 * @typedef {object} StandardsInput
 * @property {{ name: string, type: string, description?: string, short_description?: string, daoURI: string, attestationIssuers?: { name: string, issuer: string }[] }} identity
 *   short_description (federation.yaml's canonical field) is dao.json's description, else description
 * @property {VisibilityPolicy} policy parsed (`readPolicy(doc).policy`: what the loader gives, and what `isPublic` reads).
 *   projectPublic also accepts data/visibility.yaml's raw document here: it normalises through `readPolicy`, which is
 *   idempotent on a parsed policy
 * @property {{ members: Record<string, unknown>[], systems: Record<string, unknown>[], proposals: Record<string, unknown>[],
 *   governance: Record<string, unknown>, meetings: Record<string, unknown>[], projects: Record<string, unknown>[],
 *   finances: Record<string, unknown>, ideas: Record<string, unknown>[], 'knowledge-manifest': Record<string, unknown>,
 *   sources: Record<string, unknown>[] }} records raw, as in git, by registry name
 * @property {Record<string, DriverRead> | null} reads by system id; null: the git copy
 * @property {{ proposal?: (id: string) => string }} [urls]
 */
/** @typedef {{ id: string, kind: string, at: string, actor: string | null }} PublicEvent */
/** @typedef {{ id: string, title: string | null, author: string | null, state: string, opened: string, closed: string | null, rules: string[], restricted: boolean, attached: string[], events: PublicEvent[] }} PublicProposal */
/** @typedef {{ id: string, proposal: string | null, title: string | null, status: string, date: string, rule: string | null, method: string | null, restricted: boolean }} PublicDecision */
/**
 * @typedef {object} PublicInput
 * @property {StandardsInput['identity']} identity
 * @property {string} origin https://<host>
 * @property {{ id: string, record: Record<string, unknown>, withheld: string[] }[]} members id as published (L8-C6);
 *   `withheld`: the names (never the values) of the record's fields its public view drops, so a builder does not read
 *   a withheld `status` or `kind` as its default
 * @property {Record<string, unknown>[]} systems public views
 * @property {Record<string, DriverRead>} reads public Systems only
 * @property {PublicProposal[]} proposals
 * @property {PublicDecision[]} decisions
 * @property {{ description: string | null, rules: Record<string, unknown>[] } | null} governance null: not public
 * @property {{ meetings: Record<string, unknown>[], projects: Record<string, unknown>[], finances: Record<string, unknown>,
 *   ideas: Record<string, unknown>[], knowledge: Record<string, unknown> | null, sources: Record<string, unknown>[] }} extras
 */
/** @typedef {{ collection: string, records: number, fields: number, reads?: number }} Withheld reads: live reads not published
 *   because their System's public view drops a field (present only when one was) */

/** What a restricted proposal is called (the words of L4b and L5 spec §9.5). */
export const RESTRICTED_TITLE = 'A change to a restricted collection'

/** The leak scan's floor (L8-C15). */
const MIN_SECRET = 6

/**
 * Words the builders write of their own accord (R20): a withheld value equal to one of them, in any case, is not a
 * secret — the scan would find the builder's word, not the record's value, and refuse to publish for nothing. Fixed
 * vocabularies only: DAOIP-5's mechanisms and application statuses, the ledger's states, event and activity kinds,
 * attach payload kinds, registry names, Gardens statuses, and the literals of the documents (entity and document
 * types, 0.6's defaults, the words of URLs the builders compose, and the documents' keys, which the scan reads too:
 * a dropped read's section titled "Signers" is not published by the key `org-os.signers`). A test keeps the copied
 * lists equal to their sources (lib/proposals.mjs, lib/registries.mjs, grants.mjs GARDENS_STATUS, ACTIVITY_KINDS).
 */
export const VOCABULARY = Object.freeze([
  ...MECHANISMS, ...APPLICATION_STATUSES,
  // the ledger's states (lib/proposals.mjs PROPOSAL_STATES) and event kinds (EVENT_KINDS), and `opened` (an activity)
  'open', 'ratified', 'rejected', 'withdrawn', 'expired',
  'approve', 'object', 'vote', 'comment', 'retract', 'revise', 'replay', 'attach', 'system', 'withdraw', 'reject', 'expire', 'ratify', 'opened',
  // attach payload kinds (server/systems/driver.ts ForeignRef)
  'snapshot-proposal', 'hats-wearer', 'hats-hat', 'gardens-proposal',
  // Gardens proposal statuses (grants.mjs GARDENS_STATUS), and pool types (server/systems/gardens.ts POOL_TYPES: a dropped
  // read's `type` is a secret candidate, and `funding` is a word of the key grantFundingMechanism)
  'inactive', 'active', 'paused', 'disputed', 'executed', 'cancelled',
  'signaling', 'funding', 'streaming',
  // entity types (ids.mjs entityType) and document type literals
  'DAO', 'Foundation', 'Person', 'Entity', 'Organization', 'proposal', 'activity', 'GrantPool', 'GrantApplication', 'AttestationIssuer',
  'MeetingRegistry', 'ProjectRegistry', 'FinancialRegistry', 'IdeaRegistry', 'KnowledgeManifest',
  // the extras' 0.6 defaults (extras.mjs) and the contracts' (contracts.mjs)
  'meeting', 'planned', 'pending', 'project', 'Integrate', 'todo', 'medium', 'none', 'unverified',
  'Registration contract', 'ERC-4824 registration contract',
  // the drivers' own words in a read's `sections` (server/systems/*.ts): their section titles and the fixed labels of their
  // rows. A dropped read is withheld whole (C1), and a title such as "Decided" or a label such as "Voting" would
  // otherwise be found in governance.md's "decided by" or DAOIP-5's "Conviction Voting" (R38)
  'Proposals', 'Pool', 'Pools', 'Decided', 'Council', 'Roles', 'Wearers', 'Modules', 'Registration', 'Chains', 'Balances', 'Signers',
  'Waiting on signers', 'Executed', 'Open votes', 'Recent results', 'Settings',
  'Funds', 'Community', 'Admin', 'Allowlist', 'Type', 'Members', 'Council Safe', 'Council Safe change waiting',
  'Voting', 'Period', 'Delay', 'Quorum', 'Strategies', 'Validation', 'Admins',
  // the Safe read from the chain (L7-D15): its section, its row labels and its fixed cells
  'Safe', 'Version', 'Nonce', 'Guard', 'Fallback handler', 'Block', 'read from the chain', 'not known',
  // the generator's mark on dao.json (dao.mjs, L8-C18): its key, its field, its value and that value's words
  GENERATOR_MARK_KEY, 'generator', GENERATOR_MARK.generator, 'org-os', 'standards', 'org-os standards',
  // words of the URLs the builders compose
  'agenda', 'proposalId', 'safeTxHash', '.well-known',
  ...REGISTRIES.map(r => r.name),
  // the keys of the documents (the scan reads keys too): EIP-4824, DAOIP-3, DAOIP-5, the extras' 0.6 keys
  '@context', 'type', 'name', 'description', 'membersURI', 'proposalsURI', 'activityLogURI', 'governanceURI', 'contractsURI',
  'grantPoolsURI', 'attestationIssuersURI', 'meetingsURI', 'financesURI', 'members', 'proposals', 'activities', 'contracts',
  'status', 'contentURI', 'extensions', 'member', 'grantPools', 'grantFundingMechanism', 'isOpen', 'closeDate', 'applicationsURI',
  'totalGrantPoolSize', 'totalGrantPoolSizeInUSD', 'email', 'image', 'amount', 'denomination', 'applications', 'grantPoolId',
  'grantPoolName', 'projectName', 'createdAt', 'fundsAsked', 'attestationIssuers', 'issuer',
  'title', 'date', 'participants', 'notes', 'decisions', 'actionItems', 'assignee', 'dueDate', 'consensus', 'projects', 'lead',
  'startDate', 'endDate', 'milestones', 'tasks', 'budget', 'relatedProposals', 'priority', 'budgets', 'expenses', 'revenues',
  'ideas', 'domains', 'coverage', 'page_count', 'sources', 'last_updated', 'exchange', 'published_domains', 'subscribed_domains', 'url',
  // the documents' extension keys (L8-C13), with and without their prefix
  ...['opened', 'closed', 'rules', 'decision', 'executes', 'date', 'event', 'at', 'kind', 'system', 'contract', 'threshold', 'signers',
    'readAt', 'source', 'gardensStatus'].flatMap(k => [k, `org-os.${k}`]),
])
const VOCABULARY_LOWER = new Set(VOCABULARY.map(w => w.toLowerCase()))
/** An ISO-8601 date, or date and time (R20): builders write dates of their own (an event's time, a decision's date). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/

/** Whether a withheld string is no secret whatever the records say: a date, or a word of VOCABULARY.
 * @param {string} s */
const notSecret = s => ISO_DATE.test(s) || VOCABULARY_LOWER.has(s.toLowerCase())

/** The collections of `input.records`, in the order `withheld` lists them. */
const COLLECTIONS = /** @type {const} */ (['members', 'systems', 'proposals', 'governance', 'meetings', 'projects', 'finances', 'ideas', 'knowledge-manifest', 'sources'])
const DOCUMENTS = new Set(['governance', 'finances', 'knowledge-manifest'])

/** The kinds that close a proposal: their actor may be recorded on `closed.as` (L5 spec §7.2). */
const CLOSINGS = new Set(['ratify', 'reject', 'expire', 'withdraw'])

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {Record<string, unknown>[]} */
const listOf = v => (Array.isArray(v) ? v : [])
/** @param {unknown} v @returns {string | null} */
const str = v => (typeof v === 'string' ? v : null)

/** Every string of a value, nested, object keys excluded. @param {unknown} value @param {(s: string) => void} take */
function eachString(value, take) {
  if (typeof value === 'string') take(value)
  else if (Array.isArray(value)) for (const v of value) eachString(v, take)
  else if (isObj(value)) for (const v of Object.values(value)) eachString(v, take)
}

/** @param {string} file @param {string} text @returns {Problem} */
const warn = (file, text) => ({ level: 'warn', file, text })
/** @param {string} collection */
const fileOf = collection => `data/${collection}.yaml`

/**
 * Whether a System may be read for the live copy (C1): public, and every one of its fields public. A driver reads the
 * raw record, so a System with a withheld field is never read. `policy`: the parsed policy or the raw document.
 * @param {VisibilityPolicy | Record<string, unknown> | null | undefined} policy @param {unknown} system @returns {boolean}
 */
export function readable(policy, system) {
  const view = publicView(readPolicy(policy).policy, 'systems', system)
  return view !== null && Object.keys(/** @type {Record<string, unknown>} */ (system)).every(k => k === 'visibility' || k in view)
}

/**
 * The public projection of the raw input.
 * `secrets`: every string (6+ characters) of a withheld record or field — and of what a proposal never carries, of a
 * dropped read, and of a kept read's `sections` — that does not also appear (any case) in the public projection or, for
 * all but `sections`, in a kept read's facts and open (R38). A kept read's `sections` string is cleared only by that same
 * read's facts or open.
 * @param {StandardsInput} input
 * @returns {{ pub: PublicInput, withheld: Withheld[], secrets: Set<string>, problems: Problem[] }}
 */
export function projectPublic(input) {
  /** @type {Problem[]} */
  const problems = []
  /** Strings that may be secrets; the public ones are taken out at the end. */
  const candidates = new Set()
  /** @param {unknown} value */
  const withhold = value => eachString(value, s => { if (s.length >= MIN_SECRET) candidates.add(s) })
  /** Strings of kept reads' `sections` that the same read's facts and open do not carry (R38): never cleared by
   * another read's facts. */
  const sectionCandidates = new Set()

  const { policy, problems: policyProblems } = readPolicy(input?.policy)
  for (const text of policyProblems) problems.push(warn('data/visibility.yaml', text))

  const identity = input?.identity
  const records = /** @type {Record<string, unknown>} */ (isObj(input?.records) ? input.records : {})
  const rawReads = isObj(input?.reads) ? input.reads : {}
  const origin = originOf(identity?.daoURI)

  if (origin === null) {
    problems.push({ level: 'error', file: 'federation.yaml', text: `identity.daoURI ${JSON.stringify(identity?.daoURI ?? null)} is not an https URL: every published id is built from it, so nothing is published` })
    const pub = emptyPublic(identity)
    for (const c of COLLECTIONS) withhold(records[c])
    withhold(rawReads)
    return { pub, withheld: [], secrets: subtract(candidates, pub), problems }
  }

  /** @type {Map<string, Withheld>} */
  const counts = new Map()
  /** @param {string} collection @param {'records' | 'fields' | 'reads'} what @param {number} [n] */
  const count = (collection, what, n = 1) => {
    if (n <= 0) return
    /** @type {Withheld} */
    const c = counts.get(collection) ?? { collection, records: 0, fields: 0 }
    c[what] = (c[what] ?? 0) + n
    counts.set(collection, c)
  }

  /** Each public view's dropped field names (never their values), for the views `viewsOf` returns.
   * @type {WeakMap<Record<string, unknown>, string[]>} */
  const droppedOf = new WeakMap()

  /** A collection's public views, counting and withholding what is dropped. Records keep their input order.
   * @param {string} collection @returns {Record<string, unknown>[]} */
  const viewsOf = collection => {
    /** @type {Record<string, unknown>[]} */
    const out = []
    listOf(records[collection]).forEach((record, i) => {
      if (!isObj(record)) { problems.push(warn(fileOf(collection), `${collection} entry #${i + 1} is not a mapping; not published`)); withhold(record); count(collection, 'records'); return }
      const bad = recordVisibilityProblem(record)
      if (bad) problems.push(warn(fileOf(collection), `${collection} ${String(record.id ?? `#${i + 1}`)}: ${bad}`))
      const view = publicView(policy, collection, record)
      if (view === null) { withhold(record); count(collection, 'records'); return }
      const dropped = Object.keys(record).filter(k => k !== 'visibility' && !(k in view))
      for (const k of dropped) withhold(record[k])
      count(collection, 'fields', dropped.length)
      droppedOf.set(view, dropped)
      out.push(view)
    })
    return out
  }

  /** A document's public view, or null; counting and withholding what is dropped.
   * @param {string} name @returns {Record<string, unknown> | null} */
  const documentOf = name => {
    const doc = records[name]
    if (doc === undefined || doc === null) return null
    if (!isObj(doc)) { problems.push(warn(fileOf(name), `${name} is not a mapping; not published`)); withhold(doc); count(name, 'records'); return null }
    const bad = recordVisibilityProblem(doc)
    if (bad) problems.push(warn(fileOf(name), `${name}: ${bad}`))
    const view = publicView(policy, name, doc)
    if (view === null) { if (Object.keys(doc).length > 0) { withhold(doc); count(name, 'records') } return null }
    const dropped = Object.keys(doc).filter(k => k !== 'visibility' && !(k in view))
    for (const k of dropped) withhold(doc[k])
    count(name, 'fields', dropped.length)
    return view
  }

  // ── members ──
  const memberViews = viewsOf('members')
  /** raw id → published id, for public members */
  const publicMembers = new Map()
  /** @type {PublicInput['members']} */
  const members = []
  for (const record of memberViews) {
    if (typeof record.id !== 'string' || record.id === '') { problems.push(warn(fileOf('members'), 'a public member has no id; not published')); withhold(record); continue }
    const id = memberUri(record.id, origin)
    publicMembers.set(record.id, id)
    members.push({ id, record, withheld: [...(droppedOf.get(record) ?? [])].sort() })
  }

  // ── systems and their reads ──
  const systems = viewsOf('systems')
  /** @type {Map<string, Record<string, unknown>>} */
  const systemById = new Map()
  for (const s of systems) if (typeof s.id === 'string') systemById.set(s.id, s)
  /** @type {Record<string, DriverRead>} */
  const reads = {}
  for (const [id, read] of Object.entries(rawReads)) {
    const system = systemById.get(id)
    if (!system || !isObj(read)) { withhold(read); continue }
    // A driver reads the raw record (server/standards/reads.ts): a read of a System whose public view drops a field
    // can carry that field (a pool's address in its page URL, its community in its facts). Not published (C1).
    const hidden = droppedOf.get(system) ?? []
    if (hidden.length > 0) {
      withhold(read)
      count('systems', 'reads')
      problems.push(warn(fileOf('systems'), `systems ${id}: ${hidden.length === 1 ? 'a field is' : `${hidden.length} fields are`} not public, so its live read is not published`))
      continue
    }
    // `sections` are the members' side's tables: a driver names signers and voters there from data/members.yaml,
    // members-level members included. Builders read `facts` and `open` only. R38: a sections string this read's own
    // facts or open also carry (a proposal title, the pool's page) is what the builders publish from there, so it is
    // no secret; every other one is a candidate, and another read's facts do not clear it.
    const own = shownText([read.facts, read.open])
    eachString(read.sections, s => { if (s.length >= MIN_SECRET && !own.includes(s.toLowerCase())) sectionCandidates.add(s) })
    reads[id] = /** @type {DriverRead} */ ({ ...read, sections: [] })
  }
  /** Public hats trees, from the public views only (a withheld chain or address is no tree): for actors. */
  const trees = systems.filter(s => s.kind === 'hats-tree').flatMap(s => {
    const tree = treeOfView(s)
    return tree ? [tree] : []
  })
  /** The hat ref when it lies in a public tree; else null. @param {unknown} as */
  const publicHat = as => {
    const value = isObj(as) ? as.hat : undefined
    for (const t of trees) { const ref = hatIn(t, value); if (ref) return ref }
    return null
  }
  /** L8-C9: the recorded public hat, else the public member's URI, else null. A CAIP-10 actor is never published.
   * @param {unknown} as @param {unknown} by @returns {string | null} */
  const actorOf = (as, by) => {
    const hat = publicHat(as)
    if (hat) return hat
    if (typeof by !== 'string' || parseCaip10(by)) return null
    return publicMembers.get(by) ?? null
  }

  // ── proposals ──
  /** @type {PublicProposal[]} */
  const proposals = []
  /** id → restricted, for every published proposal; absent: not published */
  const published = new Map()
  /** ids of proposals in the ledger that are not published */
  const unpublished = new Set()
  listOf(records.proposals).forEach((raw, i) => {
    withhold(raw)   // what a proposal carries is in pub, and is taken out again at the end
    if (!isObj(raw) || typeof raw.id !== 'string' || raw.id === '') {
      problems.push(warn(fileOf('proposals'), `proposal #${i + 1} is not a proposal with an id; not published`))
      count('proposals', 'records')
      return
    }
    const bad = recordVisibilityProblem(raw)
    if (bad) problems.push(warn(fileOf('proposals'), `proposals ${raw.id}: ${bad}`))
    if (!isPublic(policy, 'proposals', raw)) { unpublished.add(raw.id); count('proposals', 'records'); return }
    const view = publicView(policy, 'proposals', raw) ?? {}
    if (typeof view.state !== 'string' || view.state === '') {
      // EIP-4824 requires a proposal's status: without a public state it cannot be an entry
      problems.push(warn(fileOf('proposals'), `proposals ${raw.id}: no public state; not published`))
      unpublished.add(raw.id); count('proposals', 'records'); return
    }
    try {
      const p = projectProposal(raw, view)
      proposals.push(p)
      published.set(p.id, p.restricted)
    } catch (err) {
      problems.push(warn(fileOf('proposals'), `proposals ${raw.id}: ${err instanceof Error ? err.message : String(err)}; published as restricted`))
      proposals.push({ id: raw.id, title: null, author: null, state: view.state, opened: str(view.opened) ?? '', closed: null, rules: [], restricted: true, attached: [], events: [] })
      published.set(raw.id, true)
    }
  })

  /** @param {Record<string, unknown>} raw @param {Record<string, unknown> & { state: string }} view its public view @returns {PublicProposal} */
  function projectProposal(raw, view) {
    const id = /** @type {string} */ (raw.id)
    const restricted = isRestricted(raw)
    const closed = isObj(view.closed) ? view.closed : null
    /** @type {PublicEvent[]} */
    const events = []
    /** @type {string[]} */
    const attached = []
    if (view.events !== undefined && !Array.isArray(view.events)) problems.push(warn(fileOf('proposals'), `proposals ${id}: events is not a list; none published`))
    listOf(view.events).forEach((e, n) => {
      if (!isObj(e) || typeof e.id !== 'string' || typeof e.kind !== 'string') {
        problems.push(warn(fileOf('proposals'), `proposals ${id}: event #${n + 1} has no id or kind; not published`))
        return
      }
      const as = isObj(e.as) ? e.as : CLOSINGS.has(e.kind) && closed ? closed.as : undefined
      events.push({ id: e.id, kind: e.kind, at: str(e.at) ?? '', actor: actorOf(as, e.by) })
      if (!restricted && e.kind === 'attach') for (const ref of publishedRefs(e.ref)) if (!attached.includes(ref)) attached.push(ref)
    })
    return {
      id,
      title: restricted ? null : str(view.title),
      author: actorOf(view.opened_as, view.author),
      state: view.state,
      opened: str(view.opened) ?? '',
      closed: closed ? str(closed.at) : null,
      rules: listOf(view.rules).flatMap(r => (isObj(r) && typeof r.id === 'string' ? [r.id] : typeof r === 'string' ? [r] : [])),
      restricted,
      attached,
      events,
    }
  }

  /** Rule 8 (L8-C8): an op target that is not public now, a private-op placeholder, or ops it cannot read.
   * @param {Record<string, unknown>} raw @returns {boolean} */
  function isRestricted(raw) {
    const id = String(raw.id)
    if (raw.ops === undefined || raw.ops === null) return false
    if (!Array.isArray(raw.ops)) { problems.push(warn(fileOf('proposals'), `proposals ${id}: ops is not a list; published as restricted`)); return true }
    let restricted = false
    for (const op of raw.ops) {
      if (!isObj(op)) { problems.push(warn(fileOf('proposals'), `proposals ${id}: an op is not a mapping; published as restricted`)); restricted = true; continue }
      if (op.op === 'private') { restricted = true; continue }
      if (typeof op.record !== 'string') { problems.push(warn(fileOf('proposals'), `proposals ${id}: an op names no record; published as restricted`)); restricted = true; continue }
      if (!opTargetPublic(op)) restricted = true
    }
    return restricted
  }

  /** Whether everything an op touches is public now. @param {Record<string, unknown>} op @returns {boolean} */
  function opTargetPublic(op) {
    const record = /** @type {string} */ (op.record)
    /** @type {{ registry: string, id: string }} */
    let parsed
    try { parsed = parseRecord(record) } catch {
      const name = record.includes(':') ? record.slice(0, record.indexOf(':')) : record
      const def = REGISTRIES.find(r => r.name === name)
      if (def?.kind !== 'document' || !DOCUMENTS.has(name)) return false
      const doc = records[name]
      return isObj(doc) && isPublic(policy, name, doc) && fieldsPublic(name, doc, op)
    }
    const list = records[parsed.registry]
    if (!Array.isArray(list) || DOCUMENTS.has(parsed.registry)) return false
    const target = list.find(e => isObj(e) && e.id !== undefined && e.id !== null && String(e.id) === parsed.id)
    return isObj(target) && isPublic(policy, parsed.registry, target) && fieldsPublic(parsed.registry, target, op)
  }

  /** The fields an op writes are public on its target. @param {string} registry @param {Record<string, unknown>} target @param {Record<string, unknown>} op */
  function fieldsPublic(registry, target, op) {
    const written = isObj(op.set) ? op.set : isObj(op.value) ? op.value : {}
    return Object.keys(written).every(k => k === 'visibility' || isPublic(policy, registry, target, k))
  }

  /** An attach event's ref in its published form (spec §5.3), when its System is public. Every published id is built
   * from the System's public view (its chain, address, space): the ledger's ref only selects and must agree with it.
   * The ref's payload kind must be the System's kind. A wearer is never published.
   * @param {unknown} ref @returns {string[]} */
  function publishedRefs(ref) {
    if (!isObj(ref) || typeof ref.system !== 'string' || typeof ref.id !== 'string') return []
    const system = systemById.get(ref.system)
    if (!system) return []
    const payload = isObj(ref.payload) ? ref.payload : {}
    const kind = payload.kind === undefined ? 'safe' : KIND_OF_PAYLOAD[String(payload.kind)]
    if (kind === undefined || system.kind !== kind) return []
    try {
      if (kind === 'snapshot-space') {
        const space = spaceOf(system)
        return space ? [snapshotProposalUri(space, ref.id)] : []
      }
      if (kind === 'hats-tree') {
        const tree = treeOfView(system)
        const hat = tree ? hatIn(tree, ref.id) : null
        return hat ? [hat] : []
      }
      const chains = systemChains(system)
      const address = typeof system.address === 'string' && isAddress(system.address) ? system.address : null
      if (address === null || chains.length === 0) return []
      if (kind === 'gardens-pool') {
        const m = /^(0x[0-9a-fA-F]{40})-([1-9][0-9]*)$/.exec(ref.id)
        if (!m || m[1].toLowerCase() !== address.toLowerCase()) return []
        return [applicationId(caip10(chains[0], address), m[2])]
      }
      const steps = [{ chain: str(ref.chain) ?? chains[0], id: ref.id }, ...listOf(ref.also).map(a => ({ chain: isObj(a) ? str(a.chain) : null, id: isObj(a) ? a.id : null }))]
      return steps.flatMap(st => (typeof st.chain === 'string' && chains.includes(st.chain) && typeof st.id === 'string' && /^0x[0-9a-fA-F]{64}$/.test(st.id)
        ? [`${caip10(st.chain, address)}?safeTxHash=${st.id.toLowerCase()}`]
        : []))
    } catch {
      return []
    }
  }

  // ── governance and its decision rows ──
  const govView = documentOf('governance')
  const govRaw = isObj(records.governance) ? records.governance : null
  /** @type {PublicInput['governance']} */
  const governance = govView === null ? null : {
    description: str(govView.description),
    rules: listOf(govView.rules).filter(isObj),
  }
  /** @type {PublicDecision[]} */
  const decisions = []
  if (govRaw && govView !== null && 'decisions' in govView) {   // else documentOf withheld them
    const docLevel = effectiveLevel(policy, 'governance', govRaw)
    listOf(govRaw.decisions).forEach((row, i) => {
      if (!isObj(row) || typeof row.id !== 'string' || row.id === '') {
        problems.push(warn(fileOf('governance'), `governance decision #${i + 1} has no id; not published`))
        withhold(row); count('governance', 'records'); return
      }
      const bad = recordVisibilityProblem(row)
      if (bad) problems.push(warn(fileOf('governance'), `governance decision ${row.id}: ${bad}`))
      const level = row.visibility === 'public' || row.visibility === 'members' ? row.visibility
        : row.visibility === undefined || row.visibility === null ? docLevel : 'members'
      if (!isPublic(policy, 'governance', { visibility: level }, 'decisions')) { withhold(row); count('governance', 'records'); return }
      withhold(row.by); withhold(row.summary)   // L8-C17: never published
      const named = str(row.proposal)
      const restricted = named !== null && (unpublished.has(named) || published.get(named) === true)
      if (restricted) withhold(row.title)
      // only a published proposal's id is carried: an unpublished one's id must never reach an output
      const proposal = named !== null && published.has(named) ? named : null
      if (named !== null && proposal === null) withhold(named)
      // EIP-4824 requires a status (R30): a row without one is 0.6's `draft`, never ""
      const status = typeof row.status === 'string' && row.status.trim() !== '' ? row.status : null
      if (status === null) problems.push(warn(fileOf('governance'), `governance decision ${row.id} has no status; published as draft`))
      decisions.push({
        id: row.id, proposal, title: restricted ? null : str(row.title), status: status ?? 'draft', date: str(row.date) ?? '',
        rule: str(row.rule), method: str(row.method), restricted,
      })
    })
  }

  /** The finances document's entries (budgets, expenses, revenues) that are public: an entry's own `visibility`
   * decides, else the document's (public, or it would not be here). Its `visibility` key is not carried.
   * @param {Record<string, unknown> | null} doc @returns {Record<string, unknown>} */
  function financesOf(doc) {
    if (doc === null) return {}
    /** @type {Record<string, unknown>} */
    const out = { ...doc }
    for (const list of ['budgets', 'expenses', 'revenues']) {
      if (!(list in out)) continue
      if (!Array.isArray(out[list])) { problems.push(warn(fileOf('finances'), `finances ${list} is not a list; not published`)); withhold(out[list]); delete out[list]; continue }
      /** @type {Record<string, unknown>[]} */
      const kept = []
      for (const entry of /** @type {unknown[]} */ (out[list])) {
        const bad = recordVisibilityProblem(entry)
        if (bad) problems.push(warn(fileOf('finances'), `finances ${list} ${isObj(entry) ? String(entry.id ?? '(no id)') : '(entry)'}: ${bad}`))
        if (!isObj(entry) || (entry.visibility !== undefined && entry.visibility !== null && entry.visibility !== 'public')) { withhold(entry); count('finances', 'records'); continue }
        // the collection's field rules apply to each entry's fields too (rule 3)
        /** @type {Record<string, unknown>} */
        const shown = {}
        let dropped = 0
        for (const [k, v] of Object.entries(entry)) {
          if (k === 'visibility') continue
          if (isPublic(policy, 'finances', { visibility: 'public' }, k)) shown[k] = v
          else { withhold(v); dropped++ }
        }
        count('finances', 'fields', dropped)
        kept.push(shown)
      }
      out[list] = kept
    }
    return out
  }

  // ── the extras ──
  const extras = {
    meetings: viewsOf('meetings'),
    projects: viewsOf('projects'),
    finances: financesOf(documentOf('finances')),
    ideas: viewsOf('ideas'),
    knowledge: documentOf('knowledge-manifest'),
    sources: viewsOf('sources'),
  }

  /** @type {PublicInput} */
  const pub = { identity, origin, members, systems, reads, proposals, decisions, governance, extras }
  const withheld = COLLECTIONS.flatMap(c => (counts.has(c) ? [/** @type {Withheld} */ (counts.get(c))] : []))
  return { pub, withheld, secrets: subtract(candidates, pub, sectionCandidates), problems }
}

/** @param {StandardsInput['identity']} identity @returns {PublicInput} */
function emptyPublic(identity) {
  return {
    identity, origin: '', members: [], systems: [], reads: {}, proposals: [], decisions: [], governance: null,
    extras: { meetings: [], projects: [], finances: {}, ideas: [], knowledge: null, sources: [] },
  }
}

/** Every string of a value, and its object keys, joined (NUL between) and lower-cased: what `includes` reads as shown.
 * @param {unknown} value @returns {string} */
function shownText(value) {
  /** @type {string[]} */
  const parts = []
  /** @param {unknown} v */
  const walk = v => {
    if (typeof v === 'string') parts.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) { parts.push(k); walk(x) }
  }
  walk(value)
  return parts.join('\u0000').toLowerCase()
}

/** The Snapshot proposal ids `snapshotEntries` (proposals.mjs) composes from a public Snapshot System's space and its
 * kept read's proposal ids: a driver's Open votes and Recent results rows link to the very same page. */
function snapshotIdsOf(/** @type {PublicInput} */ pub) {
  /** @type {string[]} */
  const ids = []
  for (const system of pub.systems) {
    if (system.kind !== 'snapshot-space' || typeof system.space !== 'string' || system.space === '') continue
    const facts = pub.reads[String(system.id)]?.facts
    if (!isObj(facts) || !Array.isArray(facts.proposals)) continue
    for (const p of facts.proposals) if (isObj(p) && typeof p.id === 'string' && p.id !== '') ids.push(snapshotProposalUri(system.space, p.id))
  }
  return ids
}

/** The candidates that appear nowhere (in any case) in the public projection, its keys, or the restricted title, and
 * that are not dates or words of VOCABULARY. Nor are the members' `withheld` field names shown. The on-chain ids the
 * builders compose from a public System's view (contractIdsOf: a Safe's CAIP-10 per chain, a hats tree's ref, a pool's
 * CAIP-10) are shown: a dropped read repeats them, and they are built from public fields only; so are the Snapshot
 * proposal ids composed from a public space and its kept read (snapshotIdsOf).
 *
 * R38: the facts and open of the reads kept in `pub.reads` count as shown. They are reads of Systems public in every
 * field (C1 dropped the others, whose strings stay unshown), and the builders publish from them. `sectionCandidates`
 * (a kept read's sections strings its own facts and open do not carry) are taken out by the projection only, never
 * by a read's facts.
 * @param {Set<string>} candidates @param {PublicInput} pub @param {Set<string>} [sectionCandidates]
 * @returns {Set<string>} */
function subtract(candidates, pub, sectionCandidates = new Set()) {
  const shown = shownText([
    RESTRICTED_TITLE, ...pub.systems.flatMap(s => contractIdsOf(s).map(c => c.id)), ...snapshotIdsOf(pub),
    { ...pub, reads: {}, members: pub.members.map(({ id, record }) => ({ id, record })) },
  ])
  const shownByReads = shownText(Object.values(pub.reads).map(r => [r?.facts, r?.open]))
  const out = new Set()
  for (const s of candidates) {
    const lower = s.toLowerCase()
    if (!notSecret(s) && !shown.includes(lower) && !shownByReads.includes(lower)) out.add(s)
  }
  for (const s of sectionCandidates) if (!notSecret(s) && !shown.includes(s.toLowerCase())) out.add(s)
  return out
}

/** Which System kind reads each foreign ref's payload kind (server/systems/driver.ts ForeignRef); a Safe ref has none. */
const KIND_OF_PAYLOAD = /** @type {Record<string, string>} */ ({
  'snapshot-proposal': 'snapshot-space', 'hats-wearer': 'hats-tree', 'hats-hat': 'hats-tree', 'gardens-proposal': 'gardens-pool',
})

/** A hats-tree System's chain and tree id from its public view; null when either is withheld or unreadable.
 * @param {Record<string, unknown>} view @returns {{ chain: string, tree: number } | null} */
function treeOfView(view) {
  const chain = systemChains(view)[0]
  const tree = treeIdOf(view.address)
  return chain && tree !== null ? { chain, tree } : null
}

/** The hat ref (built by `hatRef`) when `value` is a hat ref on the tree's chain and in the tree; else null.
 * @param {{ chain: string, tree: number }} tree @param {unknown} value @returns {string | null} */
function hatIn(tree, value) {
  const parsed = parseHatRef(value)
  if (!parsed || parsed.chain !== tree.chain || !inTree(parsed.hatId, tree.tree)) return null
  try { return hatRef(tree.chain, parsed.hatId) } catch { return null }
}

/** A Snapshot System's space: `space`, else the one its snapshot.box/.org URL names (server/systems/snapshot.ts spaceOf).
 * @param {Record<string, unknown>} system @returns {string | null} */
function spaceOf(system) {
  if (typeof system.space === 'string' && system.space) return system.space
  if (typeof system.url !== 'string') return null
  let u
  try { u = new URL(system.url) } catch { return null }
  if (u.protocol !== 'https:' || !['snapshot.box', 'snapshot.org'].includes(u.hostname)) return null
  const m = /^#\/(?:s:)?([^/?]+)/.exec(u.hash)
  return m ? m[1] : null
}

/**
 * An error Problem per (file, secret) found in the built files: strings, nested values and object keys, any case.
 * The text never repeats the secret (problems are printed). Secrets shorter than 6 characters are not scanned (L8-C15).
 * @param {Record<string, unknown>} files @param {Set<string>} secrets @returns {Problem[]}
 */
export function checkNoLeak(files, secrets) {
  const scanned = [...secrets].filter(s => typeof s === 'string' && s.length >= MIN_SECRET).map(s => ({ s, lower: s.toLowerCase() }))
  /** @type {Problem[]} */
  const out = []
  for (const file of Object.keys(files).sort()) {
    /** @type {{ path: string, text: string }[]} */
    const strings = []
    /** @param {unknown} v @param {string} path */
    const walk = (v, path) => {
      if (typeof v === 'string') strings.push({ path, text: v.toLowerCase() })
      else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
      else if (isObj(v)) for (const [k, x] of Object.entries(v)) { strings.push({ path: `${path} (a key)`, text: k.toLowerCase() }); walk(x, `${path}.${k}`) }
    }
    walk(files[file], '$')
    for (const { s, lower } of scanned) {
      const hit = strings.find(x => x.text.includes(lower))
      if (hit) out.push({ level: 'error', file, text: `a withheld value (${s.length} characters) is published at ${hit.path}; nothing is published while it is` })
    }
  }
  return out
}
