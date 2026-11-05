import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { validateRepo, type Problem } from '../../lib/data-validate.mjs'

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function instance(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-receipts-'))
  made.push(dir)
  mkdirSync(join(dir, 'data'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'data', name), text)
  return dir
}
const errorsOf = (ps: Problem[]) => ps.filter(p => p.level === 'error')

const sealed = (over: Record<string, unknown> = {}) => ({
  id: 'board-onboarding', entry: 'board:onboarding', version: '1.0.0', shelf: 'framework',
  created: [{ record: 'boards:onboarding', base: 'a'.repeat(64) }],
  status: 'installed', by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_x' }, removed: null,
  ...over,
})
const run = (...receipts: unknown[]) => errorsOf(validateRepo(instance({ 'library.yaml': stringify({ schema_version: '1.0', installed: receipts }) })))

describe('validateRepo and data/library.yaml (DAO-OS L1)', () => {
  it('an instance with no file is silent', () => {
    expect(validateRepo(instance({})).filter(p => p.file === 'data/library.yaml')).toEqual([])
  })
  it('a sealed receipt gives no problem', () => expect(run(sealed())).toEqual([]))
  it('a sealed removal gives no problem', () => {
    expect(run(sealed({ status: 'removed', removed: { by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } } }))).toEqual([])
  })
  it('a receipt committed without its decision is one error', () => {
    expect(run(sealed({ decision: null }))).toEqual([{
      file: 'data/library.yaml', id: 'board-onboarding', path: 'decision', level: 'error',
      message: 'this receipt was committed without its decision; it was not written by the platform. Correct it by hand from the commit that added it.',
    }])
  })
  it.each([
    ['a status outside installed and removed', sealed({ status: 'adopted' }), /status/],
    ['a field no receipt has (the shape is closed)', sealed({ commit: 'abc' }), /additional/i],
    ['an entry id that is not <kind>:<slug>', sealed({ entry: 'Onboarding' }), /entry/],
    ['a version that is not semver', sealed({ version: 'one' }), /version/],
    ['no created records', sealed({ created: [] }), /created/],
    ['a base that is not 64 hex', sealed({ created: [{ record: 'boards:onboarding', base: 'abc' }] }), /created\.0\.base/],
    ['a decision that is both kinds', sealed({ decision: { rule: 'records/direct', change: 'chg_x', proposal: 'p-2026-10-30-001' } }), /decision/],
    ['a removed receipt with no removed', sealed({ status: 'removed', removed: null }), /removed/],
  ])('fails %s', (_name, receipt, pattern) => {
    const found = run(receipt)
    expect(found.length, 'it must fail').toBeGreaterThan(0)
    expect(found.map(p => `${p.path}: ${p.message}`).join('\n')).toMatch(pattern)
    expect(found.every(p => p.file === 'data/library.yaml')).toBe(true)
  })
})
