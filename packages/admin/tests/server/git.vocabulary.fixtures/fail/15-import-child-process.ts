import { execSync } from 'node:child_process'

export const f = () => execSync('git reset --hard')
