import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { sources } from '../../server/resources/adapters/sources.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const now = new Date(2026, 9, 15, 12)
const ctx = (lastOk: AdapterContext['lastOk'] = () => null): AdapterContext => ({ repo, now: () => now, run: runCommand, lastOk })

describe('sources adapter', () => {
  it('says so when nothing is declared', async () => {
    expect(await sources.read(ctx())).toEqual({ absent: 'No sources, channels or KMS connectors declared here' })
  })

  it('reads sources and channels as editable cards', async () => {
    writeFileSync(join(repo, 'data', 'sources.yaml'), 'sources:\n  - id: blog\n    name: Org Blog\n    type: blog\n    status: active\n    content_count: 12\n')
    writeFileSync(join(repo, 'data', 'channels.yaml'), 'channels:\n  - id: tg\n    name: Telegram group\n    platform: telegram\n    status: active\n')
    const g = (await sources.read(ctx())) as Graph
    expect(g.nodes).toEqual([
      expect.objectContaining({ id: 'source:blog', kind: 'source', board: 'systems', name: 'Org Blog', status: 'active',
        facts: expect.objectContaining({ type: 'blog', doc_count: 12 }), source: { path: 'data/sources.yaml', editable: true, registry: 'sources', entityId: 'blog' } }),
      expect.objectContaining({ id: 'channel:tg', kind: 'channel', name: 'Telegram group', facts: expect.objectContaining({ platform: 'telegram' }) }),
    ])
    expect(g.edges).toEqual([])
  })

  it('reads KMS connectors, stale when the last ok ingest is over 14 days old', async () => {
    writeFileSync(join(repo, 'kms.yaml'), 'target: knowledge\nconnectors:\n  - name: example-commons\n    config: {}\n  - name: fresh\n')
    const seen: [string, string][] = []
    const g = (await sources.read(ctx((op, id) => {
      seen.push([op, id])
      return id === 'connector:example-commons' ? new Date(2026, 8, 20).toISOString() : new Date(2026, 9, 14).toISOString()
    }))) as Graph
    expect(seen).toEqual([['connector.ingest', 'connector:example-commons'], ['connector.ingest', 'connector:fresh']])
    expect(g.nodes.find(n => n.id === 'connector:example-commons')).toMatchObject({ kind: 'connector', status: 'declared',
      attention: { level: 'warn', text: 'last ingest 25 days ago' }, facts: expect.objectContaining({ target: 'knowledge' }),
      source: { path: 'kms.yaml', editable: false } })
    expect(g.nodes.find(n => n.id === 'connector:fresh')?.attention).toBeNull()
  })

  it('names a tracked registry that the working tree lost', async () => {
    writeFileSync(join(repo, 'data', 'sources.yaml'), 'sources:\n  - id: blog\n')
    execSync('git add data/sources.yaml && git commit -qm sources', { cwd: repo })
    rmSync(join(repo, 'data', 'sources.yaml'))
    const g = (await sources.read(ctx())) as Graph
    expect(g.nodes).toEqual([expect.objectContaining({ id: 'absent:sources:sources', name: 'data/sources.yaml',
      attention: expect.objectContaining({ text: expect.stringMatching(/missing from the working tree/) }) })])
  })

  it('turns an unreadable registry into its own card', async () => {
    writeFileSync(join(repo, 'data', 'channels.yaml'), 'channels:\n  - id: a\n    name: *nowhere\n')
    const g = (await sources.read(ctx())) as Graph
    expect(g.nodes).toEqual([expect.objectContaining({ id: 'absent:sources:channels', kind: 'absent', name: 'data/channels.yaml' })])
  })
})
