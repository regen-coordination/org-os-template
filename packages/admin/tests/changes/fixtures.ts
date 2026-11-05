import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, MEMBERS_YAML, PROJECTS_YAML } from '../fixtures.ts'

export const SOLO = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  decisions: []
`
export const CONSENSUS = `schema_version: "2.0"
governance:
  model: "consensus"
  decisions: []
`

/** makeFixtureRepo (whose git email is member steward-a's), plus a governance file, committed: two
 *  commits in all. With null there is no governance file (the solo default), and one commit. */
export function makeChangeRepo(governance: string | null = SOLO): string {
  const repo = makeFixtureRepo()
  if (governance !== null) {
    writeFileSync(join(repo, 'data', 'governance.yaml'), governance)
    execSync('git add -A', { cwd: repo, stdio: 'pipe' })
    execSync('git commit -qm "fixture: a governance file"', { cwd: repo, stdio: 'pipe' })
  }
  return repo
}

export const git = (repo: string, cmd: string): string => execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe' }).toString()

/** makeChangeRepo with synthetic members only: bruno (who holds the test email, so every commit is his) and ana, as the
 *  base fixture's two; proj-001 is led by bruno. One commit more than makeChangeRepo. */
export function makeSyntheticRepo(governance: string | null = SOLO): string {
  const repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS_YAML.replace(/"steward-a"/g, '"bruno"').replace('"Steward A"', '"Bruno Lima"'))
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS_YAML.replace('lead: "steward-a"', 'lead: "bruno"'))
  execSync('git add -A', { cwd: repo, stdio: 'pipe' })
  execSync('git commit -qm "fixture: synthetic members"', { cwd: repo, stdio: 'pipe' })
  return repo
}
