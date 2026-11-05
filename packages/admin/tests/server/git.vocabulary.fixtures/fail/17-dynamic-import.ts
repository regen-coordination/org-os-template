export const f = async () => (await import('node:child_process')).execSync('git stash')
