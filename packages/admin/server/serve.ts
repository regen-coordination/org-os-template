import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Hono } from 'hono'
import { createApp } from './app.ts'
import { storeAccess } from './private/ops.ts'
import { reconcilePrivate } from './private/proposals.ts'
import { repoStatus } from './git.ts'
import { watchData, watchPaths } from './watcher.ts'
import { ADAPTERS, ResourceStore } from './resources/index.ts'
import { mountResources } from './resources/routes.ts'
import { runCommand } from './resources/run.ts'
import { refusal } from './guard.ts'
import { JobStore, otherLive, serverPidFile, stateDir } from './state.ts'
import { ServerAttention, serverAttentionAdapter } from './attention.ts'
import { openPrivateStore, type PrivateStore } from './private/store.ts'
import { scheduleBackups } from './private/backup.ts'
import { LocalExecutor } from './operations/executor.ts'
import { Plans } from './operations/plans.ts'
import { mountOperations } from './operations/routes.ts'
import { mountProposals } from './proposals/routes.ts'
import { mountSync } from './proposals/sync.ts'
import { mountGenerated } from './proposals/generated.ts'
import { mountStandards } from './standards/routes.ts'
import { mountBootstrap } from './bootstrap/routes.ts'
import { mountWizards } from './wizards/routes.ts'
import { opById } from './operations/catalogue.ts'
import { parseRpcConfig } from './systems/chains.ts'
import { SystemReader, READ_TTL_MS } from './systems/reader.ts'
import { FAILED_READ_TTL_MS, type FetchLike } from './systems/driver.ts'
import { failedReadRetry } from './systems/retry.ts'
import { Membership } from './session/membership.ts'
import { mountSession } from './session/routes.ts'
import { withRequest } from './request.ts'
import { checkRemote } from './visibility/remote.ts'
import { attentionLevel, EventLevels, gateEvent, PUBLIC_VIEWER } from './visibility/gate.ts'
import { connectionViewer, mountVisibility } from './visibility/routes.ts'
import type { Viewer } from '../lib/visibility.mjs'

export interface ServeOptions {
  repo: string
  port: number
  /** The built UI (`app/dist`). When absent the API is still served. */
  appDist?: string
  /** How often time-based attention is recomputed; tests make it small. */
  clockRefreshMs?: number
  /** The fetch outside systems are read with. Tests pass a fake; the default is `networkFetch`. */
  fetch?: FetchLike
  /** Hosted mode (L5 spec §3): `readHosted` reads `--hosted` / `ORG_OS_HOSTED`. The session cookie is then Secure, and
   *  no backup key is attention. */
  hosted?: boolean
  /** How often the private store is backed up; tests make it small. Default `ORG_OS_BACKUP_EVERY`, else 24 h. */
  backupEveryMs?: number
  /** How long a WebSocket connection's viewer is kept before it is asked again; tests make it small. Default
   *  `CONNECTION_VIEWER_MS`. */
  connectionViewerMs?: number
}

/** How often crew is asked again while an agent is seated: herdr's working, idle and blocked
 *  states change without touching a file the watcher could see. */
export const CREW_POLL_MS = 10_000

/** Deadlines, last syncs and last ingests change with the clock, not with a file: without a
 *  tick, "deadline in 4 days" would still read that way the next morning. */
export const CLOCK_REFRESH_MS = 3_600_000

/** Outside systems are read again on this tick, which is also the reader's cache age, so "read N
 *  min ago" stays under five minutes while the server runs. */
export const SYSTEMS_REFRESH_MS = READ_TTL_MS

/** The one real network call. Under a test run (vitest sets VITEST) it refuses, so a test that
 *  forgot to inject a fake fetch fails loudly instead of reaching out (ruling S13). */
export const networkFetch: FetchLike = async (url, init) => {
  if (process.env.VITEST) throw new Error(`no network in tests: ${url} (inject a fake fetch)`)
  return globalThis.fetch(url, init)
}

/** Hosted mode (L5 spec §3): the `--hosted` flag, or `ORG_OS_HOSTED` set to `1` or `true`. */
export function readHosted(argv: readonly string[], env: Record<string, string | undefined>): boolean {
  return argv.includes('--hosted') || /^(1|true)$/i.test(env.ORG_OS_HOSTED ?? '')
}

/** How long a WebSocket connection's viewer is kept before it is asked again (its session may have ended, its hats
 *  changed): an event that finds it older waits for the answer and is judged on the viewer as it is now. */
export const CONNECTION_VIEWER_MS = 10_000

