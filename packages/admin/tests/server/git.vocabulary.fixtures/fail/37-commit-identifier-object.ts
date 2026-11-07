import { simpleGit } from 'simple-git'

export const f = (r: string) => {
  const opts = { '--no-verify': null }
  return simpleGit(r).commit('m', opts)
}
