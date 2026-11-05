import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { galleryCompare } from './gallery-compare.mts'

// Every directory here is a fresh temporary one: the refusal runs git, and never in this repository.
const made: string[] = []
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d }
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }) })

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
function sources() {
  const gallery = temp('gc-gallery-'), shots = temp('gc-shots-')
  writeFileSync(join(gallery, 'tokens-1440-light.png'), PNG)
  writeFileSync(join(gallery, 'frame-390-dark.png'), PNG)
  writeFileSync(join(shots, 'tokens-1440-light.png'), PNG)
  return { gallery, shots }
}

describe('gallery-compare', () => {
  it('refuses an out-dir inside a git working tree (exit 2), and writes nothing there', () => {
    const repo = temp('gc-repo-')
    execFileSync('git', ['init', '-q', repo])
    const out = join(repo, 'compare')
    const said: string[] = []
    expect(galleryCompare({ out, ...sources(), say: s => said.push(s) })).toBe(2)
    expect(existsSync(out)).toBe(false)
    expect(said.join('\n')).toMatch(/inside a git working tree/)
  })

  it('refuses a directory that does not exist yet when its parent is in a working tree', () => {
    const repo = temp('gc-repo-')
    execFileSync('git', ['init', '-q', repo])
    mkdirSync(join(repo, 'a'))
    expect(galleryCompare({ out: join(repo, 'a', 'b', 'c'), ...sources(), say: () => {} })).toBe(2)
    expect(existsSync(join(repo, 'a', 'b'))).toBe(false)
  })

  it('refuses an out-dir inside a repository’s .git directory too, where --is-inside-work-tree says false (L4a final review M-20)', () => {
    const repo = temp('gc-repo-')
    execFileSync('git', ['init', '-q', repo])
    const out = join(repo, '.git', 'compare')
    expect(galleryCompare({ out, ...sources(), say: () => {} })).toBe(2)
    expect(existsSync(out)).toBe(false)
  })

  it('allows an out-dir outside any repository even when the caller’s environment names one (GIT_DIR)', () => {
    const repo = temp('gc-repo-')
    execFileSync('git', ['init', '-q', repo])
    const before = process.env.GIT_DIR
    process.env.GIT_DIR = join(repo, '.git')
    try {
      const out = join(temp('gc-out-'), 'compare')
      expect(galleryCompare({ out, ...sources(), say: () => {} })).toBe(0)
    } finally { if (before === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = before }
  })

  it('pairs each gallery shot with this build’s, side by side, copying both', () => {
    const out = join(temp('gc-out-'), 'compare')
    expect(galleryCompare({ out, ...sources(), say: () => {} })).toBe(0)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(existsSync(join(out, 'gallery', 'tokens-1440-light.png'))).toBe(true)
    expect(existsSync(join(out, 'house', 'tokens-1440-light.png'))).toBe(true)
    expect(html).toContain('gallery/tokens-1440-light.png')
    expect(html).toContain('house/tokens-1440-light.png')
    // a shot not taken yet says so, beside the gallery's
    expect(html).toContain('gallery/frame-390-dark.png')
    expect(html).toMatch(/frame-390-dark[\s\S]*not shot yet/)
  })
})
