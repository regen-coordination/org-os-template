import { describe, it, expect } from 'vitest'
import { applyFilters, fieldWord, filterText, type Filter } from './filters.ts'
import { TASKS, dueIn, readTask } from '../../test/fixtures/house/workspace.ts'

const ids = (filters: Filter[]) => applyFilters([...TASKS], filters, readTask).map(t => t.id)

describe('filterText', () => {
  it('reads a filter as its chip says it, in sentence case', () => {
    expect(filterText({ field: 'status', op: 'is-not', value: 'done' })).toBe('Status is not done')
    expect(filterText({ field: 'project', op: 'is', value: 'Node kit' })).toBe('Project is Node kit')
    expect(filterText({ field: 'due', op: 'before', value: '2026-10-20' })).toBe('Due is before 2026-10-20')
    expect(filterText({ field: 'due', op: 'after', value: '2026-10-20' })).toBe('Due is after 2026-10-20')
    expect(filterText({ field: 'title', op: 'contains', value: 'signer' })).toBe('Title contains signer')
  })

  it("takes the collection's own name for a field", () => {
    expect(filterText({ field: 'title', op: 'contains', value: 'pool' }, 'Task')).toBe('Task contains pool')
    expect(fieldWord('due-date')).toBe('Due date')
  })
})

describe('applyFilters, on the fixture tasks', () => {
  it('lets every row through with no filter, in order', () => {
    expect(ids([])).toEqual(TASKS.map(t => t.id))
  })

  it('is and is not match the whole value, ignoring case; a row with no value is not the value', () => {
    expect(ids([{ field: 'status', op: 'is-not', value: 'done' }])).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5'])
    expect(ids([{ field: 'project', op: 'is', value: 'node kit' }])).toEqual(['task-1', 'task-4'])
    expect(ids([{ field: 'owner', op: 'is', value: 'steward-a' }])).toEqual(['task-2', 'task-7'])
    expect(ids([{ field: 'owner', op: 'is-not', value: 'steward-a' }])).toEqual(['task-1', 'task-3', 'task-4', 'task-5', 'task-6'])
  })

  it('contains finds the value inside the text', () => {
    expect(ids([{ field: 'title', op: 'contains', value: 'SIGNER' }])).toEqual(['task-2', 'task-7'])
  })

  it('before and after compare dates, and a task with no date passes neither', () => {
    expect(ids([{ field: 'due', op: 'before', value: dueIn(0) }])).toEqual(['task-4', 'task-6', 'task-7'])
    expect(ids([{ field: 'due', op: 'after', value: dueIn(2) }])).toEqual(['task-2', 'task-3'])
    expect(ids([{ field: 'due', op: 'after', value: 'soon' }])).toEqual([])
  })

  it('applies every filter: a row passes all of them', () => {
    expect(ids([{ field: 'status', op: 'is-not', value: 'Done' }, { field: 'project', op: 'is', value: 'Treasury' }])).toEqual(['task-2', 'task-5'])
  })
})
