import { existsSync, mkdirSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { parse } from 'yaml'
import { readFileSync } from 'node:fs'
import { refusal } from '../server/guard.ts'
import { runningServer, stateDir } from '../server/state.ts'
import { readFederation } from '../lib/federation/read.mjs'
import { forget, readRecent, remember } from './home.ts'
import { isInstance, resolveFolder, writableFolderProblem } from './folders.ts'
import { gitUrlProblem, launcherGit } from './git-write.ts'
import { defaultAssess, defaultStartAdmin } from './children.ts'

import { readableHost } from '../server/serve.ts'
export { readHosted } from '../server/serve.ts'

export interface DoctorSummary {
  status: string; blockers: number; warnings: number
  findings: { level: 'WARN' | 'BLOCKER'; code: string; message: string; hint?: string }[]
}
export interface AdminChild { url: string; stop: () => Promise<void>; /** Settles when the admin has ended. */ exited: Promise<void> }
export type StartAdmin = (repo: string) => Promise<AdminChild>
export type Assess = (repo: string) => Promise<DoctorSummary>

export interface LauncherOptions {
  port: number
  frameworkDir: string
  appDist?: string
  base?: string
  hosted?: boolean
  startAdmin?: StartAdmin
  assess?: Assess
}

export const HOSTED_SENTENCE = 'A hosted Hub is one instance. The launcher is for your own machine.'

/** The name an instance gives itself, read now from its federation.yaml; never stored. */
function liveName(path: string): string | null {
  try {
    const name = readFederation(parse(readFileSync(join(path, 'federation.yaml'), 'utf8'))).identity.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  } catch { return null }
}

export async function startLauncher(opts: LauncherOptions): Promise<{ port: number; app: Hono; openFlow: (repo: string) => Promise<{ url: string }>; close: () => Promise<void> }> {
  if (opts.hosted) throw new Error(HOSTED_SENTENCE)
  const defaultStart = opts.startAdmin ? null : defaultStartAdmin(opts.frameworkDir)
  const startAdmin: StartAdmin = opts.startAdmin ?? defaultStart!
  const assess: Assess = opts.assess ?? defaultAssess(opts.frameworkDir)

  const children = new Map<string, AdminChild>()
  const starting = new Map<string, Promise<AdminChild>>()

  /** Tasks 4–6 reuse this: the doctor looks, its findings are saved, the instance is remembered, its admin is started. */
  async function openFlow(repo: string): Promise<{ url: string }> {
    if (!isInstance(repo)) throw new Error(`${repo} is not an org-os instance, so it cannot be opened.`)
    const summary = await assess(repo)
    const dir = stateDir(repo)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'doctor.json'), `${JSON.stringify({ at: new Date().toISOString(), ...summary }, null, 2)}\n`)
    remember(repo)
    let child = children.get(repo)
    if (!child) {
      let pending = starting.get(repo)
      if (!pending) {
        pending = startAdmin(repo).finally(() => starting.delete(repo))
        starting.set(repo, pending)
      }
      child = await pending
      children.set(repo, child)
      const started = child
      void child.exited.then(() => { if (children.get(repo) === started) children.delete(repo) })
    }
    return { url: `${child.url}/systems/map?first=1` }
  }

  const app = new Hono()

  app.use('/api/*', async (c, next) => {
    const refused = refusal({ method: c.req.method, host: c.req.header('host'), origin: c.req.header('origin'), contentType: c.req.header('content-type') })
    if (refused) return c.json({ error: refused.error }, refused.status)
    // A write must also come from the launcher's own page: an Origin is required, and DELETE must be JSON too.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const host = c.req.header('host')
      const origin = c.req.header('origin')
      if (origin === undefined || origin !== `http://${host}`) {
        return c.json({ error: `Refused: a write must come from the launcher's own page (http://${host ?? ''}), and the request ${origin === undefined ? 'named no page' : `came from ${origin}`}.` }, 403)
      }
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (type !== 'application/json') {
        return c.json({ error: `Refused: a write must be sent as JSON. Set the header "content-type: application/json" (the request had ${c.req.header('content-type') ? `"${c.req.header('content-type')}"` : 'no content type'}).` }, 415)
      }
    }
    await next()
  })

  const base = (): string => {
    if (opts.base) return opts.base
    const last = readRecent().find(p => existsSync(p) && isInstance(p))
    return last ? dirname(last) : homedir()
  }

  app.get('/api/launcher/state', c => {
    const recent = readRecent().map(path => {
      const found = existsSync(path)
      const instance = found && isInstance(path)
      return { path, name: instance ? liveName(path) : null, found, instance }
    })
    return c.json({
      base: base(),
      recent,
      doors: [
        { id: 'open', available: true }, { id: 'create', available: true }, { id: 'adopt', available: true },
        { id: 'join', available: false, note: 'Comes with federation.' },
      ],
    })
  })

  const bodyPath = async (c: { req: { json: () => Promise<unknown> } }): Promise<string | null> => {
    try {
      const b = await c.req.json() as { path?: unknown }
      return typeof b?.path === 'string' && b.path.trim() ? b.path : null
    } catch { return null }
  }

  app.post('/api/launcher/open', async c => {
    const given = await bodyPath(c)
    if (!given) return c.json({ error: 'Say which folder.' }, 400)
    const typed = resolveFolder(given, base())
    if (!existsSync(typed)) return c.json({ error: `There is no folder at ${typed}.` }, 404)
    const path = realpathSync(typed)
    if (!isInstance(path)) return c.json({ error: `${path} is not an org-os instance yet.`, adoptable: true, path }, 409)
    if (!children.has(path)) {
      const pid = runningServer(path)
      if (pid !== null) return c.json({ error: `This instance is already open in another window (process ${pid}). Use that window, or stop it first.` }, 409)
    }
    try { return c.json(await openFlow(path)) } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/launcher/clone', async c => {
    let url = '', given = ''
    try {
      const b = await c.req.json() as { url?: unknown; folder?: unknown }
      url = typeof b?.url === 'string' ? b.url.trim() : ''
      given = typeof b?.folder === 'string' ? b.folder : ''
    } catch { /* answered below */ }
    const bad = gitUrlProblem(url)
    if (bad) return c.json({ error: bad }, 400)
    if (!given.trim()) return c.json({ error: 'Say which folder to clone into.' }, 400)
    const abs = resolveFolder(given, base())
    const problem = writableFolderProblem(abs)
    if (problem) return c.json({ error: problem }, 409)
    // Claim the folder before cloning: only what this request made is removed if the clone fails.
    let firstMade: string | undefined
    let made = false
    try {
      firstMade = mkdirSync(dirname(abs), { recursive: true })
      try { mkdirSync(abs); made = true } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
        const now = writableFolderProblem(abs)
        if (now) return c.json({ error: now }, 409)
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409)
    }
    let result
    try { result = await launcherGit(dirname(abs), 'clone', ['--', url, abs]) } catch (err) {
      result = { code: 1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
    }
    if (result.code !== 0) {
      // Only folders this request made, and only while empty: anything someone put in them meanwhile stays.
      if (made) { try { rmdirSync(abs) } catch { /* not empty, or already gone */ } }
      if (firstMade) {
        // the parents it made, from the innermost up to the first one
        try { for (let d = dirname(abs); d.startsWith(firstMade); d = dirname(d)) { rmdirSync(d); if (d === firstMade) break } } catch { /* not empty, or already gone */ }
      }
      const last = result.stderr.trim().split('\n').filter(Boolean).pop() ?? 'git could not clone it.'
      return c.json({ error: last }, 502)
    }
    const path = realpathSync(abs)
    if (!isInstance(path)) return c.json({ error: `${path} is not an org-os instance yet.`, adoptable: true, path }, 409)
    try { return c.json(await openFlow(path)) } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.delete('/api/launcher/recent', async c => {
    const path = await bodyPath(c)
    if (!path) return c.json({ error: 'Say which folder.' }, 400)
    return c.json({ recent: forget(path) })
  })

  app.all('/api/*', c => c.json({ error: 'Not found.' }, 404))

  if (opts.appDist && existsSync(opts.appDist)) {
    app.use('/*', serveStatic({ root: opts.appDist }))
    app.get('*', serveStatic({ path: 'index.html', root: opts.appDist })) // SPA fallback
  }

  const withReadableHost = readableHost(bound => `Use http://localhost:${bound}.`)

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: opts.port, createServer: withReadableHost }, info => {
      resolve({
        port: info.port, app, openFlow,
        close: async () => {
          await Promise.all([...children.values()].map(ch => ch.stop().catch(() => {})))
          children.clear()
          await defaultStart?.closeAll()
          await new Promise<void>(done => { server.close(() => done()); (server as any).closeAllConnections?.() })
        },
      })
    })
    server.on('error', reject)
  })
}
