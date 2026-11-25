import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX = 20

/** Where the launcher keeps what it remembers: `~/.org-os`, or `ORG_OS_LAUNCHER_HOME`. */
export function launcherHome(): string {
  return process.env.ORG_OS_LAUNCHER_HOME ?? join(homedir(), '.org-os')
}

const file = () => join(launcherHome(), 'instances.json')

/** The folders the launcher opened lately, absolute, most recent first. A missing, unreadable or corrupt file is an empty list. */
export function readRecent(): string[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { instances?: unknown } | null
    const list = raw?.instances
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/** The path as it is stored: its real path when it exists, as given otherwise. */
const stored = (path: string): string => {
  try { return existsSync(path) ? realpathSync(path) : path } catch { return path }
}

function write(paths: string[]): string[] {
  mkdirSync(launcherHome(), { recursive: true })
  const tmp = `${file()}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ instances: paths }, null, 2)}\n`)
  renameSync(tmp, file())
  return paths
}

/** Moves `path` to the front of the list (once), keeps at most 20, writes the file whole; returns the list. */
export function remember(path: string): string[] {
  const p = stored(path)
  return write([p, ...readRecent().filter(x => x !== p && stored(x) !== p)].slice(0, MAX))
}

/** Takes `path` off the list; returns the list. */
export function forget(path: string): string[] {
  const p = stored(path)
  return write(readRecent().filter(x => x !== path && x !== p && stored(x) !== p))
}
