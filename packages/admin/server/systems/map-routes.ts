import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import type { FetchLike } from './driver.ts'
import { manifestImports } from '../../lib/systems-recognise.mjs'

export interface MapDeps { repo: string; fetch: FetchLike }

/** "Map the rest" (network N1): two read-only routes. They stage nothing; the page stages through /api/changes/ops. */
export function mountSystemsMap(app: Hono, { repo, fetch }: MapDeps): void {
  app.get('/api/systems/map/manifest', c => {
    const read = (file: string): unknown => {
      try { return existsSync(file) ? file.endsWith('.json') ? JSON.parse(readFileSync(file, 'utf8')) : parse(readFileSync(file, 'utf8')) : null } catch { return null }
    }
    const manifest = read(join(repo, 'repos.manifest.json')) as object | null
    const reg = read(join(repo, 'data', 'systems.yaml')) as { systems?: unknown } | null
    const systems = Array.isArray(reg?.systems) ? (reg!.systems as object[]) : []
    return c.json({ imports: manifestImports(manifest, systems) })
  })

  app.get('/api/systems/map/github/:owner', async c => {
    const owner = c.req.param('owner')
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) return c.json({ error: 'That is not a GitHub owner name.' }, 400)
    const fail = () => c.json({ error: `GitHub didn't answer for ${owner}. Try again, or paste the repos one per line.` }, 502)
    try {
      const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&type=owner&sort=pushed`, {
        method: 'GET', headers: { accept: 'application/vnd.github+json', 'user-agent': 'org-os-admin' }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return fail()
      const body = await res.json()
      if (!Array.isArray(body)) return fail()
      const repos = body.filter((r: any) => r && typeof r.name === 'string' && typeof r.html_url === 'string').map((r: any) => ({
        name: r.name as string, url: r.html_url as string, archived: r.archived === true, fork: r.fork === true,
        ...(typeof r.description === 'string' && r.description ? { description: r.description } : {}),
      }))
      return c.json({ repos, more: body.length >= 100 })
    } catch { return fail() }
  })
}
