// packages/admin/lib/standards/extras.mjs
//
// The org-os extras (DAO-OS L8 spec §5.10): meetings.json, projects.json, finances.json, ideas.json, knowledge.json in
// their 0.6 shapes (same @context, type and keys as scripts/generate-all-schemas.mjs), built from the public
// projection only (`projectPublic`'s `extras`), with no null and no "" anywhere. A collection with nothing public is
// written with empty lists. Pure; relative imports only (vendored into instances).
//
// What differs from 0.6, on purpose:
//  - People (meeting participants and assignees, a project's lead, members and assignees) are published as the public
//    member's id (L8-C6); anyone who is not a public member is left out.
//  - A project's `relatedProposals` lists only published proposals, as their proposal ids (L8-C7).
//  - 0.6's action-item, task and decision regexes had no end anchor, so their lazy `(.+?)` captured one character;
//    here each matches to the end of its line.
//  - Order is total and deterministic: meetings by date then id; everything else by id.
//  - No clock: a Markdown meeting without a date has none (0.6 wrote the generation time).
import { proposalUri } from './ids.mjs'

const CONTEXT = 'https://www.daostar.org/schemas'

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v)
/** @param {unknown} v @returns {Record<string, unknown>[]} */
const objs = v => (Array.isArray(v) ? v.filter(isObj) : [])

/** A copy without null, undefined or "" values (objects and lists, nested); an object left empty goes too.
 * @param {unknown} v @returns {unknown} */
export function clean(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined
    const iso = v.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  if (Array.isArray(v)) return v.map(clean).filter(x => x !== undefined)
  if (isObj(v)) {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x)
      if (c !== undefined) out[k] = c
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return v === null || v === undefined || v === '' ? undefined : v
}
/** clean() of a value that is an object or list, which is never undefined for a list. @param {Record<string, unknown>} o */
const cleaned = o => /** @type {Record<string, unknown>} */ (clean(o) ?? {})

/** @param {Record<string, unknown>} a @param {Record<string, unknown>} b */
const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)

