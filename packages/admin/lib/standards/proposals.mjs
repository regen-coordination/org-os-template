// packages/admin/lib/standards/proposals.mjs
//
// proposals.json and activities.json (EIP-4824; lane L8, addendum §5.3, §5.4; rulings L8-C7, C8, C9, C17).
// Builders read the public projection only. Pure; relative imports only (vendored into instances).
import { proposalUri, snapshotProposalUri } from './ids.mjs'
import { RESTRICTED_TITLE } from './project.mjs'

const CONTEXT = 'https://www.daostar.org/schemas'

/** L8-C9: the event kinds that become activities. `comment` (conversation) and `replay` (mechanics) are not. */
export const ACTIVITY_KINDS = ['opened', 'approve', 'object', 'vote', 'retract', 'revise', 'attach', 'system', 'withdraw', 'reject', 'expire', 'ratify']

/** @param {unknown} v @returns {string | null} a non-empty string, else null */
const text = v => (typeof v === 'string' && v.trim() !== '' ? v : null)
/** @param {{ id: string }} a @param {{ id: string }} b */
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * L8 §5.3: the proposals of every public Snapshot space whose read succeeded. Null without such a read (the git copy).
 * A proposal with an empty title or state is skipped; a duplicate id is listed once.
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ entries: object[] } | null}
 */
export function snapshotEntries(pub) {
  /** @type {Map<string, object>} */
  const found = new Map()
  let any = false
  for (const system of pub.systems) {
    if (system.kind !== 'snapshot-space' || !text(system.space)) continue
    const read = pub.reads?.[String(system.id)]
    if (!read || read.ok === false) continue
    const facts = /** @type {Record<string, unknown> | undefined} */ (read.facts)
    if (!facts || !Array.isArray(facts.proposals)) continue
    any = true
    for (const p of facts.proposals) {
      if (typeof p !== 'object' || p === null || !text(p.id) || !text(p.title) || !text(p.state)) continue
      const id = snapshotProposalUri(String(system.space), p.id)
      if (!found.has(id)) found.set(id, { type: 'proposal', id, name: p.title, status: p.state, contentURI: id })
    }
  }
  return any ? { entries: [...found.values()] } : null
}

/**
 * @param {import('./project.mjs').PublicInput} pub
 * @param {{ proposal?: (id: string) => string }} [urls]
 * @param {{ entries: object[] } | null} [snapshot] Task 9's Snapshot entries (live copy)
 * @returns {{ '@context': string, proposals: Record<string, unknown>[] }}
 */
export function proposalsDoc(pub, urls, snapshot) {
  const daoURI = String(pub.identity.daoURI)
  const decisionOf = new Map()
  for (const d of pub.decisions) if (d.proposal) decisionOf.set(d.proposal, d.id)

  /** @type {Record<string, unknown>[]} */
  const out = []
  for (const p of pub.proposals) {
    /** @type {Record<string, unknown>} */
    const ext = {}
    if (text(p.opened)) ext['org-os.opened'] = p.opened
    if (text(p.closed)) ext['org-os.closed'] = p.closed
    if (p.rules.length > 0) ext['org-os.rules'] = [...p.rules]
    const decision = decisionOf.get(p.id)
    if (decision) ext['org-os.decision'] = decision
    if (!p.restricted) {
      const executes = [...new Set(p.attached.filter(r => text(r)))].sort()
      if (executes.length > 0) ext['org-os.executes'] = executes
    }
    /** @type {Record<string, unknown>} */
    const entry = {
      type: 'proposal',
      id: proposalUri(daoURI, p.id),
      name: p.restricted || !text(p.title) ? RESTRICTED_TITLE : p.title,
      status: p.state,
    }
    if (urls?.proposal) entry.contentURI = urls.proposal(p.id)
    if (Object.keys(ext).length > 0) entry.extensions = ext
    out.push(entry)
  }

  const published = new Set(pub.proposals.map(p => p.id))
  for (const d of pub.decisions) {
    if (d.proposal && published.has(d.proposal)) continue // folded into its proposal
    const masked = d.restricted || !text(d.title)
    /** @type {Record<string, unknown>} */
    const entry = { type: 'proposal', id: proposalUri(daoURI, d.id), name: masked ? RESTRICTED_TITLE : d.title, status: text(d.status) ?? 'draft' }
    if (!d.restricted && !d.proposal && text(d.date)) entry.extensions = { 'org-os.date': d.date }
    out.push(entry)
  }

  if (snapshot?.entries) out.push(...snapshot.entries.map(e => /** @type {Record<string, unknown>} */ (e)))
  return { '@context': CONTEXT, proposals: out.sort(byId) }
}

/**
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ '@context': string, activities: Record<string, unknown>[] }}
 */
export function activitiesDoc(pub) {
  const daoURI = String(pub.identity.daoURI)
  const kinds = new Set(ACTIVITY_KINDS)
  /** @type {Record<string, unknown>[]} */
  const out = []
  /** @param {string} pid @param {string} eid @param {string} kind @param {string} at @param {string | null} actor */
  const add = (pid, eid, kind, at, actor) => {
    const proposal = proposalUri(daoURI, pid)
    /** @type {Record<string, unknown>} */
    const ext = { 'org-os.event': kind }
    if (text(at)) ext['org-os.at'] = at
    out.push({
      id: `${proposal}#${eid}`,
      type: 'activity',
      proposal: { type: 'proposal', id: proposal },
      ...(text(actor) ? { member: { id: actor } } : {}),
      extensions: ext,
    })
  }
  for (const p of pub.proposals) {
    add(p.id, 'opened', 'opened', p.opened, p.author)
    for (const e of p.events) if (kinds.has(e.kind) && e.kind !== 'opened') add(p.id, e.id, e.kind, e.at, e.actor)
  }
  return { '@context': CONTEXT, activities: out.sort(byId) }
}
