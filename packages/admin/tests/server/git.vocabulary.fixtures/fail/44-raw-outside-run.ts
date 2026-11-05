import { simpleGit } from 'simple-git'

export const f = (r: string, argv: string[]) => simpleGit(r).raw(argv)
