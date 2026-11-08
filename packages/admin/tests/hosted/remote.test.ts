import { describe, it, expect, afterEach, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRemote, remoteVisibility, RemoteWatch, REMOTE_TURNED_PUBLIC } from '../../server/visibility/remote.ts'
import { ServerAttention } from '../../server/attention.ts'
import { startServer, REMOTE_RECHECK_MS, type Running } from '../../server/serve.ts'
import type { FetchLike } from '../../server/systems/driver.ts'

// L9 spec §5.7 (carry 7): rule 4 follows one same-host redirect and asks again while a hosted Hub runs. Every answer is
// a recorded fixture through an injected fetch; no test reaches a network.

const here = dirname(fileURLToPath(import.meta.url))
interface Recorded { status: number; headers?: Record<string, string>; body: unknown }
const fixture = (name: string): Recorded => {
  const raw = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'remote', `${name}.json`), 'utf8')) as Record<string, unknown>
  return 'status' in raw ? raw as unknown as Recorded : { status: 200, body: raw }
}

interface Seen { url: string; init: Parameters<FetchLike>[1] }
/** Answers in order; the last answer repeats. */
function script(answers: Recorded[], seen: Seen[] = []): FetchLike {
  let i = 0
  return async (url, init) => {
    seen.push({ url, init })
    const a = answers[Math.min(i++, answers.length - 1)]!
    const headers = a.headers ?? {}
    return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, json: async () => a.body }
  }
}
const never: FetchLike = async () => { throw new Error('asked the network') }

const URL_ = 'https://github.com/example-org/example-house.git'
const API = 'https://api.github.com/repos/example-org/example-house'
const NEW_API = 'https://api.github.com/repositories/1001'

describe('remoteVisibility follows one same-host redirect', () => {
  it('a 301 to the same API host whose target says public is public', async () => {
    const seen: Seen[] = []
    expect(await remoteVisibility(URL_, script([fixture('redirect-same-host'), fixture('public-200')], seen))).toBe('public')
    expect(seen.map(s => s.url)).toEqual([API, NEW_API])
    expect(seen.every(s => s.init.redirect === 'manual')).toBe(true)
  })
  it('a 301 whose target says 404 is not public', async () => {
    expect(await remoteVisibility(URL_, script([fixture('redirect-same-host'), fixture('not-found-404')]))).toBe('not-public')
  })
  it('a 301 to another host is unknown, and the other host is never asked', async () => {
    const seen: Seen[] = []
    expect(await remoteVisibility(URL_, script([fixture('redirect-other-host'), fixture('public-200')], seen))).toBe('unknown')
    expect(seen.map(s => s.url)).toEqual([API])
  })
  it('two redirects in a row are unknown', async () => {
    const seen: Seen[] = []
    expect(await remoteVisibility(URL_, script([fixture('redirect-same-host'), fixture('redirect-same-host'), fixture('public-200')], seen))).toBe('unknown')
    expect(seen).toHaveLength(2)
  })
  it('a redirect with no Location is unknown', async () => {
    expect(await remoteVisibility(URL_, script([{ status: 301, body: {} }]))).toBe('unknown')
  })
  it('the request carries no credential header, on either call', async () => {
    const seen: Seen[] = []
    await remoteVisibility('https://token-abc123@github.com/example-org/example-house.git', script([fixture('redirect-same-host'), fixture('not-found-404')], seen))
    expect(seen).toHaveLength(2)
    for (const s of seen) { expect(Object.keys(s.init.headers)).toEqual(['accept']); expect(s.url).not.toContain('token-abc123') }
  })
})

describe('checkRemote through a redirect', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function repoWith(remote: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-hosted-'))
    dirs.push(dir)
    execSync('git init -q -b main', { cwd: dir })
    execSync(`git remote add origin ${remote}`, { cwd: dir })
    return dir
  }
  const sentence = 'The repository at github.com/example-org/example-house is public, and it holds what only members may read. Make it private, then start again.'
  const viaRedirect = () => script([fixture('redirect-same-host'), fixture('public-200')])
  it('hosted refuses; locally it is an alert', async () => {
    expect(await checkRemote(repoWith(URL_), { hosted: true, fetch: viaRedirect(), env: {} })).toEqual({ refuse: sentence, attention: null })
    expect(await checkRemote(repoWith(URL_), { hosted: false, fetch: viaRedirect(), env: {} })).toEqual({ refuse: null, attention: sentence })
  })
})

