import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).raw(['worktree', 'add', '-b', 'x', '/tmp/x'])
