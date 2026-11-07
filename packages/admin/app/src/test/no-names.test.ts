// Names on screen: no file under app/src/test/fixtures/, app/src/parts/, tests/e2e/ or app/e2e/ holds a
// real person's name. The repository is public, so the list of names this guards is never committed: it
// is read from `.org-os/names.local` at the repository root, one name per line (`#` comments and blank
// lines are ignored), matched case-insensitively as whole words. That file is git-ignored. When it is
// absent, the scan is skipped with that reason in its title; the root README ("Run it yourself") says
// how to make one. Test material uses roles and placeholders instead ("Steward A", "Ops lead"…).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const admin = fileURLToPath(new URL('../../../', import.meta.url))
const root = join(admin, '..', '..')
const LIST = join(root, '.org-os', 'names.local')

/** The names in a names.local text: one per line, `#` starts a comment, blank lines are skipped. */
function namesIn(text: string): string[] {
  return text.split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean)
}

/** The names found in `text`, each as a whole word (letters, digits or `_` on neither side), any case,
 *  and any run of white space where the name has one. */
function namesFound(text: string, names: string[]): string[] {
  return names.filter(n => {
    const body = n.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu').test(text)
  })
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(e => { const p = join(dir, e); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}

describe('names on screen', () => {
  it('reads names.local: one per line, comments and blank lines ignored', () => {
    expect(namesIn('# who\nZed Quill\n\n  Orla  # trailing\n#Nobody\n')).toEqual(['Zed Quill', 'Orla'])
  })

  it('matches a name as a whole word in any case, and nothing inside another word (the check can fail)', () => {
    expect(namesFound('signed by zed  QUILL today', ['Zed Quill'])).toEqual(['Zed Quill'])
    expect(namesFound('"orla"', ['Orla'])).toEqual(['Orla'])
    expect(namesFound('orlando and zedquill', ['Orla', 'Zed Quill'])).toEqual([])
  })

  const has = existsSync(LIST)
  const title = has
    ? 'no fixture, /parts file or e2e file holds a name listed in .org-os/names.local'
    : 'skipped: .org-os/names.local is absent — see the root README, “Run it yourself”'
  it.skipIf(!has)(title, () => {
    const names = namesIn(readFileSync(LIST, 'utf8'))
    expect(names.length).toBeGreaterThan(0)
    // the e2e scripts and anything textual under app/e2e (its stored shots are images, git-ignored; E-99)
    const e2e = [join(admin, 'tests/e2e'), join(admin, 'app/e2e')].filter(existsSync).flatMap(filesUnder).filter(f => !/\.(png|webp)$/.test(f))
    const files = [...filesUnder(join(admin, 'app/src/test/fixtures')), ...filesUnder(join(admin, 'app/src/parts')), ...e2e]
    expect(files.length).toBeGreaterThan(20)
    const hits = files.flatMap(f => namesFound(readFileSync(f, 'utf8'), names).map(n => `${f.slice(admin.length)}: ${n}`))
    expect(hits).toEqual([])
  })
})
