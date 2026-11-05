import { simpleGit } from 'simple-git'

export const f = (r: string) => {
  const { clean } = simpleGit(r)
  return clean('f')
}