describe('RemoteWatch', () => {
  const dirs: string[] = []
  afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function repoWith(remote: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-watch-'))
    dirs.push(dir)
    execSync('git init -q -b main', { cwd: dir })
    execSync(`git remote add origin ${remote}`, { cwd: dir })
    return dir
  }
  const label = 'github.com/example-org/example-house'

  it('hosted, a remote that turns public while running raises the alert and isPublic() is true', async () => {
    vi.useFakeTimers()
    const attention = new ServerAttention()
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: script([fixture('not-found-404'), fixture('public-200')]), everyMs: 1000, attention })
    await watch.check()
    expect(watch.isPublic()).toBe(false)
    expect(attention.resources()).toEqual([])
    await watch.check()
    expect(watch.isPublic()).toBe(true)
    const [item] = attention.resources()
    expect(item!.attention).toEqual({ level: 'alert', text: REMOTE_TURNED_PUBLIC(label) })
    expect(item!.attention!.text).toBe(`The repository at ${label} is now public, and it holds what only members may read. The Hub stopped sending commits there. Make it private; the Hub asks again every hour.`)
    watch.stop()
  })
  it('a public answer reached through a redirect counts', async () => {
    vi.useFakeTimers()
    const attention = new ServerAttention()
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: script([fixture('redirect-same-host'), fixture('public-200')]), everyMs: 1000, attention })
    await watch.check()
    expect(watch.isPublic()).toBe(true)
  })
  it('unknown while running changes nothing, public or not', async () => {
    vi.useFakeTimers()
    const attention = new ServerAttention()
    const fetch = script([fixture('public-200'), fixture('redirect-other-host')])
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch, everyMs: 1000, attention })
    await watch.check()
    expect(watch.isPublic()).toBe(true)
    await watch.check()
    expect(watch.isPublic()).toBe(true)
    expect(attention.resources()).toHaveLength(1)
    const quiet = new RemoteWatch({ repo: repoWith(URL_), fetch: never, everyMs: 1000, attention: new ServerAttention() })
    await quiet.check()
    expect(quiet.isPublic()).toBe(false)
  })
  it('a remote made private again clears the alert', async () => {
    vi.useFakeTimers()
    const attention = new ServerAttention()
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: script([fixture('public-200'), fixture('not-found-404')]), everyMs: 1000, attention })
    await watch.check()
    expect(watch.isPublic()).toBe(true)
    await watch.check()
    expect(watch.isPublic()).toBe(false)
    expect(attention.resources()).toEqual([])
  })
  it('start asks on every period and stop clears the timer', async () => {
    vi.useFakeTimers()
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: never, everyMs: 1000, attention: new ServerAttention() })
    const check = vi.spyOn(watch, 'check').mockResolvedValue()
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(check).toHaveBeenCalledTimes(3)
    watch.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(check).toHaveBeenCalledTimes(3)
  })
  it('a check still under way when stop() is called neither raises nor clears attention, so nothing is refreshed', async () => {
    for (const [first, second] of [['not-found-404', 'public-200'], ['public-200', 'not-found-404']] as const) {
      const attention = new ServerAttention()
      let release: () => void = () => {}
      const gate = new Promise<void>(r => { release = r })
      let asked = 0
      const answers = script([fixture(first), fixture(second)])
      // The first answer lands at once; the second waits until the test lets it go, after stop().
      const fetch: FetchLike = async (url, init) => { asked += 1; if (asked > 1) await gate; return answers(url, init) }
      const watch = new RemoteWatch({ repo: repoWith(URL_), fetch, everyMs: 1000, attention })
      await watch.check()
      const was = watch.isPublic()
      const kept = attention.resources()
      const changed = vi.fn()
      attention.onChange = changed
      const pending = watch.check()
      await vi.waitFor(() => expect(asked).toBe(2))
      watch.stop()
      release()
      await pending
      expect([first, watch.isPublic(), attention.resources(), changed.mock.calls.length]).toEqual([first, was, kept, 0])
      await watch.check() // asked after stop: nothing at all
      expect(asked).toBe(2)
    }
  })
  it('a check that throws inside the timer is caught and said, never an unhandled rejection', async () => {
    vi.useFakeTimers()
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: never, everyMs: 1000, attention: new ServerAttention() })
    vi.spyOn(watch, 'check').mockRejectedValue(new Error('SENTINEL-check-1'))
    watch.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(said).toHaveBeenCalledTimes(1)
    expect(String(said.mock.calls[0]![0])).toMatch(/could not be asked again: SENTINEL-check-1/)
    watch.stop()
    said.mockRestore()
  })
  it('stop clears the timer', async () => {
    vi.useFakeTimers()
    const watch = new RemoteWatch({ repo: repoWith(URL_), fetch: never, everyMs: 1000, attention: new ServerAttention() })
    watch.start()
    expect(vi.getTimerCount()).toBe(1)
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('startServer', () => {
  const dirs: string[] = []
  let running: Running | null = null
  afterEach(async () => { await running?.close(); running = null; vi.useRealTimers(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function repoWith(remote: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-serve-'))
    dirs.push(dir)
    execSync('git init -q -b main', { cwd: dir })
    execSync(`git remote add origin ${remote}`, { cwd: dir })
    return dir
  }
  it('hosted asks again every hour, and close stops asking', async () => {
    expect(REMOTE_RECHECK_MS).toBe(3_600_000)
    const seen: Seen[] = []
    const fetch = script([fixture('not-found-404')], seen)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    running = await startServer({ repo: repoWith(URL_), port: 0, hosted: true, fetch })
    const atStart = seen.length
    await vi.advanceTimersByTimeAsync(REMOTE_RECHECK_MS)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(atStart))
    const afterHour = seen.length
    await running.close(); running = null
    await vi.advanceTimersByTimeAsync(3 * REMOTE_RECHECK_MS)
    expect(seen.length).toBe(afterHour)
  })
})
