import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

export const MEMBERS_YAML = `schema_version: "2.0"

# Members Registry
# Keep handles current — agents use them for outreach.

members:
  - id: "luiz"
    name: "Luiz Fernando"
    role: "Core Steward"
    layer: "core"
    status: "active"
    joined: "2023-01-15"
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
    lead: "luiz"
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

export const FEDERATION_YAML = `identity:
  name: "Fixture Org"
  type: "Organization"
`

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
  git('config user.email admin-test@local')
  git('config user.name admin-test')
  git('add -A')
  git('commit -qm "fixture: initial state"')
  return dir
}

export function removeFixtureRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
