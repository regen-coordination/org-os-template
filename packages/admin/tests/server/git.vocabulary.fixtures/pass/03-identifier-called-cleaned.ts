import { simpleGit } from 'simple-git'

export const cleaned = (text: string) => text.trim()
export const resetCount = 0
export const f = (r: string) => simpleGit(r).status()
