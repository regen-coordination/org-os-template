import { describe, it, expect } from 'vitest'
import { repoDriver } from '../../server/systems/repo.ts'
import { DRIVERS } from '../../server/systems/drivers.ts'
import { guardedFetch, guardedText, UpstreamHttpError, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'

const NOW = new Date('2026-10-30T12:00:00Z')
const SHA = 'a'.repeat(40)
const SYSTEM = { id: 'ideas', kind: 'repo', driver: 'repo', name: 'Ideas', url: 'https://github.com/example-org/ideas', files: ['data/ideas.yaml', '.well-known/projects.json'] }
const FILES: Record<string, string> = {
  'data/ideas.yaml': 'ideas:\n  - id: i1\n    title: First idea\n  - id: i2\n    title: Second idea\n',
  '.well-known/projects.json': JSON.stringify([{ id: 'p1', name: 'Project one' }]),
}

function world(files: Record<string, string | number> = FILES) {
  const seen: string[] = []
  const inits: any[] = []
  const fetch: FetchLike = async (url, init) => {
    seen.push(url); inits.push(init)
    const u = new URL(url)
    if (u.hostname === 'api.github.com') {
      const body = { sha: SHA, commit: { committer: { date: '2026-10-29T10:00:00Z' } } }
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
    }
    const path = u.pathname.split('/').slice(4).join('/')
    const f = files[path]
    if (f === undefined || typeof f === 'number') return { ok: false, status: typeof f === 'number' ? f : 404, json: async () => ({}), text: async () => '' }
    return { ok: true, status: 200, json: async () => JSON.parse(f), text: async () => f }
  }
  const ctx = (): DriverContext => {
    const signal = new AbortController().signal
    return { fetchJson: guardedFetch(repoDriver, fetch, signal), fetchText: guardedText(repoDriver, fetch, signal), now: () => NOW, members: [] }
  }
  return { seen, inits, fetch, ctx }
}

describe('the repo driver', () => {
  it('is registered, read only, with the two GitHub hosts', () => {
    expect(DRIVERS).toContain(repoDriver)
    expect(repoDriver.name).toBe('repo')
    expect(repoDriver.hosts).toEqual(['api.github.com', 'raw.githubusercontent.com'])
    const d = repoDriver as unknown as Record<string, unknown>
    for (const k of ['prepare', 'prepareAction', 'actions', 'outcome']) expect(d[k], k).toBeUndefined()
  })

  it('reads the items of the published files, each from the repository, at the commit read', async () => {
    const w = world()
    const r = await repoDriver.read(SYSTEM, w.ctx())
    expect(r.ok).toBe(true)
    expect(r.facts.repo).toBe('example-org/ideas')
    expect(r.facts.sha).toBe(SHA)
    expect(r.facts.committed).toBe('2026-10-29T10:00:00Z')
    expect(r.facts.files).toEqual([{ path: 'data/ideas.yaml', ok: true, items: 2 }, { path: '.well-known/projects.json', ok: true, items: 1 }])
    const items = r.facts.items as any[]
    expect(items).toEqual([
      { path: 'data/ideas.yaml', id: 'i1', title: 'First idea', from: 'from example-org/ideas' },
      { path: 'data/ideas.yaml', id: 'i2', title: 'Second idea', from: 'from example-org/ideas' },
      { path: '.well-known/projects.json', id: 'p1', title: 'Project one', from: 'from example-org/ideas' },
    ])
    expect(w.seen.some(u => u.startsWith(`https://raw.githubusercontent.com/example-org/ideas/${SHA}/data/ideas.yaml`))).toBe(true)
    for (const s of r.sections) for (const row of s.rows) expect(row.cells.at(-1)).toBe('from example-org/ideas')
    expect(r.open).toEqual({ url: 'https://github.com/example-org/ideas', embeddable: false })
  })

  it('a file that is not there reads "not published, or private"; the read stays ok', async () => {
    const w = world({ 'data/ideas.yaml': FILES['data/ideas.yaml']! })
    const r = await repoDriver.read(SYSTEM, w.ctx())
    expect(r.ok).toBe(true)
    expect((r.facts.files as any[])[1]).toEqual({ path: '.well-known/projects.json', ok: false, items: 0, error: 'not published, or private' })
  })

  it('a file over 512 KiB is not read', async () => {
    const w = world({ ...FILES, 'data/ideas.yaml': 'x'.repeat(600 * 1024) })
    const r = await repoDriver.read(SYSTEM, w.ctx())
    expect(r.ok).toBe(true)
    expect((r.facts.files as any[])[0]).toMatchObject({ ok: false, error: 'too large to read (over 512 KiB)' })
  })

  it('refuses a url that is not a GitHub repository', async () => {
    const w = world()
    await expect(repoDriver.read({ ...SYSTEM, url: 'https://gitlab.com/a/b' }, w.ctx())).rejects.toThrow('the repo driver reads GitHub repositories (https://github.com/<owner>/<repo>)')
    expect(w.seen).toEqual([])
  })

  it('reads Markdown front matter as one item', async () => {
    const w = world({ 'README.md': '---\nid: readme\ntitle: Hello\n---\nbody' })
    const r = await repoDriver.read({ ...SYSTEM, files: ['README.md'] }, w.ctx())
    expect((r.facts.items as any[])).toEqual([{ path: 'README.md', id: 'readme', title: 'Hello', from: 'from example-org/ideas' }])
  })

  it('a commit that cannot be read fails the read', async () => {
    const fetchText = async () => ''
    const fetchJson = async () => { throw new UpstreamHttpError('api.github.com answered 404', 404, null) }
    await expect(repoDriver.read(SYSTEM, { fetchJson, fetchText, now: () => NOW, members: [] })).rejects.toThrow('not published, or private')
  })
})

describe('the repo driver, hostile input', () => {
  it('refuses paths and branches that leave the pinned repository', async () => {
    for (const f of ['../../other/repo/main/x', './x', 'a//b', '/abs', 'a/..']) {
      const w = world()
      await expect(repoDriver.read({ ...SYSTEM, files: [f] }, w.ctx()), f).rejects.toThrow('is not a path inside the repository')
      expect(w.seen).toEqual([])
    }
    for (const branch of ['..', '.']) await expect(repoDriver.read({ ...SYSTEM, branch }, world().ctx())).rejects.toThrow('is not a branch')
  })
  it('refuses a .git url in the code as the schema does', async () => {
    await expect(repoDriver.read({ ...SYSTEM, url: 'https://github.com/o/r.git' }, world().ctx())).rejects.toThrow('GitHub repositories')
  })
  it('a parse error never carries file content into the facts', async () => {
    const w = world({ 'data/ideas.yaml': 'refused: [unclosed secret-token', '.well-known/projects.json': '{"refused secret-token' })
    const r = await repoDriver.read(SYSTEM, w.ctx())
    expect((r.facts.files as any[]).map(f => f.error)).toEqual(['not readable as YAML, JSON or Markdown front matter', 'not readable as YAML, JSON or Markdown front matter'])
    expect(JSON.stringify(r)).not.toContain('secret-token')
  })
  it('the schema rejects the same paths', async () => {
    const { validateEntry } = await import('../../lib/data-validate.mjs') as any
    const check = (f: string) => JSON.stringify(validateEntry('systems', { id: 'x', kind: 'repo', driver: 'repo', name: 'X', url: 'https://github.com/o/r', files: [f] }))
    expect(check('data/a.yaml')).not.toMatch(/pattern/)
    for (const f of ['../x', 'a/../b', '/abs', './x', 'a//b']) expect(check(f), f).toMatch(/pattern/)
  })
})

describe('the text door', () => {
  it('goes GET, https, declared hosts only, and a redirect is refused', async () => {
    const w = world()
    const get = guardedText(repoDriver, w.fetch, new AbortController().signal)
    await get(`https://raw.githubusercontent.com/example-org/ideas/${SHA}/data/ideas.yaml`)
    expect(w.inits[0]).toMatchObject({ method: 'GET', redirect: 'error' })
    await expect(get('https://example.com/x')).rejects.toThrow(/refused/)
    await expect(get('http://raw.githubusercontent.com/x')).rejects.toThrow(/refused/)
    await expect(get('https://raw.githubusercontent.com:8443/x')).rejects.toThrow(/refused/)
  })
  it('refuses a body over 512 KiB, by Content-Length before reading it', async () => {
    let read = false
    const fetch: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => String(600 * 1024) }, json: async () => ({}), text: async () => { read = true; return '' } })
    await expect(guardedText(repoDriver, fetch, new AbortController().signal)('https://raw.githubusercontent.com/x')).rejects.toThrow('too large to read (over 512 KiB)')
    expect(read).toBe(false)
  })
})
