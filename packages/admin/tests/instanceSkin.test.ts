import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstanceSkin, INSTANCE_SKIN_MAX_BYTES } from '../server/instanceSkin.ts'

let repo: string
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'instance-skin-')) })
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('readInstanceSkin', () => {
  it('is empty when the instance carries no skin', () => {
    expect(readInstanceSkin(repo)).toBe('')
  })
  it('reads house/skin.css as written', () => {
    mkdirSync(join(repo, 'house'))
    const css = 'html:root[data-skin="house"] { --accent: #4571e1; }\n'
    writeFileSync(join(repo, 'house', 'skin.css'), css)
    expect(readInstanceSkin(repo)).toBe(css)
  })
  it('refuses a file too large to be a skin', () => {
    mkdirSync(join(repo, 'house'))
    writeFileSync(join(repo, 'house', 'skin.css'), 'x'.repeat(INSTANCE_SKIN_MAX_BYTES + 1))
    expect(readInstanceSkin(repo)).toBe('')
  })
  it('is empty when house/skin.css is a folder', () => {
    mkdirSync(join(repo, 'house', 'skin.css'), { recursive: true })
    expect(readInstanceSkin(repo)).toBe('')
  })
})
