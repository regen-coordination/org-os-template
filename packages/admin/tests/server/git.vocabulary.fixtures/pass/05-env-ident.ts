import { simpleGit } from 'simple-git'

// L5 §6.4: one commit as the house, under this process's environment plus the ident.
export const f = (r: string, paths: string[], name: string, email: string) =>
  simpleGit(r, { unsafe: { allowUnsafeEditor: true, allowUnsafeConfigPaths: true } })
    .env({ ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email })
    .commit('m', paths)
