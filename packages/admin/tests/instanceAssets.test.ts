import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { assetHeaders, instanceMark, readInstanceAsset, INSTANCE_ASSET_MAX_BYTES } from '../server/instanceAssets.ts'
import { createApp } from '../server/app.ts'
import { startServer, type Running } from '../server/serve.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo(); mkdirSync(join(repo, 'house'), { recursive: true }) })
afterEach(() => removeFixtureRepo(repo))
const put = (name: string, body: string | Buffer) => writeFileSync(join(repo, 'house', name), body)
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'

describe('readInstanceAsset', () => {
  it('reads an image from house/ by a plain name, with its type', () => {
    put('wordmark-dark.svg', SVG)
    expect(readInstanceAsset(repo, 'wordmark-dark.svg')).toEqual({ body: Buffer.from(SVG), type: 'image/svg+xml' })
  })
  it('refuses anything but a plain image name in house/ itself', () => {
    put('skin.css', 'x')
    writeFileSync(join(repo, 'secret.png'), 'x')
    for (const name of ['skin.css', '../secret.png', '..%2Fsecret.png', '.hidden.png', 'Mark.PNG', 'a/b.png', 'mark.png.svg.exe', ''])
      expect(readInstanceAsset(repo, name)).toBeNull()
  })
  it('refuses a missing file, a folder, and a file over the cap', () => {
    expect(readInstanceAsset(repo, 'none.png')).toBeNull()
    mkdirSync(join(repo, 'house', 'dir.png'))
    expect(readInstanceAsset(repo, 'dir.png')).toBeNull()
    put('big.png', Buffer.alloc(INSTANCE_ASSET_MAX_BYTES + 1))
    expect(readInstanceAsset(repo, 'big.png')).toBeNull()
  })
})

describe('instanceMark', () => {
  it('is null with no mark, else the first of mark.svg, mark.png, mark.webp', () => {
    expect(instanceMark(repo)).toBeNull()
    put('mark.webp', 'x'); expect(instanceMark(repo)).toBe('/instance-assets/mark.webp')
    put('mark.png', 'x'); expect(instanceMark(repo)).toBe('/instance-assets/mark.png')
    put('mark.svg', SVG); expect(instanceMark(repo)).toBe('/instance-assets/mark.svg')
  })
  it('is in /api/status, so the frame passes it to the org seal', async () => {
    expect((await (await createApp(repo).request('/api/status')).json())).not.toHaveProperty('mark')
    put('mark.png', 'x')
    expect((await (await createApp(repo).request('/api/status')).json()).mark).toBe('/instance-assets/mark.png')
  })
})

describe('serving instance images', () => {
  let server: Running | undefined
  afterEach(async () => { await server?.close(); server = undefined })
  it('serves an image with its type, an SVG locked down, and a 404 for anything else', async () => {
    put('wordmark-white.svg', SVG); put('mark.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const running = await startServer({ repo, port: 0 })
    server = running
    const at = (p: string) => fetch(`http://127.0.0.1:${running.port}${p}`)
    const svg = await at('/instance-assets/wordmark-white.svg')
    expect(svg.status).toBe(200)
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(svg.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await svg.text()).toBe(SVG)
    const png = await at('/instance-assets/mark.png')
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-security-policy')).toBeNull()
    expect((await at('/instance-assets/skin.css')).status).toBe(404)
    expect((await at('/instance-assets/..%2Fdata%2Fmembers.yaml')).status).toBe(404)
  })
  it('locks an SVG down even on its own', () => {
    expect(assetHeaders('image/svg+xml')['Content-Security-Policy']).toContain('sandbox')
  })
})
