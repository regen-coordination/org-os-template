import { lstatSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path'

/** True when `mount` (relative to `repo`) would, once symlinks are followed, land outside the repo. The nearest existing
 *  ancestor is resolved (the mount itself if there, else its parents); a dangling link counts as outside. */
export function leadsOutside(repo: string, mount: string): boolean {
  let real: string
  try { real = realpathSync(repo) } catch { return true }
  let p = resolve(repo, mount)
  for (;;) {
    try {
      lstatSync(p)
      let target: string
      try { target = realpathSync(p) } catch { return true }
      const rel = relative(real, target)
      return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    } catch {
      const up = dirname(p)
      if (up === p) return true
      p = up
    }
  }
}
