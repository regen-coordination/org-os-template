import { resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'

export interface RepoStatus { branch: string; dirty: boolean }

/** The whole vocabulary of this service is: status, add(paths), commit(paths).
 *  stash/clean/reset/force are deliberately absent — vault safety is enforced
 *  here, not by convention. Do not add pass-through git access. */
export async function repoStatus(repo: string): Promise<RepoStatus> {
  const status = await simpleGit(repo).status()
  return { branch: status.current ?? 'HEAD', dirty: status.files.length > 0 }
}

function assertInsideData(repo: string, path: string): void {
  const dataRoot = resolve(repo, 'data') + sep
  if (!resolve(repo, path).startsWith(dataRoot)) {
    throw new Error(`guardrail: refusing to commit path outside data/: ${path}`)
  }
}

export async function commitDataPaths(repo: string, paths: string[], message: string): Promise<void> {
  if (paths.length === 0) throw new Error('no paths to commit')
  for (const p of paths) assertInsideData(repo, p)
  const git = simpleGit(repo)
  await git.add(paths)
  await git.commit(message, paths)
}
