import { simpleGit } from 'simple-git'

const yes = true
export const f = (r: string) => simpleGit(r, { unsafe: { allowUnsafeEditor: yes } })
