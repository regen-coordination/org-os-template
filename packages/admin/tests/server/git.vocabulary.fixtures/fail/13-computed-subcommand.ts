import { simpleGit } from 'simple-git'

export const f = (r: string, sub: string) => simpleGit(r).raw([sub, 'x'])
