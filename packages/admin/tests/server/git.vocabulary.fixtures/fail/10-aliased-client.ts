import { simpleGit } from 'simple-git'

export const f = (r: string) => {
  const g = simpleGit(r)
  return g.clean('f')
}
