import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).push('origin', 'main', ['--force'])
