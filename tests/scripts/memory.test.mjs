// tests/scripts/memory.test.mjs
//
// DAO-OS L6 §14 (Q76), Task 15: `npm run memory`. A members entry (org memory) is appended to memory/<date>.md in the
// repository and nothing is committed (the session's close commits it); a stricter entry (Council memory) is posted to
// the running Hub's POST /api/memory, so the gate applies, and with no Hub it is refused in the spec's words, never
// written to git instead. Every repository is a fresh temporary one; the "Hub" here is a stub on this machine's loopback
// (the real route, and the command against a real Hub, are packages/admin/tests/workspace/memory.test.ts). The close
// skill's memory step names both levels and the command, and its generated copy is what sync-commands makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'memory.mjs');
const OPS = 'hat:eip155:42220:0x0000000d0002000000000000000000000000000000000000000000000000';
const NO_HUB =
  'Council memory is written through the Hub, so it can be read only by those it is for: start it (npm start), then run this again.';

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', env: gitEnv }).trim();

function tempRepo(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'memory-cmd-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'steward-a@example.org');
  git(dir, 'config', 'user.name', 'Steward A');
  writeFileSync(path.join(dir, 'federation.yaml'), 'identity:\n  name: "Fixture Org"\n');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'fixture');
  return dir;
}

