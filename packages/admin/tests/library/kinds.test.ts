// DAO-OS L7 (spec §5.1): the library's two new kinds, `template` and `wizard`, and L1's minors on the placeholder
// grammar, receipts and object placeholders. The test shelf is copied into a temporary directory before any edit.
import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadShelf } from '../../server/library/read.ts'
import { resolveInstalls } from '../../server/library/config.ts'
import type { LibraryEntry } from '../../server/library/types.ts'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
const OWNERS = ['eip155:11155111:0x00000000000000000000000000000000000000a1', 'eip155:11155111:0x00000000000000000000000000000000000000a2']
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const copy = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'kinds-'))
  dirs.push(dir)
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}
const edit = (file: string, from: string, to: string) => {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(from)) throw new Error(`the fixture holds no "${from}"`)
  writeFileSync(file, text.replace(from, to))
}
const council = (): LibraryEntry => loadShelf(FIXTURE, new Set()).entries.find(e => e.id === 'template:test-council')!
const TEMPLATE = 'template/test-council/entry.yaml'

describe('the test shelf serves a template and a wizard', () => {
  it('lists template:test-council on the template shelf and wizard:test-compose on the wizard shelf', () => {
    const shelf = loadShelf(FIXTURE, new Set())
    expect(shelf.problems).toEqual([])
    expect(shelf.entries.map(e => [e.id, e.shelf])).toEqual([
      ['board:test-desk', 'board'], ['system:test-link', 'system'], ['template:test-council', 'template'], ['wizard:test-compose', 'wizard'],
    ])
    expect(shelf.entries.find(e => e.id === 'wizard:test-compose')!.wizard).toBe('wizard.yaml')
  })
})

describe('placeholders (L1 minor: the grammar is the config property names)', () => {
  it('resolves a camelCase ${config.chainId} in an install', () => {
    const { ops, errors } = resolveInstalls(council(), { owners: OWNERS, threshold: 2 })
    expect(errors).toEqual([])
    expect(ops[0]!.value).toMatchObject({ chain: 'eip155:11155111', name: 'Test DAO Safe' })
    expect(ops[1]!.value).toMatchObject({ chain: 'eip155:11155111' })
  })

  it('leaves ${hat.…} as text: only ${config.…} is resolved at add', () => {
    const { ops } = resolveInstalls(council(), { owners: OWNERS, threshold: 2 })
    const deployment = ops[0]!.value!.deployment as { on_deploy: { roles: Record<string, { hat: string }> } }
    expect(deployment.on_deploy.roles.council!.hat).toBe('${hat.test-dao-roles/council}')
  })

  it('gives each use of an object placeholder its own copy', () => {
    const { ops } = resolveInstalls(council(), { owners: OWNERS, threshold: 2 })
    const owners = (ops[0]!.value!.deployment as { owners: string[] }).owners
    const wearers = (ops[1]!.value!.hats as { wearers: string[] }[])[0]!.wearers
    expect(owners).toEqual(OWNERS)
    expect(wearers).toEqual(OWNERS)
    expect(wearers).not.toBe(owners)
  })

  it('refuses an entry whose ${config.} names nothing', () => {
    const dir = copy()
    edit(join(dir, TEMPLATE), 'salt: "1"', 'salt: "${config.}"')
    const shelf = loadShelf(dir, new Set())
    expect(shelf.entries.map(e => e.id)).not.toContain('template:test-council')
    expect(shelf.problems).toEqual([{ shelf: 'test-shelf', sentence: 'template:test-council: "${config.}" names no property of config.' }])
  })

  it('refuses an entry whose ${config.not_in_config} is not a property of its config', () => {
    const dir = copy()
    edit(join(dir, TEMPLATE), 'salt: "1"', 'salt: "${config.not_in_config}"')
    expect(loadShelf(dir, new Set()).problems).toEqual([{ shelf: 'test-shelf', sentence: 'template:test-council: "${config.not_in_config}" names no property of config.' }])
  })
})

describe('what an entry may not install', () => {
  it('an install on library: is refused: receipts are the library\'s own', () => {
    const dir = copy()
    edit(join(dir, TEMPLATE), 'record: "boards:${config.id}-council"', 'record: library:x')
    const shelf = loadShelf(dir, new Set())
    expect(shelf.entries.map(e => e.id)).not.toContain('template:test-council')
    expect(shelf.problems).toEqual([{ shelf: 'test-shelf', sentence: 'template:test-council: an entry never writes receipts (library:).' }])
  })
})

describe('a wizard entry', () => {
  it('names a wizard.yaml inside its own folder', () => {
    const dir = copy()
    edit(join(dir, 'wizard/test-compose/entry.yaml'), 'wizard: wizard.yaml', 'wizard: ../../template/test-council/entry.yaml')
    expect(loadShelf(dir, new Set()).problems).toEqual([{ shelf: 'test-shelf', sentence: 'wizard:test-compose: its wizard ../../template/test-council/entry.yaml is not a file in its folder.' }])
  })

  it('whose wizard.yaml is missing is refused', () => {
    const dir = copy()
    edit(join(dir, 'wizard/test-compose/entry.yaml'), 'wizard: wizard.yaml', 'wizard: nope.yaml')
    expect(loadShelf(dir, new Set()).problems).toEqual([{ shelf: 'test-shelf', sentence: 'wizard:test-compose: its wizard nope.yaml is not a file in its folder.' }])
  })

  it('whose wizard.yaml is not a wizard is refused with what is wrong', () => {
    const dir = copy()
    edit(join(dir, 'wizard/test-compose/wizard.yaml'), 'title: Compose a test council\n', '')
    expect(loadShelf(dir, new Set()).problems).toEqual([{ shelf: 'test-shelf', sentence: 'wizard:test-compose: wizard.yaml: The wizard has no title.' }])
  })

  it('a wizard on another shelf than wizard is refused by the entry schema', () => {
    const dir = copy()
    edit(join(dir, 'board/test-desk/entry.yaml'), 'as_of: 2026-10-29\n', 'as_of: 2026-10-29\nwizard: wizard.yaml\n')
    const problems = loadShelf(dir, new Set()).problems
    expect(problems).toHaveLength(1)
    expect(problems[0]!.sentence).toMatch(/board\/test-desk\/entry\.yaml: .*library\/entry\.schema\.json/)
  })
})
