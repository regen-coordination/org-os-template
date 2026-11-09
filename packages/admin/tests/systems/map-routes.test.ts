import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { mountSystemsMap } from '../../server/systems/map-routes.ts'
import { REAL_REPO } from '../fixtures.ts'

const mk = (fetch: any) => { const a = new Hono(); mountSystemsMap(a, { repo: REAL_REPO, fetch }); return a }
const never = (() => { throw new Error('no network') }) as any

describe('map routes', () => {
  it('offers the manifest entries', async () => {
    const r = await mk(never).request('/api/systems/map/manifest')
    expect(r.status).toBe(200)
    const { imports } = await r.json() as any
    expect(imports.length).toBeGreaterThan(0)
    expect(imports[0]).toMatchObject({ kind: 'repo' })
  })
  it('refuses a bad owner', async () => {
    for (const o of ['a_b', 'a'.repeat(40), 'a%20b']) expect((await mk(never).request(`/api/systems/map/github/${o}`)).status).toBe(400)
  })
  it('lists repos and flags more', async () => {
    let seen = ''
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}`, html_url: `https://github.com/o/r${i}`, archived: false, fork: i === 0, description: null }))
    const f = (n: number) => async (url: string) => { seen = url; return { ok: true, status: 200, json: async () => items(n) } }
    const a = await (await mk(f(2)).request('/api/systems/map/github/o')).json() as any
    expect(seen).toBe('https://api.github.com/users/o/repos?per_page=100&type=owner&sort=pushed')
    expect(a.more).toBe(false)
    expect(a.repos[0]).toMatchObject({ name: 'r0', url: 'https://github.com/o/r0', fork: true, archived: false })
    expect((await (await mk(f(100)).request('/api/systems/map/github/o')).json() as any).more).toBe(true)
  })
  it('says GitHub did not answer', async () => {
    const bad = [async () => ({ ok: false, status: 403, json: async () => ({}) }), async () => { throw new Error('x') }]
    for (const f of bad) {
      const r = await mk(f).request('/api/systems/map/github/o')
      expect(r.status).toBe(502)
      expect(await r.json()).toEqual({ error: "GitHub didn't answer for o. Try again, or paste the repos one per line." })
    }
  })
})
