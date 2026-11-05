import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo, SYSTEMS_YAML } from '../fixtures.ts'
import { loadEntries, loadLibrary } from '../../server/library/read.ts'
import { previewEntry, listEntries, cannotAdd } from '../../server/library/preview.ts'
import { listReceipts } from '../../server/library/remove.ts'
import { makeSyntheticRepo } from '../changes/fixtures.ts'
import type { StageOp } from '../../server/changes/types.ts'
import { resolveActor } from '../../server/actor.ts'
import { DRIVERS } from '../../server/systems/drivers.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const entry = (id: string) => loadEntries().find(e => e.id === id)!
const preview = async (id: string) => previewEntry(repo, entry(id), await resolveActor(repo))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

describe('preview = prepare: what adding would change, without adding it', () => {
  it('says what a board template adds: its record, its blocks, and the class it is decided in', async () => {
    const p = await preview('board:onboarding')
    expect(p.refusal).toBeNull()
    expect(p.adds).toEqual([expect.objectContaining({ record: 'boards:onboarding', op: 'create', class: 'records' })])
    expect(p.blocks.map(b => b.type)).toEqual(expect.arrayContaining(['note', 'list']))
    expect(p.decided).toEqual([{ class: 'records', direct: true, sentence: 'the maintainer decides alone' }])
    expect(p.source).toMatchObject({ name: 'framework', version: '1.0.0', standing: 'stated', as_of: '2026-10-18' })
  })

  it('says who decides under the rule in force even when the reader is no member, and prints no one\'s email', async () => {
    const p = await previewEntry(repo, entry('board:onboarding'), { unknown: 'someone@example.org' })
    expect(p.decided).toEqual([{ class: 'records', direct: true, sentence: 'the maintainer decides alone' }])
    expect(JSON.stringify(p)).not.toContain('someone@example.org')
  })

  it('writes nothing: no file changes, no commit, no change staged', async () => {
    const before = git('rev-parse', 'HEAD'); const status = git('status', '--porcelain')
    for (const e of loadEntries()) await previewEntry(repo, e, await resolveActor(repo))
    await listEntries(repo)
    listReceipts(repo)
    expect(git('rev-parse', 'HEAD')).toBe(before)
    expect(git('status', '--porcelain')).toBe(status)
  })

  it('a requirement is unmet until the instance has the system kind, then met', async () => {
    let p = await preview('board:treasury-council')
    expect(p.needs).toEqual([{ text: 'a system of kind safe', met: false }])
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML)
    p = await preview('board:treasury-council')
    expect(p.needs).toEqual([{ text: 'a system of kind safe', met: true }])
  })

  // Replaced on purpose (L7 Task 7, cherry-picked): the Safe driver now declares the Transaction Service and each
  // chain's RPC (L7-D15), so the expectation reads its hosts from the driver rather than a hand list.
  it('names the hosts a driver will call, and that it only reads', async () => {
    const hosts = DRIVERS.find(d => d.name === 'safe')!.hosts
    expect(hosts[0]).toBe('api.safe.global')
    expect((await preview('system:safe')).reaches).toEqual(hosts.map(host => ({ host, reads: 'read only' })))
    expect((await preview('system:link')).reaches).toEqual([])
  })

  it('names the Celo RPC and explorer an added hats-tree system will call, each read only', async () => {
    const e = { ...entry('system:safe'), id: 'system:roles', installs: [{ op: 'create' as const, record: 'systems:roles', value: { id: 'roles', kind: 'hats-tree', name: 'Roles', chain: 'eip155:42220', address: '13', driver: 'hats-tree' } }] }
    const p = await previewEntry(repo, e, await resolveActor(repo))
    expect(p.reaches).toEqual(expect.arrayContaining([{ host: 'forno.celo.org', reads: 'read only' }, { host: 'celo.blockscout.com', reads: 'read only' }]))
  })

  it('refuses an id that is already a built-in board, with the sentence and the next free id (§4.5)', async () => {
    const e = { ...entry('board:onboarding'), id: 'board:treasury', installs: [{ op: 'create' as const, record: 'boards:treasury', value: { id: 'treasury', name: 'T', layout: 'flow', blocks: [] } }] }
    const p = await previewEntry(repo, e, await resolveActor(repo))
    expect(p.refusal).toEqual({ sentence: 'A board with the id `treasury` already exists. Add it under another id.', nextFreeId: 'treasury-2' })
  })

  it("refuses an id that is already the instance's own board, and moves past a taken -2", async () => {
    writeFileSync(join(repo, 'data', 'boards.yaml'), 'schema_version: "1.0"\nboards:\n  - id: onboarding\n    name: Mine\n    layout: flow\n    blocks: []\n  - id: onboarding-2\n    name: Mine too\n    layout: flow\n    blocks: []\n')
    const p = await preview('board:onboarding')
    expect(p.refusal?.nextFreeId).toBe('onboarding-3')
  })

  it('refuses a system id the org already has, the same way', async () => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML)
    const p = await preview('system:safe')
    expect(p.refusal).toEqual({ sentence: 'A system with the id `treasury-safe` already exists. Add it under another id.', nextFreeId: 'treasury-safe-2' })
  })

  it('shows a built-in board as already here: nothing to add, and says when the instance replaced it', async () => {
    let p = await preview('board:treasury')
    expect(p.builtin).toBe(true); expect(p.adds).toEqual([]); expect(p.refusal).toBeNull()
    expect(p.note).toBe('Built in: every instance has this board.')
    writeFileSync(join(repo, 'data', 'boards.yaml'), 'schema_version: "1.0"\nboards:\n  - id: treasury\n    name: Ours\n    layout: flow\n    blocks: []\n')
    p = await preview('board:treasury')
    expect(p.note).toBe("Built in. This org's own board of the same id is shown in its place; deleting it restores this one.")
  })

  it('classes a rule set as governance, decided under the rule in force, and says the engine cannot write it yet', async () => {
    const p = await preview('rules:consent-7d')
    expect(p.adds.every(a => a.class === 'governance')).toBe(true)
    expect(p.decided.map(d => d.class)).toEqual(['governance'])
    expect(p.rules.map(r => r.id)).toEqual(['records', 'governance', 'other'])
    expect(p.rules[1]!.sentence).toBe('governance, members, identity, systems, publication: maintainer decides by consent, 7 days to object')
    expect(p.note).toMatch(/cannot edit data\/governance\.yaml yet/)
  })

  it('a rule set that lists classes by name covers every class, publication too (R-L5-2.6)', async () => {
    const { parse } = await import('yaml')
    const { CHANGE_CLASSES } = await import('../../lib/change-classes.mjs')
    const entry = parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'library', 'rules', 'consent-7d', 'entry.yaml'), 'utf8'))
    const covered = entry.installs[0].set.rules.flatMap((r: { applies_to: string[] }) => r.applies_to)
    expect(CHANGE_CLASSES.filter((c: string) => !covered.includes(c))).toEqual([])
  })

  it('says the solo entry adds nothing', async () => {
    const p = await preview('rules:solo')
    expect(p.adds).toEqual([]); expect(p.note).toBe('Adds nothing: this is what an org has until it writes rules.')
  })

  it('asks for what a system kind needs the person to supply', async () => {
    expect((await preview('system:safe')).asks).toEqual(expect.arrayContaining(['id', 'name', 'chain', 'address']))
  })
})

