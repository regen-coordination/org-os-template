declare function run(sub: string, args: string[], repo: string): Promise<string>

export const a = (r: string, sha: string) => run('log', ['-1', '--format=%B', sha], r)
export const b = (r: string, a: string, b2: string) => run('diff', ['--name-only', a, b2], r)
export const c = (r: string, id: string, n: string, o: string) => run('update-ref', [`refs/heads/proposal/${id}`, n, o], r)
export const d = (r: string, p: string) => run('worktree', ['add', '--detach', p, 'HEAD'], r)
export const e = (r: string) => run('--version', [], r)
