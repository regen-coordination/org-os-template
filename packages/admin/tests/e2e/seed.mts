// What the acceptance walks (routes, a11y, keys) start from, on the e2e fixture (setup.mts): a records rule that asks
// one maintainer's approval, the maintainers `steward-a` and `contributor`; the Safe the recordings hold, as a system;
// and, through the API the client calls, one open proposal authored by `contributor` and one change `steward-a` has
// staged. The proposal is written as `contributor` by pointing the fixture's git address at them for those two calls
// (the actor is the member whose handles.git holds it), then back at `steward-a`, who is the walks' actor.
import { execFileSync } from 'node:child_process'
import type { Page } from 'playwright-core'
import { CONTRIBUTOR_EMAIL, STEWARD_EMAIL } from './setup.mts'
import { RECORDED_SAFE } from './offline-fetch.mts'

/** A records rule: `propose` is the member role's, `decide` is one approval by a maintainer, and the author's own
 *  approval does not count (self_approve is false by default). The member role is every person (`all`) or the ids
 *  given; either way someone may propose (F-L3-1), or the server refuses the governance file. The proposals walk uses
 *  it with its own two maintainers. */
export function approveRule(maintainers: readonly string[], members: readonly string[] | 'all' = 'all'): string {
  return `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [${maintainers.join(', ')}] }
    member: ${members === 'all' ? '{ all: true }' : `{ members: [${members.join(', ')}] }`}
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
}

/** The acceptance walks' governance (E-89): both e2e members propose, by name (`contributor` is of kind agent, and
 *  `all` is every person); `steward-a` decides, since an agent never decides. So `contributor`'s proposal waits on
 *  `steward-a`'s approval. */
export const GOVERNANCE = approveRule(['steward-a'], ['steward-a', 'contributor'])

/** The id of the Safe system seeded, and its data/systems.yaml: the Safe the offline recordings answer for. */
export const SAFE_ID = 'treasury-safe'
export const SYSTEMS = `schema_version: "1.0"
systems:
  - id: "${SAFE_ID}"
    kind: "safe"
    name: "Treasury"
    chain: "eip155:42220"
    address: "${RECORDED_SAFE}"
    driver: "safe"
    section: "organization/treasury"
`

/** The seeded proposal's title, as the walks look for it. */
export const PROPOSAL_TITLE = 'Move the onboarding program to develop'

/** A write as the client sends it (the server refuses one that is not JSON), answered with its JSON or thrown. */
async function send<T>(base: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`seed: POST ${path} answered ${r.status}: ${text}`)
  return JSON.parse(text) as T
}

/** Stages ops for whoever the fixture's git address names: POST /api/changes/ops, as the record form's Save does. */
export const stage = (base: string, ops: unknown[]) => send<unknown>(base, '/api/changes/ops', { ops })

/** Proposes what is staged: POST /api/proposals, as the tray's Propose panel does. Answers the new proposal's id. */
export async function propose(base: string, input: { title: string; rationale?: string }): Promise<string> {
  const view = await send<{ id?: unknown }>(base, '/api/proposals', input)
  if (typeof view.id !== 'string') throw new Error(`seed: the proposal came back without an id: ${JSON.stringify(view)}`)
  return view.id
}

const setEmail = (repo: string, email: string) => execFileSync('git', ['config', 'user.email', email], { cwd: repo, stdio: 'pipe' })

export interface Seeded { proposal: string; project: string }

/** Seeds a running fixture started with `governance: GOVERNANCE, systems: SYSTEMS`: `contributor` proposes a status
 *  change of the project, then `steward-a` stages a change of its tags. Leaves the fixture acting as `steward-a`. */
export async function seed(fx: { base: string; repo: string }): Promise<Seeded> {
  const project = 'proj-001'
  let proposal: string
  setEmail(fx.repo, CONTRIBUTOR_EMAIL)
  try {
    await stage(fx.base, [{ op: 'update', record: `projects:${project}`, set: { status: 'develop' } }])
    proposal = await propose(fx.base, { title: PROPOSAL_TITLE, rationale: 'The pilot cohort is through; the next one plans the second season.' })
  } finally {
    setEmail(fx.repo, STEWARD_EMAIL)
  }
  await stage(fx.base, [{ op: 'update', record: `projects:${project}`, set: { tags: ['nodes', 'onboarding', 'season-two'] } }])
  return { proposal, project }
}

/** One route the acceptance walks visit: its path, the stem its shots are stored under (`<slug>-<width>-<theme>.png`),
 *  and whether it is seen previewing as Public (picked from the View as menu once the page has drawn). */
export interface AcceptanceRoute { slug: string; path: string; preview?: 'public' }

/** Every route of spec §14.1, on a seeded fixture, plus Home and the proposal previewing as Public. The first
 *  registry and the first library entry are the server's own first. */
export async function acceptanceRoutes(base: string, s: Seeded): Promise<AcceptanceRoute[]> {
  const get = async <T,>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`)
    if (!r.ok) throw new Error(`${path}: ${r.status}`)
    return r.json() as Promise<T>
  }
  const registry = (await get<{ name: string }[]>('/api/registries'))[0]?.name
  const entry = (await get<{ entries: { id: string }[] }>('/api/library')).entries[0]?.id
  if (!registry || !entry) throw new Error(`the fixture has no registry (${registry}) or no library entry (${entry})`)
  const proposal = `/governance/proposals/${encodeURIComponent(s.proposal)}`
  const plain = (path: string) => ({ slug: path === '/' ? 'home' : path.slice(1).replace(/[^a-z0-9]+/gi, '-'), path })
  return [
    ...['/', '/needs', '/systems', '/roles', '/b/treasury', '/workspace', '/b/projects', '/b/people', '/b/funding',
      '/b/partners', '/b/ideas', '/b/meetings', '/b/organization', '/b/systems', '/b/outside-systems', '/b/sources',
      '/b/crew', '/b/modules', '/b/fleet', '/activity', '/all'].map(plain),
    { slug: 'all-registry', path: `/all/${encodeURIComponent(registry)}` },
    ...['/boards', '/governance/proposals', '/governance/decisions', '/governance/rules'].map(plain),
    { slug: 'proposal', path: proposal },
    { slug: 'record-project', path: `/r/project/${encodeURIComponent(s.project)}` },
    { slug: 'record-safe', path: `/r/system/${encodeURIComponent(SAFE_ID)}` },
    plain('/new/projects'),
    // the stepped form (spec 2026-11-04 §3, Option B) on a wide screen: a narrow one gets it at /new/projects already
    { slug: 'new-projects-steps', path: '/new/projects?steps=1' },
    plain('/library'),
    { slug: 'library-entry', path: `/library/${encodeURIComponent(entry)}` },
    ...['/wizards/claim-handle', '/wizards/open-instance', '/changes', '/door', '/does-not-exist'].map(plain),
    { slug: 'home-public', path: '/', preview: 'public' },
    { slug: 'proposal-public', path: proposal, preview: 'public' },
  ]
}

/** Waits for a page to have drawn: its h1 holds more than the loading ellipsis, no "Loading…" or skeleton is left, and a map has
 *  laid out its first node. */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => { const h = document.querySelector('h1')?.textContent; return !!h && h !== '…' })
  await page.getByText('Loading…').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  // a first frame's skeletons (§6.2) go when the page has drawn; /parts draws them as specimens, for good. One that
  // never clears is a page that never drew: the run fails (review minor 8)
  if (!new URL(page.url()).pathname.startsWith('/parts')) {
    await page.locator('.skel[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => { throw new Error(`${page.url()}: a skeleton was still loading after 15 s`) })
  }
  if (await page.locator('.react-flow').count() > 0) await page.locator('.react-flow__node').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
}

/** Previews the page as Public from the View as control the frame shows (the top bar's, or the phone bar's eye), and
 *  waits for the band. */
export async function viewAsPublic(page: Page): Promise<void> {
  await page.locator('[data-view-as] button[aria-haspopup]').filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name: 'Public' }).click()
  await page.locator('.band').waitFor()
}
