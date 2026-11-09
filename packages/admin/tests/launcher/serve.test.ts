import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { startLauncher, type DoctorSummary } from '../../launcher/serve.ts'
import { doctorSummaryOf } from '../../launcher/children.ts'
import { readRecent, remember } from '../../launcher/home.ts'
import { stateDir } from '../../server/state.ts'

const clean: DoctorSummary = { status: 'ok', blockers: 0, warnings: 0, findings: [] }
let repo: string
let fakeStartAdmin: ReturnType<typeof vi.fn>
let fakeAssess: ReturnType<typeof vi.fn>
let launcher: Awaited<ReturnType<typeof startLauncher>>
let base: string

beforeEach(async () => {
  repo = makeFixtureRepo()
  fakeStartAdmin = vi.fn(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(() => {}) }))
  fakeAssess = vi.fn(async () => clean)
  launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, startAdmin: fakeStartAdmin, assess: fakeAssess })
  base = `http://127.0.0.1:${launcher.port}`
})
afterEach(async () => { await launcher.close(); removeFixtureRepo(repo) })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  launcher.app.request(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}`, ...headers } })

describe('the launcher', () => {
  it('refuses a foreign Origin or Host', async () => {
    expect((await post('/api/launcher/open', { path: repo }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post('/api/launcher/open', { path: repo }, { host: 'evil.example:4679' })).status).toBe(403)
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  })

  it('refuses a write with no Origin, and a DELETE that is not JSON', async () => {
    const h = { 'content-type': 'application/json', host: `localhost:${launcher.port}` }
    expect((await launcher.app.request(`${base}/api/launcher/open`, { method: 'POST', body: JSON.stringify({ path: repo }), headers: h })).status).toBe(403)
    const own = { host: h.host, origin: `http://localhost:${launcher.port}` }
    expect((await launcher.app.request(`${base}/api/launcher/recent`, { method: 'DELETE', body: '{}', headers: { ...own, 'content-type': 'text/plain' } })).status).toBe(415)
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  })

  it('opens one canonical path: a trailing slash and a symlink are the same instance', async () => {
    const { symlinkSync } = await import('node:fs')
    const link = `${repo}-link`
    symlinkSync(repo, link)
    try {
      await post('/api/launcher/open', { path: `${repo}/` })
      await post('/api/launcher/open', { path: link })
      await post('/api/launcher/open', { path: `${repo}/data/..` })
      expect(fakeStartAdmin).toHaveBeenCalledTimes(1)
      expect(fakeStartAdmin).toHaveBeenCalledWith(realpathSync(repo))
      expect(JSON.parse(readFileSync(join(stateDir(realpathSync(repo)), 'doctor.json'), 'utf8')).blockers).toBe(0)
    } finally { rmSync(link, { force: true }) }
  })

  it('drops an admin that has ended: the next open starts a new one', async () => {
    let end!: () => void
    fakeStartAdmin.mockImplementationOnce(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(r => { end = r }) }))
    await post('/api/launcher/open', { path: repo })
    end()
    await new Promise(r => setTimeout(r, 10))
    await post('/api/launcher/open', { path: repo })
    expect(fakeStartAdmin).toHaveBeenCalledTimes(2)
  })

  it('refuses a write that is not JSON', async () => {
    const r = await launcher.app.request(`${base}/api/launcher/open`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}` } })
    expect(r.status).toBe(415)
  })

  it('refuses a foreign Host over a real socket', async () => {
    const status = await new Promise<number>((res, rej) => {
      const req = request({ host: '127.0.0.1', port: launcher.port, path: '/api/launcher/state', headers: { host: 'evil.example' } }, r => { r.resume(); res(r.statusCode!) })
      req.on('error', rej); req.end()
    })
    expect(status).toBe(403)
  })

  it('opens an instance: doctor result saved, remembered, admin started, sent to map the rest', async () => {
    const r = await post('/api/launcher/open', { path: repo })
    expect(await r.json()).toEqual({ url: 'http://localhost:4999/systems/map?first=1' })
    expect(JSON.parse(readFileSync(join(stateDir(realpathSync(repo)), 'doctor.json'), 'utf8')).blockers).toBe(0)
    expect(readRecent()[0]).toBe(realpathSync(repo))
    await post('/api/launcher/open', { path: repo })
    expect(fakeStartAdmin).toHaveBeenCalledTimes(1) // the child is reused
  })

  it('offers adopt for a folder that is not an instance', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'launcher-plain-'))
    try {
      const r = await post('/api/launcher/open', { path: plain })
      expect(r.status).toBe(409)
      expect(await r.json()).toMatchObject({ adoptable: true, path: realpathSync(plain) })
    } finally { rmSync(plain, { recursive: true, force: true }) }
  })

  it('says 404 for a path that does not exist', async () => {
    expect((await post('/api/launcher/open', { path: '/nope/not/here' })).status).toBe(404)
  })

  it('names the process of an admin it did not start', async () => {
    const { serverPidFile } = await import('../../server/state.ts')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(stateDir(realpathSync(repo)), { recursive: true })
    writeFileSync(serverPidFile(realpathSync(repo)), String(process.ppid))
    const r = await post('/api/launcher/open', { path: repo })
    expect(r.status).toBe(409)
    expect((await r.json() as { error: string }).error).toBe(`This instance is already open in another window (process ${process.ppid}). Use that window, or stop it first.`)
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  })

  it('lists a missing folder as not found, and an instance by its live name', async () => {
    remember(repo)
    remember('/nope')
    const state = await (await launcher.app.request(`${base}/api/launcher/state`, { headers: { host: `localhost:${launcher.port}` } })).json() as any
    expect(state.recent[0]).toEqual({ path: '/nope', found: false, name: null, instance: false })
    expect(state.recent[1]).toEqual({ path: realpathSync(repo), found: true, name: 'Fixture Org', instance: true })
    const r = await launcher.app.request(`${base}/api/launcher/recent`, { method: 'DELETE', body: JSON.stringify({ path: '/nope' }), headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}` } })
    const left = (await r.json() as any).recent as string[]
    expect(left).not.toContain('/nope')
    expect(left).toContain(realpathSync(repo))
  })

  it('shows join as coming with federation', async () => {
    const state = await (await launcher.app.request(`${base}/api/launcher/state`, { headers: { host: `localhost:${launcher.port}` } })).json() as any
    expect(state.doors.find((d: any) => d.id === 'join')).toEqual({ id: 'join', available: false, note: 'Comes with federation.' })
    expect(state.doors.filter((d: any) => d.available).map((d: any) => d.id)).toEqual(['open', 'create', 'adopt'])
  })

  it('answers 404 to an unknown API path', async () => {
    expect((await launcher.app.request(`${base}/api/nothing`, { headers: { host: `localhost:${launcher.port}` } })).status).toBe(404)
  })

  it('will not start hosted', async () => {
    await expect(startLauncher({ port: 0, frameworkDir: REAL_REPO, hosted: true })).rejects.toThrow('A hosted Hub is one instance')
  })
})

describe('doctorSummaryOf', () => {
  it('keeps the warnings and blockers, drops the OK findings', () => {
    const s = doctorSummaryOf({ status: 'blocked', summary: { blockers: 1, warnings: 1, checks: 2 }, checks: [
      { findings: [{ level: 'OK', code: 'a', message: 'fine', hint: null }, { level: 'BLOCKER', code: 'b', message: 'bad', hint: 'fix it' }] },
      { findings: [{ level: 'WARN', code: 'c', message: 'meh', hint: null }] },
    ] })
    expect(s).toEqual({ status: 'blocked', blockers: 1, warnings: 1, findings: [
      { level: 'BLOCKER', code: 'b', message: 'bad', hint: 'fix it' }, { level: 'WARN', code: 'c', message: 'meh' }] })
  })
})
