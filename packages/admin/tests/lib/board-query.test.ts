// packages/admin/tests/lib/board-query.test.ts
import { describe, it, expect } from 'vitest'
import {
  BLOCK_TYPES, BASE_FIELDS, SECTION_IDS, fieldOf, runQuery, sectionBoardId, sortKeys, validateBoard, validateSource,
} from '../../lib/board-query.mjs'
import { REGISTRY_OF_KIND } from '../../lib/registries.mjs'

const r = (over: Record<string, unknown> = {}) => ({
  id: 'project:a', kind: 'project', name: 'A', status: 'active', attention: null, changed: null, facts: {},
  source: { registry: 'projects', entityId: 'a' }, ...over,
}) as Parameters<typeof fieldOf>[0]
const fieldsOf = (kind: string) => (kind === 'project' ? [...BASE_FIELDS, 'lead', 'due', 'tags'] : null)

describe('fieldOf (P4b\'s, P4-C9)', () => {
  it("reads a record's own fields, the derived needs, changed and free, then its facts, then its file entry", () => {
    const x = r({ facts: { lead: 'ana' }, attention: { level: 'alert', text: 't' }, changed: { at: '2026-10-01', by: 'lf' } })
    expect(fieldOf(x, 'id')).toBe('project:a')
    expect(fieldOf(x, 'attention')).toBe('t')
    expect(fieldOf(x, 'needs')).toBe(0)
    expect(fieldOf(r({ attention: { level: 'warn', text: 'w' } }), 'needs')).toBe(1)
    expect(fieldOf(r(), 'needs')).toBe(2)
    expect(fieldOf(x, 'changed')).toBe('2026-10-01')
    expect(fieldOf(r({ status: 'free' }), 'free')).toBe(1)
    expect(fieldOf(x, 'lead')).toBe('ana')
    expect(fieldOf(x, 'due', { due: '2026-10-28' })).toBe('2026-10-28')
    expect(fieldOf(x, 'nothing')).toBeNull()
  })
})

describe('sortKeys', () => {
  it('reads one string, a list, and comma-separated keys in either', () => {
    expect(sortKeys('needs, changed')).toEqual([{ field: 'needs', dir: 1 }, { field: 'changed', dir: 1 }])
    expect(sortKeys(['free=1', '-changed,name'])).toEqual([{ field: 'free', dir: 1, eq: '1' }, { field: 'changed', dir: -1 }, { field: 'name', dir: 1 }])
    expect(sortKeys(undefined)).toEqual([])
  })
})

