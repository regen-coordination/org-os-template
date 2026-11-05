import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { systems as systemsAdapter } from '../../server/resources/adapters/systems.ts'
import { records } from '../../server/resources/adapters/records.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { link } from '../../server/systems/link.ts'
import type { Driver } from '../../server/systems/driver.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const NOW = new Date('2026-10-16T09:00:00Z')
/** Stands in for the Safe driver here: no network, nothing to report. */
const quiet: Driver = { name: 'quiet', hosts: [], async read(_s, ctx) { return { ok: true, readAt: ctx.now().toISOString(), facts: {}, sections: [], open: null } } }
const SYSTEMS = `schema_version: "1.0"
systems:
  - id: "drive"
    kind: "docs"
    name: "Shared drive"
    url: "https://drive.example.org/folder"
    driver: "link"
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60"
    driver: "quiet"
    section: "organization/treasury"
`
const ctx = (): AdapterContext => ({ repo, now: () => NOW, run: runCommand, lastOk: () => null, systems: new SystemReader({ repo, now: () => NOW, drivers: [link, quiet] }) })
const read = async (text = SYSTEMS) => {
  writeFileSync(join(repo, 'data', 'systems.yaml'), text)
  return (await systemsAdapter.read(ctx())) as Graph
}
const addOrgMember = () => {
  const path = join(repo, 'data', 'members.yaml')
  writeFileSync(path, `${readFileSync(path, 'utf8')}  - id: "fixture-org"\n    name: "Fixture Org"\n    kind: "organization"\n`)
}

describe('the systems adapter', () => {
  it('turns each entry into a system resource, placed by its section', async () => {
    const g = await read()
    expect(g.nodes.map(n => [n.id, n.kind, n.board])).toEqual([['system:drive', 'system', 'systems'], ['system:treasury-safe', 'system', 'organization']])
    expect(g.nodes[0]).toMatchObject({
      name: 'Shared drive', status: 'docs', attention: null,
      source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'drive' },
      facts: { kind: 'docs', url: 'https://drive.example.org/folder', driver: { ok: true, sections: [], open: { url: 'https://drive.example.org/folder', embeddable: false } } },
    })
    expect(g.nodes[0]!.facts.driver).toMatchObject({ state: 'fresh' })
  })

  it('a Safe is held by the org: its organization member if it has one, else this instance', async () => {
    expect((await read()).edges).toEqual([{ from: 'system:treasury-safe', to: 'instance:fixture-org', kind: 'held-by' }])
    addOrgMember()
    expect((await read()).edges).toEqual([{ from: 'system:treasury-safe', to: 'person:fixture-org', kind: 'held-by' }])
  })

  it('the store keeps the held-by edge only when the holder is on the map', async () => {
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
    const without = await new ResourceStore(ctx(), [records, systemsAdapter]).graph()
    expect(without.edges.filter(e => e.kind === 'held-by')).toEqual([])
    addOrgMember()
    const withOrg = await new ResourceStore(ctx(), [records, systemsAdapter]).graph()
    expect(withOrg.edges.filter(e => e.kind === 'held-by')).toEqual([{ from: 'system:treasury-safe', to: 'person:fixture-org', kind: 'held-by' }])
  })

  it('no systems.yaml: no cards at all, so every instance\'s systems board stays as it was', async () => {
    expect(await systemsAdapter.read(ctx())).toEqual({ nodes: [], edges: [] })
  })

  it('a link that is not http or https is a failed read, never an address to open (Review Focus 4)', async () => {
    const g = await read(SYSTEMS.replace('https://drive.example.org/folder', 'javascript:alert(1)'))
    expect(g.nodes[0]!.facts.driver).toMatchObject({ ok: false, open: null, error: 'only http and https addresses are opened, not javascript:' })
    expect(g.nodes[0]!.attention).toEqual({ level: 'warn', text: 'read failed: only http and https addresses are opened, not javascript:' })
  })

  it('facts.url is there only when it is an http or https address', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'not an address']) {
      const g = await read(SYSTEMS.replace('https://drive.example.org/folder', url))
      expect(g.nodes[0]!.facts).not.toHaveProperty('url')
    }
    expect((await read(SYSTEMS.replace('https://drive.example.org/folder', 'http://drive.example.org/x'))).nodes[0]!.facts.url).toBe('http://drive.example.org/x')
    expect((await read()).nodes[1]!.facts).not.toHaveProperty('url') // the Safe has none
  })

  it('an embeddable link says so', async () => {
    const g = await read(SYSTEMS.replace('    driver: "link"\n', '    driver: "link"\n    embeddable: true\n'))
    expect(g.nodes[0]!.facts.driver).toMatchObject({ open: { url: 'https://drive.example.org/folder', embeddable: true } })
  })

  it('an entry with no id, or an id several entries share, is not a resource; a numeric id is one', async () => {
    const g = await read(`schema_version: "1.0"
systems:
  - kind: "docs"
    name: "No id"
    url: "https://a.example.org"
  - id: "twin"
    kind: "docs"
    name: "First twin"
    url: "https://b.example.org"
  - id: "twin"
    kind: "docs"
    name: "Second twin"
    url: "https://c.example.org"
  - id: 42
    kind: "docs"
    name: "Numbered"
    url: "https://d.example.org"
`)
    expect(g.nodes.map(n => n.id)).toEqual(['system:42'])
    expect(g.nodes[0]!.source).toMatchObject({ entityId: '42' })
  })
})
