import { lstatSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { cloneName } from '../lib/clone-name.mjs'

export type FolderState = 'new' | 'empty' | 'not-empty' | 'not-a-folder'

/** What the person typed, as an absolute path: `~` is their home, a relative path is read from `base`. */
export function resolveFolder(input: string, base: string): string {
  const text = input.trim()
  if (!text) throw new Error('Say which folder.')
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return resolve(base, text)
}

/** What is at `abs`, with `unreadable` for a path that cannot be looked at (a parent that is a file, a loop, no permission). */
function probe(abs: string): FolderState | 'unreadable' {
  let stat
  try {
    stat = statSync(abs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'unreadable'
    try { lstatSync(abs) } catch { return 'new' } // nothing there at all
    return 'not-a-folder' // a symlink that points nowhere
  }
  if (!stat.isDirectory()) return 'not-a-folder'
  try { return readdirSync(abs).length === 0 ? 'empty' : 'not-empty' } catch { return 'unreadable' }
}

/** What is at `abs`, following symlinks. Only a path that is not there is `new`, whether or not its parents are; a path
 *  that cannot be looked at is `not-a-folder`, so nothing is ever made on it. */
export function folderState(abs: string): FolderState {
  const state = probe(abs)
  return state === 'unreadable' ? 'not-a-folder' : state
}

/** Why a new instance cannot be made at `abs`, in a sentence, or null when it can. */
export function writableFolderProblem(abs: string): string | null {
  const state = probe(abs)
  if (state === 'unreadable') return `${abs} cannot be read. Choose a new or empty folder.`
  if (state === 'not-empty') return `${abs} already has files in it. Choose a new or empty folder.`
  if (state === 'not-a-folder') return `${abs} is a file, not a folder.`
  return null
}

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
const isFile = (p: string) => { try { return statSync(p).isFile() } catch { return false } }

/** An instance has a `data/` folder and a `federation.yaml`. */
export function isInstance(abs: string): boolean {
  return isDir(join(abs, 'data')) && isFile(join(abs, 'federation.yaml'))
}

/** Where a clone of `url` goes by default: the repo's name, inside `base`. */
export function defaultCloneFolder(url: string, base: string): string {
  return join(base, cloneName(url))
}