describe('the list the page browses', () => {
  it('says per entry what it adds, and whether it fits this org', async () => {
    let list = await listEntries(repo)
    const council = list.entries.find(e => e.id === 'board:treasury-council')!
    expect(council.adds).toBe('adds 1 board · 4 blocks')
    expect(council.fits).toEqual({ met: false, missing: ['a system of kind safe'] })
    expect(list.entries.find(e => e.id === 'board:onboarding')!.fits).toBeNull()
    expect(list.entries.find(e => e.id === 'board:home')!.installable).toBe(false)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML)
    list = await listEntries(repo)
    expect(list.entries.find(e => e.id === 'board:treasury-council')!.fits).toEqual({ met: true, missing: [] })
  })
  it('counts the shelves and names the sources', async () => {
    const list = await listEntries(repo)
    expect(list.sources).toEqual(['framework'])
    expect(list.shelves.map(s => s.shelf)).toEqual(['board', 'rules', 'system'])
    expect(list.shelves.reduce((n, s) => n + s.count, 0)).toBe(list.entries.length)
  })
  it('lists the shelf even when the instance has an unreadable systems file, and leaves that file as it was', async () => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), 'systems: [unclosed\n')
    const list = await listEntries(repo)
    expect(list.entries.length).toBeGreaterThan(0)
    expect(readFileSync(join(repo, 'data', 'systems.yaml'), 'utf8')).toContain('unclosed')
  })
})

