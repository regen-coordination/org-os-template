import { assertDriver, HOST_DRIVER_METHODS } from '../src/driver.mjs';

// Behavioral contract every HostDriver must satisfy. Call with a factory that
// returns a fresh driver. Pass { assert } (node:assert/strict). Driver-agnostic:
// asserts shape + the read/write invariants, not driver-specific command strings.
export async function runHostDriverContract(makeDriver, { assert } = {}) {
  if (!assert) throw new Error('runHostDriverContract requires { assert }');
  const driver = makeDriver();

  // 1. Shape: every contract method is present.
  assertDriver(driver, 'contract');
  for (const m of HOST_DRIVER_METHODS) assert.equal(typeof driver[m], 'function', `missing ${m}`);

  // 2. resolveRemote returns a scheme + canonical flag.
  const r = driver.resolveRemote('rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5');
  assert.ok(r && typeof r === 'object', 'resolveRemote returns an object');
  assert.ok(['github', 'radicle'].includes(r.scheme), 'resolveRemote.scheme is github|radicle');

  // 3. getCanonical shape: { defaultBranch, threshold, delegates }.
  const c = await driver.getCanonical('rad:z');
  assert.equal(typeof c.defaultBranch, 'string');
  assert.equal(typeof c.threshold, 'number');
  assert.ok(Array.isArray(c.delegates));

  // 4. getDrift shape: { behind, ahead, canonicalRef }.
  const d = await driver.getDrift('rad:z');
  assert.equal(typeof d.behind, 'number');
  assert.equal(typeof d.ahead, 'number');
  assert.equal(typeof d.canonicalRef, 'string');

  // 5. fetchFile returns a string or null (never throws for a missing file).
  const f = await driver.fetchFile('rad:z', 'does-not-exist.txt');
  assert.ok(f === null || typeof f === 'string', 'fetchFile returns string|null');

  // 6. webUrl returns a string URL containing the path.
  const url = driver.webUrl('rad:z', 'BOOTSTRAP.md');
  assert.equal(typeof url, 'string');
  assert.match(url, /BOOTSTRAP\.md/);
}
