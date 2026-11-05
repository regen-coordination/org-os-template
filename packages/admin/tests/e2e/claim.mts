// W2a in the installed Chrome (wizards spec §5.4a): an instance whose git address no member holds opens
// read-only; the notice offers the claim; the wizard asks which member, shows the exact line, writes
// nothing until "This is me", then one commit carrying Org-Actor and Org-Rule: bootstrap/claim, and the
// page is editable. Also: where rules are written the wizard refuses in words and writes nothing; and
// the commit is undone by reverting it.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTrailers } from '../../lib/trailers.mjs'
import { OWNER_CLAIM_COMMAND } from '../../lib/claim.mjs'
import { startFixture } from './setup.mts'

const UNCLAIMED = `schema_version: "2.0"
members:
  - id: "ana"
    name: "Ana Costa"
    kind: person
    handles:
      github: "ana-costa"
  - id: "bo"
    name: "Bo Lind"
    kind: person
    handles:
      git: ["bo@example.org"]
`

const inRepo = (repo: string) => (...args: string[]) => execFileSync('git', args, { cwd: repo }).toString().trim()

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const stops: (() => Promise<void>)[] = []
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // ── the happy path ──
  const fx = await startFixture({ members: UNCLAIMED })
  stops.push(() => fx.stop())
  const git = inRepo(fx.repo)
  await page.goto(`${fx.base}/`)
  // the read-only band (C9): its sentence, and git's address as its title
  await page.getByText(/Read only: your git address is not a member’s\./).waitFor()
  await page.locator('.band-ro[title="git: admin-test@local"]').waitFor()
  await page.getByRole('link', { name: 'Claim your handle' }).click()
  await page.waitForURL(/\/wizards\/claim-handle$/)
  await page.getByRole('heading', { level: 2, name: 'Claim your handle' }).waitFor()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('heading', { level: 2, name: 'Which member are you?' }).waitFor()
  if (await page.getByRole('radio', { name: /Bo Lind/ }).count() !== 0) throw new Error('Bo already holds an address and must not be offered')
  await page.getByRole('radio', { name: /Ana Costa/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { level: 2, name: 'Check the line' }).waitFor()
  const log = await page.locator('.wiz-log').first().innerText()
  for (const want of ['+       git: admin-test@local', 'Org-Actor: unknown <admin-test@local>', 'Org-Rule: bootstrap/claim', 'data/members.yaml']) {
    if (!log.includes(want)) throw new Error(`the review does not show "${want}":\n${log}`)
  }
  const before = git('rev-parse', 'HEAD')
  if (git('status', '--porcelain') !== '') throw new Error('the review wrote something')
  await page.getByRole('button', { name: 'This is me' }).click()
  await page.getByRole('heading', { level: 2, name: 'You are ana' }).waitFor({ timeout: 15_000 })
  if (git('rev-list', '--count', `${before}..HEAD`) !== '1') throw new Error('the claim did not make exactly one commit')
  const t = parseTrailers(git('log', '-1', '--pretty=%B'))
  if (t.rule !== 'bootstrap/claim' || t.actor !== 'unknown <admin-test@local>') throw new Error(`the trailers are wrong: ${JSON.stringify(t)}`)
  const written = readFileSync(join(fx.repo, 'data', 'members.yaml'), 'utf8')
  if (!written.includes('      git: admin-test@local')) throw new Error('members.yaml does not hold the address')
  if (git('show', '--stat', '--format=', 'HEAD').split('\n').filter(l => l.includes('|')).length !== 1) throw new Error('the commit touched more than one file')
  // editable now: the read-only notice is gone and a record opens in edit
  await page.goto(`${fx.base}/r/project/proj-001`)
  await page.getByRole('button', { name: 'Edit' }).waitFor()
  if (await page.getByText(/Read only:/).count() !== 0) throw new Error('the page is still read-only')
  // undo: revert that one commit
  git('revert', '--no-edit', 'HEAD')
  await page.reload()
  await page.locator('.band-ro[title="git: admin-test@local"]').waitFor()

  // ── a refusal, in words ──
  const ruled = await startFixture({ members: UNCLAIMED, governance: 'governance:\n  roles:\n    stewards: { members: [bo] }\n  rules:\n    - id: r1\n      applies_to: [members]\n      propose: stewards\n      decide: { by: stewards, method: direct }\n' })
  stops.push(() => ruled.stop())
  await page.goto(`${ruled.base}/wizards/claim-handle`)
  await page.locator('.note-error').getByText('This organisation has rules for who its members are. Ask a maintainer to add your address, or propose it.').waitFor()
  if (await page.getByRole('button', { name: 'Start' }).count() !== 0) throw new Error('the wizard offers a start where rules are written')
  if (inRepo(ruled.repo)('status', '--porcelain') !== '') throw new Error('a refused wizard wrote something')

  // ── a bare rule locks the organisation out: nobody can propose, so the sentence says who can act ──
  const bare = await startFixture({ members: UNCLAIMED, governance: 'governance:\n  model: solo-maintainer\n  rules:\n    - id: r1\n      applies_to: [members]\n' })
  stops.push(() => bare.stop())
  await page.goto(`${bare.base}/wizards/claim-handle`)
  const alert = page.locator('.note-error') // a clay note, not an alert (C10, E-81: §13)
  await alert.getByText('This organisation has rules for who its members are, and nobody can propose a change to them:').waitFor()
  if (!(await alert.innerText()).includes(OWNER_CLAIM_COMMAND)) throw new Error('the locked-out sentence does not carry the owner command')
  if (await page.getByRole('button', { name: 'Start' }).count() !== 0) throw new Error('the wizard offers a start to a locked-out organisation')
  if (inRepo(bare.repo)('status', '--porcelain') !== '') throw new Error('a refused wizard wrote something')

  // ── W1's first screens: the command is shown, nothing is run, nothing is written ──
  const jobsBefore = await (await fetch(`${fx.base}/api/jobs`)).json() as unknown[]
  const headBefore = git('rev-parse', 'HEAD')
  await page.goto(`${fx.base}/wizards/open-instance`)
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('radio', { name: /Open a new organization/ }).check()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Alder Commons')
  await page.getByRole('radio', { name: /Local node/ }).check()
  await page.getByLabel('One line').fill('A cooperative of seed keepers in the Alder valley.')
  if (await page.getByLabel('Folder to create').inputValue() !== '../alder-commons') throw new Error('the folder was not suggested from the name')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Your name').fill('Ana Costa')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('heading', { level: 2, name: 'The command, and the file it reads' }).waitFor()
  const shown = await page.locator('.wiz-log').allInnerTexts()
  if (!shown.includes('npm run clone:framework -- --target ../alder-commons --config draft.yaml')) throw new Error(`the command is not shown:\n${shown.join('\n---\n')}`)
  if (await page.getByRole('button', { name: /Create|Run|Confirm/ }).count() !== 0) throw new Error('W1 offers to run something')
  const jobsAfter = await (await fetch(`${fx.base}/api/jobs`)).json() as unknown[]
  if (jobsAfter.length !== jobsBefore.length) throw new Error('W1 started a job')
  if (git('rev-parse', 'HEAD') !== headBefore || git('status', '--porcelain') !== '') throw new Error('W1 changed the repository')

  console.log('claim wizard: ok')
} finally {
  await browser?.close()
  for (const stop of stops) await stop()
}
