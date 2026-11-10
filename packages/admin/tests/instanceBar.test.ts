import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstanceBar, INSTANCE_BAR_MAX_BYTES, INSTANCE_BAR_MAX_SITES, INSTANCE_BAR_PATH } from '../server/instanceBar.ts'
import { createApp } from '../server/app.ts'

let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'instance-bar-')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))
const write = (yaml: string) => { mkdirSync(join(repo, 'house'), { recursive: true }); writeFileSync(join(repo, 'house', 'bar.yaml'), yaml) }

describe('readInstanceBar', () => {
  it('has no sites when the instance carries no bar', () => {
    expect(readInstanceBar(repo)).toEqual({ label: null, sites: [] })
  })
  it('reads the sites in order, the current one marked, a note kept', () => {
    write('label: Example Org\nsites:\n  - { label: Knowledge, href: "https://knowledge.example.org", note: What we know }\n  - { label: House, href: /, current: true }\n')
    expect(readInstanceBar(repo)).toEqual({ label: 'Example Org', sites: [
      { label: 'Knowledge', href: 'https://knowledge.example.org', current: false, note: 'What we know' },
      { label: 'House', href: '/', current: true },
    ] })
  })
  it('leaves out a site with no label or with an address that is not a link', () => {
    write('sites:\n  - { href: "https://a.example" }\n  - { label: Script, href: "javascript:alert(1)" }\n  - { label: Other host, href: "//evil.example" }\n  - { label: Data, href: "data:text/html,hi" }\n  - just words\n  - { label: Kept, href: /b/projects }\n')
    expect(readInstanceBar(repo).sites).toEqual([{ label: 'Kept', href: '/b/projects', current: false }])
  })
  it('marks only the first site that says it is current', () => {
    write('sites:\n  - { label: A, href: /a, current: true }\n  - { label: B, href: /b, current: true }\n')
    expect(readInstanceBar(repo).sites.map(s => s.current)).toEqual([true, false])
  })
  it(`keeps at most ${INSTANCE_BAR_MAX_SITES} sites`, () => {
    write('sites:\n' + Array.from({ length: 12 }, (_, i) => `  - { label: S${i}, href: /s${i} }\n`).join(''))
    expect(readInstanceBar(repo).sites).toHaveLength(INSTANCE_BAR_MAX_SITES)
  })
  it.each([['not YAML', 'sites: [ {'], ['a list', '- a\n- b\n'], ['no sites', 'label: Example Org\n'], ['words', 'hello']])('has no sites when the file is %s', (_, yaml) => {
    write(yaml)
    expect(readInstanceBar(repo).sites).toEqual([])
  })
  it('refuses a file too large to be a bar', () => {
    write('sites:\n  - { label: A, href: /a }\n#' + 'x'.repeat(INSTANCE_BAR_MAX_BYTES))
    expect(readInstanceBar(repo).sites).toEqual([])
  })
})

describe(`GET ${INSTANCE_BAR_PATH}`, () => {
  it('answers the instance bar, and no sites when there is none', async () => {
    const app = createApp(repo)
    expect(await (await app.request(INSTANCE_BAR_PATH)).json()).toEqual({ label: null, sites: [] })
    write('sites:\n  - { label: House, href: /, current: true }\n')
    const res = await app.request(INSTANCE_BAR_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ label: null, sites: [{ label: 'House', href: '/', current: true }] })
  })
})
