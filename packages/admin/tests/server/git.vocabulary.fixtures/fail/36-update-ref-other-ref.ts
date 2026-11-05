import { simpleGit } from 'simple-git'

export const f = (r: string) => simpleGit(r).raw(['update-ref', 'refs/heads/main', 'a'.repeat(40), 'b'.repeat(40)])
