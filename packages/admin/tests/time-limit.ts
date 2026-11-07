/**
 * How long one test may run before vitest ends it, in milliseconds.
 *
 * The limit is there to end a hang, not to measure speed. 30 s is about four
 * times the slowest test seen at a load average of 83 to 170 on 10 cores
 * (third review, 2026-10-11: 7 s). On a machine more crowded than that, raise
 * it for one run, without a commit:
 *
 *     ADMIN_TEST_TIMEOUT_MS=120000 npm test
 */
const DEFAULT_MS = 30_000

export function testTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const set = env.ADMIN_TEST_TIMEOUT_MS
  if (set === undefined || set === '') return DEFAULT_MS
  const ms = Number(set)
  if (!Number.isInteger(ms) || ms < 1000) {
    throw new Error(`ADMIN_TEST_TIMEOUT_MS is "${set}": give a whole number of milliseconds, 1000 or more (for example 120000), or leave it unset for ${DEFAULT_MS}.`)
  }
  return ms
}
