import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** The store's one file in its folder (L5 spec §10.1). */
export const STORE_FILE = 'house.db'

/** The private store's folder: `ORG_OS_PRIVATE_DIR` (relative to the repository when not absolute), else
 *  `<repo>/.org-os/private`. An empty value is unset. */
export function privateDir(repo: string, env: NodeJS.ProcessEnv = process.env): string {
  const set = env.ORG_OS_PRIVATE_DIR
  if (set !== undefined && set.trim() !== '') return resolve(repo, set)
  return join(resolve(repo), '.org-os', 'private')
}

/** `path` with every link in the part that exists resolved, so a folder reached through a link (the temp
 *  directory on macOS, a volume mounted into the repository) is compared where it really is. */
function real(path: string): string {
  let head = resolve(path)
  const tail: string[] = []
  while (!existsSync(head)) {
    const up = dirname(head)
    if (up === head) return resolve(path)
    tail.unshift(basename(head))
    head = up
  }
  return join(realpathSync(head), ...tail)
}

/** Where `dir` sits inside `repo`, as a path git reads (`/`-separated, `''` for the repository's own root), or
 *  null when it is outside the repository. */
export function placeInRepo(repo: string, dir: string): string | null {
  const rel = relative(real(repo), real(dir))
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}
