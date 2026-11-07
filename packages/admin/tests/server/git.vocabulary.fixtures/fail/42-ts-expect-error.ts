import { simpleGit } from 'simple-git'

export const f = (r: string) => {
  // @ts-expect-error
  return simpleGit(r).nothing()
}
