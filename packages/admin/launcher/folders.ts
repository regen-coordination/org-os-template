import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type FolderState = 'new' | 'empty' | 'not-empty' | 'not-a-folder'

/** What the person typed, as an absolute path: `~` is their home, a relative path is read from `base`. */
export function resolveFolder(input: string, base: string): string {
  const text = input.trim()
  if (!text) throw new Error('Say which folder.')
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return resolve(homedir(), text.slice(2))
  return resolve(base, text)
}

/** What is at `abs`, following symlinks. A path that is not there is `new`, whether or not its parents are. */
export function folderState(abs: string): FolderState {
  let stat
  try { stat = statSync(abs) } catch { return 'new' }
  if (!stat.isDirectory()) return 'not-a-folder'
  return readdirSync(abs).length === 0 ? 'empty' : 'not-empty'
}

/** Why a new instance cannot be made at `abs`, in a sentence, or null when it can. */
export function writableFolderProblem(abs: string): string | null {
  const state = folderState(abs)
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
