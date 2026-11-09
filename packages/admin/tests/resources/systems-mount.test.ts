import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { systems } from '../../server/resources/adapters/systems.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => {
  repo = makeFixtureRepo()
  const site = join(repo, 'repos', 'site')
  mkdirSync(site, { recursive: true })
  execSync('git init -q -b main && echo x > a.txt && git add a.txt && git -c user.name=T -c user.email=t@x commit -q -m init && echo y >> a.txt', { cwd: site })
  writeFileSync(join(repo, 'data', 'systems.yaml'), [
    'schema_version: "1.0"', 'systems:',
    '  - id: site', '    kind: repo', '    name: Site', '    url: https://github.com/x/site', '    mount: repos/site',
    '  - id: later', '    kind: repo', '    name: Later', '    url: https://github.com/x/later', '    mount: repos/later',
    '  - id: escape', '    kind: repo', '    name: Escape', '    url: https://github.com/x/e', '    mount: ../outside', '',
  ].join('\n'))
})
afterEach(() => removeFixtureRepo(repo))

const ctx = (): AdapterContext => ({ repo, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })

describe('systems adapter: mounts', () => {
  it('reads a clone, and says when there is none', async () => {
    const g = (await systems.read(ctx())) as Graph
    const by = (id: string) => g.nodes.find(n => n.id === `system:${id}`)!
    expect(by('site').facts.mount).toMatchObject({ path: 'repos/site', cloned: true, branch: 'main', dirty: true })
    expect(by('later').facts.mount).toEqual({ path: 'repos/later', cloned: false })
    expect(by('escape').facts.mount).toEqual({ path: '../outside', cloned: false })
  })
})
