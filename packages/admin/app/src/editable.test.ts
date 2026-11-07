import { describe, it, expect } from 'vitest'
import { canCreate, canEdit, type EditTarget } from './editable.ts'
import { resource } from './test/data.ts'
import type { Entity, Op, RegistryRead } from './api.ts'

const entries = [{ id: 'p1' }, { id: 'p2' }, { id: 'dup' }, { id: 'dup' }, { name: 'no id' }, { id: '' }] as unknown as Entity[]
const reg: RegistryRead = { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries }
const target = (over: Partial<EditTarget> = {}): EditTarget =>
  ({ resource: resource(), registry: 'projects', reg, id: 'p1', ops: [], known: true, ...over })
const op = (o: Partial<Op> & Pick<Op, 'op'>): Op => ({ record: 'projects:p1', base: 'h', before: { id: 'p1' }, ...o } as Op)

describe('canEdit (C11, C17): the one predicate for Edit, e, ?edit=1 and Delete', () => {
  it('allows a registry-backed, addressable record for a known actor', () => {
    expect(canEdit(target())).toBe(true)
  })
  it('allows a record that lives only in its registry (C17)', () => {
    expect(canEdit(target({ resource: null, registry: 'meetings', reg: { ...reg, name: 'meetings' } }))).toBe(true)
  })
  it('refuses an unknown actor', () => { expect(canEdit(target({ known: false }))).toBe(false) })
  it('refuses a resource with no registry, or one its source marks read-only', () => {
    expect(canEdit(target({ resource: resource({ source: null }) }))).toBe(false)
    expect(canEdit(target({ resource: resource({ source: { path: 'x', editable: false, registry: 'projects', entityId: 'p1' } }) }))).toBe(false)
    expect(canEdit(target({ resource: resource({ source: { path: 'x', editable: false } }), registry: null }))).toBe(false)
  })
  it('refuses a document, and a registry not yet read', () => {
    expect(canEdit(target({ reg: { ...reg, kind: 'document', entries: undefined, document: {} } }))).toBe(false)
    expect(canEdit(target({ reg: undefined }))).toBe(false)
  })
  it("refuses an entry it can't address: an id other entries share, an entry with no id (#n), an id nothing holds", () => {
    expect(canEdit(target({ id: 'dup' }))).toBe(false)
    expect(canEdit(target({ resource: null, id: '#5' }))).toBe(false)
    expect(canEdit(target({ id: 'gone' }))).toBe(false)
  })
  it('refuses a record staged for deletion, and allows one staged as new that the file does not hold yet', () => {
    expect(canEdit(target({ ops: [op({ op: 'delete' })] }))).toBe(false)
    expect(canEdit(target({ ops: [op({ op: 'delete', record: 'projects:p2' })] }))).toBe(true)
    expect(canEdit(target({ resource: null, id: 'new', ops: [op({ op: 'create', record: 'projects:new', value: { id: 'new' }, base: null, before: null })] }))).toBe(true)
    expect(canEdit(target({ resource: null, id: 'p1', ops: [op({ op: 'create', value: { id: 'p1' }, base: null, before: null })] }))).toBe(false)
  })
})

describe('canCreate (C11): where New is offered', () => {
  it('needs a known actor, a collection, and a section whose New adds to that registry', () => {
    expect(canCreate('projects', 'collection', true)).toBe(true)
    expect(canCreate('meetings', 'collection', true)).toBe(true)
    expect(canCreate('projects', 'collection', false)).toBe(false)
    expect(canCreate('projects', 'document', true)).toBe(false)
    expect(canCreate('projects', undefined, true)).toBe(false)
    expect(canCreate('events', 'collection', true)).toBe(false)
    expect(canCreate('toString', 'collection', true)).toBe(false)
  })
})
