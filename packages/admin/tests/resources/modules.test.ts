import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { modules, splitChecks } from '../../server/resources/adapters/modules.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))
const ctx = (r: string): AdapterContext => ({ repo: r, now: () => new Date(), run: runCommand, lastOk: () => null })

const manifest = (dir: string, body: string) => {
  mkdirSync(join(repo, 'modules', dir), { recursive: true })
  writeFileSync(join(repo, 'modules', dir, 'module.yaml'), body)
}

describe('modules adapter', () => {
  it('says so when there is no modules/ directory', async () => {
    expect(await modules.read(ctx(repo))).toEqual({ absent: 'No modules here (no modules/ directory)' })
  })

  it('checks file-exists in process, lists command checks without running them, links dependencies', async () => {
    writeFileSync(join(repo, 'present.md'), 'x')
    manifest('org-os-a', ['id: org-os-a', 'version: 0.1.0', 'type: integration', 'dependencies: [org-os-b]', 'checks:',
      '  - file-exists: present.md', '  - file-exists: missing.md', '  - file-exists: ../outside.md', '  - command: npm run a:doctor', ''].join('\n'))
    manifest('org-os-b', 'id: org-os-b\nversion: 1.0.0\n')
    const g = (await modules.read(ctx(repo))) as Graph
    const a = g.nodes.find(n => n.id === 'module:org-os-a')!
    expect(a).toMatchObject({ kind: 'module', board: 'systems', name: 'org-os-a', status: '0.1.0',
      attention: { level: 'alert', text: 'check fails: missing.md missing (+1 more)' } })
    expect(a.facts).toMatchObject({ type: 'integration', fileChecks: ['present.md', 'missing.md', '../outside.md'],
      commandChecks: ['npm run a:doctor'], failing: ['missing.md missing', '../outside.md is outside the repository'] })
    expect(g.edges).toEqual([{ from: 'module:org-os-a', to: 'module:org-os-b', kind: 'depends-on' }])
  })

  it('turns an unreadable manifest into its own card', async () => {
    manifest('broken', 'id: [unclosed\n')
    const g = (await modules.read(ctx(repo))) as Graph
    expect(g.nodes[0]).toMatchObject({ id: 'absent:modules:broken', kind: 'absent', name: 'modules/broken/module.yaml' })
  })

  it('splitChecks ignores shapes it does not know', () => {
    expect(splitChecks([{ 'file-exists': 'a' }, { command: 'b' }, 'c', null, { other: 1 }])).toEqual({ fileChecks: ['a'], commandChecks: ['b'] })
    expect(splitChecks(undefined)).toEqual({ fileChecks: [], commandChecks: [] })
  })

  it('reads this repository\'s real modules', async () => {
    const g = (await modules.read(ctx(REAL_REPO))) as Graph
    expect(g.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['module:org-os-buzz', 'module:org-os-instance-doctor']))
  })
})
