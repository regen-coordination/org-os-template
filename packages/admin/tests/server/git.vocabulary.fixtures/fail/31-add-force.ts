import { simpleGit } from 'simple-git'

export const f = (r: string, path: string) => simpleGit(r).add(['-f', path])
