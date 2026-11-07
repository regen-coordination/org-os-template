import { simpleGit } from 'simple-git'

export const f = (r: string, args: string[]) => simpleGit(r).raw([...args])