describe('runQuery', () => {
  const rows = [
    r({ id: 'project:a', name: 'Alpha', status: 'done', facts: { tags: ['x'] } }),
    r({ id: 'project:b', name: 'Beta', status: 'active', facts: { tags: ['y', 'x'] } }),
    r({ id: 'project:c', name: 'Gamma', status: null }),
    r({ id: 'person:p', kind: 'person', name: 'Pat', status: 'active' }),
    r({ id: 'absent:crew', kind: 'absent', name: 'Crew' }),
  ]
  const names = (s: Parameters<typeof runQuery>[0], o?: Parameters<typeof runQuery>[2]) => runQuery(s, rows, o).map(x => x.name)

  it('picks by kind, one or several or "*", keeps input order unsorted, and drops nothing on its own (P4b ruling)', () => {
    expect(names({ kind: 'project' })).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(names({ kind: ['person', 'project'] })).toEqual(['Alpha', 'Beta', 'Gamma', 'Pat'])
    expect(names({ kind: '*' })).toEqual(['Alpha', 'Beta', 'Gamma', 'Pat', 'Crew'])
    expect(names({})).toEqual(['Alpha', 'Beta', 'Gamma', 'Pat', 'Crew'])
  })
  it('picks a section through the given membership, and nothing when none is given', () => {
    expect(names({ section: 'people' }, { inSection: (s, x) => s === 'people' && x.kind === 'person' })).toEqual(['Pat'])
    expect(names({ section: 'people' })).toEqual([])
  })
  it('filters: equals (a list holds the value), not, in, has', () => {
    expect(names({ kind: 'project', where: { status: 'active' } })).toEqual(['Beta'])
    expect(names({ kind: 'project', where: { tags: 'x' } })).toEqual(['Alpha', 'Beta'])
    expect(names({ kind: 'project', where: { status: { not: 'done' } } })).toEqual(['Beta', 'Gamma'])
    expect(names({ kind: 'project', where: { status: { in: ['done', 'active'] } } })).toEqual(['Alpha', 'Beta'])
    expect(names({ kind: 'project', where: { status: { has: false } } })).toEqual(['Gamma'])
  })
  it('filters by a field only the file entry holds', () => {
    const due: Record<string, string> = { 'project:a': '2026-10-01', 'project:b': '2026-11-01' }
    const entryOf = (x: { id: string }) => (due[x.id] ? { due: due[x.id] } : undefined)
    expect(names({ kind: 'project', where: { due: { before: '2026-10-15' } } }, { entryOf })).toEqual(['Alpha'])
  })
  it('sorts: -field descending, empties last either way, ties by name; field=value last', () => {
    expect(names({ kind: 'project', sort: 'status' })).toEqual(['Beta', 'Alpha', 'Gamma'])
    expect(names({ kind: 'project', sort: '-status' })).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(names({ kind: 'project', sort: 'status=active, name' })).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
  it('sorts by the derived fields as Home does: needs then changed; free then name', () => {
    const xs = [
      r({ id: 'project:w', name: 'W', attention: { level: 'warn', text: 'w' }, changed: { at: '2026-01-01', by: '' } }),
      r({ id: 'project:a2', name: 'A2', attention: { level: 'alert', text: 'a' }, changed: { at: '2026-03-01', by: '' } }),
      r({ id: 'project:a1', name: 'A1', attention: { level: 'alert', text: 'a' }, changed: { at: '2026-02-01', by: '' } }),
    ]
    expect(runQuery({ where: { attention: { has: true } }, sort: 'needs, changed' }, xs).map(x => x.name)).toEqual(['A1', 'A2', 'W'])
    const seats = [r({ id: 'seat:1', kind: 'seat', name: 'S1', status: 'free' }), r({ id: 'seat:2', kind: 'seat', name: 'S2', status: 'seated' })]
    expect(runQuery({ kind: 'seat', sort: 'free, name' }, seats).map(x => x.name)).toEqual(['S2', 'S1'])
  })
  it('takes limit as given, 0 included', () => {
    expect(names({ kind: 'project', sort: 'name', limit: 2 })).toEqual(['Alpha', 'Beta'])
    expect(names({ kind: 'project', limit: 0 })).toEqual([])
  })
})

describe('validateSource', () => {
  it('passes a good source', () => {
    expect(validateSource({ kind: 'project', where: { status: { not: 'done' } }, sort: '-due, name', limit: 5 }, fieldsOf)).toEqual([])
    expect(validateSource({ section: 'crew', sort: 'free, name' }, fieldsOf)).toEqual([])
    expect(validateSource({ where: { attention: { has: true } }, sort: 'needs, changed' }, fieldsOf)).toEqual([])
  })
  it('names an unknown kind, section, field, condition and key, and a source naming both kind and section', () => {
    expect(validateSource({ kind: 'projetc' }, fieldsOf)[0]).toMatch(/^kind "projetc" is not a record kind/)
    expect(validateSource({ section: 'nope' }, fieldsOf)).toEqual([`section "nope" is not a section (${SECTION_IDS.join(', ')})`])
    expect(validateSource({ kind: 'project', section: 'projects' }, fieldsOf)).toEqual(['a source names kind or section, not both'])
    expect(validateSource({ kind: 'project', where: { statuss: 'x' } }, fieldsOf)).toEqual([expect.stringMatching(/^where: "statuss" is not a field of project \(it has id, kind, name/)])
    expect(validateSource({ kind: 'project', where: { status: { nott: 'x' } } }, fieldsOf)).toEqual(['where.status: "nott" is not a condition (not, in, before, after, has)'])
    expect(validateSource({ kind: 'project', sort: '-dew' }, fieldsOf)).toEqual([expect.stringMatching(/^sort: "dew" is not a field of project/)])
    expect(validateSource({ kind: 'project', limit: -1 }, fieldsOf)).toEqual(['limit -1 is not a whole number from 0'])
    expect(validateSource({ kind: 'project', filter: 1 }, fieldsOf)).toEqual(['"filter" is not part of a source (kind, section, where, sort, limit)'])
  })
  it('checks only the fields every record has with no kind or "*", none for a kind with no registry or for a section', () => {
    expect(validateSource({ kind: '*', where: { lead: 'x' } }, fieldsOf)).toEqual([expect.stringMatching(/^where: "lead" is not a field of every record/)])
    expect(validateSource({ kind: 'module', where: { failing: true } }, fieldsOf)).toEqual([])
    expect(validateSource({ section: 'projects', where: { lead: 'x' } }, fieldsOf)).toEqual([])
  })
})

describe('validateBoard', () => {
  const ctx = { fieldsOf }
  const grid = (blocks: unknown[]) => ({ id: 'b', name: 'B', layout: 'grid', blocks })
  const list = (id: string, place: unknown) => ({ id, type: 'list', source: { kind: 'project' }, place })

  it("passes a good board of every block type, in P4b's cfg shapes", () => {
    expect(validateBoard(grid([
      list('l', { col: 1, span: 4, row: 1 }),
      { id: 'k', type: 'kanban', source: { kind: 'project' }, view: { group: 'status', columns: ['idea', 'active'] }, place: { col: 5, span: 8, row: 1 } },
      { id: 'm', type: 'map', source: { map: 'organization' }, place: { col: 1, span: 6, row: 2 } },
      { id: 'r', type: 'record', source: { record: 'project:a' }, place: { col: 7, span: 6, row: 2 } },
      { id: 'n', type: 'metric', source: { kind: 'project' }, view: { measure: 'sum', field: 'due' }, place: { col: 1, span: 3, row: 3 } },
      { id: 'q', type: 'metric', source: { system: 'treasury-safe', fact: 'threshold', reading: 'balance' }, place: { col: 4, span: 3, row: 3 } },
      { id: 's', type: 'system', source: { system: 'treasury-safe' }, place: { col: 7, span: 3, row: 3 } },
      { id: 't', type: 'note', text: 'Hello', place: { col: 10, span: 3, row: 3 } },
      { id: 'sec', type: 'list', source: { section: 'crew', sort: 'free, name' }, view: { switch: true }, place: { col: 1, span: 6, row: 4 } },
      { id: 'ops', type: 'list', source: { jobs: 'recent', limit: 8 }, place: { col: 7, span: 6, row: 4 } },
    ]), ctx)).toEqual([])
  })
  it('refuses spans outside 1–12, under 3, past column 12, and overlaps', () => {
    expect(validateBoard(grid([list('a', { col: 1, span: 13, row: 1 })]), ctx)).toEqual(['block "a": span 13 is outside 1–12'])
    expect(validateBoard(grid([list('a', { col: 1, span: 2, row: 1 })]), ctx)).toEqual(['block "a": span 2 is under the minimum of 3'])
    expect(validateBoard(grid([list('a', { col: 11, span: 4, row: 1 })]), ctx)).toEqual([expect.stringMatching(/^block "a": reaches column 14, past 12/)])
    expect(validateBoard(grid([list('a', { col: 1, span: 6, row: 1 }), list('b', { col: 4, span: 6, row: 1 })]), ctx))
      .toEqual(['block "b" overlaps block "a" in row 1'])
  })
  it('refuses duplicate ids, unknown types and missing places', () => {
    expect(validateBoard(grid([list('a', { col: 1, span: 3, row: 1 }), list('a', { col: 4, span: 3, row: 1 })]), ctx))
      .toEqual(['two blocks are called "a": block ids must differ'])
    expect(validateBoard(grid([{ id: 'x', type: 'chart', place: { col: 1, span: 3, row: 1 } }]), ctx))
      .toEqual([`block "x": type "chart" is not a block type (${BLOCK_TYPES.join(', ')})`])
    expect(validateBoard(grid([list('a', undefined)]), ctx)).toEqual(['block "a": has no place on this grid board'])
  })
  it('checks canvas sizes and flow places', () => {
    const canvas = { id: 'c', name: 'C', layout: 'canvas', blocks: [list('a', { x: 0, y: 0, w: 100, h: 80 })] }
    expect(validateBoard(canvas, ctx)).toEqual(['block "a": w 100 is under 240', 'block "a": h 80 is under 120'])
    expect(validateBoard({ id: 'f', name: 'F', layout: 'flow', blocks: [list('a', { col: 1, span: 3, row: 1 })] }, ctx))
      .toEqual(['block "a": a flow board places blocks by their order: remove place'])
  })
  it('names a kanban without its group or columns, a metric measure that is not one, and a system metric without its fact', () => {
    const flow = (block: unknown) => ({ id: 'f', name: 'F', layout: 'flow', blocks: [block] })
    expect(validateBoard(flow({ id: 'k', type: 'kanban', source: { kind: 'project' }, view: { group: 'stage' } }), ctx)).toEqual([
      expect.stringMatching(/^block "k": view.group: "stage" is not a field of project/),
      'block "k": a kanban needs view.columns: the values its columns hold, such as [idea, active, done]',
    ])
    expect(validateBoard(flow({ id: 'm', type: 'metric', source: { kind: 'project' }, view: { measure: 'avg' } }), ctx))
      .toEqual(['block "m": view.measure "avg" is not count or sum'])
    expect(validateBoard(flow({ id: 'm', type: 'metric', source: { system: 'safe' } }), ctx))
      .toEqual(['block "m": a metric of a system reads { system, fact }, with an optional reading, such as { system: treasury-safe, fact: threshold }'])
    expect(validateBoard(flow({ id: 'm', type: 'metric', source: { system: 'safe', fact: 'threshold', extra: 1 } }), ctx))
      .toEqual(['block "m": a metric of a system reads { system, fact }, with an optional reading, such as { system: treasury-safe, fact: threshold }'])
  })
  it("refuses a record or system block that names nothing yet, as Arrange's new blocks start (NEW_BLOCK relies on it)", () => {
    const flow = (block: unknown) => ({ id: 'f', name: 'F', layout: 'flow', blocks: [block] })
    expect(validateBoard(flow({ id: 'record-1', type: 'record', source: { record: '' } }), ctx))
      .toEqual(['block "record-1": a record block reads { record: <kind>:<id> }, such as { record: project:co-fund }'])
    expect(validateBoard(flow({ id: 'system-1', type: 'system', source: { system: '' } }), ctx))
      .toEqual(['block "system-1": a system block reads { system: <its id in data/systems.yaml> }, with an optional reading'])
  })
})

describe('the proposals block', () => {
  const ctx = { fieldsOf }
  const flow = (source: unknown) => ({ id: 'f', name: 'F', layout: 'flow', blocks: [{ id: 'p', type: 'proposals', source }] })
  it('reads one of open, closed, mine or needs-me, and nothing else', () => {
    for (const which of ['open', 'closed', 'mine', 'needs-me']) expect(validateBoard(flow({ proposals: which }), ctx)).toEqual([])
    const said = ['block "p": a proposals block reads { proposals: <open, closed, mine, needs-me> }']
    expect(validateBoard(flow({ proposals: 'all' }), ctx)).toEqual(said)
    expect(validateBoard(flow({ proposals: 'open', kind: 'project' }), ctx)).toEqual(said)
    expect(validateBoard(flow({ kind: 'proposal' }), ctx)).toEqual(said)
  })
  it('names the proposal kind a list may read', () => {
    expect(validateBoard({ id: 'f', name: 'F', layout: 'flow', blocks: [{ id: 'l', type: 'list', source: { kind: 'proposal' } }] }, ctx)).toEqual([])
  })
})

describe("the Hub's own blocks (C6)", () => {
  const ctx = { fieldsOf }
  const flow = (type: string, source?: unknown) => ({ id: 'f', name: 'F', layout: 'flow', blocks: [{ id: 'b', type, ...(source === undefined ? {} : { source }) }] })
  it('needs, systems, prepared, balances and fundflow (C12) read no source', () => {
    for (const t of ['needs', 'systems', 'prepared', 'balances', 'fundflow']) {
      expect(validateBoard(flow(t), ctx), t).toEqual([])
      expect(validateBoard(flow(t, { kind: 'project' }), ctx), t).toEqual([`block "b": a ${t} block reads no source: remove source`])
    }
  })
  it('recently reads all or money, and nothing else', () => {
    expect(validateBoard(flow('recently', { recently: 'all' }), ctx)).toEqual([])
    expect(validateBoard(flow('recently', { recently: 'money' }), ctx)).toEqual([])
    const said = ['block "b": a recently block reads { recently: <all, money> }']
    expect(validateBoard(flow('recently', { recently: 'everything' }), ctx)).toEqual(said)
    expect(validateBoard(flow('recently'), ctx)).toEqual(said)
  })
})

describe('constants', () => {
  it('gives the systems section its own board id, so /b/systems stays the map (P4-C10)', () => {
    expect(sectionBoardId('systems')).toBe('outside-systems')
    expect(sectionBoardId('projects')).toBe('projects')
  })
  it('keeps the kind table in the lib', () => expect(REGISTRY_OF_KIND.project).toBe('projects'))
  it('lists the derived fields among every record\'s', () => expect([...BASE_FIELDS]).toEqual(['id', 'kind', 'name', 'status', 'attention', 'needs', 'changed', 'free']))
})
