import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { withGitTrace } from '../git-shim.ts'
import { commitDataPaths, onCommit, pushTrunk, GitExit, __internal } from '../../server/git.ts'
import { ServerAttention } from '../../server/attention.ts'
import { resolveTrunk } from '../../server/proposals/ledger.ts'
import {
  mountPush, Pusher, PUSH_REJECTED, PUSH_HELD, PUSH_OFF, PUSH_MAINTAINERS, PUSH_DEBOUNCE_MS, PUSH_FAILED,
} from '../../server/hosted/push.ts'
import { HOSTED_WRITES } from '../../server/hosted/writes.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountSession } from '../../server/session/routes.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// L9 spec §5.6 (one writer, Q72, carry 10). Every repository is fresh under the temp directory: the Hub's clone
// (makeChangeRepo), a bare repository standing in for the remote, and, for the diverged case, a second clone. No network:
// the remote is a local path. The bare remote keeps a reflog, so each ref update a push makes is one line there.

const cleanup: string[] = []
const pushers: Pusher[] = []
const savedEnv = { ...process.env }
beforeEach(() => {
  // No global or system git configuration reaches these repositories (a global hooks path, a push default).
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(async () => {
  for (const p of pushers.splice(0)) await p.stop()
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.unstubAllEnvs()
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
  Object.assign(process.env, savedEnv) // a hosted start sets the Hub's ident in process.env (L9 §5.5)
  vi.restoreAllMocks()
})

const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const tip = (repo: string, ref = 'refs/heads/main') => git(repo, `rev-parse ${ref}`).trim()
/** The new values the bare remote's main took, oldest first (its reflog). */
const updates = (bare: string): string[] => {
  const log = join(bare, 'logs', 'refs', 'heads', 'main')
  return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => l.split(' ')[1]!) : []
}
async function until(what: string, cond: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`)
    await new Promise(r => setTimeout(r, 25))
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The Hub's clone, with `origin` a bare repository that already holds its trunk. */
function hub(): { repo: string; bare: string } {
  const repo = makeChangeRepo()
  cleanup.push(repo)
  const bare = join(tmp('push-remote-'), 'remote.git')
  git(tmp('push-init-'), `init -q --bare -b main ${bare}`)
  git(bare, 'config core.logAllRefUpdates true')
  git(repo, `remote add origin ${bare}`)
  git(repo, 'push -q origin refs/heads/main:refs/heads/main')
  return { repo, bare }
}
let n = 0
/** A Hub commit, as the server makes one (commitDataPaths, which tells onCommit). */
async function hubCommit(repo: string): Promise<string> {
  n += 1
  writeFileSync(join(repo, 'data', 'pusher.yaml'), `n: ${n}\n`)
  return commitDataPaths(repo, ['data/pusher.yaml'], `test: commit ${n}`)
}
function pusherFor(repo: string, o: { debounceMs?: number; isPublic?: () => boolean; retryMs?: number } = {}) {
  const attention = new ServerAttention()
  const p = new Pusher({
    repo, trunk: () => resolveTrunk(repo), debounceMs: o.debounceMs ?? 300, retryMs: o.retryMs,
    watch: { isPublic: o.isPublic ?? (() => false) }, attention,
  })
  pushers.push(p)
  return { pusher: p, attention }
}

describe('onCommit (L9 §5.6)', () => {
  it('tells every listener after commitDataPaths lands, with the full sha; the unsubscribe stops it; a throwing listener is not the commit\'s failure', async () => {
    const { repo } = hub()
    const heard: { repo: string; commit: string }[] = []
    const off = onCommit(e => heard.push(e))
    const offBad = onCommit(() => { throw new Error('a listener that fails') })
    const sha = await hubCommit(repo)
    expect(heard).toEqual([{ repo, commit: sha }])
    expect(sha).toBe(tip(repo))
    off(); offBad()
    await hubCommit(repo)
    expect(heard).toHaveLength(1)
  })
})

describe('the Pusher (L9 §5.6)', () => {
  it('a commit is pushed within the debounce; a burst of three commits is one push', async () => {
    const { repo, bare } = hub()
    const { pusher } = pusherFor(repo, { debounceMs: 1500 })
    const before = updates(bare).length
    pusher.start()
    await until('the start push', () => pusher.state() === 'idle')
    expect(updates(bare)).toHaveLength(before) // the remote already held the trunk: nothing to send

    const one = await hubCommit(repo)
    const at = Date.now()
    expect(pusher.state()).toBe('pending')
    expect(tip(bare)).not.toBe(one) // not at once: after the debounce
    await until('the push of one commit', () => tip(bare) === one)
    expect(Date.now() - at).toBeGreaterThanOrEqual(1400)
    expect(updates(bare).slice(before)).toEqual([one])
    await until('idle', () => pusher.state() === 'idle')

    await hubCommit(repo); await hubCommit(repo)
    const third = await hubCommit(repo)
    await until('the push of the burst', () => tip(bare) === third)
    await sleep(1800) // a second push of the burst would have come by now
    expect(updates(bare).slice(before)).toEqual([one, third]) // one ref update for the three
    expect(pusher.state()).toBe('idle')
  })

  it('a diverged remote stops the pusher: the alert is §5.6\'s, the local trunk keeps the Hub\'s commit and no merge', async () => {
    const { repo, bare } = hub()
    const { pusher, attention } = pusherFor(repo)
    pusher.start()
    await until('the start push', () => pusher.state() === 'idle')
    // Someone pushes to the remote behind the Hub's back.
    const other = join(tmp('push-other-'), 'other')
    git(tmp('push-clone-'), `clone -q ${bare} ${other}`)
    git(other, 'config user.email steward-b@example.org'); git(other, 'config user.name steward-b')
    writeFileSync(join(other, 'data', 'elsewhere.yaml'), 'made: elsewhere\n')
    git(other, 'add -A'); git(other, 'commit -qm "a commit the Hub did not make"')
    git(other, 'push -q origin refs/heads/main:refs/heads/main')
    const theirs = tip(other)

    const ours = await hubCommit(repo)
    await until('the stop', () => pusher.state() === 'stopped')
    expect(attention.resources().map(r => r.attention)).toEqual([{ level: 'alert', text: PUSH_REJECTED }])
    expect(tip(bare)).toBe(theirs) // never written over
    expect(tip(repo)).toBe(ours) // the Hub keeps its commit
    expect(git(repo, 'rev-list --merges HEAD').trim()).toBe('') // and merges nothing
    expect(git(repo, 'rev-list HEAD').split('\n')).not.toContain(theirs) // nor fetches theirs in

    // Stopped means stopped: the next commits are kept here and sent nowhere.
    const later = await hubCommit(repo)
    await sleep(800)
    expect([pusher.state(), tip(bare), tip(repo)]).toEqual(['stopped', theirs, later])
  })

  it('retry resumes once the remote is an ancestor of the trunk again', async () => {
    const { repo, bare } = hub()
    const base = tip(repo)
    const { pusher, attention } = pusherFor(repo)
    pusher.start()
    await until('the start push', () => pusher.state() === 'idle')
    const other = join(tmp('push-other-'), 'other')
    git(tmp('push-clone-'), `clone -q ${bare} ${other}`)
    git(other, 'config user.email steward-b@example.org'); git(other, 'config user.name steward-b')
    git(other, 'commit -q --allow-empty -m "a commit the Hub did not make"')
    git(other, 'push -q origin refs/heads/main:refs/heads/main')
    const ours = await hubCommit(repo)
    await until('the stop', () => pusher.state() === 'stopped')

    // Still diverged: the retry says so, and nothing moved.
    expect(await pusher.retry()).toEqual({ pushed: false, sentence: PUSH_REJECTED })
    expect(pusher.state()).toBe('stopped')
    // A maintainer sets the remote back to an ancestor of the Hub's trunk (in the bare repository, as the test's own act).
    git(bare, `update-ref refs/heads/main ${base}`)
    expect(await pusher.retry()).toEqual({ pushed: true })
    expect(tip(bare)).toBe(ours)
    expect(pusher.state()).toBe('idle')
    expect(attention.resources()).toEqual([])
    // And it listens again.
    const next = await hubCommit(repo)
    await until('the next push', () => tip(bare) === next)
  })

  it('a public remote holds the push; so does an answer that cannot be read; "not public" lets it go', async () => {
    const { repo, bare } = hub()
    let answer: () => boolean = () => true
    const { pusher } = pusherFor(repo, { isPublic: () => answer() })
    const before = tip(bare)
    pusher.start()
    const ours = await hubCommit(repo)
    await sleep(1000) // three debounces
    expect([pusher.state(), tip(bare)]).toEqual(['pending', before])
    expect(await pusher.retry()).toEqual({ pushed: false, sentence: PUSH_HELD })
    answer = () => { throw new Error('the watch could not say') }
    await sleep(700)
    expect([pusher.state(), tip(bare)]).toEqual(['pending', before])
    answer = () => undefined as unknown as boolean // not known to be false
    await sleep(700)
    expect(tip(bare)).toBe(before)
    answer = () => false
    await until('the push once the remote is private', () => tip(bare) === ours)
    await until('idle', () => pusher.state() === 'idle') // the remote's ref moves a moment before git exits
  })

  it('stop() stops listening and clears its timer: a later commit is not pushed', async () => {
    const { repo, bare } = hub()
    const { pusher } = pusherFor(repo, { debounceMs: 200 })
    pusher.start()
    await until('the start push', () => pusher.state() === 'idle')
    await hubCommit(repo) // pending, its timer set
    await pusher.stop()
    const before = tip(bare)
    await hubCommit(repo)
    await sleep(600)
    expect([pusher.state(), tip(bare)]).toEqual(['stopped', before])
    expect(await pusher.retry()).toMatchObject({ pushed: false })
  })

  it('a build commit (in a worktree) and another repository\'s commit do not make a push', async () => {
    const { repo, bare } = hub()
    const { pusher } = pusherFor(repo, { debounceMs: 200 })
    pusher.start()
    await until('the start push', () => pusher.state() === 'idle')
    const before = updates(bare).length
    // A build commits in a detached worktree of the Hub's clone, onto a proposal branch: not the trunk, not pushed.
    const worktree = join(tmp('push-build-'), 'build')
    git(repo, `worktree add -q --detach ${worktree} HEAD`)
    await hubCommit(worktree)
    const elsewhere = makeChangeRepo(); cleanup.push(elsewhere)
    await hubCommit(elsewhere)
    expect(pusher.state()).toBe('idle')
    await sleep(500)
    expect(updates(bare)).toHaveLength(before)
  })
})

describe('the push vocabulary (L9 §5.6): exactly `<remote> refs/heads/<b>:refs/heads/<b>`', () => {
  const refused: [string, string[]][] = [
    ['push --force …', ['push', '--force', 'origin', 'refs/heads/main:refs/heads/main']],
    ['push origin +refs/…', ['push', 'origin', '+refs/heads/main:refs/heads/main']],
    ['push origin a:b with a ≠ b', ['push', 'origin', 'refs/heads/main:refs/heads/other']],
    ['a URL as the remote', ['push', 'https://example.org/x.git', 'refs/heads/main:refs/heads/main']],
    ['an scp-like address as the remote', ['push', 'git@example.org:x/y.git', 'refs/heads/main:refs/heads/main']],
    ['a bad ref name', ['push', 'origin', 'refs/heads/a..b:refs/heads/a..b']],
    ['extra arguments', ['push', 'origin', 'refs/heads/main:refs/heads/main', 'refs/heads/main:refs/heads/main']],
    ['an empty source (a delete)', ['push', 'origin', ':refs/heads/main']],
  ]
  it.each(refused)('refuses %s, before git starts', async (_name, argv) => {
    expect(() => __internal.checkArgv(argv)).toThrow(/git guardrail/)
    const { repo } = hub()
    await withGitTrace(async started => {
      await expect(__internal.run(argv[0]!, argv.slice(1), repo)).rejects.toThrow(/git guardrail/)
      expect(started()).toEqual([])
    })
  })
  it('accepts the one shape', () => {
    expect(() => __internal.checkArgv(['push', 'origin', 'refs/heads/main:refs/heads/main'])).not.toThrow()
  })
  it('pushTrunk refuses a URL, a forcing or invalid trunk, another remote and a missing origin; it sends nothing', async () => {
    const { repo, bare } = hub()
    const before = tip(bare)
    await expect(pushTrunk(repo, 'https://example.org/x.git', 'main')).rejects.toThrow(/git guardrail/)
    await expect(pushTrunk(repo, 'origin', '+main')).rejects.toThrow(/git guardrail/)
    await expect(pushTrunk(repo, 'origin', 'proposal/p-2026-10-18-001-a3f9')).rejects.toThrow(/git guardrail/)
    git(repo, `remote add upstream ${bare}`)
    await expect(pushTrunk(repo, 'upstream', 'main')).rejects.toThrow(/pushes to origin only/)
    const lone = makeChangeRepo(); cleanup.push(lone)
    await expect(pushTrunk(lone, 'origin', 'main')).rejects.toThrow(/no remote\.origin\.url/)
    expect(tip(bare)).toBe(before)
  })
  it('pushTrunk throws GitExit on a rejection, with git\'s [rejected]', async () => {
    const { repo, bare } = hub()
    const other = join(tmp('push-other-'), 'other')
    git(tmp('push-clone-'), `clone -q ${bare} ${other}`)
    git(other, 'config user.email steward-b@example.org'); git(other, 'config user.name steward-b')
    git(other, 'commit -q --allow-empty -m "theirs"')
    git(other, 'push -q origin refs/heads/main:refs/heads/main')
    await hubCommit(repo)
    const err = await pushTrunk(repo, 'origin', 'main').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(GitExit)
    expect((err as GitExit).message).toMatch(/\[rejected\]/)
  })
})

// ── a push that hangs (a remote that takes the connection and never answers) ends; it never holds the Pusher ──

describe('a hung push (review of Task 7, finding 2)', () => {
  /** A remote over ssh whose "ssh" is a local script that takes the connection and says nothing: no network. */
  function hungRemote(): string {
    const repo = makeChangeRepo(); cleanup.push(repo)
    const bin = tmp('push-ssh-')
    const ssh = join(bin, 'ssh-silent')
    writeFileSync(ssh, '#!/bin/sh\nexec sleep 8\n', { mode: 0o755 })
    vi.stubEnv('GIT_SSH_COMMAND', ssh)
    git(repo, 'remote add origin ssh://git@hub.example.org/remote.git')
    return repo
  }

  it('pushTrunk gives up after its block time with a GitExit, not git\'s [rejected]', async () => {
    const repo = hungRemote()
    const at = Date.now()
    const err = await pushTrunk(repo, 'origin', 'main', { blockMs: 600 }).then(() => null, (e: unknown) => e)
    expect(Date.now() - at).toBeLessThan(10_000)
    expect(err).toBeInstanceOf(GitExit)
    expect((err as GitExit).message).not.toMatch(/\[rejected\]/)
  })

  it('the Pusher reads it as a failure to try again, and stop() is not held by it', async () => {
    const repo = hungRemote()
    const attention = new ServerAttention()
    const p = new Pusher({ repo, trunk: () => resolveTrunk(repo), debounceMs: 200, retryMs: 60_000, pushBlockMs: 600, watch: { isPublic: () => false }, attention })
    pushers.push(p)
    p.start()
    await until('the failure', () => attention.resources().length > 0, 10_000)
    expect(attention.resources().map(r => r.attention)).toEqual([{ level: 'warn', text: PUSH_FAILED }])
    expect(p.state()).toBe('pending')
    const at = Date.now()
    await p.stop()
    expect(Date.now() - at).toBeLessThan(2_000)
  })
})

describe('§5.6\'s sentence', () => {
  it('is verbatim', () => {
    expect(PUSH_REJECTED).toBe('The remote has commits the Hub did not make, so the Hub stopped sending its own there. The Hub keeps working and keeps its commits here. A maintainer decides what to do with the remote\'s commits; the Hub never merges them or writes over them.')
    expect(PUSH_DEBOUNCE_MS).toBe(5000)
  })
})

// ── POST /api/push/retry: maintainers only (C9-22) ──

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1` // wears Ops: a member who is not a maintainer
const A2 = `${CELO}:0x00000000000000000000000000000000000000A2` // wears Council: a maintainer
const T0 = new Date('2026-10-30T10:00:00.000Z')
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    maintainer: { hat: "${COUNCIL}" }
  decisions: []
`

describe('POST /api/push/retry (L9 §5.6, C9-22)', () => {
  const stores: PrivateStore[] = []
  afterEach(() => { for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } } })

  async function house(pusher: () => Pusher | null) {
    const repo = makeChangeRepo(GOVERNANCE); cleanup.push(repo)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree"')
    const dir = tmp('push-store-')
    const store = await openPrivateStore(repo, { dir }); stores.push(store)
    const hats: Record<string, string[]> = { [A1]: [OPS], [A2]: [COUNCIL] }
    const now = () => T0
    const reader = {
      wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
        ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hats[account] ?? [], block: 100, readAt: T0.toISOString() })),
      wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    }
    const membership = new Membership({ repo, reader, now })
    const app = createApp(repo, a => {
      mountSession(a, { repo, store, membership, hosted: true, now })
      mountPush(a, { pusher })
    }, { hosted: true, request: withRequest({ repo, hosted: true, membership, store, now }) })
    const signIn = async (account: string) => {
      await membership.forAct(account)
      return `house_session=${(await createSession(store, account, now)).token}`
    }
    const retry = async (cookie?: string) => {
      const headers: Record<string, string> = { host: 'localhost:4680', 'content-type': 'application/json' }
      if (cookie) headers.cookie = cookie
      const res = await app.request('http://localhost:4680/api/push/retry', { method: 'POST', headers, body: '{}' })
      return { status: res.status, json: await res.json() }
    }
    return { app, signIn, retry, repo }
  }

  it('is an actor route of HOSTED_WRITES', () => {
    expect(HOSTED_WRITES.find(w => w.method === 'POST' && w.path === '/api/push/retry')).toEqual({ method: 'POST', path: '/api/push/retry', class: 'actor' })
  })

  it('a member who is not a maintainer is 403, and the Pusher is not asked; a maintainer\'s retry is the Pusher\'s answer', async () => {
    const asked = vi.fn(async () => ({ pushed: true }))
    const fake = { retry: asked } as unknown as Pusher
    const { signIn, retry } = await house(() => fake)
    expect(await retry(await signIn(A1))).toEqual({ status: 403, json: { code: 'MAINTAINERS_ONLY', error: PUSH_MAINTAINERS } })
    expect(asked).not.toHaveBeenCalled()
    expect((await retry()).status).toBe(401) // no session: refused first (L5)
    expect(asked).not.toHaveBeenCalled()
    expect(await retry(await signIn(A2))).toEqual({ status: 200, json: { pushed: true } })
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('with no Pusher (local, or ORG_OS_PUSH=off) a maintainer is told so, 409 PUSH_OFF', async () => {
    const { signIn, retry } = await house(() => null)
    expect(await retry(await signIn(A2))).toEqual({ status: 409, json: { code: 'PUSH_OFF', error: PUSH_OFF } })
  })
})

// ── the server starts the Pusher when hosted and config.push, and stops it at close ──

describe('startServer and the Pusher', () => {
  let server: Running | null = null
  afterEach(async () => { await server?.close(); server = null })
  function config(env: Record<string, string> = {}): HostedConfig {
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR!, ...env }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    return r.config
  }
  async function hosted(env: Record<string, string> = {}) {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
    const { repo, bare } = hub()
    vi.stubEnv('ORG_OS_ADMIN_HOME', tmp('push-home-'))
    vi.stubEnv('ORG_OS_PRIVATE_DIR', tmp('push-private-'))
    vi.stubEnv('ORG_OS_REMOTE_PRIVATE', 'confirmed') // a local path: rule 4 cannot ask, the operator confirmed
    git(repo, 'commit -q --allow-empty -m "a commit the remote has not seen"')
    const local = tip(repo)
    // The push as it is once writes are turned on (Lane 3 Task 11: while they are off there is no Pusher at all).
    server = await startServer({ repo, port: 0, hosted: true, hostedConfig: config(env), fetch: async () => { throw new Error('no network in this test') }, instanceWrites: 'on' })
    return { repo, bare, local }
  }

  it('hosted with ORG_OS_PUSH on: the trunk is pushed at start; close stops it', async () => {
    const { bare, local } = await hosted()
    await until('the start push', () => tip(bare) === local)
    await server!.close(); server = null
  })

  it('hosted with ORG_OS_PUSH=off: nothing is pushed', async () => {
    const { bare, local } = await hosted({ ORG_OS_PUSH: 'off' })
    const before = tip(bare)
    expect(before).not.toBe(local)
    await sleep(1000)
    expect(tip(bare)).toBe(before)
  })

  it('hosted with ORG_OS_PUSH=off: no git push runs at all, at start or after a Hub commit (C1; review of Task 7, finding 3)', async () => {
    await withGitTrace(async started => {
      const { repo, bare } = await hosted({ ORG_OS_PUSH: 'off' })
      const before = tip(bare)
      const ours = await hubCommit(repo) // a Hub commit tells onCommit; with the push off nobody listens to send it
      await sleep(PUSH_DEBOUNCE_MS + 1_500)
      expect(tip(bare)).toBe(before)
      expect(tip(repo)).toBe(ours)
      // The one push in the trace is the fixture's own, which put the trunk on the remote before the server started.
      expect(started().filter(line => line.split(' ').includes('push'))).toEqual(['push -q origin refs/heads/main:refs/heads/main'])
      expect(started().length).toBeGreaterThan(0) // the trace saw the server's git: it was on PATH
    })
  }, 30_000)
})

