import { defineConfig } from 'vitest/config'
import { testTimeoutMs } from './tests/time-limit.ts'

// One locale and one time zone for every run, whatever the host's (ruling R-10, L4-R8): numbers group as en-US
// ("1,271.00") and dates fall on the UTC day the fixtures' clocks name. Node's ICU takes its default locale and
// zone from these variables when a process starts, so they are set here, in the main process, before vitest
// forks its workers; the workers inherit them. tests/setup.env.test.ts checks that they took.
process.env.LANG = 'en_US.UTF-8'
process.env.LC_ALL = 'en_US.UTF-8'
process.env.TZ = 'UTC'
export default defineConfig({
  // `globals: true` lets @testing-library/react auto-register afterEach(cleanup),
  // so component renders are torn down between tests (avoids duplicate-DOM matches).
  //
  // `testTimeout`: one limit for every test, there to end a hang. It is 30 s,
  // or what ADMIN_TEST_TIMEOUT_MS says (see tests/time-limit.ts for why, and
  // for when to raise it). Two tests hold a limit of their own, both derived
  // from this one: the README's run command, which builds the app first
  // (tests/readme.test.ts), and the wait for a file-change event
  // (tests/watcher.test.ts).
  // `css.include`: vitest stubs every stylesheet to an empty string, even one imported `?raw`; the
  // house skin's source read as text (/parts/tokens draws its values from it) is the one let through.
  test: { css: { include: [/skins\/house\.css\?raw$/] }, globals: true, setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.ts', 'app/src/**/*.test.ts', 'app/src/**/*.test.tsx'], testTimeout: testTimeoutMs() },
})
