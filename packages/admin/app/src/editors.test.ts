import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { REGISTRIES } from '../../lib/registries.mjs'
import { GOVERNED_FILES, READ_ONLY_HERE, editorOf, editorsMarkdown, leftOut } from './editors.ts'

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
    expect(by('record')).toEqual(['members', 'projects', 'meetings', 'ideas', 'funding-opportunities', 'relationships', 'sources', 'events', 'channels', 'assets', 'knowledge-gaps', 'systems'])
    expect(by('board')).toEqual(['boards'])
    expect(by('own-routes')).toEqual(['proposals', 'library'])
    expect(by('generated')).toEqual(['.well-known/**'])
    expect(by('none-yet')).toEqual(['finances', 'governance', 'knowledge-manifest', 'visibility', 'data/*.yaml', 'IDENTITY.md', 'federation.yaml'])
    expect(rowOf('governance')!.how).toMatch(/never staged today \(R-L5-11\.7\).*governance check \(§7\.6\)/)
    expect(rowOf('visibility')!.how).toMatch(/Narrowing a record has its own route \(L5\); widening one is a publication/)
    expect(rowOf('data/*.yaml')!.what).toMatch(/data\/horizon\.yaml and data\/access-grants\.yaml/)
  })

  it('every document registry has no path yet, and every collection has one', () => {
    for (const r of REGISTRIES) expect(editorOf({ registry: r.name })!.path === 'none-yet', r.name).toBe(r.kind === 'document')
  })

  it('finds a file’s row by its path', () => {
    expect(editorOf({ path: 'data/members.yaml' })!.target).toBe('members')
    expect(editorOf({ path: './data/proposals.yaml' })!.target).toBe('proposals')
    expect(editorOf({ path: 'data/horizon.yaml' })!.target).toBe('data/*.yaml')
    expect(editorOf({ path: 'data/access-grants.yml' })!.target).toBe('data/*.yaml')
    expect(editorOf({ path: '.well-known/org.json' })!.path).toBe('generated')
    expect(editorOf({ path: 'IDENTITY.md' })!.target).toBe('IDENTITY.md')
    expect(editorOf({ path: 'federation.yaml' })!.target).toBe('federation.yaml')
    expect(editorOf({ path: 'scripts/initialize.mjs' })).toBeNull()
    expect(editorOf({ path: 'data/nested/x.yaml' })).toBeNull()
    expect(editorOf({ registry: 'nope' })).toBeNull()
  })

  it('the sentence a document says, in the Hub’s words', () => {
    expect(READ_ONLY_HERE).toBe('Read only here: a change to this file has no path in the Hub yet.')
    for (const f of GOVERNED_FILES) expect(`${f.what} ${f.how}`).not.toMatch(/house/i)
  })

  it('the README’s "What the Hub edits" is this table', () => {
    const at = README.indexOf('## What the Hub edits')
    expect(at).toBeGreaterThan(0)
    expect(README.slice(at)).toContain(editorsMarkdown())
    expect(editorsMarkdown().split('\n')).toHaveLength(2 + new Set(GOVERNED_FILES.map(f => f.how)).size)
  })
})
