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

// A stand-in herdr that answers each read-only call and `agent start` from a
// shell snippet. In a snippet, $n is how many times that command has been called
// (1 for the first). Every call's arguments are logged, so a test can show that
// a second start was never sent.
function herdrStub({ start, info, list }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'crew-herdr-stub-')));
  const unexpected = `echo '{"error":{"code":"unexpected","message":"unexpected call"}}' >&2; exit 1`;
  const bin = stub(
    [
      `d='${dir}'`,
      'key="$1_$2"',
      'n=$(cat "$d/$key.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/$key.n"',
      'echo "$*" >> "$d/log"',
      'case "$key" in',
      `  agent_start) ${start ?? unexpected} ;;`,
      `  pane_process-info) ${info ?? unexpected} ;;`,
      `  agent_list) ${list ?? unexpected} ;;`,
      `  *) ${unexpected} ;;`,
      'esac',
    ].join('\n'),
  );
  const count = (key) => {
    try {
      return Number(readFileSync(join(dir, `${key}.n`), 'utf-8').trim());
    } catch {
      return 0;
    }
  };
  return { bin, starts: () => count('agent_start'), infos: () => count('pane_process-info'), lists: () => count('agent_list') };
}

const refuse = (code, message) => `echo '${JSON.stringify({ error: { code, message } })}' >&2; exit 1`;
const OK = `echo '{"result":{}}'`;
const NOT_A_SHELL = 'agent target pane wP:p1 is not an available shell';
const BUSY = refuse('agent_pane_busy', NOT_A_SHELL);

// What `herdr pane process-info` returns: the shape was read from herdr 0.9.1.
const processInfo = (foregroundPgid, procs) =>
  `echo '${JSON.stringify({
    id: 'cli:pane:process_info',
    result: {
      process_info: {
        foreground_process_group_id: foregroundPgid,
        foreground_processes: procs.map(([name, pid, argv0 = name]) => ({ name, pid, argv0, argv: [argv0] })),
        pane_id: 'wP:p1',
        shell_pid: 100,
      },
    },
  })}'`;
const BARE_SHELL = processInfo(100, [['zsh', 100]]); // shell is the foreground: ready
const SHELL_STARTING = processInfo(250, [['sleep', 250]]); // rc file still running something in the foreground
const AGENT_RUNNING = processInfo(300, [['2.1.296', 300, 'claude']]);

const agentList = (agents) => `echo '${JSON.stringify({ result: { agents } })}'`;
const NO_AGENTS = agentList([]);
const ENGINEER_THERE = agentList([{ name: 'engineer', pane_id: 'wP:p1', workspace_id: 'wP', agent: 'claude', agent_status: 'idle' }]);

const quick = { startWaitMs: 2000, startRetryMs: 20 };
const start = (herdr) => herdr.startAgent({ name: 'engineer', kind: 'claude', pane_id: 'wP:p1', args: [] });

test('a start refused with agent_pane_busy while the shell is still starting is retried until it succeeds', () => {
  // the message is not the one crew used to match on: the code alone decides
  const s = herdrStub({ start: `if [ "$n" -le 2 ]; then ${refuse('agent_pane_busy', 'pane busy')}; else ${OK}; fi`, info: SHELL_STARTING, list: NO_AGENTS });
  start(createHerdr({ bin: s.bin, ...quick }));
  assert.equal(s.starts(), 3);
  assert.ok(s.infos() >= 2, 'it looked at the pane each time it was refused');
});

test('agent_pane_busy on a pane that already hosts an agent is not retried', () => {
  for (const [what, spec] of [
    ['an agent in the foreground', { info: AGENT_RUNNING, list: NO_AGENTS }],
    ['an agent herdr lists on that pane', { info: SHELL_STARTING, list: ENGINEER_THERE }],
  ]) {
    const s = herdrStub({ start: BUSY, ...spec });
    assert.throws(
      () => start(createHerdr({ bin: s.bin, ...quick })),
      (err) => {
        assert.ok(err instanceof HerdrError);
        assert.equal(err.code, 'agent_pane_busy');
        assert.match(err.message, /already (has|hosts|runs)/i);
        return true;
      },
      what,
    );
    assert.equal(s.starts(), 1, what);
  }
});

test('a busy answer when the pane cannot be inspected fails at once, saying why', () => {
  const s = herdrStub({ start: BUSY, info: refuse('pane_not_found', 'pane not found'), list: NO_AGENTS });
  assert.throws(
    () => start(createHerdr({ bin: s.bin, ...quick })),
    (err) => err.code === 'agent_pane_busy' && /could not (look|inspect|read)/i.test(err.message),
  );
  assert.equal(s.starts(), 1);
});

