// tests/scripts/crew-herdr.test.mjs
//
// The real herdr adapter against a stand-in binary: a hung herdr must not hang
// the command. Everything else about the adapter is checked by hand against a
// live herdr (spec §13); this file covers only what can be shown without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHerdr, HerdrError } from '../../scripts/crew/herdr.mjs';

function stub(body) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-herdr-')));
  const bin = join(dir, 'herdr');
  writeFileSync(bin, `#!/bin/sh\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('a herdr that never answers becomes a HerdrError with its own code and a plain message', () => {
  const herdr = createHerdr({ bin: stub('exec sleep 30'), timeoutMs: 200 });
  const started = Date.now();
  assert.throws(
    () => herdr.listAgents(),
    (err) => {
      assert.ok(err instanceof HerdrError);
      assert.equal(err.code, 'herdr_timeout');
      assert.match(err.message, /did not answer within/);
      assert.match(err.message, /agent list/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 10000, 'the call returned');
});

test('a timed-out prompt is a HerdrError the caller can tell apart from a refusal', () => {
  const herdr = createHerdr({ bin: stub('exec sleep 30'), timeoutMs: 200 });
  assert.throws(() => herdr.promptAgent('engineer', 'hello'), (err) => err instanceof HerdrError && err.code === 'herdr_timeout');
});

test('a herdr that answers in time is unaffected', () => {
  const herdr = createHerdr({ bin: stub(`echo '{"result":{"agents":[]}}'`), timeoutMs: 5000 });
  assert.deepEqual(herdr.listAgents(), []);
});
