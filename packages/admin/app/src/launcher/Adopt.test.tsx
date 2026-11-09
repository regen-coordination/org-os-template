// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { parse } from 'yaml'
import source from '../../../wizards/open-instance.yaml?raw'
import Adopt from './Adopt.tsx'
import { renderAt } from '../test/render.tsx'
import * as api from './api.ts'

vi.mock('./api.ts', async orig => ({
  ...(await orig<typeof import('./api.ts')>()),
  launcherWizard: vi.fn(), adoptPlan: vi.fn(), adoptApply: vi.fn(),
}))
const m = vi.mocked(api)

const ADD_HEADING = 'These files will be added on a new branch, org-os/adopt:'
const KEPT_HEADING = 'Your repo already has these. They stay exactly as they are:'

async function toReview(folder = '/home/me/plain') {
  renderAt(<Adopt base="/home/me" initialFolder={folder} />, '/launch')
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { level: 2, name: 'About the organization' })
  expect(screen.queryByLabelText('Folder to create')).toBeNull()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alder Commons' } })
  fireEvent.click(screen.getByRole('radio', { name: /Local node/ }))
  fireEvent.change(screen.getByLabelText('One line'), { target: { value: 'Seed keepers.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText('Your name')
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Steward A' } })
  fireEvent.change(screen.getByLabelText('Git email'), { target: { value: 'a@alder.example' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(await screen.findByRole('button', { name: 'See what it adds' }))
}

describe('the Adopt door', () => {
  const assign = vi.fn()
  const real = window.location
  beforeEach(() => {
    vi.clearAllMocks()
    m.launcherWizard.mockResolvedValue(parse(source) as never)
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign } })
  })
  afterEach(() => { Object.defineProperty(window, 'location', { configurable: true, value: real }) })

  it('asks for the folder, then the questions with the folder preset and hidden', async () => {
    renderAt(<Adopt base="/home/me" />, '/launch')
    const field = await screen.findByLabelText("The repo's folder") as HTMLInputElement
    expect(field.value).toBe('')
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(field, { target: { value: '~/plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    expect(screen.queryByLabelText('Folder to create')).toBeNull()
  })

  it('lists both groups under the exact headings, with the button and the line under it', async () => {
    m.adoptPlan.mockResolvedValue({ planId: 'p1', add: ['data/members.yaml', 'federation.yaml'], kept: ['.gitignore', 'README.md', 'package.json'] } as never)
    await toReview()
    const added = await screen.findByRole('list', { name: ADD_HEADING })
    expect(screen.getByText(ADD_HEADING)).toBeTruthy()
    expect(within(added).getAllByRole('listitem').map(li => li.textContent)).toEqual(['data/members.yaml', 'federation.yaml'])
    expect(screen.getByText(KEPT_HEADING)).toBeTruthy()
    const kept = screen.getByRole('list', { name: KEPT_HEADING })
    expect(within(kept).getAllByRole('listitem').map(li => li.textContent)).toEqual(['.gitignore', 'README.md', 'package.json'])
    expect(screen.getByRole('button', { name: 'Add them on org-os/adopt' })).toBeTruthy()
    expect(screen.getByText("Your default branch isn't touched. Merging is up to you.")).toBeTruthy()
    expect(m.adoptPlan).toHaveBeenCalledWith('/home/me/plain', expect.objectContaining({ name: 'Alder Commons', folder: '/home/me/plain' }))
    expect(m.adoptApply).not.toHaveBeenCalled()
  })

  it('applies the plan and goes to the instance', async () => {
    m.adoptPlan.mockResolvedValue({ planId: 'p1', add: ['federation.yaml'], kept: [] } as never)
    m.adoptApply.mockResolvedValue({ url: 'http://localhost:4999/systems/map?first=1', branch: 'org-os/adopt' } as never)
    await toReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add them on org-os/adopt' }))
    await waitFor(() => expect(m.adoptApply).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:4999/systems/map?first=1'))
  })

  it('a refused plan is said on the review of the questions', async () => {
    m.adoptPlan.mockRejectedValue(new Error('This repo has uncommitted or untracked files (notes.txt). Commit them or move them out, then adopt.'))
    await toReview()
    expect(await screen.findByText(/uncommitted or untracked files \(notes\.txt\)/)).toBeTruthy()
    expect(screen.queryByText(ADD_HEADING)).toBeNull()
  })

  it('a failed apply is said as it came, and nothing navigates', async () => {
    m.adoptPlan.mockResolvedValue({ planId: 'p1', add: ['federation.yaml'], kept: [] } as never)
    m.adoptApply.mockRejectedValue(new Error('No email was given and auto-detection is disabled. The 1 file already copied stays on org-os/adopt, not committed.'))
    await toReview()
    fireEvent.click(await screen.findByRole('button', { name: 'Add them on org-os/adopt' }))
    expect(await screen.findByText(/not committed/)).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })
})
