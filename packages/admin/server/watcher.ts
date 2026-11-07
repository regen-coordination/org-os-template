import { join, basename, relative, sep } from 'node:path'
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar'

/** An unhandled watcher error would end the process, and with it any job running under it. */
const failed = (err: unknown) =>
  console.error(`org-os admin: a file watcher failed: ${err instanceof Error ? err.message : String(err)}`)

/** Watch data/*.yaml; invoke callback with the registry name (filename minus .yaml).
 *  `options` lets callers override chokidar defaults (e.g. usePolling for deterministic tests). */
export function watchData(repo: string, onChange: (registry: string) => void, options?: ChokidarOptions): FSWatcher {
  const watcher = watch(join(repo, 'data'), { ignoreInitial: true, ...options })
  watcher.on('all', (_event, path) => {
    const file = basename(path)
    if (file.endsWith('.yaml')) onChange(file.slice(0, -'.yaml'.length))
  })
  watcher.on('error', failed)
  return watcher
}

/** Watch repository-relative paths, files or folders; report each change as a repository-
 *  relative path written with `/`, which is what the resource store's adapters watch. */
export function watchPaths(repo: string, rels: string[], onChange: (rel: string) => void, options?: ChokidarOptions): FSWatcher {
  const watcher = watch(rels.map(r => join(repo, r)), { ignoreInitial: true, ...options })
  watcher.on('all', (_event, path) => onChange(relative(repo, path).split(sep).join('/')))
  watcher.on('error', failed)
  return watcher
}
