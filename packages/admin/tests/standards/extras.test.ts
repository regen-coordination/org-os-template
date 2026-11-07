import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { extraDocs } from '../../lib/standards/extras.mjs'
import { fixtureInput, P } from './fixtures.ts'

const BODY = [
  '## Agenda', '', '- [ ] Send the notes (@steward-a, due: 2026-11-01) #act-1', '- [ ] Book the room (@steward-b)', '- [ ] Plain item',
  '', '## Decisions', '', '- [ ] Adopt the charter #dec-1', '- [ ] Meet monthly', '', '## Notes', 'text',
].join('\n')

const A = 'https://dao.example.org/members/steward-a'

/** The public projection of the fixture with the extras' records replaced, and what extraDocs builds from it. */
function build(records: Record<string, unknown>, policy: Record<string, unknown> = {}) {
  const input = fixtureInput()
  Object.assign(input.records, records)
  Object.assign(input.policy.collections, { meetings: { default: 'members', fields: {} }, finances: { default: 'members', fields: {} }, ideas: { default: 'members', fields: {} }, ...policy })
  const r = projectPublic(input)
  return { r, docs: extraDocs(r.pub) as Record<string, any> }
}
const everyValue = (v: unknown, f: (x: unknown) => void) => {
  f(v)
  if (Array.isArray(v)) v.forEach(x => everyValue(x, f))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => everyValue(x, f))
}

