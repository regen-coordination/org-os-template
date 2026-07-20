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

  // 7. whoami returns an object with an `id` property (may be null, but the shape exists).
  const who = await driver.whoami();
  assert.ok(who && typeof who === 'object', 'whoami returns an object');
  assert.ok('id' in who, 'whoami result has an id property');

  // 8. listPeers resolves to an array.
  const peers = await driver.listPeers('rad:z');
  assert.ok(Array.isArray(peers), 'listPeers resolves to an array');

  // 9. Write path: every write method returns { ok: boolean, ... } (never a silent
  // success-shaped object smuggled past a thrown error) — the "fail loudly, never
  // silently fall back" invariant made observable. A driver MAY instead throw a
  // real Error for a write failure; either is acceptable, but nothing in between.
  async function assertWriteShape(name, fn, { expectId = false } = {}) {
    let result;
    try {
      result = await fn();
    } catch (err) {
      assert.ok(err instanceof Error, `${name}: a thrown write failure must be an Error`);
      return;
    }
    assert.ok(result && typeof result === 'object', `${name}: write result is an object`);
    assert.equal(typeof result.ok, 'boolean', `${name}: write result has boolean ok`);
    if (expectId) {
      assert.ok('id' in result, `${name}: write result has an id property`);
      assert.ok(result.id === null || typeof result.id === 'string', `${name}: id is string|null`);
    }
  }

  await assertWriteShape('push', () => driver.push({ branch: 'x' }));
  await assertWriteShape('openChange', () => driver.openChange({ title: 't', body: 'b', base: 'main' }), { expectId: true });
  await assertWriteShape('createIssue', () => driver.createIssue({ title: 't', body: 'b' }), { expectId: true });
  await assertWriteShape('commentIssue', () => driver.commentIssue({ id: '1', body: 'b' }));
  await assertWriteShape('syncUpstream', () => driver.syncUpstream({}));
  await assertWriteShape('clone', () => driver.clone({ repo: 'a/b' }, '/tmp/does-not-matter'));
}
