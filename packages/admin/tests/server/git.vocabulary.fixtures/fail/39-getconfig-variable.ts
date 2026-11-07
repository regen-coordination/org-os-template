import { simpleGit } from 'simple-git'

export const f = (r: string, key: string) => simpleGit(r).getConfig(key)
