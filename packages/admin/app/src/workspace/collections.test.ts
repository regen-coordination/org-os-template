// DAO-OS L6 Task 17: a collection's rules in the client — its fields, its board's columns and card order, the ops a
// move makes, the ids a new record, view and collection take, and the map's graph (spec §7.2, §7.3, §7.6).
import { describe, it, expect } from 'vitest'
import {
  boardColumns, boardFieldOf, cellText, collectionGraph, collectionIdOf, dateFieldOf, fieldIdOf, fieldsOf, inColumnOrder, isWorkspaceCollection,
  NONE, placeOps, recordIdOf, titleFieldOf, viewIdOf, withKept, type Row,
} from './collections.ts'

const def = (over: Record<string, unknown> = {}) => ({ id: 'circles', name: 'Circles', builtin: false, visibility: 'members',
  fields: [{ id: 'name', type: 'text' }, { id: 'status', type: 'select', options: ['active', 'paused'] }, { id: 'starts', type: 'date' },
    { id: 'projects', type: 'relation', to: 'projects', many: true }, { id: 'parent', type: 'relation', to: 'circles' }], ...over }) as never

describe('a collection’s fields', () => {
  it('tasks and meetings carry the Hub’s fields; a custom collection its definition’s, named by `name` or its id', () => {
    expect(fieldsOf('tasks').map(f => f.id)).toEqual(['title', 'status', 'owner', 'due', 'project', 'meeting', 'proposal', 'priority'])
    expect(fieldsOf('meetings').map(f => [f.id, f.type])).toEqual([['title', 'text'], ['date', 'date'], ['type', 'select'], ['notes', 'page']])
    expect(fieldsOf('circles', def()).map(f => f.label)).toEqual(['Name', 'Status', 'Starts', 'Projects', 'Parent'])
    expect(fieldsOf('circles', def({ fields: [{ id: 'lead_by', type: 'person', name: 'Led by' }] }))[0]).toMatchObject({ id: 'lead_by', label: 'Led by' })
  })

  it('a registry with no definition is read from its rows: every key but the gate’s', () => {
    const rows: Row[] = [{ id: 'p1', name: 'One', status: 'active', visibility: 'members', restricted: { budget: 'hat:ops' } }]
    expect(fieldsOf('projects', undefined, rows).map(f => f.id)).toEqual(['name', 'status', 'budget'])
  })

  it('the title is `title`, else `name`, else the first text field', () => {
    expect(titleFieldOf(fieldsOf('tasks'))).toBe('title')
    expect(titleFieldOf(fieldsOf('circles', def()))).toBe('name')
    expect(titleFieldOf([{ id: 'label', label: 'Label', type: 'text' }])).toBe('label')
  })

  it('a board groups by its saved field, else status, else the first select; a calendar by its date, else the first date field', () => {
    expect(boardFieldOf(fieldsOf('tasks'))).toBe('status')
    expect(boardFieldOf(fieldsOf('tasks'), 'priority')).toBe('priority')
    expect(boardFieldOf([{ id: 'stage', label: 'Stage', type: 'select' }])).toBe('stage')
    expect(dateFieldOf(fieldsOf('tasks'))).toBe('due')
    expect(dateFieldOf(fieldsOf('meetings'))).toBe('date')
    expect(dateFieldOf(fieldsOf('circles', def()))).toBe('starts')
  })

  it('tasks, meetings and custom collections are workspace writes; a registry like projects is not', () => {
    expect(isWorkspaceCollection('tasks')).toBe(true)
    expect(isWorkspaceCollection('meetings')).toBe(true)
    expect(isWorkspaceCollection('circles', def())).toBe(true)
    expect(isWorkspaceCollection('projects', { id: 'projects', builtin: true, visibility: 'members' } as never)).toBe(false)
    expect(isWorkspaceCollection('projects')).toBe(false)
  })

  it('a cell reads a value as text: lists joined, yes and no, a range with its dash, nothing as nothing', () => {
    expect(cellText(['a', 'b'])).toBe('a, b')
    expect(cellText(true)).toBe('Yes')
    expect(cellText({ start: '2026-11-01', end: '2026-11-03' })).toBe('2026-11-01 – 2026-11-03')
    expect(cellText(null)).toBe('')
    expect(cellText(3)).toBe('3')
  })
})

