import { simpleGit } from 'simple-git'

// stash, clean, reset and --force are deliberately absent: reset --hard, clean -fd, stash, push --force.
/* checkout, rebase, branch -d and cherry-pick are absent too. */
export const note = 'the words reset and clean in a string are only text'
export const f = (r: string) => simpleGit(r).status()
