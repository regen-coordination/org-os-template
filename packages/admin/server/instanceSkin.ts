// The instance's own look (README, "Skins": "the instance's own data does not carry one yet"). An instance may carry
// `house/skin.css`: token values that re-tint the shipped house skin, light and dark, with nothing of the instance
// written into the framework. The house serves it at INSTANCE_SKIN_PATH and index.html links it in the head, so the
// first frame is already drawn in it. Its blocks use `html:root[...]` selectors, one element more specific than
// house.css's `:root[...]`, so they win whatever order the stylesheets arrive in (a build's bundle, dev's injected
// styles). Absent, the answer is an empty stylesheet: the house looks as it ships.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const INSTANCE_SKIN_PATH = '/instance-skin.css'
/** Where an instance keeps its skin, from its root. */
export const INSTANCE_SKIN_FILE = join('house', 'skin.css')
/** Larger than any token file needs; a bigger file is a mistake, not a skin. */
export const INSTANCE_SKIN_MAX_BYTES = 64 * 1024

/** The instance skin's CSS, or '' when the instance carries none (or one too large to be a skin). Read on every
 *  call, so an edit shows on the next load without a restart. */
export function readInstanceSkin(repo: string): string {
  const file = join(repo, INSTANCE_SKIN_FILE)
  if (!existsSync(file)) return ''
  const st = statSync(file)
  if (!st.isFile() || st.size > INSTANCE_SKIN_MAX_BYTES) return ''
  return readFileSync(file, 'utf8')
}
