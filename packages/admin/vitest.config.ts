import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'app/src/**/*.test.tsx'] },
})
