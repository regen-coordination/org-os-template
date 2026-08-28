import { join, basename } from 'node:path'
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar'

/** Watch data/*.yaml; invoke callback with the registry name (filename minus .yaml).
 *  `options` lets callers override chokidar defaults (e.g. usePolling for deterministic tests). */
export function watchData(repo: string, onChange: (registry: string) => void, options?: ChokidarOptions): FSWatcher {
  const watcher = watch(join(repo, 'data'), { ignoreInitial: true, ...options })
  watcher.on('all', (_event, path) => {
    const file = basename(path)
    if (file.endsWith('.yaml')) onChange(file.slice(0, -'.yaml'.length))
  })
  return watcher
}
