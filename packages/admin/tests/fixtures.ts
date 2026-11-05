import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { parseDocument, isSeq, isMap } from 'yaml'

export const MEMBERS_YAML = `schema_version: "2.0"

# Members Registry
# Keep handles current — agents use them for outreach.

members:
  - id: "steward-a"
    name: "Steward A"
    role: "Core Steward"
    layer: "core"
    status: "active"
    joined: "2023-01-15"
    handles:
      git: ["admin-test@local"]
  - id: "ana"
    name: "Ana Silva" # prefers async comms
    role: "Contributor"
    layer: "contributor"
    status: "active"
    joined: "2025-02-01"
`

export const PROJECTS_YAML = `schema_version: "2.0"

# Projects Registry
# IDEA lifecycle: idea -> develop -> execute -> archive

projects:
  - id: "proj-001"
    title: "Node Onboarding Program"
    status: "execute"
    type: "program"
    lead: "steward-a"
    contributors: ["ana"]
    tags: ["nodes", "onboarding"]
`

export const FINANCES_YAML = `schema_version: "2.0"
finances:
  treasury:
    primary_safe: "0xabc"
    chain: "optimism"
  budgets: []
  expenses: []
  revenues: []
`

export const IDEAS_YAML = `schema_version: "2.0"
ideas: []
`

/** data/systems.yaml as the 0.6 migration writes it (F1 §3.4). Not part of makeFixtureRepo. */
export const SYSTEMS_YAML = `schema_version: "1.0"
systems:
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "0x1111111111111111111111111111111111111111"
    driver: "safe"
    section: "organization/treasury"
`

export const FEDERATION_YAML = `identity:
  name: "Fixture Org"
  type: "Organization"
`

/** The git email every fixture repository commits with. A member's handles.git holds it, so every
 *  write passes Apply's actor check (P1 spec 7.1). */
export const TEST_EMAIL = 'admin-test@local'

/** The real registries hold no test email, so their copy gets a member of its own, appended last:
 *  every real entry keeps its bytes. */
const TEST_MEMBER = `  - id: "admin-test"\n    name: "Admin Test"\n    kind: "person"\n    handles:\n      git: ["${TEST_EMAIL}"]\n`

function addTestMember(dir: string): void {
  const path = join(dir, 'data', 'members.yaml')
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8').replace(/\s*$/, '\n') + TEST_MEMBER
  const seq = parseDocument(text).get('members')
  const last = isSeq(seq) ? seq.items.at(-1) : null
  if (!isMap(last) || last.get('id') !== 'admin-test') {
    throw new Error('makeRealDataRepo: data/members.yaml does not end with its members list, so the test member could not be appended; insert it where the list ends, in addTestMember.')
  }
  writeFileSync(path, text)
}

export function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'admin-fixture-'))
  mkdirSync(join(dir, 'data'))
  writeFileSync(join(dir, 'data', 'members.yaml'), MEMBERS_YAML)
  writeFileSync(join(dir, 'data', 'projects.yaml'), PROJECTS_YAML)
  writeFileSync(join(dir, 'data', 'finances.yaml'), FINANCES_YAML)
  writeFileSync(join(dir, 'data', 'ideas.yaml'), IDEAS_YAML)
  writeFileSync(join(dir, 'federation.yaml'), FEDERATION_YAML)
  const git = (cmd: string) =>
    execSync(`git ${cmd}`, { cwd: dir, stdio: 'pipe' })
  git('init -q -b main')
  git(`config user.email ${TEST_EMAIL}`)
  git('config user.name admin-test')
  git('add -A')
  git('commit -qm "fixture: initial state"')
  return dir
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The repository this package lives in: its `data/` is the real-registry corpus. */
export const REAL_REPO = join(PACKAGE_ROOT, '..', '..')
/** This package's JSON Schemas, one per registry. */
export const PACKAGE_SCHEMAS = join(PACKAGE_ROOT, 'schemas')

/** A git repo holding a COPY of this repository's real `data/*.yaml`, under
 *  `packages/admin/.scratch/` (ignored). Tests that save run against the copy:
 *  nothing is ever written to the repository's own `data/`. */
export function makeRealDataRepo(): string {
  mkdirSync(join(PACKAGE_ROOT, '.scratch'), { recursive: true })
  const dir = mkdtempSync(join(PACKAGE_ROOT, '.scratch', 'real-'))
  mkdirSync(join(dir, 'data'))
  for (const file of readdirSync(join(REAL_REPO, 'data'))) {
    if (file.endsWith('.yaml')) copyFileSync(join(REAL_REPO, 'data', file), join(dir, 'data', file))
  }
  copyFileSync(join(REAL_REPO, 'federation.yaml'), join(dir, 'federation.yaml'))
  addTestMember(dir)
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: dir, stdio: 'pipe' })
  git('init -q -b main')
  git(`config user.email ${TEST_EMAIL}`)
  git('config user.name admin-test')
  git('add -A')
  git('commit -qm "scratch: copy of the real registries"')
  return dir
}

export function removeFixtureRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** data/boards.yaml (P4 §5.1). Not part of makeFixtureRepo. */
export const BOARDS_YAML = `schema_version: "1.0"
boards:
  - id: "treasury"
    name: "Treasury & council"
    audience: "members"
    layout: "grid"
    blocks:
      - id: "open-projects"
        type: "list"
        title: "Open projects"
        source: { kind: "project", where: { status: { not: "done" } }, sort: "title" }
        place: { col: 1, span: 8, row: 1 }
      - id: "hello"
        type: "note"
        text: "The council meets Thursdays."
        place: { col: 9, span: 4, row: 1 }
`
