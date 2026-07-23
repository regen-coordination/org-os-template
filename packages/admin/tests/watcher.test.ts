import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { watchData } from '../server/watcher.ts'

let repo: string
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); removeFixtureRepo(repo) })

describe('watchData', () => {
  it('reports the registry name when a data file changes', async () => {
    repo = makeFixtureRepo()
    const seen: string[] = []
    // usePolling makes event delivery deterministic under parallel-suite load
    // (native fsevents can drop/lag events when many watchers run at once).
    const watcher = watchData(repo, name => seen.push(name), { usePolling: true, interval: 40 })
    close = () => watcher.close()
    await new Promise<void>(resolve => watcher.on('ready', () => resolve()))
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'schema_version: "2.0"\nprojects: []\n')
    // Normally fires in <1s; the large ceiling only guards against event-loop
    // starvation when git-heavy suites run in parallel (the write itself is deterministic).
    await expect.poll(() => seen, { interval: 25, timeout: 15000 }).toContain('projects')
  }, 20000) // per-test timeout must exceed the poll ceiling, else vitest's 5s default aborts first
})
