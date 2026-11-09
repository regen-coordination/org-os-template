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
import { scaffold } from './scaffold.ts'
import { AdoptError, adoptProblem, applyAdopt, planAdopt, removeScratch, type AdoptPlan } from './adopt.ts'
import { loadWizards } from '../lib/wizards.mjs'
import { orgProblem, youProblem, type Answers } from '../lib/open-instance.mjs'
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

/** How long an adopt plan is held before it expires and its scratch folder is removed. */
export const PLAN_TTL_MS = 30 * 60_000

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

  app.get('/api/launcher/wizard', c => {
    const def = loadWizards().wizards.find(w => w.id === 'open-instance')
    return def ? c.json(def) : c.json({ error: 'The open-instance wizard is missing.' }, 500)
  })

  app.post('/api/launcher/create', async c => {
    let answers: Record<string, unknown> = {}
    try { const b = await c.req.json() as { answers?: unknown }; if (b?.answers && typeof b.answers === 'object') answers = b.answers as Record<string, unknown> } catch { /* answered below */ }
    const bad = orgProblem(answers as Answers) ?? youProblem(answers as Answers)
    if (bad) return c.json({ error: bad }, 400)
    const abs = resolveFolder(String(answers.folder), base())
    const problem = writableFolderProblem(abs)
    if (problem) return c.json({ error: problem }, 409)
    // clone:framework makes the folder itself and refuses one that holds files; nothing is removed here if it fails.
    let result
    try { result = await scaffold(answers as Answers, abs, { git: true }, opts.frameworkDir) } catch (err) {
      result = { code: 1, log: err instanceof Error ? err.message : String(err) }
    }
    if (result.code !== 0) return c.json({ error: 'The framework could not create the instance. Whatever it made is left in the folder.', log: result.log }, 500)
    try { return c.json(await openFlow(realpathSync(abs))) } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Adopt (Task 6): plans are held here by an unguessable id, never sent to the page with their scratch path. Each one
  // expires after PLAN_TTL_MS; its scratch is removed then, after an apply, and on close().
  const plans = new Map<string, { plan: AdoptPlan; timer: ReturnType<typeof setTimeout> }>()
  const dropPlan = (id: string): AdoptPlan | undefined => {
    const held = plans.get(id)
    if (!held) return undefined
    plans.delete(id)
    clearTimeout(held.timer)
    return held.plan
  }

  app.post('/api/launcher/adopt/plan', async c => {
    let given = '', answers: Record<string, unknown> = {}
    try {
      const b = await c.req.json() as { path?: unknown; answers?: unknown }
      given = typeof b?.path === 'string' ? b.path : ''
      if (b?.answers && typeof b.answers === 'object') answers = b.answers as Record<string, unknown>
    } catch { /* answered below */ }
    if (!given.trim()) return c.json({ error: 'Say which folder.' }, 400)
    // The same canonical path as the open route: resolved, there, then its real path once.
    const typed = resolveFolder(given, base())
    if (!existsSync(typed)) return c.json({ error: `There is no folder at ${typed}.` }, 404)
    const path = realpathSync(typed)
    const problem = await adoptProblem(path)
    if (problem) return c.json({ error: problem }, 409)
    const withFolder = { ...answers, folder: path } as Answers
    const bad = orgProblem(withFolder) ?? youProblem(withFolder)
    if (bad) return c.json({ error: bad }, 400)
    let plan: AdoptPlan
    try { plan = await planAdopt(path, withFolder, opts.frameworkDir) } catch (err) {
      if (err instanceof AdoptError) return c.json({ error: err.message, ...(err.log !== undefined ? { log: err.log } : {}) }, err.status)
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
    const timer = setTimeout(() => { const gone = dropPlan(plan.id); if (gone) removeScratch(gone.scratch) }, PLAN_TTL_MS)
    timer.unref?.()
    plans.set(plan.id, { plan, timer })
    return c.json({ planId: plan.id, add: plan.add, kept: plan.kept })
  })

  app.post('/api/launcher/adopt/apply', async c => {
    let id = ''
    try { const b = await c.req.json() as { planId?: unknown }; id = typeof b?.planId === 'string' ? b.planId : '' } catch { /* answered below */ }
    // Taken out before any await: a plan is applied at most once.
    const plan = id ? dropPlan(id) : undefined
    if (!plan) return c.json({ error: 'This plan has expired or was already used. Start the adoption again.' }, 410)
    let applied
    try { applied = await applyAdopt(plan) } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, err instanceof AdoptError ? err.status : 500)
    }
    try { return c.json({ ...(await openFlow(plan.dir)), branch: applied.branch }) } catch (err) {
      return c.json({ error: `The files were added on ${applied.branch}, but the instance could not be opened: ${err instanceof Error ? err.message : String(err)}` }, 500)
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
          for (const id of [...plans.keys()]) { const gone = dropPlan(id); if (gone) removeScratch(gone.scratch) }
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
