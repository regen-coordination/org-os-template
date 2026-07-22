import { defineKmsConfig } from '../../src/config.ts'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const FIXTURE_ROOT = path.dirname(fileURLToPath(import.meta.url))
export const fixtureConfig = () => defineKmsConfig({
  identity: { name: 'fixture/commons' },
  sources: [
    { id: 'alpha', label: 'Alpha', dir: 'vault/alpha', content: ['docs/**/*.md'], data: 'data' },
    { id: 'beta', label: 'Beta', dir: 'vault/beta', content: ['knowledge/**/*.md'], exclude: ['**/working/**'] },
  ],
})
