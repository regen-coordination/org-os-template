import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).env({ ...process.env, GIT_SSH_COMMAND: 'x' })
