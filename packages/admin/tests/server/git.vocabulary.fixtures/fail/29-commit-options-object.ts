import { simpleGit } from 'simple-git'

export const f = (r: string, paths: string[]) => simpleGit(r).commit('m', paths, { '--no-verify': null })
