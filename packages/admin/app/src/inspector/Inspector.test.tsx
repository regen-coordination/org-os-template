// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import Inspector, { InspectorView, inspectorForm } from './Inspector.tsx'
import { useInspector } from './InspectorContext.tsx'
import { Shell } from '../design/Shell.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, resource } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { NETWORK_PROJECTS, ROLES, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { SAFE } from '../test/fixtures/house/org.ts'

const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', status: '0.1.0',
  attention: { level: 'alert', text: 'check fails: VERIFIED.md missing' },
  facts: { type: 'integration', failing: [], description: null }, source: { path: 'modules/a/module.yaml', editable: false } })
const ops = [
  { id: 'module.doctor', label: 'Run doctor', effect: 'reads', network: true, confirm: true, params: { type: 'object' }, preset: null, unavailable: null },
  { id: 'module.command-check', label: 'Run check: npm test | tee', effect: 'changes', network: true, confirm: true, params: { type: 'object' }, preset: { index: 0 }, unavailable: 'holds a shell character' },
]
const projects = (...ids: string[]) => ({ name: 'projects', kind: 'collection', schemaVersion: null, entries: ids.map(id => ({ id })) })
function Opener({ id }: { id: string }) {
  const i = useInspector()
  useEffect(() => i.open(id), [])
  return null
}

