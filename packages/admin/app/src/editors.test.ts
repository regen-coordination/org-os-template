import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { REGISTRIES } from '../../lib/registries.mjs'
import { GOVERNED_FILES, editorOf, editorsMarkdown, leftOut } from './editors.ts'

// F-L3-3: every governed file has a stated path through the Hub. The two lists that say what is governed are read as
// they are on disk: the registry list (lib/registries.mjs) and the change classes (schemas/change-classes.json, at the
// framework root). A name either of them gains that the table leaves out fails here.
const CLASSES = JSON.parse(readFileSync(new URL('../../../../schemas/change-classes.json', import.meta.url), 'utf8')) as { map: { registry?: string; path?: string }[] }
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
const rowOf = (target: string) => GOVERNED_FILES.find(f => f.target === target)

describe('what each governed file is edited with (F-L3-3)', () => {
  it('leaves out nothing the registry list or the change classes name', () => {
    expect(REGISTRIES.length).toBeGreaterThan(15)
    expect(CLASSES.map.length).toBeGreaterThan(5)
    expect(leftOut(REGISTRIES.map(r => r.name), CLASSES.map)).toEqual([])
  })

  it('the check can fail: a registry, a path or the other data files the table has no row for', () => {
    expect(leftOut(['members', 'treasury-notes'], [{ path: 'CHARTER.md' }, { registry: 'grants' }, { registry: '*' }]))
      .toEqual(['registry treasury-notes', 'path CHARTER.md', 'registry grants'])
  })

  it('names no registry the list does not have, and each target once', () => {
    const names = new Set(REGISTRIES.map(r => r.name))
    expect(GOVERNED_FILES.filter(f => f.kind === 'registry' && !names.has(f.target))).toEqual([])
    expect(new Set(GOVERNED_FILES.map(f => f.target)).size).toBe(GOVERNED_FILES.length)
  })

  it('says how each is edited, as the ruling assigns them', () => {
    const by = (path: string) => GOVERNED_FILES.filter(f => f.path === path).map(f => f.target)
    expect(by('record')).toEqual(['members', 'projects', 'meetings', 'ideas', 'funding-opportunities', 'relationships', 'sources', 'events', 'channels', 'assets', 'knowledge-gaps', 'systems', 'tasks', 'data/collections/**'])
    expect(by('board')).toEqual(['boards'])
    expect(by('own-routes')).toEqual(['proposals', 'library', 'federation-requests', 'invites', 'data/kb/**', 'federation/**'])
    expect(by('page')).toEqual(['pages/**'])
    expect(by('generated')).toEqual(['.well-known/**'])
    // DAO-OS L6 Task 19: the source editor is built; what had no path yet is edited whole there
    expect(by('source')).toEqual(['finances', 'governance', 'knowledge-manifest', 'visibility', 'data/*.yaml', 'collections', 'data/imports.yaml',
      'memory/**', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/**', 'docs/agent-plans/**', 'IDENTITY.md', 'federation.yaml'])
    expect(by('none-yet')).toEqual([])
    expect(rowOf('governance')!.how).toMatch(/^The source editor \(\/files\/<path>\).*The governance check \(§7\.6\) runs on it/)
    expect(rowOf('visibility')!.how).toMatch(/Narrowing a record has its own route \(L5\); a text that widens what is public is a publication/)
    expect(rowOf('data/*.yaml')!.what).toMatch(/data\/horizon\.yaml and data\/access-grants\.yaml/)
  })

  it('every document registry is edited whole in the source editor, and every collection has a path of its own (L6 Task 19)', () => {
    for (const r of REGISTRIES) expect(editorOf({ registry: r.name })!.path === 'source', r.name).toBe(r.kind === 'document')
  })

  it('finds a file’s row by its path', () => {
    expect(editorOf({ path: 'data/members.yaml' })!.target).toBe('members')
    expect(editorOf({ path: './data/proposals.yaml' })!.target).toBe('proposals')
    expect(editorOf({ path: 'data/horizon.yaml' })!.target).toBe('data/*.yaml')
    expect(editorOf({ path: 'data/access-grants.yml' })!.target).toBe('data/*.yaml')
    expect(editorOf({ path: '.well-known/org.json' })!.path).toBe('generated')
    expect(editorOf({ path: 'IDENTITY.md' })!.target).toBe('IDENTITY.md')
    expect(editorOf({ path: 'federation.yaml' })!.target).toBe('federation.yaml')
    // DAO-OS L6's files: a page, a custom collection's records, the canon, the imports' record, the agent layer
    expect(editorOf({ path: 'pages/handbook-1a2b.md' })!.path).toBe('page')
    expect(editorOf({ path: 'data/collections/grants.yaml' })!.path).toBe('record')
    expect(editorOf({ path: 'data/kb/encyclopedia-entry.yaml' })!.target).toBe('data/kb/**')
    expect(editorOf({ path: 'data/imports.yaml' })!.target).toBe('data/imports.yaml')
    expect(editorOf({ path: 'memory/2026-11-04.md' })!.target).toBe('memory/**')
    expect(editorOf({ path: 'scripts/initialize.mjs' })).toBeNull()
    expect(editorOf({ path: 'data/nested/x.yaml' })).toBeNull()
    expect(editorOf({ registry: 'nope' })).toBeNull()
  })

  it('says each in the Hub’s words', () => {
    for (const f of GOVERNED_FILES) expect(`${f.what} ${f.how}`).not.toMatch(/house/i)
  })

  it('the README’s "What the Hub edits" is this table', () => {
    const at = README.indexOf('## What the Hub edits')
    expect(at).toBeGreaterThan(0)
    expect(README.slice(at)).toContain(editorsMarkdown())
    expect(editorsMarkdown().split('\n')).toHaveLength(2 + new Set(GOVERNED_FILES.map(f => f.how)).size)
  })
})
