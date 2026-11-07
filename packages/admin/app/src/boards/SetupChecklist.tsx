import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api } from '../api.ts'
import { useActor } from '../actor.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Meter } from '../design/Meter.tsx'
import { newRecordHref } from '../hrefs.ts'
import { announce } from '../parts/live.tsx'
import { useRegistries, useResources, useStatus, useSystemsRead } from '../queries.ts'
import { SECTIONS, sectionCount } from '../sections.ts'
import { recall, remember } from '../storage.ts'
import { useCanWrite } from '../viewAs/ViewAs.tsx'

/** One thing to set up: done, or where to go to do it. */
export interface SetupItem { id: string; label: string; done: boolean; href: string; act: 'Add' | 'Connect' | 'Open' }

/** What setting up the org reads (spec 2026-11-04 §1b): its name, each section's count, its rules and its proposals. */
export interface SetupState { org: string | null; counts: Partial<Record<string, number>>; rules: number; proposals: number }

const has = (n: number | undefined) => (n ?? 0) > 0

/** The checklist, in the mockup's order: the same emptiness the sidebar's dots show. Each open item goes to its New,
 *  stepped (`newRecordHref` with `steps`: spec §1b, Option B), the treasury to New on systems, the rules and the
 *  proposals to their pages. */
export function setupItems(s: SetupState): SetupItem[] {
  const add = (id: string, label: string, registry: string): SetupItem => ({ id, label, done: has(s.counts[id]), href: newRecordHref(registry, { steps: true }), act: 'Add' })
  return [
    { id: 'door', label: 'Name and door', done: s.org !== null && s.org !== '', href: '/door', act: 'Open' },
    add('people', 'People', 'members'),
    { id: 'roles', label: 'Roles and who decides', done: s.rules > 0, href: '/governance/rules', act: 'Open' },
    add('projects', 'Projects', 'projects'),
    { ...add('treasury', 'Connect the treasury', 'systems'), act: 'Connect' },
    add('funding', 'Track funding', 'funding-opportunities'),
    add('ideas', 'Ideas', 'ideas'),
    add('meetings', 'Meetings', 'meetings'),
    { id: 'proposal', label: 'First proposal', done: s.proposals > 0, href: '/governance/proposals', act: 'Open' },
  ]
}

const HIDDEN = 'org-os-admin.setup.hidden.'

/** Home's "Set up <org>" (spec 2026-11-04 §1b): for a known member who can write, never while previewing; drawn once
 *  every read it counts from has answered (a failed read draws nothing: it cannot say what is set); gone when all is
 *  set, or once hidden. *Hide* is kept per viewer in this browser (storage may refuse: then it hides for this visit). */
export function SetupChecklist() {
  const { actor, known } = useActor()
  const canWrite = useCanWrite()
  const status = useStatus()
  const resources = useResources()
  const registries = useRegistries()
  const systems = useSystemsRead()
  const governance = useQuery({ queryKey: ['governance'], queryFn: api.governance })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const who = actor && 'id' in actor ? actor.id : null
  const key = `${HIDDEN}${who ?? ''}`
  const [hidden, setHidden] = useState<string | null>(null)
  const labelId = useId()
  if (!known || !canWrite || who === null) return null
  if (hidden === key || recall(key) === '1') return null
  if (!status.data || !resources.data || !registries.data || !governance.data || !proposals.data || systems.pending) return null
  const counts = Object.fromEntries(SECTIONS.map(d => [d.id, sectionCount(d, resources.data, registries.data, systems.entries)]))
  // the treasury is counted from data/systems.yaml's entries: when that read failed it cannot be said, so it is not drawn (I-2)
  const items = setupItems({ org: status.data.org, counts, rules: governance.data.rules.length, proposals: proposals.data.length })
    .filter(i => i.id !== 'treasury' || systems.error === null)
  const done = items.filter(i => i.done).length
  if (done === items.length) return null
  const hide = () => {
    remember(key, '1')
    setHidden(key)
    announce('Set up is hidden. It stays hidden in this browser.')
  }
  // an org not named yet (its first item open) is "the org" (M-4)
  const org = status.data.org !== null && status.data.org !== '' ? status.data.org : 'the org'
  return (
    <section className="setup" aria-labelledby={labelId}>
      <div className="setup-h">
        <h2 className="setup-t" id={labelId}>Set up {org}</h2>
        <span className="setup-m"><Meter done={done} of={items.length} words={`${done} of ${items.length} set`} /></span>
        <Button variant="ghost" small onClick={hide}>Hide</Button>
      </div>
      <p className="setup-who">Only members who can write see this.</p>
      <ul className="setup-cl">
        {items.map(i => (
          <li key={i.id} className={i.done ? 'setup-i setup-done' : 'setup-i'}>
            <Icon name={i.done ? 'check' : 'dashed-circle'} size="sm" />
            <span className="setup-l">{i.label}</span>
            {i.done
              ? <span className="sr-only">, done</span>
              : i.href === '/door'
                ? <a className="setup-a" href={i.href} target="_blank" rel="noopener noreferrer">{i.act}<span className="sr-only">: {i.label} (opens in a new tab)</span></a>
                : <Link className="setup-a" href={i.href}>{i.act}<span className="sr-only">: {i.label}</span></Link>}
          </li>
        ))}
      </ul>
    </section>
  )
}
