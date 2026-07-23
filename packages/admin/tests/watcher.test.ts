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
    const watcher = watchData(repo, name => seen.push(name))
    close = () => watcher.close()
    await new Promise<void>(resolve => watcher.on('ready', () => resolve()))
    writeFileSync(join(repo, 'data', 'projects.yaml'), 'schema_version: "2.0"\nprojects: []\n')
    await expect.poll(() => seen, { timeout: 3000 }).toContain('projects')
  })
})
