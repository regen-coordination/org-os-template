import fs from 'node:fs/promises'
import path from 'node:path'
const from = path.resolve('..', '.well-known')
const to = path.resolve('public', '.well-known')
await fs.mkdir(to, { recursive: true })
for (const f of await fs.readdir(from)) await fs.copyFile(path.join(from, f), path.join(to, f))
console.log('synced .well-known')
