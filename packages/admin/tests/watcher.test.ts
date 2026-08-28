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
      await expect.poll(() => seen, { interval: 25, timeout: 5000 }).toContain('projects')
    } finally {
      clearInterval(rewrite)
    }
  }, 10000)
})