/** The command, run as a child (asynchronously, so a stub Hub in this process can answer it). */
function run(args, { input, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], {
      cwd: root,
      env: { ...gitEnv, ORG_OS_HUB_URL: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

/** A stub Hub on 127.0.0.1: answers /api/status with `org` and /api/memory as `answer` says; keeps what it was sent. */
async function stubHub({ org = 'Fixture Org', answer = () => ({ status: 201, body: { id: '2026-10-30-1', visibility: OPS } }) } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      let out = { status: 404, body: { error: 'no such route' } };
      if (req.url === '/api/status') out = { status: 200, body: { org, branch: 'main', dirty: false } };
      else if (req.url.startsWith('/api/memory')) out = answer(req, body);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://localhost:${port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

/** A port on this machine nothing listens on. */
async function closedPort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

const cleanup = [];
test.after(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
});

test('memory add --level members appends to memory/<date>.md and commits nothing', async () => {
  const repo = tempRepo({ 'memory/2026-10-30.md': '# 2026-10-30\n\n## Session — 09:00\n\nEarlier.\n' });
  cleanup.push(repo);
  const head = git(repo, 'rev-parse', 'HEAD');
  const entry = path.join(repo, '..', `${path.basename(repo)}-entry.md`);
  cleanup.push(entry);
  writeFileSync(entry, '**Focus:** the handbook.\n');
  const r = await run(['add', '--dir', repo, '--level', 'members', '--date', '2026-10-30', '--title', 'Session — 14:00', '--file', entry]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(path.join(repo, 'memory', '2026-10-30.md'), 'utf8'),
    '# 2026-10-30\n\n## Session — 09:00\n\nEarlier.\n\n## Session — 14:00\n\n**Focus:** the handbook.\n',
  );
  assert.match(r.stdout, /memory\/2026-10-30\.md/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head, 'a commit was made');
  assert.equal(git(repo, 'status', '--porcelain'), 'M memory/2026-10-30.md');
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), '', 'something was staged');

  // A day with no file yet: the file is made, with its heading; the body from stdin.
  const r2 = await run(['add', '--dir', repo, '--level', 'members', '--date', '2026-10-31', '--title', 'Session — 08:00', '-'], { input: 'Read the queue.' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(readFileSync(path.join(repo, 'memory', '2026-10-31.md'), 'utf8'), '# 2026-10-31\n\n## Session — 08:00\n\nRead the queue.\n');
  assert.equal(git(repo, 'rev-parse', 'HEAD'), head);
});

// L6 carries K3: a members body (or a title) cannot forge an entry in memory/<date>.md. A body line that reads as a level
// one or two heading (ATX, or a setext underline, which also covers the `---` that separates sessions) is escaped, so
// the entry's own `## <title>` is the only entry heading the command writes; `###` and below stay (the close's format).
test('memory add --level members escapes a body line that would read as an entry heading or a separator (K3)', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const body = [
    '**Focus:** the handbook.',
    '## Session — 23:59',
    '   # Forged title',
    '\t## Indented by a tab is code, kept',
    'A paragraph line',
    '---',
    'Another one',
    '===',
    '### Key Decisions',
    '- kept as written',
    'Carriage\r## Forged by a carriage return',
  ].join('\n');
  const r = await run(['add', '--dir', repo, '--level', 'members', '--date', '2026-10-30', '--title', '## Not a second heading', '-'], { input: body });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(path.join(repo, 'memory', '2026-10-30.md'), 'utf8');
  assert.equal(text, [
    '# 2026-10-30',
    '',
    '## \\## Not a second heading',
    '',
    '**Focus:** the handbook.',
    '\\## Session — 23:59',
    '   \\# Forged title',
    '\t## Indented by a tab is code, kept',
    'A paragraph line',
    '\\---',
    'Another one',
    '\\===',
    '### Key Decisions',
    '- kept as written',
    'Carriage',
    '\\## Forged by a carriage return',
    '',
  ].join('\n'));
  // The only lines read as entries are the command's own.
  const list = await run(['list', '--dir', repo, '--date', '2026-10-30']);
  assert.equal(list.stdout.split('\n').filter((l) => l.startsWith('members ·')).length, 1, list.stdout);
});

test('--level hat:<ops hat> posts the entry to the Hub as JSON, and writes nothing in the repository', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const hub = await stubHub();
  try {
    const r = await run(
      ['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'Payroll talk', '--session', 'ses-1', '--hub', hub.url, '-'],
      { input: 'Steward B asked about the payout.\n' },
    );
    assert.equal(r.status, 0, r.stderr);
    const post = hub.seen.find((s) => s.method === 'POST');
    assert.equal(post.url, '/api/memory');
    assert.match(post.headers['content-type'], /^application\/json/);
    assert.equal(post.headers.origin, undefined, 'a command sends no Origin');
    assert.deepEqual(JSON.parse(post.body), {
      level: OPS, date: '2026-10-30', title: 'Payroll talk', body: 'Steward B asked about the payout.\n', session: 'ses-1',
    });
    assert.match(r.stdout, /2026-10-30-1/);
    assert.ok(!existsSync(path.join(repo, 'memory')), 'a Council entry reached the repository');
    assert.equal(git(repo, 'status', '--porcelain'), '');
  } finally {
    await hub.close();
  }
});

test("with no Hub running it refuses with the spec's sentence, and writes nothing", async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const port = await closedPort();
  const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'Payroll talk', '--hub', `http://localhost:${port}`, '-'], { input: 'Secret.\n' });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes(NO_HUB), r.stderr);
  assert.ok(!existsSync(path.join(repo, 'memory')));
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test("the Hub's refusal is said in its own words; a Hub of another organisation is never written to", async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const refusing = await stubHub({ answer: () => ({ status: 403, body: { error: 'hat:… is a level you are not admitted to. Nothing was written.' } }) });
  try {
    const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', refusing.url, '-'], { input: 'x' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not admitted to\. Nothing was written\./);
  } finally {
    await refusing.close();
  }
  const other = await stubHub({ org: 'Another Org' });
  try {
    const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', other.url, '-'], { input: 'x' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /serves Another Org, not Fixture Org/);
    assert.equal(other.seen.filter((s) => s.method === 'POST').length, 0, 'the entry was sent to another organisation');
  } finally {
    await other.close();
  }
});

test('a Hub that is not on this machine is refused before anything is sent', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', 'https://hub.example.org', '-'], { input: 'x' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /only on this machine/);
});

test('a bad call is refused in words: no level, members-or-stricter, a date that is not one, no body source', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const base = ['add', '--dir', repo, '--date', '2026-10-30', '--title', 'T'];
  for (const [args, said] of [
    [[...base, '-'], /--level/],
    [[...base, '--level', 'public', '-'], /public/],
    [[...base, '--level', 'hat:', '-'], /not a level/],
    [['add', '--dir', repo, '--level', 'members', '--date', '30/10/2026', '--title', 'T', '-'], /YYYY-MM-DD/],
    [['add', '--dir', repo, '--level', 'members', '--date', '2026-10-30', '-'], /--title/],
    [[...base, '--level', 'members'], /--file <md> or -/],
  ]) {
    const r = await run(args, { input: 'x' });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, said);
  }
  assert.ok(!existsSync(path.join(repo, 'memory')));
});