test('a bare shell that is the foreground and still refused is tried once more, then reported', () => {
  const s = herdrStub({ start: BUSY, info: BARE_SHELL, list: NO_AGENTS });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'agent_pane_busy');
  assert.equal(s.starts(), 2);
});

test('a shell that never reaches the foreground fails with herdr text, what was still running and how long crew waited', () => {
  const s = herdrStub({ start: BUSY, info: SHELL_STARTING, list: NO_AGENTS });
  const began = Date.now();
  assert.throws(
    () => start(createHerdr({ bin: s.bin, startWaitMs: 1500, startRetryMs: 20 })),
    (err) => {
      assert.ok(err instanceof HerdrError);
      assert.equal(err.code, 'agent_pane_busy');
      assert.ok(err.message.includes(NOT_A_SHELL));
      assert.match(err.message, /waited \d+(\.\d+)? seconds? for the pane/);
      assert.match(err.message, /sleep/);
      return true;
    },
  );
  assert.ok(s.starts() > 1, 'it retried');
  assert.ok(Date.now() - began < 10000, 'the wait is bounded');
});

test('an unknown code with the old message is still recognised, and only after the pane was inspected', () => {
  const s = herdrStub({ start: `if [ "$n" -le 1 ]; then ${refuse('pane_not_ready', NOT_A_SHELL)}; else ${OK}; fi`, info: SHELL_STARTING, list: NO_AGENTS });
  start(createHerdr({ bin: s.bin, ...quick }));
  assert.equal(s.starts(), 2);
  assert.ok(s.infos() >= 1);
});

test('any other start error fails at once, without a retry or a look', () => {
  const s = herdrStub({ start: refuse('invalid_agent_name', 'bad name') });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'invalid_agent_name');
  assert.equal(s.starts(), 1);
  assert.equal(s.infos() + s.lists(), 0);
});

test('agent_not_ready is not retried, whatever its text says', () => {
  const s = herdrStub({ start: refuse('agent_not_ready', NOT_A_SHELL), info: SHELL_STARTING, list: NO_AGENTS });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'agent_not_ready');
  assert.equal(s.starts(), 1);
});

test('a start that was cut off is looked for with a read-only call; an agent that is there means it took', () => {
  const s = herdrStub({ start: 'exec sleep 30', info: SHELL_STARTING, list: ENGINEER_THERE });
  start(createHerdr({ bin: s.bin, timeoutMs: 1500, ...quick })); // does not throw
  assert.equal(s.starts(), 1, 'never started twice');
  assert.ok(s.lists() >= 1);
});

test('a start that was cut off and found nowhere fails with the cut-off error, once, saying it looked', () => {
  for (const [what, startSnippet, code] of [
    ['a timeout', 'exec sleep 30', 'herdr_timeout'],
    ['a transport failure', refuse('agent_start_transport_failed', 'connection lost'), 'agent_start_transport_failed'],
  ]) {
    const s = herdrStub({ start: startSnippet, info: SHELL_STARTING, list: NO_AGENTS });
    assert.throws(
      () => start(createHerdr({ bin: s.bin, timeoutMs: 1500, ...quick })),
      (err) => err.code === code && /looked|no agent/i.test(err.message),
      what,
    );
    assert.equal(s.starts(), 1, what);
  }
});

test('when the look itself fails, the cut-off error is the one reported', () => {
  const s = herdrStub({ start: 'exec sleep 30', info: SHELL_STARTING, list: refuse('herdr_error', 'socket closed') });
  assert.throws(() => start(createHerdr({ bin: s.bin, timeoutMs: 1500, ...quick })), (err) => err.code === 'herdr_timeout');
  assert.equal(s.starts(), 1);
});

test('agent_name_taken on a second start means the first one took, when that agent is in this pane', () => {
  const s = herdrStub({
    start: `if [ "$n" -le 1 ]; then ${BUSY}; else ${refuse('agent_name_taken', 'agent name engineer is already in use')}; fi`,
    info: SHELL_STARTING,
    // empty while the shell is starting, then the first start's agent appears
    list: `if [ "$n" -le 1 ]; then ${NO_AGENTS}; else ${ENGINEER_THERE}; fi`,
  });
  start(createHerdr({ bin: s.bin, ...quick }));
  assert.equal(s.starts(), 2);
});

test('agent_name_taken by an agent in another pane is a failure, not a success', () => {
  const elsewhere = agentList([{ name: 'engineer', pane_id: 'w9:p1', workspace_id: 'w9', agent: 'claude', agent_status: 'idle' }]);
  const s = herdrStub({ start: refuse('agent_name_taken', 'agent name engineer is already in use'), info: SHELL_STARTING, list: elsewhere });
  assert.throws(() => start(createHerdr({ bin: s.bin, ...quick })), (err) => err.code === 'agent_name_taken');
  assert.equal(s.starts(), 1);
});
