// @vitest-environment jsdom
// The first frame of a page (walk 2026-11-04, L4c-fix 2; spec §6.2): while nothing has answered yet, a page draws its
// heading and a skeleton in its own shape — a busy region named "Loading <what>" — never the spinner and "Loading…",
// and never a page with no h1.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import { renderAt } from '../test/render.tsx'
import { BoardPage } from '../boards/Board.tsx'
import RecordPage from './Record.tsx'
import ProposalPage from './Proposal.tsx'
import NewRecord from './NewRecord.tsx'
import RegistryList from './RegistryList.tsx'
import Governance from './Governance.tsx'
import Boards from './Boards.tsx'
import Roles from './Roles.tsx'
import Systems from './Systems.tsx'
import WizardPage from '../wizards/WizardPage.tsx'
import Workspace from './Workspace.tsx'
import Changes from './Changes.tsx'

afterEach(() => { vi.unstubAllGlobals() })

/** Every read the page makes waits, as on a slow first load. */
const hang = () => vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))

const PAGES: { name: string; at: string; ui: () => ReactElement; h1: string | RegExp }[] = [
  { name: 'Home', at: '/b/home', ui: () => <BoardPage id="home" />, h1: 'Reading what waits on you…' },
  { name: 'Treasury', at: '/b/treasury', ui: () => <BoardPage id="treasury" />, h1: 'Treasury' },
  { name: 'a collection', at: '/b/meetings', ui: () => <BoardPage id="meetings" />, h1: 'Meetings' },
  { name: 'a record', at: '/r/project/proj-001', ui: () => <RecordPage kind="project" id="proj-001" />, h1: 'proj-001' },
  { name: 'a proposal', at: '/governance/proposals/p-1', ui: () => <ProposalPage id="p-1" />, h1: 'p-1' },
  { name: 'New', at: '/new/projects', ui: () => <NewRecord registry="projects" />, h1: /^New / },
  { name: 'a registry', at: '/all/projects', ui: () => <RegistryList registry="projects" title="projects" />, h1: 'projects' },
  { name: 'Proposals', at: '/governance/proposals', ui: () => <Governance part="proposals" />, h1: 'Proposals' },
  { name: 'Boards', at: '/boards', ui: () => <Boards />, h1: 'Boards' },
  { name: 'Roles', at: '/roles', ui: () => <Roles />, h1: 'Roles' },
  { name: 'Systems', at: '/systems', ui: () => <Systems />, h1: 'Systems' },
  { name: 'a wizard', at: '/wizards/claim-handle', ui: () => <WizardPage id="claim-handle" />, h1: 'Wizard' },
]

describe('a page’s first frame', () => {
  for (const p of PAGES) {
    it(`${p.name}: its heading and a skeleton, never the spinner and “Loading…”`, () => {
      hang()
      renderAt(p.ui(), p.at)
      const h1 = document.querySelectorAll('h1')
      expect(h1.length).toBe(1)
      if (typeof p.h1 === 'string') expect(h1[0]!.textContent).toBe(p.h1)
      else expect(h1[0]!.textContent).toMatch(p.h1)
      expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
      expect(document.body.textContent).not.toContain('Loading…')
      expect(document.querySelector('.spin')).toBeNull()
    })
  }
})

// An absence is not said before the read that would fill it has answered (walk 2026-11-04, L4c-fix 3): the empty
// sentence stays as it is, and waits for the answer.
describe('no empty sentence before the first answer', () => {
  it('Workspace: a skeleton, not “Nothing in the Workspace yet.”', () => {
    hang()
    renderAt(<Workspace />, '/workspace')
    expect(document.querySelector('h1')!.textContent).toBe('Workspace')
    expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Nothing in the Workspace yet.')
  })

  it('Changes: a skeleton, not “Nothing is staged.”', () => {
    hang()
    renderAt(<Changes />, '/changes')
    expect(document.querySelector('h1')!.textContent).toBe('Changes')
    expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Nothing is staged.')
  })
})