describe('what a preview says about adding (DAO-OS L1)', () => {
  const SHELF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
  let org: string
  beforeEach(() => {
    org = makeSyntheticRepo()
    writeFileSync(join(org, 'federation.yaml'), `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
  })
  afterEach(() => removeFixtureRepo(org))
  const served = (id: string) => loadLibrary(org).entries.find(e => e.id === id)!
  const look = async (id: string, staged: StageOp[] = []) => previewEntry(org, served(id), await resolveActor(org), staged)

  it('a built-in board: the built-in sentence', async () => {
    expect((await look('board:home')).cannotAdd).toBe('Built in: every instance has this board.')
  })
  it('an entry with nothing to add says so', async () => {
    expect((await look('rules:solo')).cannotAdd).toBe('It adds nothing.')
  })
  it('a rule set: the rules note', async () => {
    expect((await look('rules:consent-7d')).cannotAdd).toBe('Adding a rule set is not available yet: the change engine cannot edit data/governance.yaml yet.')
  })
  it('an entry that changes what the org has, not on the rules shelf, is not added', () => {
    const e = { ...served('board:test-desk'), installs: [{ op: 'update' as const, record: 'boards:test-desk', set: { name: 'X' } }] }
    expect(cannotAdd(org, e, [])).toBe('Adding is built for entries that create records; this one changes records the org already has, and removing that is not built yet.')
  })
  it('a raw entry: the raw sentence', async () => {
    expect((await look('board:onboarding')).cannotAdd).toBe('This entry is raw: the library shows it and does not add it.')
  })
  it('a sound entry from a registered shelf can be added', async () => {
    const p = await look('board:test-desk')
    expect(p.cannotAdd).toBeNull()
    expect(p.receipts).toEqual([])
  })
  it('lists what the entry asks for, with defaults and whether each is required', async () => {
    const p = await look('system:safe')
    expect(p.fields).toContainEqual({ name: 'id', description: 'The id the org will call it by.', default: 'treasury-safe', required: true })
    expect(p.fields.map(f => f.name)).toEqual(['id', 'name', 'chain', 'address'])
    expect((await look('board:onboarding')).fields).toEqual([])
  })
  it('decides an add by the classes of what the entry creates, the receipt riding along', async () => {
    const p = await look('system:test-link')
    expect(p.decided.map(d => d.class)).toEqual(['systems'])
    expect(p.adds).toEqual([expect.objectContaining({ record: 'systems:test-link', op: 'create', class: 'systems' })])
  })
  it('reads a requirement through the actor\'s own staged change', () => {
    const council = { ...served('board:test-desk'), id: 'board:test-council', requires: ['system-kind:link'] }
    expect(cannotAdd(org, council, [])).toBe('It needs a system of kind link, which this organization does not have yet. Add it first.')
    const staged: StageOp[] = [{ op: 'create', record: 'systems:desk', value: { id: 'desk', kind: 'link', name: 'Desk', url: 'https://example.org/desk' } }]
    expect(cannotAdd(org, council, staged)).toBeNull()
  })
  it('a taken id, on file or in the staged change, when the entry takes no id: the taken sentence', () => {
    const desk = served('board:test-desk')
    const staged: StageOp[] = [{ op: 'create', record: 'boards:test-desk', value: { id: 'test-desk', name: 'Mine', layout: 'flow', blocks: [] } }]
    expect(cannotAdd(org, desk, staged)).toBe('A board with the id `test-desk` already exists. Add it under another id.')
    writeFileSync(join(org, 'data', 'boards.yaml'), 'schema_version: "1.0"\nboards:\n  - id: test-desk\n    name: Mine\n    layout: flow\n    blocks: []\n')
    expect(cannotAdd(org, desk, [])).toBe('A board with the id `test-desk` already exists. Add it under another id.')
    expect(cannotAdd(org, desk, [{ op: 'delete', record: 'boards:test-desk' }])).toBeNull()
  })
  it('a taken id an entry lets the person change is a refusal with the next free id, not a cannotAdd', async () => {
    writeFileSync(join(org, 'data', 'systems.yaml'), 'schema_version: "1.0"\nsystems:\n  - id: test-link\n    kind: link\n    name: Ours\n    url: https://example.org/ours\n')
    const p = await look('system:test-link')
    expect(p.cannotAdd).toBeNull()
    expect(p.refusal).toEqual({ sentence: 'A system with the id `test-link` already exists. Add it under another id.', nextFreeId: 'test-link-2' })
  })
})
