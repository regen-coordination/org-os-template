// tests/scripts/crew-herdr.test.mjs
//
// The real herdr adapter against a stand-in binary: a hung herdr must not hang
// the command. Everything else about the adapter is checked by hand against a
// live herdr (spec §13); this file covers only what can be shown without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

// A stand-in `agent start` that refuses the first `refusals` calls with the given
// error and then succeeds, counting its calls in a file.
function startStub({ refusals, code = 'pane_not_ready', message }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-herdr-count-')));
  const count = join(dir, 'count');
  const err = JSON.stringify({ error: { code, message } });
  const bin = stub(
    `n=$(cat '${count}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${count}'\n` +
      `if [ "$n" -le ${refusals} ]; then echo '${err}' >&2; exit 1; fi\n` +
      `echo '{"result":{}}'`,
  );
  return { bin, calls: () => Number(readFileSync(count, 'utf-8').trim()) };
}

const NOT_A_SHELL = 'agent target pane wP:p1 is not an available shell';
const quick = { startWaitMs: 2000, startRetryMs: 20 };
const start = (herdr) => herdr.startAgent({ name: 'engineer', kind: 'claude', pane_id: 'wP:p1', args: [] });

test('an agent start refused because the pane has no shell yet is retried until it succeeds', () => {
  const s = startStub({ refusals: 2, message: NOT_A_SHELL });
  start(createHerdr({ bin: s.bin, ...quick }));
  assert.equal(s.calls(), 3);
});

test('an agent start that never gets a shell fails with herdr text and how long crew waited', () => {
  const s = startStub({ refusals: 1000, message: NOT_A_SHELL });
  const started = Date.now();
  assert.throws(
    () => start(createHerdr({ bin: s.bin, startWaitMs: 1500, startRetryMs: 20 })),
    (err) => {
      assert.ok(err instanceof HerdrError);
      assert.equal(err.code, 'pane_not_ready');
      assert.ok(err.message.includes(NOT_A_SHELL));
      assert.match(err.message, /waited \d+(\.\d+)? seconds? for the pane/);
      return true;
    },
  );
  assert.ok(s.calls() > 1, 'it retried');
  assert.ok(Date.now() - started < 10000, 'the wait is bounded');
});

test('any other start error fails at once, without a retry', () => {
  const s = startStub({ refusals: 1000, code: 'invalid_kind', message: 'unknown agent kind' });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'invalid_kind');
  assert.equal(s.calls(), 1);
});

test('agent_not_ready is not retried, whatever its text says', () => {
  const s = startStub({ refusals: 1000, code: 'agent_not_ready', message: NOT_A_SHELL });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'agent_not_ready');
  assert.equal(s.calls(), 1);
});
