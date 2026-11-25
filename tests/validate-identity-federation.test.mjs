import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = resolve(import.meta.dirname, '../scripts/validate-identity.mjs')

function fixture(peersYaml) {
  const tmp = mkdtempSync(join(tmpdir(), 'validate-fed-'))
  const me = join(tmp, 'me')
  mkdirSync(me)
  mkdirSync(join(tmp, 'site'))
  mkdirSync(join(me, '.well-known'))
  for (const f of ['dao', 'members', 'projects', 'finances', 'activities', 'proposals', 'contracts']) {
    writeFileSync(join(me, '.well-known', `${f}.json`), JSON.stringify({ '@context': 'https://www.daostar.org/schemas', name: 'Me Node' }))
  }
  writeFileSync(join(me, 'IDENTITY.md'), '# Identity\n\n- **Name:** Me Node\n- **Type:** LocalNode\n')
  writeFileSync(join(me, 'federation.yaml'), [
    'identity:', '  name: Me Node', '  type: LocalNode',
    'metadata:', '  framework_version: "0.6"', `  genesis_commit: ${'a'.repeat(40)}`, '  last_sync_commit: null',
    peersYaml, '',
  ].join('\n'))
  return { tmp, me }
}

const run = (me, ...flags) => spawnSync(process.execPath, [script, me, ...flags], { encoding: 'utf8' })

test('a repo listed as a peer is a warning, and an error only under --strict', () => {
  const { tmp, me } = fixture('peers:\n  - name: site\n    repo: ../site\n')
  try {
    const r = run(me)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /peer "site": a repo, not an org-os instance — map it as a System in data\/systems\.yaml/)
    const s = run(me, '--strict')
    assert.equal(s.status, 1, s.stdout)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a one-sided link and a missing folder are warnings', () => {
  const { tmp, me } = fixture('peers:\n  - name: other\n    repo: ../other\n  - name: gone\n    repo: ../gone\n')
  try {
    mkdirSync(join(tmp, 'other'))
    writeFileSync(join(tmp, 'other', 'federation.yaml'), 'identity:\n  name: Other\npeers: []\n')
    const r = run(me)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /peer "other": only this side lists the link/)
    assert.match(r.stdout, /peer "gone": no folder at /)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('the fixture itself is clean under --strict, so the warnings above are the only cause', () => {
  const { tmp, me } = fixture('peers: []')
  try {
    const s = run(me, '--strict')
    assert.equal(s.status, 0, s.stdout)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test("a network hub or join.where that won't be published is a warning (final review I2)", () => {
  const { tmp, me } = fixture([
    'networks:', '  - name: far', '    hub: https://nas/', '  - name: near', '    hub: github.com/near-org', '  - name: bare',
    'join:', '  policy: invite', '  where: ../ask-here', 'peers: []',
  ].join('\n'))
  try {
    const r = run(me)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /network "far": its hub isn't a public https address, so it won't be published/)
    assert.doesNotMatch(r.stdout, /network "near"|network "bare"/)
    assert.match(r.stdout, /join\.where isn't a public https address, so it won't be published/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('peers nested under federation: are read, with a warning to move them up (final review C1)', () => {
  const { tmp, me } = fixture('federation:\n  peers:\n    - name: gone\n      repo: ../gone\n')
  try {
    const r = run(me)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /federation\.peers is read as peers; move it to the top level\./)
    assert.match(r.stdout, /peer "gone": no folder at /)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a sibling listed by a vault-relative path is found and read (final review I1)', () => {
  const { tmp, me } = fixture("peers:\n  - name: other\n    repo: '03 Libs/other'\n")
  try {
    mkdirSync(join(tmp, '03 Libs', 'other'), { recursive: true })
    writeFileSync(join(tmp, '03 Libs', 'other', 'federation.yaml'), 'identity:\n  name: Other\npeers: []\n')
    const r = run(me)
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /peer "other": only this side lists the link/)
    assert.doesNotMatch(r.stdout, /no folder at/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('only the origin remote is this instance: a sibling listing the upstream template is one-sided (N2 Task 12)', () => {
  const { tmp, me } = fixture('peers:\n  - name: other\n    repo: ../other\n')
  try {
    const git = (...a) => { const r = spawnSync('git', a, { cwd: me, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr) }
    git('init', '-q')
    git('remote', 'add', 'origin', 'https://github.com/me-org/me-node')
    git('remote', 'add', 'upstream', 'https://github.com/template-org/org-os')
    mkdirSync(join(tmp, 'other'))
    const otherLists = url => writeFileSync(join(tmp, 'other', 'federation.yaml'), `identity:\n  name: Other\npeers:\n  - name: them\n    url: ${url}\n`)
    otherLists('https://github.com/template-org/org-os')
    const up = run(me)
    assert.equal(up.status, 0, up.stdout)
    assert.match(up.stdout, /peer "other": only this side lists the link/)
    otherLists('https://github.com/me-org/me-node')
    const origin = run(me)
    assert.equal(origin.status, 0, origin.stdout)
    assert.doesNotMatch(origin.stdout, /peer "other"/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})
