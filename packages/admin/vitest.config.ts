import { defineConfig } from 'vitest/config'
export default defineConfig({
  // `globals: true` lets @testing-library/react auto-register afterEach(cleanup),
  // so component renders are torn down between tests (avoids duplicate-DOM matches).
  test: { globals: true, include: ['tests/**/*.test.ts', 'app/src/**/*.test.tsx'] },
})
