import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { recogniseLink, recogniseLines, systemIdFor, githubRepoSystems, manifestImports } from '../../lib/systems-recognise.mjs'
import { REAL_REPO } from '../fixtures.ts'

const A = '0x' + 'ab'.repeat(20)
const sys = (line: string) => (recogniseLink(line) as any).system

describe('recogniseLink', () => {
  it('ignores blanks and comments', () => {
    expect(recogniseLink('')).toBeNull()
    expect(recogniseLink('   ')).toBeNull()
    expect(recogniseLink('# note')).toBeNull()
  })
  it('recognises a GitHub repo', () => {
    for (const l of ['https://github.com/o/r', 'https://github.com/o/r.git', 'https://github.com/o/r/tree/main/x'])
      expect(recogniseLink(l)).toEqual({ ok: true, system: { kind: 'repo', name: 'r', url: 'https://github.com/o/r' } })
  })
  it('recognises a GitHub owner', () => {
    expect(recogniseLink('https://github.com/o')).toEqual({ ok: true, githubOwner: 'o' })
    expect(recogniseLink('https://github.com/o/')).toEqual({ ok: true, githubOwner: 'o' })
  })
  it('recognises Snapshot spaces', () => {
    expect(sys('https://snapshot.box/#/s:refi.eth')).toEqual({ kind: 'snapshot-space', name: 'refi.eth', space: 'refi.eth' })
    expect(sys('https://snapshot.org/#/refi.eth')).toEqual({ kind: 'snapshot-space', name: 'refi.eth', space: 'refi.eth' })
  })
  it('recognises Safes', () => {
    const chains: Record<string, string> = { eth: 'eip155:1', oeth: 'eip155:10', gno: 'eip155:100', matic: 'eip155:137', arb1: 'eip155:42161', base: 'eip155:8453', celo: 'eip155:42220', sep: 'eip155:11155111' }
    for (const [p, chain] of Object.entries(chains))
      expect(sys(`${p}:${A}`)).toEqual({ kind: 'safe', name: `Safe ${A.slice(0, 6)}…${A.slice(-4)}`, chain, address: A })
    expect(sys(`https://app.safe.global/home?safe=celo:${A}`)).toMatchObject({ kind: 'safe', chain: 'eip155:42220', address: A })
  })
  it('asks which chain for a bare address', () => {
    expect(recogniseLink(A)).toEqual({ ok: false, line: A, error: 'Say which chain, like celo:0x… or eth:0x….' })
  })
  it('recognises docs, databases, links', () => {
    expect(sys('https://www.notion.so/team/page')).toMatchObject({ kind: 'docs', url: 'https://www.notion.so/team/page' })
    expect(sys('https://x.notion.site/y')).toMatchObject({ kind: 'docs' })
    expect(sys('https://docs.google.com/document/d/1/edit')).toMatchObject({ kind: 'docs' })
    expect(sys('https://drive.google.com/drive/folders/1')).toMatchObject({ kind: 'docs' })
    expect(sys('https://docs.google.com/spreadsheets/d/1')).toMatchObject({ kind: 'database' })
    expect(sys('https://airtable.com/app1')).toMatchObject({ kind: 'database' })
    expect(sys('https://example.org/a/b')).toEqual({ kind: 'link', name: 'example.org', url: 'https://example.org/a/b' })
  })
  it('refuses http and the unknown', () => {
    expect(recogniseLink('http://example.org')).toEqual({ ok: false, line: 'http://example.org', error: 'Use the https address.' })
    expect(recogniseLink('hello')).toEqual({ ok: false, line: 'hello', error: 'Not a link this page knows. Paste a web address, a GitHub repo or organization, or a Safe as chain:0x….' })
  })
})

describe('systemIdFor', () => {
  it('slugs and avoids taken ids', () => {
    expect(systemIdFor('My Repo!', new Set())).toBe('my-repo')
    expect(systemIdFor('x', new Set(['x']))).toBe('x-2')
    expect(systemIdFor('x', new Set(['x', 'x-2']))).toBe('x-3')
  })
})

describe('recogniseLines', () => {
  it('marks duplicates of existing and earlier rows', () => {
    const existing = [{ id: 'r', kind: 'repo', name: 'r', url: 'git@github.com:o/r.git' }, { id: 'l', kind: 'link', name: 'e', url: 'https://example.org/a' }]
    const out = recogniseLines(['https://github.com/o/r', 'https://example.org/a', 'https://github.com/p/q', 'git@github.com:p/q.git', 'https://github.com/p/q', 'https://github.com/zed', 'nope', '# c'].join('\n'), existing)
    expect(out.rows.map(r => r.duplicateOf)).toEqual(['r', 'l', null, 'q', 'q'])
    expect(out.owners).toEqual(['zed'])
    expect(out.errors).toHaveLength(1)
  })
  it('treats the ssh and https forms of one repo as the same', () => {
    const out = recogniseLines('https://github.com/p/q\nssh://git@github.com/p/q', [])
    expect(out.rows[0].duplicateOf).toBeNull()
    expect(out.rows[1].duplicateOf).toBe(out.rows[0].system.id)
  })
  it('finds Safe and Snapshot repeats', () => {
    const out = recogniseLines(`celo:${A}\nhttps://app.safe.global/home?safe=celo:${A}\nhttps://snapshot.org/#/a\nhttps://snapshot.box/#/s:a`, [])
    expect(out.rows.map(r => r.duplicateOf !== null)).toEqual([false, true, false, true])
  })
})

describe('githubRepoSystems', () => {
  it('sets purpose and skips listed', () => {
    const list = [
      { name: 'a', url: 'https://github.com/o/a', archived: true, fork: false },
      { name: 'b', url: 'https://github.com/o/b', archived: false, fork: true, description: 'bb' },
      { name: 'c', url: 'https://github.com/o/c', archived: false, fork: false },
    ]
    const out = githubRepoSystems(list, [{ id: 'c', kind: 'repo', name: 'c', url: 'https://github.com/o/c.git' }]) as any[]
    expect(out.map(s => [s.name, s.purpose])).toEqual([['a', 'archive'], ['b', 'fork']])
    expect(out[1].description).toBe('bb')
    expect(out[0]).toMatchObject({ kind: 'repo', id: 'a' })
  })
})

describe('manifestImports', () => {
  const manifest = JSON.parse(readFileSync(join(REAL_REPO, 'repos.manifest.json'), 'utf8'))
  it('offers one per entry, then none', () => {
    const imports = manifestImports(manifest, []) as any[]
    expect(imports).toHaveLength(manifest.repositories.length)
    expect(imports[0]).toMatchObject({ kind: 'repo', url: 'https://github.com/regen-coordination/org-os-framework', mount: 'repos/org-os-framework' })
    expect(imports[0].branch).toBeUndefined()
    expect(manifestImports(manifest, imports)).toEqual([])
  })
  it('matches by mount, keeps non-main branch, tolerates null', () => {
    expect(manifestImports(null, [])).toEqual([])
    const m = { baseDirectory: 'r', repositories: [{ name: 'x', url: 'https://github.com/o/x.git', branch: 'dev' }, { name: 'y', url: 'https://github.com/o/y.git', branch: 'main' }] }
    const out = manifestImports(m, [{ id: 'q', kind: 'repo', name: 'q', url: 'https://other/y', mount: 'r/y' }]) as any[]
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'x', branch: 'dev', mount: 'r/x' })
  })
})
