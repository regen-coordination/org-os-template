import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
import { refusal, type GuardScope } from './guard.ts'
import { JobStore, otherLive, serverPidFile, stateDir } from './state.ts'
import { ServerAttention, serverAttentionAdapter } from './attention.ts'
import { classifyOpenError, openPrivateStore, STORE_STUCK, type PrivateStore } from './private/store.ts'
import { cleanLeftovers, scheduleBackups } from './private/backup.ts'
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
import { readSignInConfig, type SignInConfig } from './session/config.ts'
import { mountEmailSignIn, type EmailSignIn } from './session/email.ts'
import { logMailer, resendMailer, type Mailer } from './session/mail.ts'
import { withRequest } from './request.ts'
import { checkRemote, RemoteWatch } from './visibility/remote.ts'
import { attentionLevel, EventLevels, gateEvent, PUBLIC_VIEWER } from './visibility/gate.ts'
import { connectionViewer, mountVisibility } from './visibility/routes.ts'
import type { Viewer } from '../lib/visibility.mjs'
import type { HostedConfig } from './hosted/config.ts'
import { useHubIdent } from './hosted/ident.ts'
import { mountPush, Pusher } from './hosted/push.ts'
import { readInstanceWrites, INSTANCE_WRITES_ENV, type InstanceWrites } from './hosted/instance-writes.ts'
import { rateLimits, RATE, upgradeAddress, WS_PER_ADDRESS } from './hosted/limits.ts'
import { prepaintHashes, securityHeaders } from './hosted/headers.ts'
import { mountHealth } from './hosted/health.ts'
import { accessLog } from './hosted/access.ts'
import { resolveTrunk } from './proposals/ledger.ts'

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
  /** The hosted configuration (L9 spec §5.1), read by `readHostedConfig`. Hosted behaviours beyond L5's apply only when
   *  it is passed; its `bind` replaces the loopback address. */
  hostedConfig?: HostedConfig
  /** How often the private store is backed up; tests make it small. Default `ORG_OS_BACKUP_EVERY`, else 24 h. */
  backupEveryMs?: number
  /** How long a WebSocket connection's viewer is kept before it is asked again; tests make it small. Default
   *  `CONNECTION_VIEWER_MS`. */
  connectionViewerMs?: number
  /** The sign-in mailer (Lane 3 Task 7). Tests pass a recording one; the default sends through the provider the
   *  configuration names (`RESEND_API_KEY`, `MAIL_FROM`), or, locally with none, prints the link to the log. */
  mailer?: Mailer
  /** The writes-off switch (Lane 3 Task 11, C1), for tests that exercise the write routes of a hosted Hub. Absent (the
   *  CLI never passes it): `HOUSE_INSTANCE_WRITES`, hosted default off, and a hosted on refused while
   *  BEFORE_PILOT_OPEN is not empty. */
  instanceWrites?: InstanceWrites
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
/** A hosted Hub asks again whether its remote is still private (L9 spec §5.7). */
export const REMOTE_RECHECK_MS = 60 * 60 * 1000

/** The one real network call. Under a test run (vitest sets VITEST) it refuses, so a test that
 *  forgot to inject a fake fetch fails loudly instead of reaching out (ruling S13). */
