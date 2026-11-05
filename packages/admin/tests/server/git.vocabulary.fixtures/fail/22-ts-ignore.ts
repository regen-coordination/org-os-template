import { simpleGit } from 'simple-git'

export const f = (r: string) => {
  // @ts-ignore
  return simpleGit(r).clean('f')
}
