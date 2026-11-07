import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateRepo } from '../../lib/data-validate.mjs'
import { REAL_REPO } from '../fixtures.ts'

// The 0.6 migration is standalone (js-yaml only), so it cannot check its own
// output against these schemas. This does: what it writes must validate.
const MIGRATION = join(REAL_REPO, 'scripts', 'migrations', 'v0.5-to-v0.6-canonical-records.mjs')
const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('the data/systems.yaml the 0.6 migration writes', () => {
  it('passes the systems schema, every kind of it', () => {
    const root = mkdtempSync(join(tmpdir(), 'migration-output-'))
    made.push(root)
    mkdirSync(join(root, 'data'))
    writeFileSync(join(root, 'data', 'governance.yaml'), `governance:
  model: "consensus"
  description: "By consent."
  infrastructure:
    safe: "0x1111111111111111111111111111111111111111"
    chain: "eip155:42220"
    gardens: "0x2222222222222222222222222222222222222222"
    hats_tree: 42
    snapshot: "fixture.eth"
`)
    writeFileSync(join(root, 'federation.yaml'), 'identity:\n  name: "Fixture"\n')
    execFileSync('node', [MIGRATION, root], { encoding: 'utf8' })
    expect(readFileSync(join(root, 'data', 'systems.yaml'), 'utf8')).toMatch(/^schema_version: "1\.0"\n/)
    expect(validateRepo(root).filter(p => p.file === 'data/systems.yaml')).toEqual([])
  })
})
