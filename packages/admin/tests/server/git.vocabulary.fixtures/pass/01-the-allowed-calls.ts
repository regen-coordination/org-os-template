import { simpleGit } from 'simple-git'

export const a = (r: string, paths: string[]) => simpleGit(r).add(paths)
export const c = (r: string, paths: string[]) => simpleGit(r).commit('m', paths)
export const s = (r: string) => simpleGit(r).status()
export const sp = (r: string, paths: string[]) => simpleGit(r).status(['--', ...paths])
export const g = (r: string) => simpleGit(r).getConfig('user.email')
export const v = (r: string, ref: string) => simpleGit(r).revparse(['--verify', ref])
export const l = (r: string, paths: string[]) => simpleGit(r).raw(['ls-files', '-v', '--', ...paths])
export const w = (r: string) => simpleGit(r, { errors(error) { return error } })
