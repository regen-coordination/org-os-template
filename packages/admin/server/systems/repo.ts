import { parse } from 'yaml'
import type { Driver, DriverContext, DriverRead } from './driver.ts'
import { UpstreamHttpError } from './driver.ts'

const NOT_PUBLISHED = 'not published, or private'
const MAX_ITEMS = 500
const REPO_ONLY = 'the repo driver reads GitHub repositories (https://github.com/<owner>/<repo>)'

interface Item { path: string; id: string; title: string; from: string }

/** owner/repo from https://github.com/<owner>/<repo>; throws the driver's sentence. */
function repoOf(system: Record<string, unknown>): string {
  let u: URL | null = null
  try { u = new URL(String(system.url)) } catch { /* below */ }
  const m = u && u.protocol === 'https:' && u.hostname === 'github.com' && u.port === '' ? /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(u.pathname) : null
  if (!m || /\.git$/.test(m[2]!) || m[1] === '.' || m[1] === '..' || m[2] === '.' || m[2] === '..') throw new Error(REPO_ONLY)
  return `${m[1]}/${m[2]}`
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '') || typeof v === 'number' ? String(v) : null

/** The records of a parsed file: a list, or the lists an object holds; Markdown front matter is one record. */
function recordsOf(path: string, body: string): Record<string, unknown>[] {
  let data: unknown
  if (/\.json$/i.test(path)) data = JSON.parse(body)
  else if (/\.(md|markdown)$/i.test(path)) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)
    data = m ? parse(m[1]!) : null
    return data && typeof data === 'object' && !Array.isArray(data) ? [data as Record<string, unknown>] : []
  } else data = parse(body)
  const objects = (a: unknown[]) => a.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
  if (Array.isArray(data)) return objects(data)
  if (data && typeof data === 'object') return Object.values(data).flatMap(v => Array.isArray(v) ? objects(v) : [])
  return []
}

/** Another GitHub repository's published files, read only: the commit, then each listed file at that commit. */
export const repoDriver: Driver = {
  name: 'repo',
  hosts: ['api.github.com', 'raw.githubusercontent.com'],
  minGapMs: 250,
  async read(system: Record<string, unknown>, ctx: DriverContext): Promise<DriverRead> {
    const repo = repoOf(system)
    const paths = Array.isArray(system.files) ? system.files.filter((f): f is string => typeof f === 'string' && f !== '') : []
    if (paths.length === 0 || paths.length > 20) throw new Error('a repo System lists 1 to 20 published files')
    if (!ctx.fetchText) throw new Error('this reader was given no network access')
    const bad = paths.find(f => f.startsWith('/') || f.split('/').some(seg => seg === '' || seg === '.' || seg === '..'))
    if (bad !== undefined) throw new Error(`${JSON.stringify(bad)} is not a path inside the repository`)
    const branch = typeof system.branch === 'string' && system.branch !== '' ? system.branch : 'HEAD'
    if (branch === '.' || branch === '..') throw new Error(`${JSON.stringify(branch)} is not a branch`)
    let commit: any
    try { commit = await ctx.fetchJson(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`) }
    catch (err) { throw err instanceof UpstreamHttpError && err.status === 404 ? new Error(NOT_PUBLISHED) : err }
    const sha = String(commit?.sha ?? '')
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('github.com did not say which commit this is')
    const committed = text(commit?.commit?.committer?.date) ?? text(commit?.commit?.author?.date)
    const from = `from ${repo}`
    const files: { path: string; ok: boolean; items: number; error?: string }[] = []
    const items: Item[] = []
    for (const path of paths) {
      let body: string
      try {
        body = await ctx.fetchText(`https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`)
      } catch (err) {
        if (ctx.timeLeftMs && ctx.timeLeftMs() <= 0) throw err
        // The guard's and the fetch's own sentences (host names, statuses), never file content.
        files.push({ path, ok: false, items: 0, error: err instanceof UpstreamHttpError && err.status === 404 ? NOT_PUBLISHED : err instanceof Error ? err.message : 'could not be read' })
        continue
      }
      try {
        const records = recordsOf(path, body)
        records.forEach(r => { items.push({ path, id: text(r.id) ?? text(r.slug) ?? text(r.name) ?? '', title: text(r.title) ?? text(r.name) ?? text(r.id) ?? '', from }) })
        files.push({ path, ok: true, items: records.length })
      } catch {
        // A parse error quotes the file; the file's content never reaches the facts.
        files.push({ path, ok: false, items: 0, error: 'not readable as YAML, JSON or Markdown front matter' })
      }
    }
    const kept = items.slice(0, MAX_ITEMS)
    return {
      ok: true, readAt: ctx.now().toISOString(),
      facts: { repo, sha, committed, files, items: kept },
      sections: [
        { title: 'Files', rows: files.map(f => ({ cells: [f.path, f.ok ? `${f.items} read` : f.error!, from], ...(f.ok ? {} : { attention: 'warn' as const }) })) },
        { title: 'Items', rows: kept.map(i => ({ cells: [i.path, i.id, i.title, from] })) },
      ],
      open: { url: `https://github.com/${repo}`, embeddable: false },
    }
  },
}
