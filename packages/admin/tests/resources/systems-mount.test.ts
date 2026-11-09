import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { systems } from '../../server/resources/adapters/systems.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
let outside: string
beforeEach(() => {
  repo = makeFixtureRepo()
  outside = mkdtempSync(join(tmpdir(), 'mount-out-'))
  execSync('git init -q -b main', { cwd: outside })
  const site = join(repo, 'repos', 'site')
  mkdirSync(site, { recursive: true })
  execSync('git init -q -b main && echo x > a.txt && git add a.txt && git -c user.name=T -c user.email=t@x commit -q -m init && echo y >> a.txt', { cwd: site })
  writeFileSync(join(repo, 'data', 'systems.yaml'), [
    'schema_version: "1.0"', 'systems:',
    '  - id: site', '    kind: repo', '    name: Site', '    url: https://github.com/x/site', '    mount: repos/site',
    '  - id: later', '    kind: repo', '    name: Later', '    url: https://github.com/x/later', '    mount: repos/later',
    '  - id: escape', '    kind: repo', '    name: Escape', '    url: https://github.com/x/e', '    mount: ../outside',
    '  - id: linked', '    kind: repo', '    name: Linked', '    url: https://user:tok@github.com/x/l', '    mount: repos/linked', '',
  ].join('\n'))
})
afterEach(() => { removeFixtureRepo(repo); rmSync(outside, { recursive: true, force: true }) })

const ctx = (): AdapterContext => ({ repo, now: () => new Date(2026, 9, 15, 12), run: runCommand, lastOk: () => null })

describe('systems adapter: mounts', () => {
  it('reads a clone, and says when there is none', async () => {
    const g = (await systems.read(ctx())) as Graph
    const by = (id: string) => g.nodes.find(n => n.id === `system:${id}`)!
    expect(by('site').facts.mount).toMatchObject({ path: 'repos/site', cloned: true, branch: 'main', dirty: true })
    expect(by('later').facts.mount).toEqual({ path: 'repos/later', cloned: false })
    symlinkSync(outside, join(repo, 'repos', 'linked'))
    const g2 = (await systems.read(ctx())) as Graph
    expect(g2.nodes.find(n => n.id === 'system:linked')!.facts.mount).toEqual({ path: 'repos/linked', cloned: false })
    // the clone's address and branch are read from the registry by the operation, not carried in facts
    expect(g2.nodes.map(n => Object.keys(n.facts)).flat()).not.toContain('cloneUrl')
    expect(g2.nodes.find(n => n.id === 'system:linked')!.facts).not.toHaveProperty('branch')
    expect(by('escape').facts.mount).toEqual({ path: '../outside', cloned: false })
  })
})
