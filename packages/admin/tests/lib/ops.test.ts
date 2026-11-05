import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { StageError, parseRecord, recordId, projectOp } from '../../lib/ops.mjs'
import * as fromRecords from '../../server/changes/records.ts'
import type { Entity } from '../../server/registry.ts'

const P = { id: 'p1', title: 'One', status: 'idea', lead: 'bruno' }
const R = 'projects:p1'
const up = (set: Record<string, unknown>) => ({ op: 'update' as const, record: R, set })
/** The field a StageError names, or 'other' for any other error, or null when nothing was thrown. */
const refused = (fn: () => unknown): string | null => {
  try { fn(); return null } catch (e) { return e instanceof StageError ? e.field : 'other' }
}

describe('records (moved from tests/changes/merge.test.ts, unchanged)', () => {
  it('splits at the first colon, so an id may hold colons (Review Focus 1)', () => {
    expect(parseRecord('members:github:bruno-lima')).toEqual({ registry: 'members', id: 'github:bruno-lima' })
    expect(parseRecord('members:did:example-os:bruno-lima')).toEqual({ registry: 'members', id: 'did:example-os:bruno-lima' })
  })
  it('refuses an unknown registry and a document registry', () => {
    expect(refused(() => parseRecord('nope:x'))).toBe('')
    expect(() => parseRecord('finances:x')).toThrow(/document registry/)
  })
  it('projects an op onto the entries', () => {
    const entries = new Map<string, Entity[]>([['projects', [{ ...P }]]])
    projectOp(entries, up({ status: 'develop' }))
    projectOp(entries, { op: 'create', record: 'projects:p2', value: { id: 'p2' } })
    projectOp(entries, { op: 'delete', record: 'members:ana' }) // nothing there: changes nothing
    expect(entries.get('projects')).toEqual([{ ...P, status: 'develop' }, { id: 'p2' }])
    expect(entries.get('members')).toEqual([])
  })
})

describe('parseRecord, the two refusals in words', () => {
  it('a record naming no registry says how a record is written', () => {
    expect(() => parseRecord('nope:x')).toThrow('"nope:x" names no registry: a record is written <registry>:<id>, for example projects:my-project.')
    expect(() => parseRecord('')).toThrow(/names no registry/)
  })
  it('a record naming a document registry says it cannot be staged', () => {
    expect(() => parseRecord('finances:x')).toThrow('finances is a document registry: it is not edited entry by entry, so it cannot be staged here.')
  })
  it('a record with no colon parses to an empty id; recordId refuses it', () => {
    expect(parseRecord('projects')).toEqual({ registry: 'projects', id: '' })
    expect(refused(() => recordId('projects:'))).toBe('id')
    expect(() => recordId('projects:')).toThrow('"projects:" has no id after the colon: a record is written <registry>:<id>.')
    expect(recordId('projects:p1')).toEqual({ registry: 'projects', id: 'p1' })
  })
})

describe('projectOp', () => {
  const fresh = () => new Map<string, Entity[]>([['projects', [{ ...P }]]])
  it('create adds the value once; a second create of the same id changes nothing', () => {
    const e = fresh()
    projectOp(e, { op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Two' } })
    projectOp(e, { op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Changed' } })
    expect(e.get('projects')).toEqual([P, { id: 'p2', title: 'Two' }])
  })
  it('update merges set over the entry; replace swaps the whole entry; delete removes it', () => {
    const e = fresh()
    projectOp(e, up({ status: 'develop' }))
    expect(e.get('projects')).toEqual([{ ...P, status: 'develop' }])
    projectOp(e, { op: 'replace', record: R, value: { id: 'p1', title: 'Whole' } })
    expect(e.get('projects')).toEqual([{ id: 'p1', title: 'Whole' }])
    projectOp(e, { op: 'delete', record: R })
    expect(e.get('projects')).toEqual([])
  })
  it('is lenient: update, replace and delete of an entry that is not there change nothing', () => {
    for (const op of [
      { op: 'update' as const, record: 'projects:nope', set: { a: 1 } },
      { op: 'replace' as const, record: 'projects:nope', value: { id: 'nope' } },
      { op: 'delete' as const, record: 'projects:nope' },
    ]) {
      const e = fresh()
      projectOp(e, op)
      expect(e.get('projects')).toEqual([P])
    }
  })
  it('compares ids as strings, as the files’ lookups do', () => {
    const e = new Map<string, Entity[]>([['projects', [{ id: 7, title: 'seven' }]]])
    projectOp(e, { op: 'update', record: 'projects:7', set: { title: 'Seven' } })
    expect(e.get('projects')).toEqual([{ id: 7, title: 'Seven' }])
  })
})

describe('lib/ops.mjs is pure, so the root validator and the client can import it', () => {
  const src = readFileSync(new URL('../../lib/ops.mjs', import.meta.url), 'utf8')
  const specifiers = [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
  it('imports nothing from node:* and nothing under server/', () => {
    expect(specifiers.filter(s => s.startsWith('node:') || /(^|\/)server\//.test(s))).toEqual([])
    expect(specifiers).toEqual(['./registries.mjs'])
  })
})

describe('server/changes/records.ts still serves the names the server imports', () => {
  it('re-exports the same StageError class, parseRecord, recordId and projectOp', async () => {
    const ops = await import('../../lib/ops.mjs')
    expect(fromRecords.StageError).toBe(ops.StageError)
    expect(fromRecords.parseRecord).toBe(ops.parseRecord)
    expect(fromRecords.recordId).toBe(ops.recordId)
    expect(fromRecords.projectOp).toBe(ops.projectOp)
    expect(new fromRecords.StageError('f', 'm')).toBeInstanceOf(ops.StageError)
  })
})
