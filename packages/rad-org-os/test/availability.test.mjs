import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABILITY_TIERS, chooseAvailability } from '../bootstrap/availability.mjs';

test('the three tiers are self-hosted, garden, public', () => {
  assert.deepEqual(AVAILABILITY_TIERS.map((t) => t.key), ['self-hosted', 'garden', 'public']);
});

test('chooseAvailability returns the seed endpoint + honest trust note for each tier', () => {
  const s = chooseAvailability('self-hosted', { seed: 'https://my-node.example' });
  assert.equal(s.seed, 'https://my-node.example');
  assert.equal(s.trust, 'none');

  const g = chooseAvailability('garden');
  assert.match(g.seed, /radicle\.garden|garden/i);
  assert.match(g.caveat, /not encrypted at rest|operators/i);

  const p = chooseAvailability('public');
  assert.match(p.seed, /seed\.radicle\.xyz|iris|rosa/);
  assert.equal(p.privateOk, false); // public seeds can't host private repos
});

test('high-threat guidance points away from garden/public to self-hosted or tor', () => {
  assert.equal(chooseAvailability('public').recommendedForPrivate, false);
  assert.equal(chooseAvailability('self-hosted', { seed: 'x' }).recommendedForPrivate, true);
});

test('unknown tier throws', () => {
  assert.throws(() => chooseAvailability('nope'), /unknown availability tier/);
});
