import { join, relative, sep } from 'node:path'
import { watch, type FSWatcher, type ChokidarOptions } from 'chokidar'
import { registriesOf, registryFileOf, type RegistryDef } from './registries.ts'

/** An unhandled watcher error would end the process, and with it any job running under it. */
const failed = (err: unknown) =>
  console.error(`org-os admin: a file watcher failed: ${err instanceof Error ? err.message : String(err)}`)

/** The registry a changed file under data/ is (`rel` from the repository's root, with `/`): the one of `defs` whose file
 *  it is (L6 §7.1), else, for any other .yaml file, its name without .yaml, as before; null for a file that is no YAML. */
export function registryOfPath(rel: string, defs: readonly RegistryDef[]): string | null {
  const def = defs.find(d => registryFileOf(d) === rel)
  if (def) return def.name
  const file = rel.slice(rel.lastIndexOf('/') + 1)
  return file.endsWith('.yaml') ? file.slice(0, -'.yaml'.length) : null
}

/** Watch data/ (with its folders); invoke callback with the registry name of the file that changed (`registryOfPath`,
 *  over the instance's own list). `options` lets callers override chokidar defaults (e.g. usePolling for deterministic tests). */
export function watchData(repo: string, onChange: (registry: string) => void, options?: ChokidarOptions): FSWatcher {
  const watcher = watch(join(repo, 'data'), { ignoreInitial: true, ...options })
  watcher.on('all', (_event, path) => {
    const registry = registryOfPath(relative(repo, path).split(sep).join('/'), registriesOf(repo))
    if (registry !== null) onChange(registry)
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
