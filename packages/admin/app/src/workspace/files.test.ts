// 0.7.1 (D6): the source editor's link is drawn only for a file the viewer may read. GET /api/editors says it per row
// (`readable`); a row an older server sends without it reads as readable, as every member read every governed file.
import { describe, it, expect } from 'vitest'
import { EDITORS } from '../../../lib/workspace/editors.mjs'
import { editorLink, readableIn } from './files.ts'

const rows = EDITORS.map(r => ({ ...r, readable: r.read !== 'deciders' }))

describe('the source editor link, per viewer (0.7.1 D6)', () => {
  it('a row the viewer may not read has no link; every other keeps its editor', () => {
    expect(editorLink(rows.find(r => r.pattern === 'memory/**')!)).toBeUndefined()
    expect(editorLink(rows.find(r => r.pattern === 'docs/plans/**')!)).toBeUndefined()
    expect(editorLink(rows.find(r => r.pattern === 'IDENTITY.md')!)).toBe('/files/IDENTITY.md')
    expect(editorLink({ pattern: 'memory/**', editor: 'source' })).toBe('/files/memory/')
  })

  it('a path is readable as its row of the table says, and a path of no gated row needs no answer', () => {
    expect(readableIn(rows, 'memory/2026-11-01.md')).toBe(false)
    expect(readableIn(rows, 'HEARTBEAT.md')).toBe(false)
    expect(readableIn(rows, 'data/horizon.yaml')).toBe(true)
    expect(readableIn(undefined, 'data/horizon.yaml')).toBe(true)
    // Until the table has answered, a gated path is not linked.
    expect(readableIn(undefined, 'memory/2026-11-01.md')).toBe(false)
    expect(readableIn(EDITORS.map(r => ({ ...r, readable: true })), 'memory/2026-11-01.md')).toBe(true)
  })
})