test('memory list --date lists both: the org memory headings, and the Council entries as the Hub answers', async () => {
  const repo = tempRepo({ 'memory/2026-10-30.md': '# 2026-10-30\n\n## Session — 09:00\n\nEarlier.\n\n## Session — 14:00\n\nLater.\n' });
  cleanup.push(repo);
  const hub = await stubHub({
    answer: (req) => ({ status: 200, body: { entries: req.url === '/api/memory?date=2026-10-30' ? [{ id: '2026-10-30-1', date: '2026-10-30', title: 'Payroll talk', visibility: OPS }] : [] } }),
  });
  try {
    const r = await run(['list', '--dir', repo, '--date', '2026-10-30', '--hub', hub.url]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /members · memory\/2026-10-30\.md · Session — 09:00/);
    assert.match(r.stdout, /members · memory\/2026-10-30\.md · Session — 14:00/);
    assert.match(r.stdout, /hat:eip155:42220:0x0000000d0002\S* · 2026-10-30-1 · Payroll talk/);
  } finally {
    await hub.close();
  }
  const port = await closedPort();
  const r = await run(['list', '--dir', repo, '--date', '2026-10-30', '--hub', `http://localhost:${port}`]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Session — 09:00/);
  assert.ok(r.stdout.includes(`Council memory is not listed: ${NO_HUB}`), r.stdout);
});

test('a --file that cannot be read is a usage error in words, exit 2, and nothing is written (Task 15 review M-7)', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const missing = path.join(repo, '..', `${path.basename(repo)}-no-such-entry.md`);
  for (const level of ['members', OPS]) {
    const r = await run(['add', '--dir', repo, '--level', level, '--date', '2026-10-31', '--title', 'T', '--hub', 'http://localhost:9', '--file', missing]);
    assert.equal(r.status, 2, `${level}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /cannot be read.*Nothing was written\./);
    assert.ok(!r.stderr.includes('    at '), 'a stack trace was printed');
  }
  assert.ok(!existsSync(path.join(repo, 'memory')));
});

/** A server on 127.0.0.1 answering with `handle(req, body)` → { status, headers?, body? }; keeps what it was sent. */
async function server(handle) {
  const seen = [];
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const out = handle(req, body);
      res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) });
      res.end(out.body === undefined ? '' : JSON.stringify(out.body));
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://localhost:${s.address().port}`, seen, close: () => new Promise((r) => s.close(r)) };
}

test('a Hub that answers with a redirect is refused, and nothing is sent on (Task 15 review M-1)', async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const elsewhere = await server(() => ({ status: 201, body: { id: 'taken', visibility: OPS } }));
  const viaPost = await server((req) => (req.url === '/api/status'
    ? { status: 200, body: { org: 'Fixture Org' } }
    : { status: 307, headers: { location: `${elsewhere.url}/elsewhere` } }));
  const viaStatus = await server(() => ({ status: 302, headers: { location: `${elsewhere.url}/api/status` } }));
  try {
    for (const hub of [viaPost, viaStatus]) {
      const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', hub.url, '-'], { input: 'Kept quiet.\n' });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /redirect/i);
      assert.match(r.stderr, /Nothing was written\./);
    }
    assert.deepEqual(elsewhere.seen, [], 'the entry was sent on to where the redirect pointed');
    assert.equal(viaStatus.seen.filter((x) => x.method === 'POST').length, 0);
  } finally {
    for (const s of [elsewhere, viaPost, viaStatus]) await s.close();
  }
});

