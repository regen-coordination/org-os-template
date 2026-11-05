import { simpleGit } from 'simple-git'

export const f = (r: string, o: object) => simpleGit(r, { ...o })