/** The hashes of the built UI's inline scripts, for the hosted CSP (L9 §5.10); none when there is no built UI. */
function builtPrepaint(appDist: string | undefined): string[] {
  if (!appDist) return []
  try { return prepaintHashes(readFileSync(join(appDist, 'index.html'), 'utf8')) } catch { return [] }
}

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
export async function startServer({ repo, port, appDist, clockRefreshMs = CLOCK_REFRESH_MS, fetch = networkFetch, hosted = false, hostedConfig, backupEveryMs, connectionViewerMs = CONNECTION_VIEWER_MS, mailer, instanceWrites: givenWrites }: ServeOptions): Promise<Running> {
  // Read once, before anything listens: the trunk must not follow a later checkout.
  // (A directory that is not a git repository has none; the server still serves what it can.)
  // Hosted, every commit is the Hub's (L9 §5.5): set before any git process starts, which all inherit it.
  if (hosted) useHubIdent(process.env)
  const startBranch = await repoStatus(repo).then(s => s.branch, () => undefined)
  const jobs = new JobStore(repo)
  const systemReader = new SystemReader({ repo, fetch, rpc: parseRpcConfig(process.env.ORG_OS_RPC), safeApiKey: process.env.ORG_OS_SAFE_API_KEY?.trim() || undefined })
  const attention = new ServerAttention()
  // Rule 4 (L5 spec §12): a house does not run on a public repository. Hosted, that stops the start, before the store
  // is opened or anything listens; local, it is an alert on Home.
  const remote = await checkRemote(repo, { hosted, fetch, env: process.env })
  if (remote.refuse) throw new Error(remote.refuse)
  if (remote.attention) attention.raise('public-remote', 'Public repository', { level: 'alert', text: remote.attention })
  // The emailed-link sign-in (Lane 3 Task 4): its variables are checked before anything listens. Hosted with none of
  // them, it is not offered and the server starts; a refusal names a variable, never a value. The issuer is the Hub's
  // origin: the configured one when hosted, this machine's otherwise.
  const signInRead = readSignInConfig(process.env, {
    hosted, origin: hosted && hostedConfig ? hostedConfig.origin : `http://localhost${port ? `:${port}` : ''}`,
  })
  if ('refuse' in signInRead) throw new Error(signInRead.refuse)
  // The writes-off switch (Lane 3 Task 11, C1): read before anything listens; a value that is not on or off, or a hosted
  // on while a before-pilot defect is open, stops the start.
  const writesRead = givenWrites ?? readInstanceWrites(process.env, hosted)
  if (typeof writesRead !== 'string') throw new Error(writesRead.refuse)
  const instanceWrites: InstanceWrites = writesRead
  if (instanceWrites === 'off') console.log(`org-os admin: ${INSTANCE_WRITES_ENV} is off: this Hub writes nothing to the instance (no commits, no push, no reconcile at start).`)
  const signIn: SignInConfig | null = signInRead.config
  const signInMailer: Mailer = mailer ?? (signIn?.mail ? resendMailer({ ...signIn.mail, fetch }) : logMailer())
  const store = new ResourceStore({
    repo, now: () => new Date(), run: runCommand, lastOk: (op, id) => jobs.lastOk(op, id),
    // The only reader given the network: drivers reach their declared hosts and nothing else.
    systems: systemReader,
  }, [...ADAPTERS, serverAttentionAdapter(attention)])
  attention.onChange = () => store.invalidateAdapter('server')
  // The one private store. One that cannot be opened (not ignored by git, unreadable, newer) leaves the git side
  // serving and says why on Home (§10.1); every private read and write is then refused with that sentence.
  // L9 §7.4 (carry 8): the error's own text (SQLite's, the OS's, the file's path) goes to the log; Home and every refused
  // private read or write say the class's fixed sentence.
  let privateStore: PrivateStore | null = null
  let storeFailure: { sentence: string } | null = null
  // Hosted with its configuration, the store is where it says (L9 §5.1, ruling P7); otherwise `privateDir(repo)`.
  const config = hosted ? hostedConfig : undefined
  try { privateStore = await openPrivateStore(repo, config ? { dir: config.privateDir } : {}) } catch (err) {
    console.error(`org-os admin: ${err instanceof Error ? err.message : String(err)}`)
    storeFailure = classifyOpenError(err)
    attention.raise('private-store', 'Private store', { level: 'alert', text: storeFailure.sentence })
  }
  // A failure after it opened (a damaged file, a full disk) is said on Home the same way (§10.1); its words go to the log.
  if (privateStore) privateStore.onFailure = text => attention.raise('private-store', 'Private store', { level: 'alert', text })
  // A write that holds the store's lock past its wait (§7.5): said on Home while it holds, cleared when it lets go.
  if (privateStore) {
    privateStore.onStuck = ms => attention.raise('private-store-stuck', 'Private store', { level: 'warn', text: STORE_STUCK(ms) })
    privateStore.onUnstuck = () => attention.clear('private-store-stuck')
  }
  // §10.3: a ratified proposal whose private part was never committed to the store is applied now, before anything is
  // served; a closed proposal's leftover pending rows go. A failure is logged and the server still starts.
  // While writes are off it does not run (ledger 232 M8 sits on this path); the start says so once, above.
  if (privateStore && instanceWrites === 'on') {
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
  // The hosted binding (L9 §5.1), only when hosted and given (`config`, above): one host and one origin for the guard,
  // SIWE and the WebSocket upgrade; the `__Host-` cookie; the door's origin. Without it, hosted is L5's, on this machine.
  const guard: GuardScope = config ? { kind: 'hosted', host: config.host, origin: config.origin } : { kind: 'local' }
  // The one writer's push (L9 §5.6): made once the server listens, beside the RemoteWatch it reads rule 4 through; its
  // retry route reads it when asked, and answers PUSH_OFF while there is none (local, or ORG_OS_PUSH=off).
  let pusher: Pusher | null = null
  // The emailed-link sign-in's work done after its answers (S10-0): waited for at stop, before the store closes.
  let emailSignIn: EmailSignIn | null = null
  const app = createApp(repo, (a, ctx) => {
    // First, so its middleware reads the session for every route mounted after it.
    mountSession(a, { repo, store: privateStore, membership, hosted, config, signIn, instanceWrites })
    emailSignIn = mountEmailSignIn(a, { repo, store: privateStore, config: signIn, mailer: signInMailer, ...(config ? { hosted: config } : {}) })
    mountResources(a, store, repo, { hosted })
    mountOperations(a, { repo, store, jobs, executor, plans, startBranch, hosted })
    mountProposals(a, { repo, withLock: ctx.withLock, notify: msg => emit(msg), startBranch, systems: systemReader, hosted, privateStore: ctx.privateStore, readOnly: instanceWrites === 'off' })
    mountSync(a, { repo, withLock: ctx.withLock, store, jobs, executor, plans, startBranch, notify: msg => emit(msg) })
    mountGenerated(a, { repo })
    mountStandards(a, { repo, systems: systemReader }) // seam S4: L5's members gate wraps this route
    mountBootstrap(a, { repo, jobs, executor, withLock: ctx.withLock })
    mountWizards(a, { repo, hosted })
    mountVisibility(a, { repo, membership, systems: systemReader, withLock: ctx.withLock, privateStore: ctx.privateStore, notify: msg => emit(msg) })
    mountPush(a, { pusher: () => pusher })
    // Every mode (ruling P1): public, `{ ok }` and nothing more (L9 §5.11).
    mountHealth(a, { store: () => privateStore !== null })
  }, {
    notify: msg => emit(msg),
    // Who asks (L5 spec §6.2): the session's member, git's identity locally, nobody hosted; every route reads it.
    request: withRequest({ repo, hosted, membership, store: privateStore, config, signIn }),
    // Private records and restricted fields are read from it and written only to it (L5 §10); down, said with why.
    privateStore: storeAccess(privateStore, storeFailure),
    guard,
    // Hosted, every write route is classified (L9 §5.4): commands, sync and the claim are off, whatever the configuration.
    hosted,
    instanceWrites,
    // Hosted with its configuration (L9 Task 8): the access line to stdout, the headers, the rate limits; before the guard.
    ...(config ? { edge: [
      accessLog(line => console.log(line)),
      securityHeaders({ host: config.host, prepaintHashes: builtPrepaint(appDist) }),
      rateLimits({ trustProxy: config.trustProxy }),
    ] } : {}),
  })
  // A connection's viewer is read as a request's is, from the same session cookie.
  const viewerOfCookie = connectionViewer({ repo, hosted, membership, store: privateStore, config, signIn })
  const events = new EventLevels(repo, attentionLevel(hosted))
  // The members' side's /door goes to the door (§5.2); with no door origin it is the SPA's, as before.
  const doorOrigin = config?.doorOrigin
  if (doorOrigin) app.get('/door', c => c.redirect(doorOrigin, 302))
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
    const server = serve({ fetch: app.fetch, hostname: hosted && hostedConfig ? hostedConfig.bind : '127.0.0.1', port, createServer: withReadableHost }, () => {
      // Only a server that is listening may touch job records; and a record that a live server
      // of this repository is running is not an orphan.
      const pidFile = serverPidFile(repo)
      let other = NaN
      try { other = Number(readFileSync(pidFile, 'utf8').trim()) } catch { /* none recorded */ }
      if (otherLive(other)) console.error(`org-os admin: another server (pid ${other}) is running for this repository; its jobs were left as they are.`)
      else {
        jobs.markInterrupted()
        // What a backup or a restore cut short left in the store's folder (L9 §7.1, carry 6): only with no other server.
        if (privateStore) cleanLeftovers(dirname(privateStore.file), line => console.log(`org-os admin: ${line}`))
      }
      try { mkdirSync(stateDir(repo), { recursive: true }); writeFileSync(pidFile, String(process.pid)) } catch (err) {
        console.error(`org-os admin: could not record this server's pid: ${err instanceof Error ? err.message : String(err)}`)
      }
      // Who each socket is: kept from its upgrade until it is open, then by the socket.
      const upgrades = new WeakMap<IncomingMessage, Listener>()
      // Hosted with its configuration, open connections per client address (L9 §5.9): a place is taken when the upgrade
      // is let through, and given back when the socket closes.
      const openFrom = new Map<string, number>()
      const addressOf = new WeakMap<IncomingMessage, string>()
      const giveBack = (address: string) => {
        const n = (openFrom.get(address) ?? 1) - 1
        if (n <= 0) openFrom.delete(address); else openFrom.set(address, n)
      }
      const listeners = new WeakMap<WebSocket, Listener>()
      const wss = new WebSocketServer({
        server: server as Server, path: '/api/events',
        // The upgrade does not pass through the Hono app, so it asks the same question itself.
        verifyClient: (info, done) => {
          const refused = refusal({ method: 'GET', host: info.req.headers.host, origin: info.req.headers.origin, contentType: undefined, path: '/api/events' }, guard)
          if (refused) { done(false, refused.status, refused.error); return }
          if (config) {
            const address = upgradeAddress(info.req, config.trustProxy)
            const n = openFrom.get(address) ?? 0
            if (n >= WS_PER_ADDRESS) { done(false, 429, RATE(60)); return }
            openFrom.set(address, n + 1)
            addressOf.set(info.req, address)
          }
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
        const address = addressOf.get(req)
        if (address !== undefined) ws.once('close', () => giveBack(address))
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
      const remoteWatch = hosted ? new RemoteWatch({ repo, fetch, everyMs: REMOTE_RECHECK_MS, attention }) : null
      remoteWatch?.start()
      // Hosted and `ORG_OS_PUSH` on: the trunk goes to the remote after the server's commits, and once now. Rule 4 is
      // read through this RemoteWatch; anything but "not public" holds the push.
      // While writes are off there is no Pusher at all, whatever ORG_OS_PUSH says (C1).
      if (remoteWatch && config?.push && instanceWrites === 'on') {
        pusher = new Pusher({ repo, trunk: () => resolveTrunk(repo, startBranch), watch: remoteWatch, attention })
        pusher.start()
      }
      // Hosted with its configuration, the backups' folder, interval, count and public key are the configuration's (§5.1,
      // ruling P7: 6 h, `/srv/backups`, `/run/secrets/backup.pub` by default); otherwise the environment's, as L5.
      const backupEnv = config ? {
        ...process.env, ORG_OS_BACKUP_DIR: config.backupDir, ORG_OS_BACKUP_EVERY: String(config.backupEveryMs),
        ORG_OS_BACKUP_KEEP: String(config.backupKeep), ORG_OS_BACKUP_PUBLIC_KEY_FILE: config.backupPublicKeyFile ?? '',
      } : undefined
      const backups = privateStore ? scheduleBackups({ store: privateStore, repo, hosted, attention, everyMs: backupEveryMs, ...(backupEnv ? { env: backupEnv } : {}) }) : null

      resolve({
        port: (server.address() as AddressInfo).port,
        startBranch,
        privateStore,
        app,
        close: async () => {
          // Jobs first: a child left running would outlive the server that promised to supervise it.
          await executor.stopAll()
          // Then the push: no new one starts, its timer goes, and one under way is waited for.
          await pusher?.stop()
          clearInterval(crewPoll)
          clearInterval(clockTick)
          clearInterval(systemsTick)
          remoteWatch?.stop()
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
          await emailSignIn?.settled()
          privateStore?.close()
        },
      })
    })
  })
}
