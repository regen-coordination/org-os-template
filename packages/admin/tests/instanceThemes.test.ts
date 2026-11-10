import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstanceThemes, INSTANCE_THEMES_MAX, INSTANCE_THEMES_PATH } from '../server/instanceThemes.ts'
import { readInstanceSkin } from '../server/instanceSkin.ts'
import { createApp } from '../server/app.ts'

let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'instance-themes-')); mkdirSync(join(repo, 'house')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))
const write = (name: string, text: string) => writeFileSync(join(repo, 'house', name), text)

describe('readInstanceThemes', () => {
  it('offers none when the instance names none', () => {
    expect(readInstanceThemes(repo)).toEqual({ themes: [] })
  })
  it('reads the themes in order, each with its scheme, a note kept', () => {
    write('themes.yaml', 'themes:\n  - { id: dawn, label: Dawn, scheme: light, note: Soft morning light }\n  - { id: deep, label: Deep, scheme: dark }\n')
    expect(readInstanceThemes(repo)).toEqual({ themes: [
      { id: 'dawn', label: 'Dawn', scheme: 'light', note: 'Soft morning light' },
      { id: 'deep', label: 'Deep', scheme: 'dark' },
    ] })
  })
  it('leaves out a theme with a bad id, no label, an unknown scheme, or an id already taken', () => {
    write('themes.yaml', [
      'themes:',
      '  - { id: "Bad Id", label: Bad, scheme: dark }',
      '  - { id: "x\\"><script>", label: X, scheme: dark }',
      '  - { id: nolabel, scheme: dark }',
      '  - { id: dusk, label: Dusk, scheme: sepia }',
      '  - { id: ok, label: Ok, scheme: dark }',
      '  - { id: ok, label: Again, scheme: light }',
      '',
    ].join('\n'))
    expect(readInstanceThemes(repo).themes.map(t => t.id)).toEqual(['ok'])
  })
  it(`offers at most ${INSTANCE_THEMES_MAX}, and none from a file that is not a list of themes`, () => {
    write('themes.yaml', `themes:\n${Array.from({ length: 12 }, (_, i) => `  - { id: t${i}, label: T${i}, scheme: dark }`).join('\n')}\n`)
    expect(readInstanceThemes(repo).themes).toHaveLength(INSTANCE_THEMES_MAX)
    write('themes.yaml', 'themes: [unclosed\n')
    expect(readInstanceThemes(repo)).toEqual({ themes: [] })
    write('themes.yaml', '- { id: a, label: A, scheme: dark }\n')
    expect(readInstanceThemes(repo)).toEqual({ themes: [] })
  })
  it('is answered at /api/house/themes', async () => {
    write('themes.yaml', 'themes:\n  - { id: deep, label: Deep, scheme: dark }\n')
    const res = await createApp(repo).request(INSTANCE_THEMES_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ themes: [{ id: 'deep', label: 'Deep', scheme: 'dark' }] })
  })
})

describe('the instance skin with its themes', () => {
  it("serves the themes' CSS after the skin's, and either alone", () => {
    write('themes.css', 'html:root[data-skin][data-theme][data-org-theme="deep"] { --accent: #6b91f0; }\n')
    expect(readInstanceSkin(repo)).toContain('data-org-theme="deep"')
    write('skin.css', 'html:root[data-skin="house"] { --accent: #3458b8; }\n')
    const css = readInstanceSkin(repo)
    expect(css.indexOf('#3458b8')).toBeLessThan(css.indexOf('#6b91f0'))
  })
})
