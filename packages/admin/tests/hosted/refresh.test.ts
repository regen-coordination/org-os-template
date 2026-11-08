import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { ServerAttention } from '../../server/attention.ts'
import { resolveTrunk } from '../../server/proposals/ledger.ts'
import {
  Refresher, REFRESH_DIVERGED, REFRESH_FAILED, REFRESH_NO_REMOTE, REFRESH_NOT_ON_TRUNK, REFRESH_REFUSED, REFRESH_EVERY_MS,
} from '../../server/hosted/refresh.ts'
import { refreshRow, REFRESH_ROW, sources } from '../../server/resources/adapters/sources.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

// Convergence C1, C2: a hosted Hub whose writes are off takes the instance's commits from its remote, fast-forward only.
// Every repository is fresh under the temp directory: the Hub's copy (makeChangeRepo), a bare repository standing in for
// the remote, and a second clone that makes the commits "elsewhere" (a steward's session) and pushes them. No network.

const cleanup: string[] = []
const refreshers: Refresher[] = []
const savedEnv = { ...process.env }
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(async () => {
  for (const r of refreshers.splice(0)) await r.stop()
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.unstubAllEnvs()
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
  Object.assign(process.env, savedEnv)
  vi.restoreAllMocks()
})

const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const tip = (repo: string, ref = 'refs/heads/main') => git(repo, `rev-parse ${ref}`).trim()
async function until(what: string, cond: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`)
    await new Promise(r => setTimeout(r, 25))
  }
}

/** The Hub's copy, its bare remote, and a second clone of that remote where commits are made elsewhere. */
function world(): { repo: string; bare: string; elsewhere: string } {
  const repo = makeChangeRepo()
  cleanup.push(repo)
  const bare = join(tmp('refresh-remote-'), 'remote.git')
  git(tmp('refresh-init-'), `init -q --bare -b main ${bare}`)
  git(repo, `remote add origin ${bare}`)
  git(repo, 'push -q origin refs/heads/main:refs/heads/main')
  const elsewhere = join(tmp('refresh-elsewhere-'), 'clone')
  git(tmp('refresh-clone-'), `clone -q ${bare} ${elsewhere}`)
  git(elsewhere, 'config user.email steward@example.org')
  git(elsewhere, 'config user.name Steward')
  return { repo, bare, elsewhere }
}
let n = 0
/** A commit made elsewhere and pushed to the remote; answers its sha. */
function landElsewhere(elsewhere: string, file = 'data/elsewhere.yaml'): string {
  n += 1
  writeFileSync(join(elsewhere, file), `n: ${n}\n`)
  git(elsewhere, `add ${file}`)
  git(elsewhere, `commit -q -m "elsewhere ${n}"`)
  git(elsewhere, 'push -q origin HEAD:refs/heads/main')
  return tip(elsewhere, 'HEAD')
}
function refresherFor(repo: string, o: { everyMs?: number; onAdvance?: () => void } = {}) {
  const attention = new ServerAttention()
  const r = new Refresher({ repo, trunk: () => resolveTrunk(repo), attention, fetchBlockMs: 10_000, ...o })
  refreshers.push(r)
  return { r, attention }
}
const card = (attention: ServerAttention) => attention.resources().find(x => x.id === 'absent:server:refresh')

describe('Refresher', () => {
  it('fast-forwards the copy to the remote\'s new commits, and says when', async () => {
    const { repo, elsewhere } = world()
    const landed = landElsewhere(elsewhere)
    const onAdvance = vi.fn()
    const { r, attention } = refresherFor(repo, { onAdvance })
    const s = await r.refresh()
    expect(tip(repo)).toBe(landed)
    expect(readFileSync(join(repo, 'data', 'elsewhere.yaml'), 'utf8')).toBe(`n: ${n}\n`) // the working tree moved too
    expect(s).toMatchObject({ state: 'following', trunk: 'main', commit: landed, sentence: null })
    expect(s.lastRefresh).not.toBeNull()
    expect(onAdvance).toHaveBeenCalledTimes(1)
    expect(card(attention)).toBeUndefined()
  })

  it('already at the remote\'s commit: nothing moves, and it still follows', async () => {
    const { repo } = world()
    const before = tip(repo)
    const onAdvance = vi.fn()
    const { r } = refresherFor(repo, { onAdvance })
    expect(await r.refresh()).toMatchObject({ state: 'following', commit: before })
    expect(tip(repo)).toBe(before)
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('a diverged history stops it with an alert: the copy is left as it was, and no later refresh runs', async () => {
    const { repo, elsewhere } = world()
    landElsewhere(elsewhere)
    git(repo, 'commit -q --allow-empty -m "a commit the remote has not seen"')
    const ours = tip(repo)
    const { r, attention } = refresherFor(repo)
    expect(await r.refresh()).toMatchObject({ state: 'stopped', sentence: REFRESH_DIVERGED })
    expect(tip(repo)).toBe(ours)
    expect(card(attention)?.attention).toEqual({ level: 'alert', text: REFRESH_DIVERGED })
    // stopped until the Hub starts again: a later commit elsewhere is not taken
    landElsewhere(elsewhere)
    expect((await r.refresh()).state).toBe('stopped')
    expect(tip(repo)).toBe(ours)
  })

  it('a copy ahead of the remote is a non-fast-forward too: stopped', async () => {
    const { repo } = world()
    git(repo, 'commit -q --allow-empty -m "made in the copy"')
    const { r } = refresherFor(repo)
    expect(await r.refresh()).toMatchObject({ state: 'stopped', sentence: REFRESH_DIVERGED })
  })

  it('a copy that is not on its trunk is stopped, and nothing moves', async () => {
    const { repo, elsewhere } = world()
    landElsewhere(elsewhere)
    git(repo, 'checkout -q -b side')
    const before = tip(repo, 'refs/heads/main')
    // resolveTrunk reads the branch the copy is on when nothing names the trunk; name it, as a started server does
    const attention = new ServerAttention()
    const named = new Refresher({ repo, trunk: async () => 'main', attention })
    refreshers.push(named)
    expect(await named.refresh()).toMatchObject({ state: 'stopped', sentence: REFRESH_NOT_ON_TRUNK('main') })
    expect(tip(repo, 'refs/heads/main')).toBe(before)
  })

  it('a change in the copy that the fast-forward would write over: git refuses, and it stops', async () => {
    const { repo, elsewhere } = world()
    landElsewhere(elsewhere, 'data/clash.yaml')
    writeFileSync(join(repo, 'data', 'clash.yaml'), 'mine: true\n') // untracked, in the way
    const before = tip(repo)
    const { r } = refresherFor(repo)
    expect(await r.refresh()).toMatchObject({ state: 'stopped', sentence: REFRESH_REFUSED })
    expect(tip(repo)).toBe(before)
    expect(readFileSync(join(repo, 'data', 'clash.yaml'), 'utf8')).toBe('mine: true\n')
  })

  it('no origin: a warning, nothing run, and it asks again', async () => {
    const repo = makeChangeRepo(); cleanup.push(repo)
    const { r, attention } = refresherFor(repo)
    expect(await r.refresh()).toMatchObject({ state: 'retrying', sentence: REFRESH_NO_REMOTE })
    expect(card(attention)?.attention).toEqual({ level: 'warn', text: REFRESH_NO_REMOTE })
  })

  it('a remote it cannot read: a warning without git\'s words, then it follows again once the remote is back', async () => {
    const { repo, bare, elsewhere } = world()
    const landed = landElsewhere(elsewhere)
    git(repo, `remote set-url origin ${bare}-gone`)
    const { r, attention } = refresherFor(repo)
    expect(await r.refresh()).toMatchObject({ state: 'retrying', sentence: REFRESH_FAILED })
    expect(card(attention)?.attention?.text).not.toContain('gone')
    git(repo, `remote set-url origin ${bare}`)
    expect(await r.refresh()).toMatchObject({ state: 'following', commit: landed })
    expect(card(attention)).toBeUndefined()
  })

  it('runs at start and again every everyMs; stop() ends it', async () => {
    const { repo, elsewhere } = world()
    const first = landElsewhere(elsewhere)
    const { r } = refresherFor(repo, { everyMs: 150 })
    r.start()
    await until('the start refresh', () => tip(repo) === first)
    const second = landElsewhere(elsewhere)
    await until('the next refresh', () => tip(repo) === second)
    await r.stop()
    landElsewhere(elsewhere)
    await new Promise(res => setTimeout(res, 500))
    expect(tip(repo)).toBe(second)
  })

  it('the default is 15 minutes', () => {
    expect(REFRESH_EVERY_MS).toBe(900_000)
  })
})

describe('the Sources row', () => {
  it('is drawn from the Refresher\'s state, members only (no registry), its stop as an alert', async () => {
    const row = refreshRow({ state: 'stopped', trunk: 'main', everyMs: 900_000, lastRefresh: '2026-11-08T03:00:00.000Z', commit: 'a'.repeat(40), sentence: REFRESH_DIVERGED })
    expect(row).toMatchObject({
      id: REFRESH_ROW, kind: 'source', board: 'systems', status: 'stopped', source: null,
      attention: { level: 'alert', text: REFRESH_DIVERGED },
      changed: { at: '2026-11-08T03:00:00.000Z', by: 'last refresh' },
      facts: { trunk: 'main', every: '15 min', commit: 'a'.repeat(12) },
    })
    expect(refreshRow({ state: 'retrying', trunk: null, everyMs: 900_000, lastRefresh: null, commit: null, sentence: REFRESH_FAILED }).attention)
      .toEqual({ level: 'warn', text: REFRESH_FAILED })
  })

  it('the sources adapter shows it only when a refresh runs', async () => {
    const repo = makeChangeRepo(); cleanup.push(repo)
    const ctx = { repo, now: () => new Date(), run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }), lastOk: () => null }
    const ids = async (extra: object) => {
      const out = await sources.read({ ...ctx, ...extra })
      return 'nodes' in out ? out.nodes.map(x => x.id) : []
    }
    expect(await ids({})).not.toContain(REFRESH_ROW)
    expect(await ids({ refresh: () => null })).not.toContain(REFRESH_ROW)
    expect(await ids({ refresh: () => ({ state: 'following', trunk: 'main', everyMs: 900_000, lastRefresh: null, commit: null, sentence: null }) })).toContain(REFRESH_ROW)
  })
})

describe('startServer and the Refresher', () => {
  let server: Running | null = null
  afterEach(async () => { await server?.close(); server = null })
  function config(env: Record<string, string> = {}): HostedConfig {
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR!, ORG_OS_PUSH: 'off', ...env }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    return r.config
  }
  async function hosted(writes: 'on' | 'off', env: Record<string, string> = {}) {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const w = world()
    vi.stubEnv('ORG_OS_ADMIN_HOME', tmp('refresh-home-'))
    vi.stubEnv('ORG_OS_PRIVATE_DIR', tmp('refresh-private-'))
    vi.stubEnv('ORG_OS_REMOTE_PRIVATE', 'confirmed')
    const landed = landElsewhere(w.elsewhere)
    server = await startServer({ repo: w.repo, port: 0, hosted: true, hostedConfig: config(env), fetch: async () => { throw new Error('no network in this test') }, instanceWrites: writes })
    return { ...w, landed }
  }

  it('hosted with writes off: the copy takes the remote\'s commits at start', async () => {
    const { repo, landed } = await hosted('off')
    await until('the start refresh', () => tip(repo) === landed)
  })

  it('hosted with writes on: no refresh (the Hub is the one writer)', async () => {
    const { repo, landed } = await hosted('on')
    await new Promise(res => setTimeout(res, 1000))
    expect(tip(repo)).not.toBe(landed)
  })

  it('ORG_OS_REFRESH_EVERY=off: no refresh', async () => {
    const { repo, landed } = await hosted('off', { ORG_OS_REFRESH_EVERY: 'off' })
    await new Promise(res => setTimeout(res, 1000))
    expect(tip(repo)).not.toBe(landed)
  })
})
