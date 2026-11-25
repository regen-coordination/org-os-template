import { describe, it, expect } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { folderState, isInstance, resolveFolder, writableFolderProblem } from '../../launcher/folders.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'launcher-folders-'))

describe('folder guards', () => {
  it('follows symlinks and refuses a non-empty target', () => {
    const base = tmp()
    const full = join(base, 'full'); mkdirSync(full); writeFileSync(join(full, 'a.txt'), 'x')
    const link = join(base, 'link'); symlinkSync(full, link)
    expect(folderState(link)).toBe('not-empty')
    expect(writableFolderProblem(resolveFolder('link', dirname(link)))).toMatch(/already has files/)
  })
  it('expands ~ and resolves relative input', () => {
    expect(resolveFolder('~/x', '/base')).toBe(join(homedir(), 'x'))
    expect(resolveFolder('~', '/base')).toBe(homedir())
    expect(resolveFolder('  x  ', '/base')).toBe('/base/x')
    expect(resolveFolder('x', '/base')).toBe('/base/x')
    expect(resolveFolder('/abs/y', '/base')).toBe('/abs/y')
  })
  it('asks which folder when the input is empty', () => {
    expect(() => resolveFolder('   ', '/base')).toThrow('Say which folder.')
  })
  it('says new for a missing path, even with missing parents; empty; and not-a-folder', () => {
    const base = tmp()
    expect(folderState(join(base, 'a/b/c'))).toBe('new')
    expect(writableFolderProblem(join(base, 'a/b/c'))).toBeNull()
    expect(folderState(base)).toBe('empty')
    expect(writableFolderProblem(base)).toBeNull()
    const file = join(base, 'f'); writeFileSync(file, 'x')
    const lone = join(tmp(), 'f'); writeFileSync(lone, 'x')
    expect(folderState(lone)).toBe('not-a-folder')
    expect(writableFolderProblem(lone)).toBe(`${lone} is a file, not a folder.`)
    expect(writableFolderProblem(base)).toBe(`${base} already has files in it. Choose a new or empty folder.`)
  })
  it('refuses a dangling symlink and a path under a regular file instead of calling them new', () => {
    const base = tmp()
    const dangling = join(base, 'dangling'); symlinkSync(join(base, 'nowhere'), dangling)
    expect(folderState(dangling)).toBe('not-a-folder')
    expect(writableFolderProblem(dangling)).not.toBeNull()
    const file = join(base, 'f'); writeFileSync(file, 'x')
    const under = join(file, 'sub')
    expect(folderState(under)).toBe('not-a-folder')
    expect(writableFolderProblem(under)).toBe(`${under} cannot be read. Choose a new or empty folder.`)
  })
  it.skipIf(process.getuid?.() === 0)('refuses an unreadable folder with a sentence instead of throwing', () => {
    const dir = tmp()
    chmodSync(dir, 0o000)
    try {
      expect(folderState(dir)).toBe('not-a-folder')
      expect(writableFolderProblem(dir)).toBe(`${dir} cannot be read. Choose a new or empty folder.`)
      expect(writableFolderProblem(join(dir, 'child'))).toMatch(/cannot be read/)
    } finally { chmodSync(dir, 0o700) }
  })
  it('knows an instance by data/ and federation.yaml', () => {
    const base = tmp()
    expect(isInstance(base)).toBe(false)
    mkdirSync(join(base, 'data'))
    expect(isInstance(base)).toBe(false)
    writeFileSync(join(base, 'federation.yaml'), 'x')
    expect(isInstance(base)).toBe(true)
    const other = tmp()
    writeFileSync(join(other, 'data'), 'x'); writeFileSync(join(other, 'federation.yaml'), 'x')
    expect(isInstance(other)).toBe(false)
  })
})
