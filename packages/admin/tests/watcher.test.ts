import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { watchData, watchPaths } from '../server/watcher.ts'
import { testTimeoutMs } from './time-limit.ts'

let repo: string
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); removeFixtureRepo(repo) })

describe('watchData', () => {
  it('reports the registry name when a data file changes', async () => {
    repo = makeFixtureRepo()
    const seen: string[] = []
    // usePolling keeps delivery independent of macOS fsevents coalescing.
    const watcher = watchData(repo, name => seen.push(name), { usePolling: true, interval: 40 })
    close = () => watcher.close()
    await new Promise<void>(resolve => watcher.on('ready', () => resolve()))

    // chokidar captures its per-file polling baseline asynchronously, and
    // 'ready' does not guarantee that has finished. A single write landing
    // inside that window gets baked into the baseline, so it is never reported
    // as a change — the watcher then sits silent forever. That raced the write
    // here (which used to fire ~2ms after 'ready') and failed ~40% of runs;
    // it was misdiagnosed as event-loop starvation, but instrumentation showed
    // the loop ticking normally, 148/150 ticks, while zero events arrived.
    //
    // Re-writing until the change is reported removes the race instead of
    // guessing a settle delay: whichever stat chokidar baselined, the next
    // write has a later mtime and is detected. Production is unaffected — the
    // server creates one long-lived watcher at startup, so at worst a file
    // changed in that same millisecond window is picked up on its next edit.
    const target = join(repo, 'data', 'projects.yaml')
    let n = 0
    const write = () => writeFileSync(target, `schema_version: "2.0"\nprojects: []\n# ${n++}\n`)
    write()
    const rewrite = setInterval(write, 50)
    try {
      // Half the suite's limit, so that a missing event fails here, as an assertion that says what was awaited.
      await expect.poll(() => seen, { interval: 25, timeout: testTimeoutMs() / 2 }).toContain('projects')
    } finally {
      clearInterval(rewrite)
    }
  })
})

describe('watchPaths', () => {
  it('reports the changed path relative to the repository, with forward slashes', async () => {
    repo = makeFixtureRepo()
    mkdirSync(join(repo, 'modules', 'm'), { recursive: true })
    const seen: string[] = []
    const watcher = watchPaths(repo, ['modules'], rel => seen.push(rel), { usePolling: true, interval: 40 })
    close = () => watcher.close()
    await new Promise<void>(resolve => watcher.on('ready', () => resolve()))
    // Re-written until seen, for the same reason as the test above: chokidar's polling baseline.
    const target = join(repo, 'modules', 'm', 'module.yaml')
    let n = 0
    const rewrite = setInterval(() => writeFileSync(target, `id: m\n# ${n++}\n`), 50)
    try {
      await expect.poll(() => seen, { interval: 25, timeout: testTimeoutMs() / 2 }).toContain('modules/m/module.yaml')
    } finally { clearInterval(rewrite) }
  })
})