describe('the board', () => {
  const rows: Row[] = [{ id: 'a', status: 'doing' }, { id: 'b', status: 'open' }, { id: 'c' }, { id: 'd', status: 'doing' }]
  it('columns come from the saved order, then the values first met, then the options; a row with none is in “No status”', () => {
    expect(boardColumns(rows, { id: 'status', label: 'Status', type: 'select' }).map(c => c.id)).toEqual(['doing', 'open', NONE])
    expect(boardColumns(rows, { id: 'status', label: 'Status', type: 'select' }, ['open']).map(c => c.name)).toEqual(['open', 'doing', 'No status'])
    expect(boardColumns([], { id: 'status', label: 'Status', type: 'select', options: ['active', 'paused'] }).map(c => c.id)).toEqual(['active', 'paused'])
    // an empty collection still has a column to add a card to
    expect(boardColumns([], { id: 'status', label: 'Status', type: 'text' }).map(c => c.name)).toEqual(['No status'])
  })

  it('cards keep their `order`, then their place in the file', () => {
    const cards: Row[] = [{ id: 'a' }, { id: 'b', order: 2000 }, { id: 'c', order: 1000 }, { id: 'd' }]
    expect(inColumnOrder(cards).map(c => c.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('a move within a column sets the card’s order between its new neighbours', () => {
    const column: Row[] = [{ id: 'a', order: 1000 }, { id: 'b', order: 2000 }]
    expect(placeOps('tasks', column, { id: 'c', order: 3000 }, 1, {})).toEqual([{ op: 'update', record: 'tasks:c', set: { order: 1500 } }])
    expect(placeOps('tasks', column, { id: 'c', order: 3000 }, 0, {})).toEqual([{ op: 'update', record: 'tasks:c', set: { order: 0 } }])
    expect(placeOps('tasks', column, { id: 'c' }, 2, { status: 'done' })).toEqual([{ op: 'update', record: 'tasks:c', set: { status: 'done', order: 3000 } }])
  })

  it('a column with a card that has no order is numbered anew, the moved card in its place', () => {
    const column: Row[] = [{ id: 'a' }, { id: 'b' }]
    expect(placeOps('tasks', column, { id: 'c' }, 1, { status: 'open' })).toEqual([
      { op: 'update', record: 'tasks:a', set: { order: 1000 } },
      { op: 'update', record: 'tasks:c', set: { status: 'open', order: 2000 } },
      { op: 'update', record: 'tasks:b', set: { order: 3000 } },
    ])
  })
})

describe('ids', () => {
  it('a new record is its title’s slug and four hex digits', () => {
    expect(recordIdOf('Write the onboarding page', () => 'a1b2')).toBe('write-the-onboarding-page-a1b2')
    expect(recordIdOf('', () => 'a1b2')).toBe('record-a1b2')
  })
  it('a view id is its name’s slug, made distinct from the ones taken', () => {
    expect(viewIdOf('My open tasks', [])).toBe('my-open-tasks')
    expect(viewIdOf('Open', ['open'])).toBe('open-2')
    expect(viewIdOf('2027 plan', [])).toBe('v-2027-plan')
    expect(viewIdOf('Board', [])).toBe('board-view')
  })
  it('a collection id is lowercase and hyphens; a field id lowercase and underscores', () => {
    expect(collectionIdOf('Working circles')).toBe('working-circles')
    expect(collectionIdOf('Tree x')).toBe('tree-x')
    expect(fieldIdOf('Led by')).toBe('led_by')
  })
})

describe('what this tab wrote, kept until the read holds it (a batch commits within RECORD_IDLE_MS)', () => {
  it('lays a set over its row and adds a created row the read does not hold yet', () => {
    const kept = { a: { at: 1, set: { status: 'done' } }, n: { at: 1, created: { id: 'n', title: 'New' }, set: {} } }
    expect(withKept([{ id: 'a', status: 'open' }], kept)).toEqual([{ id: 'a', status: 'done' }, { id: 'n', title: 'New' }])
  })
})

describe('collectionGraph (§7.6)', () => {
  it('draws the records and an edge for each relation the viewer may follow; an edge to a record they may not see is dropped', () => {
    const records: Row[] = [
      { id: 'c1', name: 'Ops circle', projects: ['p1', 'p2'], parent: 'c2', visibility: 'members' },
      { id: 'c2', name: 'Council circle', parent: 'c9' },
    ]
    const known = (collection: string, id: string) => (collection === 'projects' && id === 'p1' ? { name: 'Node kit' } : null)
    const g = collectionGraph(records, def(), known)
    expect(g.items.map(i => [i.id, i.name])).toEqual([['circles:c1', 'Ops circle'], ['circles:c2', 'Council circle'], ['projects:p1', 'Node kit']])
    expect(g.items[0]).toMatchObject({ visibility: 'members' })
    // p2 is not known to the viewer, nor c9: no edge, no node
    expect(g.links).toEqual([{ from: 'circles:c1', to: 'projects:p1', label: 'projects' }, { from: 'circles:c1', to: 'circles:c2', label: 'parent' }])
  })

  it('a task links to its project, meeting and proposal', () => {
    const known = (collection: string, id: string) => ({ name: `${collection} ${id}` })
    const g = collectionGraph([{ id: 't1', title: 'Task', project: 'p1', meeting: 'm1', proposal: 'P-1' }], { id: 'tasks' }, known)
    expect(g.links.map(l => l.to)).toEqual(['projects:p1', 'meetings:m1', 'proposals:P-1'])
  })
})