test("the Hub's organisation is checked closed: a status that is not 200 with this instance's name, or an instance with no name, sends nothing (Task 15 review M-2)", async () => {
  const repo = tempRepo();
  cleanup.push(repo);
  const unnamed = tempRepo();
  cleanup.push(unnamed);
  writeFileSync(path.join(unnamed, 'federation.yaml'), 'identity:\n  type: "Cooperative"\n');
  const answers = [
    { status: 500, body: {} },
    { status: 200, body: {} },
    { status: 200, body: { org: 7 } },
    { status: 200, body: { org: 'Fixture Org Two' } },
  ];
  for (const answer of answers) {
    const hub = await server((req) => (req.url === '/api/status' ? answer : { status: 201, body: { id: 'posted', visibility: OPS } }));
    try {
      const r = await run(['add', '--dir', repo, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', hub.url, '-'], { input: 'x' });
      assert.equal(r.status, 1, `${JSON.stringify(answer)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /Nothing was written\./);
      assert.equal(hub.seen.filter((x) => x.method === 'POST').length, 0, `${JSON.stringify(answer)}: the entry was posted`);
    } finally {
      await hub.close();
    }
  }
  // An instance that names no organisation cannot be matched with any Hub's: refused, nothing posted.
  const hub = await server((req) => (req.url === '/api/status' ? { status: 200, body: { org: 'org' } } : { status: 201, body: { id: 'posted' } }));
  try {
    const r = await run(['add', '--dir', unnamed, '--level', OPS, '--date', '2026-10-30', '--title', 'T', '--hub', hub.url, '-'], { input: 'x' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /names no organisation/);
    assert.equal(hub.seen.filter((x) => x.method === 'POST').length, 0);
  } finally {
    await hub.close();
  }
});

test("the generated close skill's memory step names both levels and the command, and is what sync-commands makes", () => {
  const source = readFileSync(path.join(root, '.claude', 'commands', 'close.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'skills', 'commands', 'close', 'SKILL.md'), 'utf8');
  const step2 = (text) => {
    const at = text.indexOf('## 2. Write Memory');
    assert.ok(at >= 0, 'no step 2');
    return text.slice(at, text.indexOf('\n## 3.', at));
  };
  for (const text of [source, skill]) {
    const s = step2(text);
    assert.match(s, /members or Council\?/);
    assert.match(s, /npm run memory -- add --level members/);
    assert.match(s, /npm run memory -- add --level hat:/);
    assert.match(s, /council-memory/);
    assert.match(s, /never .*memory\//i);
    // A LEVEL refusal is never met by lowering the entry's level (Task 15 review I-2): it stays out of memory/, and a
    // steward is asked.
    assert.match(s, /`LEVEL`[^.]*never (?:write|lower)[^.]*(?:wider|level)/);
    assert.match(s, /out of `memory\/`[^.]*ask a steward/);
    // Where a Council entry's body goes (Task 15 review M-3): stdin from a heredoc, or a mktemp file outside the
    // repository, removed after; never a file in the repository.
    assert.match(s, /add --level hat:[^\n]* - <<'COUNCIL_ENTRY_EOF'/);
    assert.match(s, /`mktemp`[^.]*outside the repository[^.]*remove/);
    // The members-or-Council question covers what else the close writes: the summary, the Buzz digest, the commit message.
    assert.match(s, /Session Summary[^.]*Buzz digest[^.]*commit message[^.]*members-level/);
    assert.match(s, /a Council matter is never in any of them/);
  }
  // Step 8b posts the summary: members-level lines only.
  assert.match(source, /## 8b\.[\s\S]*?members-level[\s\S]*?## 9\./);
  // MEMORY.md's index keeps only members-level lines.
  assert.match(source, /## 4\. Update MEMORY\.md[\s\S]*members-level lines only/);
  // The generated copy is the source's body as scripts/sync-commands.mjs writes it ($ARGUMENTS stripped).
  const body = source.replace(/^---[\s\S]*?\n---\n/, '').trim().replace(/\n*\$ARGUMENTS\s*$/, '').trimEnd();
  const generated = skill.slice(skill.indexOf('-->\n') + 4).trim();
  assert.equal(generated, body, 'skills/commands/close/SKILL.md is stale: run npm run sync:commands');
});

// L6 carries K9: the init skill's close phase, which an agent may follow instead of the close command, asks the same
// question of each memory entry and names the same command.
test("the init skill's close phase asks members or Council of each memory entry and names npm run memory", () => {
  const text = readFileSync(path.join(root, 'skills', 'org-os-init', 'SKILL.md'), 'utf8');
  const at = text.indexOf('## Phase 4');
  assert.ok(at >= 0, 'no Phase 4');
  const phase = text.slice(at, text.indexOf('\n## Phase 5', at) === -1 ? undefined : text.indexOf('\n## Phase 5', at));
  const step = phase.slice(phase.indexOf('2. **Write memory**'), phase.indexOf('3. **Update HEARTBEAT.md**'));
  assert.match(step, /members or Council\?/);
  assert.match(step, /npm run memory -- add --level members/);
  assert.match(step, /npm run memory -- add --level hat:/);
  assert.match(step, /never in `memory\/`/);
  assert.match(step, /When unsure, it is Council/);
});