describe('Inspector', () => {
  it('shows kind, name, attention and the kind\'s facts, leaving empty facts out', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] }, 'GET /api/operations?resource=module%3Aa': ops })
    renderAt(<><Opener id="module:a" /><Inspector /></>)
    const aside = await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })
    expect(aside.querySelector('h3')!.textContent).toBe('org-os-buzz')
    expect(screen.getByText('check fails: VERIFIED.md missing')).toBeTruthy()
    expect(screen.getByText('integration')).toBeTruthy()
    expect(screen.queryByText('failing')).toBeNull()
    expect(screen.queryByText('description')).toBeNull()
    expect(screen.getByText('modules/a/module.yaml')).toBeTruthy()
  })

  it('holds its content in one sticky inner column, loading and loaded, so its rule can run the full height (final 4)', async () => {
    let answer!: (v: unknown) => void
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/module%3Aa': () => new Promise(r => { answer = r }), 'GET /api/operations?resource=module%3Aa': ops })
    const { container } = renderAt(<><Opener id="module:a" /><Inspector /></>)
    await screen.findByText('Loading…')
    // B9 (ledger): the aside is .insp where it was .inspector; the inner column is still .insp-in
    const inner = () => [...container.querySelectorAll('aside.insp > *')].map(e => e.className)
    expect(inner()).toEqual(['insp-in'])
    answer({ resource: mod, edges: [], neighbours: [] })
    await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })
    expect(inner()).toEqual(['insp-in'])
    expect(container.querySelector('.insp-in h3')!.textContent).toBe('org-os-buzz')
  })

  it('offers the operations that can run, and the record, but no Edit for what is not editable', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] }, 'GET /api/operations?resource=module%3Aa': ops })
    renderAt(<><Opener id="module:a" /><Inspector /></>)
    expect((await screen.findByRole('link', { name: 'Run doctor' })).getAttribute('href')).toBe('/r/module/a?op=module.doctor&opLabel=Run+doctor')
    expect(screen.queryByRole('link', { name: 'Run check: npm test | tee' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open record →' }).getAttribute('href')).toBe('/r/module/a')
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('never links the outside system a record names (facts.url)', async () => {
    const sys = resource({ id: 'system:s', kind: 'system', name: 'A site', facts: { url: 'https://example.org/secret' }, source: { path: 'data/systems.yaml', editable: false } })
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/system%3As': { resource: sys, edges: [], neighbours: [] }, 'GET /api/operations?resource=system%3As': [] })
    const { container } = renderAt(<><Opener id="system:s" /><Inspector /></>)
    await screen.findByRole('complementary', { name: 'A site inspector' })
    expect(container.querySelector('a[href^="http"]')).toBeNull()
  })

  it('offers Edit on an editable record to a member', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/project%3Ap1': { resource: resource(), edges: [], neighbours: [] }, 'GET /api/operations?resource=project%3Ap1': [],
      'GET /api/registries/projects': projects('p1', 'p2') })
    renderAt(<><Opener id="project:p1" /><Inspector /></>)
    expect((await screen.findByRole('link', { name: 'Edit' })).getAttribute('href')).toBe('/r/project/p1?edit=1')
  })

  it('offers no Edit on an id other entries share (C11)', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/project%3Ap1': { resource: resource(), edges: [], neighbours: [] }, 'GET /api/operations?resource=project%3Ap1': [],
      'GET /api/registries/projects': projects('p1', 'p1') })
    const { qc } = renderAt(<><Opener id="project:p1" /><Inspector /></>)
    await screen.findByRole('link', { name: 'Open record →' })
    await waitFor(() => expect(qc.getQueryData(['registry', 'projects'])).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('offers no Edit on a record staged for deletion (C11, the same predicate as the record page)', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'delete', record: 'projects:p1', base: 'h', before: { id: 'p1' } }] }) }),
      'GET /api/resources/project%3Ap1': { resource: resource(), edges: [], neighbours: [] }, 'GET /api/operations?resource=project%3Ap1': [],
      'GET /api/registries/projects': projects('p1') })
    const { qc } = renderAt(<><Opener id="project:p1" /><Inspector /></>)
    await screen.findByRole('link', { name: 'Open record →' })
    await waitFor(() => expect(qc.getQueryData(['registry', 'projects'])).toBeTruthy())
    await waitFor(() => expect(qc.getQueryData(['changes'])).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  it('offers no Edit when your git email matches no member', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }),
      'GET /api/resources/project%3Ap1': { resource: resource(), edges: [], neighbours: [] }, 'GET /api/operations?resource=project%3Ap1': [],
      'GET /api/registries/projects': projects('p1') })
    const { qc } = renderAt(<><Opener id="project:p1" /><Inspector /></>)
    await screen.findByRole('complementary', { name: 'Project one inspector' })
    await waitFor(() => expect(qc.getQueryData(['actor'])).toEqual({ unknown: 'x@example.org' }))
    await waitFor(() => expect(qc.getQueryData(['registry', 'projects'])).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  })

  const opened = async (path = '/b/systems') => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] }, 'GET /api/operations?resource=module%3Aa': [] })
    const r = renderAt(<><Opener id="module:a" /><Inspector /></>, path)
    await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })
    return r
  }

  it('closes on Escape', async () => {
    await opened()
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false) // marked handled: an open editor leaves it alone
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('closes on its close button', async () => {
    await opened()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('closes when the page changes', async () => {
    const { loc } = await opened()
    act(() => loc.navigate('/b/projects'))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  // B3 (fix wave): the inspector's failed read was a bare paragraph; it is an error note, and it says itself.
  it('says why when the record cannot be read, in an error note the page announces', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/operations?resource=module%3Aa': [] })
    renderAt(<><Opener id="module:a" /><Inspector /></>)
    const said = await screen.findByText('no stub for GET /api/resources/module%3Aa')
    expect(said.closest('.note-error')).not.toBeNull()
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('no stub for GET /api/resources/module%3Aa'))
  })

  // B9 (§5.10, CC-13): the inspector's form follows the frame's width; its head is the house's.
  it('chooses its form by frame width: beside the list at 1200 and over, an overlay sheet at 760–1199, a bottom sheet on the phone', () => {
    expect([1600, 1200, 1199, 760, 759, 390].map(inspectorForm)).toEqual(['aside', 'aside', 'side', 'side', 'bottom', 'bottom'])
  })

  const inFrame = async (width: number) => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] }, 'GET /api/operations?resource=module%3Aa': [] })
    const OpenRow = () => { const { open } = useInspector(); return <button type="button" onClick={() => open('module:a')}>org-os-buzz row</button> }
    const r = renderAt(<Shell title="t" nav={null} width={width} aside={<Inspector />}><OpenRow /></Shell>, '/b/systems')
    const row = screen.getByRole('button', { name: 'org-os-buzz row' })
    row.focus()
    fireEvent.click(row)
    await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })
    return { ...r, row }
  }

  it('at 1200 of frame width and over, sits beside the list in the frame’s row, not modal', async () => {
    const { container } = await inFrame(1280)
    const aside = screen.getByRole('complementary', { name: 'org-os-buzz inspector' })
    expect(aside.parentElement!.className).toBe('frame-row')
    expect(container.querySelector('dialog')).toBeNull()
  })

  it('at 760–1199 is a modal overlay sheet from the end, over a scrim; on the phone, a bottom sheet', async () => {
    const { container, unmount } = await inFrame(1000)
    const sheet = container.querySelector('dialog')!
    expect(sheet.open).toBe(true)
    expect(sheet.className).toBe('insp-sheet insp-side')
    expect(sheet.getAttribute('aria-labelledby')).toBe(sheet.querySelector('h3')!.id)
    expect(sheet.querySelector('aside.insp')).not.toBeNull()
    unmount()
    const phone = await inFrame(390)
    expect(phone.container.querySelector('dialog')!.className).toBe('insp-sheet insp-bottom')
  })

  it('modal: Esc shuts the sheet first, then returns focus to the row', async () => {
    const { container, row } = await inFrame(1000)
    const sheet = container.querySelector('dialog')!
    let openWhenFocused: boolean | null = null
    row.addEventListener('focus', () => { openWhenFocused = sheet.open })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(row)
    expect(openWhenFocused).toBe(false)
  })

  it('modal: the close × shuts it and returns focus to the row', async () => {
    const { row } = await inFrame(760)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('beside the list: Esc closes it and returns focus to the row', async () => {
    const { row } = await inFrame(1440)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  // V2 (fix round 3): the inspector passed a file entry only for Systems, so every other kind printed its
  // restricted name, status and fact columns raw, though FieldRow already supported the mask (rule 3, E-70).
  it('masks a restricted name, status and fact column for any kind, and its small map’s names (rule 3, E-70)', async () => {
    const p = resource({ id: 'project:p1', name: 'Seed Library', status: 'confidential-pivot', facts: { lead: 'steward-a', started: '2026-09-01' } })
    const near = resource({ id: 'person:a', kind: 'person', name: 'Steward A', status: null,
      source: { path: 'data/members.yaml', editable: true, registry: 'members', entityId: 'a' } })
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources/project%3Ap1': { resource: p, edges: [], neighbours: [near] },
      'GET /api/operations?resource=project%3Ap1': [],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'p1', restricted: { name: 'hat:ops', status: 'hat:ops', lead: 'hat:ops' } }] },
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'a', restricted: { name: 'hat:ops' } }] },
    })
    renderAt(<><Opener id="project:p1" /><Inspector /></>)
    const aside = await screen.findByRole('complementary', { name: 'Ops only inspector' })
    expect(aside.querySelector('h3')!.textContent).toBe('Ops only')
    expect(aside.querySelector('h3')!.getAttribute('title')).toBeNull()
    const fields = within(aside).getByRole('group', { name: 'Ops only fields' })
    const value = (label: string) => [...fields.querySelectorAll('dt')].find(dt => dt.textContent === label)!.nextElementSibling!
    expect(value('status').textContent).toBe('Ops only')
    expect(value('lead').textContent).toBe('Ops only')
    // a column the viewer is admitted to prints as it is
    expect(value('started').textContent).toBe('2026-09-01')
    expect(aside.textContent).not.toContain('Seed Library')
    expect(aside.textContent).not.toContain('confidential-pivot')
    expect(aside.textContent).not.toContain('steward-a')
    // the small map is named and drawn the same way: its centre and its neighbour
    const small = within(aside).getByRole('group', { name: 'What Ops only touches' })
    expect(within(small).getAllByText('Ops only')).toHaveLength(2)
    expect(small.textContent).not.toContain('Steward A')
  })

  it('heads itself with the kind tile, the kind as an eyebrow, the name and a close ×; the small map and field rows under it', () => {
    const near = [resource({ id: 'project:n1', name: 'Local node kit' }), resource({ id: 'person:steward-a', kind: 'person', name: 'Steward A' })]
    const { container } = renderAt(<InspectorView resource={mod} neighbours={near} ops={[]} onClose={() => {}} form="aside" />)
    const head = container.querySelector('.insp-h')!
    expect(head.querySelector('.ktile')!.getAttribute('aria-hidden')).toBe('true')
    expect(head.querySelector('.insp-k')!.textContent).toBe('Module')
    expect(head.querySelector('h3')!.textContent).toBe('org-os-buzz')
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.querySelector('svg')).not.toBeNull()
    expect(close.textContent).toBe('')
    expect(container.querySelector('.mini.mini-inspector')).not.toBeNull()
    expect(screen.getByRole('link', { name: /Local node kit/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'org-os-buzz fields' }).querySelector('dl.fields')).not.toBeNull()
  })

  // E-63: a System's rows come from systemFacts, and its link-out is its own open, as on its record header.
  it('draws a System’s rows from what its driver read: chain, address chip, the governing fact, its state and read', () => {
    const { container } = renderAt(<InspectorView resource={TREASURY_SYSTEM} neighbours={[]} ops={[]} onClose={() => {}} form="aside" now={FIXED_NOW} />)
    const rows = screen.getByRole('group', { name: 'Treasury fields' })
    const labels = [...rows.querySelectorAll('dt')].map(dt => dt.textContent)
    expect(labels).toEqual(['Chain', 'Address', 'Signers', 'State', 'Read', 'file'])
    const value = (label: string) => [...rows.querySelectorAll('dt')].find(dt => dt.textContent === label)!.nextElementSibling!
    expect(value('Chain').textContent).toContain('7 chains')
    expect(within(value('Address') as HTMLElement).getByRole('button', { name: `Copy address ${SAFE.slice(0, 6)}…${SAFE.slice(-4)}` })).toBeTruthy()
    expect(value('Signers').textContent).toBe('4 of 8 signers')
    expect(value('State').querySelector('.smark-needs')!.textContent).toBe('1 to sign')
    expect(value('Read').textContent).toBe('read 4\u00a0min ago')
    // the one link out: the System's own, beside Open record; never an explorer
    const out = [...container.querySelectorAll('a[href^="http"]')]
    expect(out.map(a => [a.textContent, a.getAttribute('href')])).toEqual([['Open in Safe (opens in a new tab)', TREASURY_SYSTEM.facts.driver && (TREASURY_SYSTEM.facts.driver as { open: { url: string } }).open.url]])
    expect(screen.getByRole('link', { name: 'Open record →' })).toBeTruthy()
  })

  it('draws a Hats tree’s id in Mono and a pool’s chip, each with its own link-out', () => {
    const tree = renderAt(<InspectorView resource={ROLES} neighbours={[]} ops={[]} onClose={() => {}} form="aside" now={FIXED_NOW} />)
    const rows = screen.getByRole('group', { name: 'Roles fields' })
    const address = [...rows.querySelectorAll('dt')].find(dt => dt.textContent === 'Address')!.nextElementSibling!
    expect(address.querySelector('.mono')!.textContent).toBe('42220 / 13')
    expect(screen.getByRole('link', { name: 'Open in Hats (opens in a new tab)' })).toBeTruthy()
    tree.unmount()
    renderAt(<InspectorView resource={NETWORK_PROJECTS} neighbours={[]} ops={[]} onClose={() => {}} form="aside" now={FIXED_NOW} />)
    expect(screen.getByRole('link', { name: 'Open in Gardens (opens in a new tab)' })).toBeTruthy()
  })

  it('draws a record (not a System) with no link-out at all', () => {
    const { container } = renderAt(<InspectorView resource={resource({ facts: { url: 'https://example.org/x' } })} neighbours={[]} ops={[]} onClose={() => {}} form="aside" editable />)
    expect(container.querySelector('a[href^="http"]')).toBeNull()
  })

  // Carried from C6: the inspector's writes are not drawn while previewing (C-23).
  it('previewed as Public, offers no Edit, no operations and no Move — only Open record', () => {
    const doctor = ops[0]! as never
    const visible = resource({ facts: { visibility: 'public' } })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}>
      <InspectorView resource={visible} neighbours={[]} ops={[doctor]} onClose={() => {}} form="aside" editable />
    </ViewAsProvider>)
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Run doctor' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move on the map' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open record →' })).toBeTruthy()
  })

  it('previewed as Public, the inspector over a map offers no Move even when the map hands it one', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources/project%3Ap1': { resource: resource({ facts: { visibility: 'public' } }), edges: [], neighbours: [] },
      'GET /api/operations?resource=project%3Ap1': ops, 'GET /api/registries/projects': projects('p1') })
    function MoveOpener() {
      const i = useInspector()
      useEffect(() => i.open('project:p1', { move: () => {} }), [])
      return null
    }
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><MoveOpener /><Inspector /></ViewAsProvider>)
    await screen.findByRole('complementary', { name: 'Project one inspector' })
    expect(screen.queryByRole('button', { name: 'Move on the map' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Run doctor' })).toBeNull()
  })
})
