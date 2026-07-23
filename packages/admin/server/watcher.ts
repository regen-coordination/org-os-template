import { join, basename } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

/** Watch data/*.yaml; invoke callback with the registry name (filename minus .yaml). */
export function watchData(repo: string, onChange: (registry: string) => void): FSWatcher {
  const watcher = watch(join(repo, 'data'), { ignoreInitial: true })
  watcher.on('all', (_event, path) => {
    const file = basename(path)
    if (file.endsWith('.yaml')) onChange(file.slice(0, -'.yaml'.length))
  })
  return watcher
}