/** Who a connection is (L5 spec §9.5: events are gated per connection): its upgrade's cookie, the viewer that cookie
 *  read as when last asked (`at`: when it was asked), and the messages still on their way to it, in order. */
interface Listener { cookie: string | undefined; viewer: Viewer; at: number; sending: Promise<void> }

const reportRefreshFailure = (err: unknown) =>
  console.error(`org-os admin: the board could not be refreshed: ${err instanceof Error ? err.message : String(err)}`)

export interface Running {
  port: number
  close: () => Promise<void>
  /** The branch the repository was on when the server started, read once: the trunk of `governance.trunk`-less
   *  instances (P2-R17). Routes that write the proposal ledger pass it as `LedgerOptions.startBranch`. */
  startBranch?: string
  /** The one private store (L5 spec §10), opened at start; null when it could not be, which is then attention on Home
   *  (§10.1) while the git side keeps serving. Sessions and private records use this store and no other. */
  privateStore: PrivateStore | null
  /** The app the server answers with: tests list its routes (`app.routes`). */
  app: Hono
}

/** The API plus the built UI on one port, bound to 127.0.0.1 only. Kept apart
 *  from index.ts (which reads the command line) so tests can start a real
 *  server on a free port and call it over HTTP. */
export async function startServer({ repo, port, appDist, clockRefreshMs = CLOCK_REFRESH_MS, fetch = networkFetch, hosted = false, backupEveryMs, connectionViewerMs = CONNECTION_VIEWER_MS }: ServeOptions): Promise<Running> {
  // Read once, before anything listens: the trunk must not follow a later checkout.
  // (A directory that is not a git repository has none; the server still serves what it can.)
  const startBranch = await repoStatus(repo).then(s => s.branch, () => undefined)
  const jobs = new JobStore(repo)
  const systemReader = new SystemReader({ repo, fetch, rpc: parseRpcConfig(process.env.ORG_OS_RPC), safeApiKey: process.env.ORG_OS_SAFE_API_KEY?.trim() || undefined })
  const attention = new ServerAttention()
  // Rule 4 (L5 spec §12): a house does not run on a public repository. Hosted, that stops the start, before the store
  // is opened or anything listens; local, it is an alert on Home.
  const remote = await checkRemote(repo, { hosted, fetch, env: process.env })
  if (remote.refuse) throw new Error(remote.refuse)
  if (remote.attention) attention.raise('public-remote', 'Public repository', { level: 'alert', text: remote.attention })
  const store = new ResourceStore({
    repo, now: () => new Date(), run: runCommand, lastOk: (op, id) => jobs.lastOk(op, id),
    // The only reader given the network: drivers reach their declared hosts and nothing else.
    systems: systemReader,
  }, [...ADAPTERS, serverAttentionAdapter(attention)])
  attention.onChange = () => store.invalidateAdapter('server')
  // The one private store. One that cannot be opened (not ignored by git, unreadable, newer) leaves the git side
  // serving and says why on Home (§10.1); every private read and write is then refused with that sentence.
  let privateStore: PrivateStore | null = null
  let storeWhy = ''
  try { privateStore = await openPrivateStore(repo) } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    storeWhy = text
    console.error(`org-os admin: ${text}`)
    attention.raise('private-store', 'Private store', { level: 'alert', text })
  }
  // A failure after it opened (a damaged file, a full disk) is said on Home the same way (§10.1); its words go to the log.
  if (privateStore) privateStore.onFailure = text => attention.raise('private-store', 'Private store', { level: 'alert', text })
  // §10.3: a ratified proposal whose private part was never committed to the store is applied now, before anything is
  // served; a closed proposal's leftover pending rows go. A failure is logged and the server still starts.
  if (privateStore) {
    try {
      const applied = await reconcilePrivate(repo, privateStore)
      if (applied.length > 0) console.log(`org-os admin: applied the restricted part of ${applied.join(', ')}, ratified before the last stop.`)
    } catch (err) {
      console.error(`org-os admin: the private store could not be reconciled with the ledger at start: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // The socket exists only once the server listens; until then events have nowhere to go.
  let emit: (msg: unknown) => void = () => {}
  let afterJob: (op: string) => void = () => {}
  const executor = new LocalExecutor(repo, jobs, {
    started: job => emit({ type: 'job-started', job }),
    output: (job, chunk) => emit({ type: 'job-output', job: job.id, resource: job.resource, chunk }),
    finished: job => { emit({ type: 'job-finished', job }); afterJob(job.op) },
  })
  const plans = new Plans()
  // Membership from the DAO's Hats tree (§5), read through the one reader; sessions live in the one private store.
  const membership = new Membership({ repo, reader: systemReader, now: () => new Date() })
  const app = createApp(repo, (a, ctx) => {
    // First, so its middleware reads the session for every route mounted after it.
    mountSession(a, { repo, store: privateStore, membership, hosted })
    mountResources(a, store, repo, { hosted })
    mountOperations(a, { repo, store, jobs, executor, plans, startBranch })
    mountProposals(a, { repo, withLock: ctx.withLock, notify: msg => emit(msg), startBranch, systems: systemReader, hosted, privateStore: ctx.privateStore })
    mountSync(a, { repo, withLock: ctx.withLock, store, jobs, executor, plans, startBranch, notify: msg => emit(msg) })
    mountGenerated(a, { repo })
    mountStandards(a, { repo, systems: systemReader }) // seam S4: L5's members gate wraps this route
    mountBootstrap(a, { repo, jobs, executor, withLock: ctx.withLock })
    mountWizards(a, { repo })
    mountVisibility(a, { repo, membership, systems: systemReader, withLock: ctx.withLock, privateStore: ctx.privateStore, notify: msg => emit(msg) })
  }, {
    notify: msg => emit(msg),
    // Who asks (L5 spec §6.2): the session's member, git's identity locally, nobody hosted; every route reads it.
    request: withRequest({ repo, hosted, membership, store: privateStore }),
    // Private records and restricted fields are read from it and written only to it (L5 §10); down, said with why.
    privateStore: storeAccess(privateStore, storeWhy),
  })
  // A connection's viewer is read as a request's is, from the same session cookie.
  const viewerOfCookie = connectionViewer({ repo, hosted, membership, store: privateStore })
  const events = new EventLevels(repo, attentionLevel(hosted))
  if (appDist && existsSync(appDist)) {
    app.use('/*', serveStatic({ root: appDist }))
    app.get('*', serveStatic({ path: 'index.html', root: appDist })) // SPA fallback
  }

  // The HTTP adapter turns away a Host header it cannot make an address of
  // (a user part, upper case) with a bare 400 before the app's guard runs.
  // Ask its question first, so the refusal comes with a sentence.
  const withReadableHost = ((options, listener) => createServer(options, (req, res) => {
    const { host } = req.headers
    let name: string | null = null
    try { if (host !== undefined) name = new URL(`http://${host}`).hostname } catch { /* not an address */ }
    if (host !== undefined && name !== host && name !== host.replace(/:\d+$/, '')) {
      const { port: bound } = req.socket.address() as AddressInfo
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error:
        `Refused: the Host header "${host}" is not an address this server can read. ` +
        `Use the server's own address, in lower case and with nothing before the name: http://localhost:${bound}.` }))
      return
    }
    listener!(req, res)
  })) as typeof createServer

  return new Promise(resolve => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port, createServer: withReadableHost }, () => {
      // Only a server that is listening may touch job records; and a record that a live server
      // of this repository is running is not an orphan.
      const pidFile = serverPidFile(repo)
      let other = NaN
      try { other = Number(readFileSync(pidFile, 'utf8').trim()) } catch { /* none recorded */ }
      if (otherLive(other)) console.error(`org-os admin: another server (pid ${other}) is running for this repository; its jobs were left as they are.`)
      else jobs.markInterrupted()
      try { mkdirSync(stateDir(repo), { recursive: true }); writeFileSync(pidFile, String(process.pid)) } catch (err) {
        console.error(`org-os admin: could not record this server's pid: ${err instanceof Error ? err.message : String(err)}`)
      }
      // Who each socket is: kept from its upgrade until it is open, then by the socket.
      const upgrades = new WeakMap<IncomingMessage, Listener>()
      const listeners = new WeakMap<WebSocket, Listener>()
      const wss = new WebSocketServer({
        server: server as Server, path: '/api/events',
        // The upgrade does not pass through the Hono app, so it asks the same question itself.
        verifyClient: (info, done) => {
          const refused = refusal({ method: 'GET', host: info.req.headers.host, origin: info.req.headers.origin, contentType: undefined })
          if (refused) { done(false, refused.status, refused.error); return }
          const cookie = info.req.headers.cookie
          const asked = Date.now()
          void viewerOfCookie(cookie).then(viewer => {
            upgrades.set(info.req, { cookie, viewer, at: asked, sending: Promise.resolve() })
            done(true)
          })
        },
      })
      wss.on('connection', (ws, req) => {
        listeners.set(ws, upgrades.get(req) ?? { cookie: undefined, viewer: PUBLIC_VIEWER, at: 0, sending: Promise.resolve() })
      })
      /** The connection's viewer now: the one kept while it is younger than `connectionViewerMs`, else asked again first
       *  (a session that ended reads as the public; an ask that fails does too, `connectionViewer`). */
      const viewerOfListener = async (l: Listener): Promise<Viewer> => {
        if (Date.now() - l.at >= connectionViewerMs) {
          const asked = Date.now()
          l.viewer = await viewerOfCookie(l.cookie)
          l.at = asked
        }
        return l.viewer
      }
      // Every message through the gate, per connection (§9.5): the public hears only what names public items, a member
      // only what they may see. The levels of the message's keys are worked out once, for every connection; each
      // connection's messages go one after another, each judged on the viewer as it is when it is sent (R-L5-13.6).
      const broadcast = (raw: unknown) => {
        const msg = raw as { type: string; registry?: string; ids?: string[] }
        const levelOf = events.levelsFor(msg)
        for (const client of wss.clients) {
          if (client.readyState !== client.OPEN) continue
          const l = listeners.get(client)
          if (!l) continue
          l.sending = l.sending.then(async () => {
            const out = gateEvent(await viewerOfListener(l), msg, levelOf)
            if (out && client.readyState === client.OPEN) client.send(JSON.stringify(out))
          }).catch(() => { /* a message the gate could not judge is not sent */ })
        }
      }
      events.start()
      const watcher = watchData(repo, registry => broadcast({ type: 'registry-changed', registry }))

      // DECISIONS.md sits at the repository root, outside data/: the Governance page needs to hear of it too.
      const decisionsWatcher = watchPaths(repo, ['DECISIONS.md'], () => broadcast({ type: 'decisions-changed' }))

      // Changes arrive in bursts (a save writes, git writes); one refresh answers a burst.
      let pending: NodeJS.Timeout | null = null
      // A system that could not be read is asked again soon, not at the next tick.
      const systemsRetry = failedReadRetry({
        delayMs: FAILED_READ_TTL_MS,
        hasFailed: () => systemReader.hasFailedRead(),
        retry: () => { systemReader.expireFailed(); store.invalidateAdapter('systems'); scheduleRefresh() },
      })
      const scheduleRefresh = () => {
        if (pending) return
        pending = setTimeout(() => {
          pending = null
          store.refresh().then(async ids => {
            if (ids.length === 0) return
            events.noteGraph(await store.graph())
            broadcast({ type: 'resources-changed', ids })
          }).catch(reportRefreshFailure).then(() => systemsRetry.afterRefresh())
        }, 200)
      }
      emit = broadcast
      afterJob = op => { const known = opById(op); if (known) store.invalidateAdapter(known.refreshes); scheduleRefresh() }
      const resourceWatcher = watchPaths(repo, store.watchPaths().filter(p => existsSync(join(repo, p))),
        rel => { if (store.invalidate(rel)) scheduleRefresh() })
      const crewPoll = setInterval(() => {
        if (store.liveSeats()) { store.invalidateAdapter('crew'); scheduleRefresh() }
      }, CREW_POLL_MS)
      const clockTick = setInterval(() => {
        for (const name of ['records', 'fleet', 'sources']) store.invalidateAdapter(name)
        scheduleRefresh()
      }, clockRefreshMs)
      const systemsTick = setInterval(() => { systemReader.expire(); store.invalidateAdapter('systems'); scheduleRefresh() }, SYSTEMS_REFRESH_MS)
      // The baseline the first resources-changed is measured from, and each resource's level then.
      store.refresh().then(async () => events.noteGraph(await store.graph())).catch(reportRefreshFailure).then(() => systemsRetry.afterRefresh())
      attention.onChange = () => { store.invalidateAdapter('server'); scheduleRefresh() }
      const backups = privateStore ? scheduleBackups({ store: privateStore, repo, hosted, attention, everyMs: backupEveryMs }) : null

      resolve({
        port: (server.address() as AddressInfo).port,
        startBranch,
        privateStore,
        app,
        close: async () => {
          // Jobs first: a child left running would outlive the server that promised to supervise it.
          await executor.stopAll()
          clearInterval(crewPoll)
          clearInterval(clockTick)
          clearInterval(systemsTick)
          systemsRetry.stop()
          try { if (readFileSync(pidFile, 'utf8').trim() === String(process.pid)) rmSync(pidFile, { force: true }) } catch { /* already gone */ }
          if (pending) clearTimeout(pending)
          await watcher.close()
          await resourceWatcher.close()
          await decisionsWatcher.close()
          for (const client of wss.clients) client.terminate()
          wss.close()
          await new Promise<void>(done => server.close(() => done()))
          // Last: a backup under way finishes first, and no request is left to read the store.
          await backups?.stop()
          privateStore?.close()
        },
      })
    })
  })
}
