import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
let sibling: string
beforeEach(() => {
  repo = makeFixtureRepo()
  sibling = join(dirname(repo), `${basename(repo)}-sibling`)
  mkdirSync(sibling)
  // A real file, not an empty commit: `git log -- .` only sees commits that touch files.
  execSync('git init -q -b main && echo x > README.md && git add README.md && git -c user.name=Peer -c user.email=p@x commit -q -m init', { cwd: sibling })
})
afterEach(() => { removeFixtureRepo(repo); rmSync(sibling, { recursive: true, force: true }) })

const ctx = (r = repo): AdapterContext => ({ repo: r, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })

describe('fleet adapter', () => {
  it("draws this instance's own card alone when there is no fleet", async () => {
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.map(n => n.id)).toEqual(['instance:fixture-org'])
    expect(g.nodes[0]).toMatchObject({ name: 'Fixture Org', status: 'this instance', facts: expect.objectContaining({ self: true, localPath: repo }) })
    expect(g.edges).toEqual([])
  })

  // Final review M4: a peer whose id is this instance's own (a federation.yaml that lists itself) replaced the self card
  // with a peer one, and Sync and Share, offered on the self card, went with it.
  it('skips a federation peer whose id is this instance\'s own: one card for it, the self one', async () => {
    writeFileSync(join(repo, 'federation.yaml'), [
      'identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:',
      '  - name: Fixture Org itself', '    repo: someone/fixture-org', '    trust: read',
      '  - name: Far Away', '    repo: someone/far-away', '    trust: read', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.filter(n => n.id === 'instance:fixture-org')).toHaveLength(1)
    expect(g.nodes.find(n => n.id === 'instance:fixture-org')).toMatchObject({ status: 'this instance', facts: expect.objectContaining({ self: true }) })
    expect(g.nodes.map(n => n.id)).toEqual(['instance:fixture-org', 'instance:far-away'])
    expect(g.edges).toEqual([{ from: 'instance:far-away', to: 'instance:fixture-org', kind: 'federation' }])
  })

  it('reads federation peers, with this instance as the hub they link to', async () => {
    writeFileSync(join(repo, 'federation.yaml'), [
      'identity:', '  name: "Fixture Org"', '  slug: fixture-org', '  type: PersonalNode', 'peers:',
      `  - name: Sibling`, `    repo: ../${basename(sibling)}`, '    trust: read', '    relationship: host-cooperative',
      '  - name: Far Away', '    repo: someone/far-away', '    url: https://github.com/someone/far-away', '    trust: read', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:fixture-org')).toMatchObject({ name: 'Fixture Org', status: 'this instance',
      facts: expect.objectContaining({ self: true, localPath: repo }) })
    expect(g.nodes.find(n => n.id === `instance:${basename(sibling)}`)).toMatchObject({ name: 'Sibling', status: 'host-cooperative',
      changed: expect.objectContaining({ by: 'Peer' }), facts: expect.objectContaining({ localPath: sibling }) })
    expect(g.nodes.find(n => n.id === 'instance:far-away')).toMatchObject({ status: 'read', changed: null,
      facts: expect.objectContaining({ localPath: null }) })
    expect(g.edges).toContainEqual({ from: 'instance:far-away', to: 'instance:fixture-org', kind: 'federation' })
  })

  it('prefers data/instances.yaml, skips its own entry, and warns on drift', async () => {
    writeFileSync(join(repo, 'data', 'instances.yaml'), [
      'instances:', '  - id: fixture-org', '    name: Me', '  - id: example-coop-os', '    name: Example Coop', '    maturity: production',
      `    local_path: ../${basename(sibling)}`, '    last_sync: "2026-10-14"', '    drift: ["framework_version behind"]', '',
    ].join('\n'))
    const g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.map(n => n.id).sort()).toEqual(['instance:example-coop-os', 'instance:fixture-org'])
    expect(g.nodes.find(n => n.id === 'instance:example-coop-os')).toMatchObject({ status: 'production',
      attention: { level: 'warn', text: '1 drift item' }, facts: expect.objectContaining({ localPath: sibling }) })
  })

  it('reads this repository\'s real fleet', async () => {
    const g = (await fleet.read(ctx(REAL_REPO))) as Graph
    expect(g.nodes.filter(n => n.kind === 'instance').length).toBeGreaterThan(1)
  })
})
