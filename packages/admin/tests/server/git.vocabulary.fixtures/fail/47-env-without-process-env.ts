import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).env({ GIT_AUTHOR_NAME: 'x' })
