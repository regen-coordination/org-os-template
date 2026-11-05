import { simpleGit } from 'simple-git'

export const f = (r: string, x: string) => simpleGit(r).raw(['merge', '--strategy-option', 'theirs', x])
