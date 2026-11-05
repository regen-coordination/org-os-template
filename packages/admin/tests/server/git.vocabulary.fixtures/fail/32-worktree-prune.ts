import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).raw(['worktree', 'prune'])