// 0.6's expressions, anchored to the end of the line (they matched one character before).
const ACTION_ITEM = /^[ \t]*- \[ \] (.+?)(?: \(@([A-Za-z0-9:_.\/-]+)(?:, due: (\d{4}-\d{2}-\d{2}))?\))?(?: #([A-Za-z0-9:_./-]+))?[ \t]*\r?$/gm
const DECISION = /^[ \t]*- \[ \] (.+?)(?: #([A-Za-z0-9:_./-]+))?[ \t]*\r?$/gm
const TASK = /^[ \t]*- \[ \] (.+?)(?: \(@([A-Za-z0-9:_.\/-]+)\))?(?: #([A-Za-z0-9:_./-]+))?[ \t]*\r?$/gm
const MILESTONE = /^[ \t]*- \[ \] (.+?) \(due: (\d{4}-\d{2}-\d{2})\)(?: #([A-Za-z0-9:_./-]+))?[ \t]*\r?$/gm

/** @param {RegExp} re @param {string} text @returns {RegExpExecArray[]} */
const matches = (re, text) => [...text.matchAll(new RegExp(re.source, re.flags))]

/**
 * @param {import('./project.mjs').PublicInput} pub
 * @returns {{ 'meetings.json': Record<string, unknown>, 'projects.json': Record<string, unknown>, 'finances.json': Record<string, unknown>,
 *   'ideas.json': Record<string, unknown>, 'knowledge.json': Record<string, unknown> }}
 */
export function extraDocs(pub) {
  const extras = pub.extras
  const origin = pub.origin
  /** raw member id → published id; a published id maps to itself */
  const people = new Map()
  for (const m of pub.members) {
    people.set(m.id, m.id)
    if (typeof m.record.id === 'string') people.set(m.record.id, m.id)
  }
  /** @param {unknown} v @returns {string | undefined} */
  const person = v => (typeof v === 'string' ? people.get(v) : undefined)
  /** @param {unknown} list @returns {string[]} */
  const personList = list => (Array.isArray(list) ? [...new Set(list.flatMap(v => person(v) ?? []))] : [])
  const published = new Set(pub.proposals.map(p => p.id))
  /** @param {unknown} list @returns {string[]} */
  const proposalList = list => (Array.isArray(list)
    ? [...new Set(list.flatMap(v => (typeof v === 'string' && published.has(v) ? [proposalUri(pub.identity.daoURI, v)] : [])))]
    : [])

  // ── meetings ──
  const meetings = extras.meetings.map(record => {
    const { body, ...rest } = record
    /** @param {unknown} items */
    const withAssignees = items => objs(items).map(i => ({ ...i, assignee: 'assignee' in i ? person(i.assignee) : undefined }))
    if (typeof body !== 'string') {
      // a record of data/meetings.yaml: as 0.6 passed it through
      const doc = { ...rest }
      if ('participants' in doc) doc.participants = personList(doc.participants)
      if ('actionItems' in doc) doc.actionItems = withAssignees(doc.actionItems)
      return doc
    }
    /** @type {Record<string, unknown>[]} */
    const actionItems = []
    for (const m of matches(ACTION_ITEM, body)) {
      actionItems.push({ id: m[4] || `action-${actionItems.length + 1}`, description: m[1], assignee: person(m[2]), status: 'pending', dueDate: m[3] })
    }
    /** @type {Record<string, unknown>[]} */
    const decisions = []
    const section = body.match(/## Decisions\s+([\s\S]*?)(?=##|$)/)
    if (section) for (const m of matches(DECISION, section[1])) decisions.push({ id: m[2] || `decision-${decisions.length + 1}`, description: m[1], consensus: false })
    return {
      id: rest.id,
      type: rest.type || 'meeting',
      title: rest.title || rest.id,
      date: rest.date,
      participants: personList(rest.participants),
      status: rest.status || 'planned',
      agenda: `${origin}/meetings/${String(rest.id)}#agenda`,
      notes: `${origin}/meetings/${String(rest.id)}`,
      decisions,
      actionItems,
    }
  })
  meetings.sort((a, b) => {
    const da = String(clean(a.date) ?? ''), db = String(clean(b.date) ?? '')
    return da < db ? -1 : da > db ? 1 : byId(a, b)
  })

  // ── projects ──
  const projects = extras.projects.map(record => {
    const { body, ...rest } = record
    /** @type {Record<string, unknown>} */
    const doc = typeof body === 'string' ? markdownProject(rest, body) : { ...rest }
    if ('lead' in doc) doc.lead = person(doc.lead)
    if ('members' in doc) doc.members = personList(doc.members)
    if ('relatedProposals' in doc) doc.relatedProposals = proposalList(doc.relatedProposals)
    if (Array.isArray(doc.tasks)) doc.tasks = objs(doc.tasks).map(t => ({ ...t, assignee: 'assignee' in t ? person(t.assignee) : undefined }))
    return doc
  })
  /** @param {Record<string, unknown>} data @param {string} body */
  function markdownProject(data, body) {
    /** @type {Record<string, unknown>[]} */
    const tasks = []
    for (const m of matches(TASK, body)) tasks.push({ id: m[3] || `task-${tasks.length + 1}`, description: m[1], assignee: m[2], status: 'todo', priority: 'medium' })
    /** @type {Record<string, unknown>[]} */
    const milestones = []
    const section = body.match(/### Milestones\s+([\s\S]*?)(?=###|$)/)
    if (section) for (const m of matches(MILESTONE, section[1])) milestones.push({ id: m[3] || `milestone-${milestones.length + 1}`, title: m[1], status: 'pending', dueDate: m[2] })
    return {
      id: data.id,
      type: data.type || 'project',
      name: data.name || data.id,
      description: data.description,
      status: data.status || 'Integrate',
      lead: data.lead,
      members: data.members ?? [],
      startDate: data.startDate,
      endDate: data.endDate,
      milestones,
      tasks,
      budget: data.budget,
      relatedProposals: data.relatedProposals ?? [],
    }
  }
  projects.sort(byId)

  // ── finances ──
  const fin = extras.finances ?? {}
  /** @param {string} key */
  const entries = key => objs(fin[key]).sort(byId)

  // ── ideas ──
  const ideas = extras.ideas.slice().sort(byId)

  // ── knowledge ──
  const doc = extras.knowledge ?? {}
  const km = isObj(doc.knowledge_manifest) ? doc.knowledge_manifest : doc
  const domains = objs(km.domains).map(d => ({
    id: d.id, name: d.name, description: d.description, coverage: d.coverage || 'none', page_count: d.page_count || 0,
    sources: Array.isArray(d.sources) ? d.sources : [], last_updated: d.last_updated,
  })).sort(byId)
  const exchange = isObj(km.exchange) ? km.exchange : {}
  const sources = extras.sources.map(s => ({ id: s.id, name: s.name, type: s.type, url: s.url || s.feed_url, status: s.status })).sort(byId)

  return {
    'meetings.json': { '@context': CONTEXT, type: 'MeetingRegistry', meetings: meetings.map(cleaned) },
    'projects.json': { '@context': CONTEXT, type: 'ProjectRegistry', projects: projects.map(cleaned) },
    'finances.json': {
      '@context': CONTEXT, type: 'FinancialRegistry',
      budgets: entries('budgets').map(cleaned), expenses: entries('expenses').map(cleaned), revenues: entries('revenues').map(cleaned),
    },
    'ideas.json': { '@context': CONTEXT, type: 'IdeaRegistry', ideas: ideas.map(cleaned) },
    'knowledge.json': {
      '@context': CONTEXT, type: 'KnowledgeManifest',
      domains: domains.map(cleaned),
      exchange: {
        published_domains: /** @type {unknown[]} */ (clean(Array.isArray(exchange.published_domains) ? exchange.published_domains : [])),
        subscribed_domains: /** @type {unknown[]} */ (clean(Array.isArray(exchange.subscribed_domains) ? exchange.subscribed_domains : [])),
      },
      sources: sources.map(cleaned),
    },
  }
}