describe('extraDocs: shapes and filtering', () => {
  it('writes the five files with the 0.6 @context and type, empty when nothing is public', () => {
    const { docs } = build({ meetings: [], ideas: [], projects: [], sources: [], 'knowledge-manifest': { visibility: 'members', domains: [] } })
    expect(Object.keys(docs).sort()).toEqual(['finances.json', 'ideas.json', 'knowledge.json', 'meetings.json', 'projects.json'])
    expect(docs['meetings.json']).toEqual({ '@context': 'https://www.daostar.org/schemas', type: 'MeetingRegistry', meetings: [] })
    expect(docs['projects.json']).toEqual({ '@context': 'https://www.daostar.org/schemas', type: 'ProjectRegistry', projects: [] })
    expect(docs['finances.json']).toEqual({ '@context': 'https://www.daostar.org/schemas', type: 'FinancialRegistry', budgets: [], expenses: [], revenues: [] })
    expect(docs['ideas.json']).toEqual({ '@context': 'https://www.daostar.org/schemas', type: 'IdeaRegistry', ideas: [] })
    expect(docs['knowledge.json']).toEqual({
      '@context': 'https://www.daostar.org/schemas', type: 'KnowledgeManifest', domains: [], exchange: { published_domains: [], subscribed_domains: [] }, sources: [],
    })
  })

  it('a public project and a members project: only the public one', () => {
    const { docs } = build({ projects: [
      { id: 'project-two', visibility: 'members', name: 'WITHHELD-60-xxxxxx' },
      { id: 'project-one', name: 'SHOWN-60 One', status: 'active', lead: 'steward-a', members: ['steward-a', 'steward-b'], budget: 'WITHHELD-61-xxxxxx', relatedProposals: [P.public, P.hidden] },
    ] })
    const projects = docs['projects.json'].projects
    expect(projects.map((p: any) => p.id)).toEqual(['project-one'])
    expect(JSON.stringify(projects)).not.toContain('WITHHELD-')
    expect(projects[0].lead).toBe(A)
    expect(projects[0].members).toEqual([A])
    expect(projects[0].relatedProposals).toEqual([`https://dao.example.org/.well-known/dao.json?proposalId=${P.public}`])
  })

  it('a Markdown project derives tasks and milestones as 0.6 does', () => {
    const body = ['### Milestones', '', '- [ ] Ship v1 (due: 2026-12-01) #ms-1', '', '### Tasks', '', '- [ ] Write docs (@steward-a) #t-1', '- [ ] Review'].join('\n')
    const { docs } = build({ projects: [{ id: 'md-project', visibility: 'public', name: 'SHOWN-62 MD', body }] })
    const [p] = docs['projects.json'].projects
    expect(p.milestones).toEqual([{ id: 'ms-1', title: 'Ship v1', status: 'pending', dueDate: '2026-12-01' }])
    expect(p.tasks.map((t: any) => [t.id, t.description, t.assignee ?? null])).toEqual([
      ['ms-1', 'Ship v1 (due: 2026-12-01)', null], ['t-1', 'Write docs', A], ['task-3', 'Review', null],
    ])
    expect(p).not.toHaveProperty('body')
    expect(p.type).toBe('project')
    expect(p.status).toBe('Integrate')
  })

  it('a Markdown meeting is public only with front matter visibility: public, or in a public collection', () => {
    const md = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `T ${id}`, date: '2026-10-05', body: BODY, ...extra })
    const closed = build({ meetings: [md('m-closed'), md('m-open', { visibility: 'public' })] })
    expect(closed.docs['meetings.json'].meetings.map((m: any) => m.id)).toEqual(['m-open'])
    const open = build({ meetings: [md('m-a'), md('m-b', { visibility: 'members' })] }, { meetings: { default: 'public', fields: {} } })
    expect(open.docs['meetings.json'].meetings.map((m: any) => m.id)).toEqual(['m-a'])
  })

  it("0.6's action-item and decision parsing is kept (anchored to the line)", () => {
    const { docs } = build({ meetings: [{ id: 'm-1', visibility: 'public', title: 'SHOWN-63 Call', participants: ['steward-a', 'steward-b'], body: BODY }] })
    const [m] = docs['meetings.json'].meetings
    expect(m.actionItems.slice(0, 3)).toEqual([
      { id: 'act-1', description: 'Send the notes', assignee: A, status: 'pending', dueDate: '2026-11-01' },
      { id: 'action-2', description: 'Book the room', status: 'pending' },
      { id: 'action-3', description: 'Plain item', status: 'pending' },
    ])
    expect(m.decisions).toEqual([
      { id: 'dec-1', description: 'Adopt the charter', consensus: false },
      { id: 'decision-2', description: 'Meet monthly', consensus: false },
    ])
    expect(m.participants).toEqual([A])   // steward-b is not public
    expect(m).toMatchObject({ type: 'meeting', title: 'SHOWN-63 Call', status: 'planned', agenda: 'https://dao.example.org/meetings/m-1#agenda', notes: 'https://dao.example.org/meetings/m-1' })
    expect(m).not.toHaveProperty('body')
    expect(JSON.stringify(m)).not.toContain('steward-b')
  })

  it('a body is not published when its field is not public', () => {
    const { docs } = build({ meetings: [{ id: 'm-1', visibility: 'public', title: 'SHOWN-64 Call', body: BODY }] }, { meetings: { default: 'public', fields: { body: 'members' } } })
    const [m] = docs['meetings.json'].meetings
    expect(m).not.toHaveProperty('body')
    expect(m.actionItems ?? []).toEqual([])   // a yaml-style record: nothing derived
  })

  it('meetings are ordered by date then id', () => {
    const { docs } = build({ meetings: [
      { id: 'b', visibility: 'public', date: '2026-10-02' }, { id: 'c', visibility: 'public', date: '2026-10-01' }, { id: 'a', visibility: 'public', date: '2026-10-02' },
    ] })
    expect(docs['meetings.json'].meetings.map((m: any) => m.id)).toEqual(['c', 'a', 'b'])
  })

  it('finances with nothing public: empty budgets, expenses and revenues', () => {
    const { docs } = build({ finances: { budgets: [{ id: 'b1', amount: 'WITHHELD-64-xxxxxx' }], expenses: [], revenues: [] } })
    expect(docs['finances.json']).toMatchObject({ budgets: [], expenses: [], revenues: [] })
    expect(JSON.stringify(docs)).not.toContain('WITHHELD-')
  })

  it('a public finances document publishes its entries; an entry marked members is left out', () => {
    const { docs, r } = build({ finances: { visibility: 'public',
      budgets: [{ id: 'b2', name: 'SHOWN-64 B2', amount: 10, note: null }, { id: 'b1', name: 'SHOWN-65 B1', amount: 5 }, { id: 'b3', visibility: 'members', name: 'WITHHELD-65-xxxxxx' }],
      expenses: [{ id: 'e1', visibility: 'public', amount: 3 }], revenues: undefined } })
    const f = docs['finances.json']
    expect(f.budgets).toEqual([{ id: 'b1', name: 'SHOWN-65 B1', amount: 5 }, { id: 'b2', name: 'SHOWN-64 B2', amount: 10 }])
    expect(f.expenses).toEqual([{ id: 'e1', amount: 3 }])
    expect(f.revenues).toEqual([])
    expect(JSON.stringify(docs)).not.toContain('WITHHELD-')
    expect(r.withheld).toContainEqual({ collection: 'finances', records: 1, fields: 0 })
  })

  it('ideas and knowledge in their 0.6 shapes, sorted by id', () => {
    const { docs } = build({
      ideas: [{ id: 'idea-b', visibility: 'public', title: 'SHOWN-66 B' }, { id: 'idea-a', visibility: 'public', title: 'SHOWN-67 A' }, { id: 'idea-c', title: 'WITHHELD-66-xxxxxx' }],
      'knowledge-manifest': { knowledge_manifest: { domains: [{ id: 'd2', name: 'Two' }, { id: 'd1', name: 'One', description: 'SHOWN-68 d', coverage: 'good', page_count: 4, sources: ['s1'], last_updated: '2026-10-01' }], exchange: { published_domains: ['d1'] } } },
      sources: [{ id: 's1', name: 'SHOWN-69 S1', type: 'rss', feed_url: 'https://example.org/feed', status: 'active' }],
    })
    expect(docs['ideas.json'].ideas.map((i: any) => i.id)).toEqual(['idea-a', 'idea-b'])
    const k = docs['knowledge.json']
    expect(k.type).toBe('KnowledgeManifest')
    expect(k.domains).toEqual([
      { id: 'd1', name: 'One', description: 'SHOWN-68 d', coverage: 'good', page_count: 4, sources: ['s1'], last_updated: '2026-10-01' },
      { id: 'd2', name: 'Two', coverage: 'none', page_count: 0, sources: [] },
    ])
    expect(k.exchange).toEqual({ published_domains: ['d1'], subscribed_domains: [] })
    expect(k.sources).toEqual([{ id: 's1', name: 'SHOWN-69 S1', type: 'rss', url: 'https://example.org/feed', status: 'active' }])
  })

  it('no null and no empty string anywhere, and the same input gives the same bytes', () => {
    const records = {
      meetings: [{ id: 'm', visibility: 'public', title: '', date: null, participants: [], body: BODY }],
      projects: [{ id: 'p', name: 'SHOWN-70 P', description: '', lead: null, startDate: null }],
      ideas: [{ id: 'i', visibility: 'public', title: 'SHOWN-71 I', summary: '', owner: null }],
    }
    const a = build(records).docs
    const b = build(records).docs
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    for (const doc of Object.values(a)) everyValue(doc, x => { expect(x).not.toBeNull(); expect(x).not.toBe(''); expect(x).not.toBeUndefined() })
  })

  it('a Date from a loader keeps its value: YYYY-MM-DD without a time part, else ISO', () => {
    const { docs } = build({ meetings: [{ id: 'm', visibility: 'public', date: new Date('2026-10-05T00:00:00.000Z'), title: 'SHOWN-72 M' }],
      ideas: [{ id: 'i', visibility: 'public', title: 'SHOWN-73 I', at: new Date('2026-10-05T10:30:00.000Z') }] })
    expect(docs['meetings.json'].meetings[0].date).toBe('2026-10-05')
    expect(docs['ideas.json'].ideas[0].at).toBe('2026-10-05T10:30:00.000Z')
  })
})
