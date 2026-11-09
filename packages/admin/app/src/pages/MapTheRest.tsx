import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from 'wouter'
import { api } from '../api.ts'
import { useSystems } from '../blocks/systems.tsx'
import { useSystemsRead } from '../queries.ts'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { githubRepoSystems, recogniseLines } from '../../../lib/systems-recognise.mjs'

type Sys = { id: string; kind: string; name: string; url?: string; mount?: string; purpose?: string } & Record<string, unknown>
type Source = 'manifest' | 'pasted' | 'github'
type Row = { key: string; source: Source; system: Sys; duplicateOf: string | null }
type Owner = { repos: Parameters<typeof githubRepoSystems>[0]; more: boolean } | { error: string } | 'loading'

const PURPOSES = ['website', 'knowledge', 'app', 'contracts', 'data', 'fork', 'archive', 'other']

/** Map the rest (network N1, `/systems/map`): where the launcher sends a person once an instance has opened (`?first=1`).
 *  Pasted links, the old repos.manifest.json and a GitHub owner's repos become Systems to review and tick; Stage puts
 *  the ticked ones into the person's change through the ordinary path, under the instance's own rules. It never clones
 *  anything: "Clone into repos/<name> later" only sets the System's `mount`. Ids and duplicates are checked against
 *  everything already on the page, in order — the instance's Systems, the manifest's, the pasted lines', then each
 *  owner's — so no two staged ops share an id and one thing is offered once. */
export default function MapTheRest() {
  const first = new URLSearchParams(useSearch()).get('first') === '1'
  const { systems, error } = useSystems()
  const read = useSystemsRead()
  const manifest = useQuery({ queryKey: ['systems-map', 'manifest'], queryFn: api.mapManifest, retry: false, refetchOnWindowFocus: false })

  const [text, setText] = useState('')
  const [recognised, setRecognised] = useState('')
  const [owners, setOwners] = useState<Record<string, Owner>>({})
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [clone, setClone] = useState<Record<string, boolean>>({})
  const [purposes, setPurposes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // What the instance already lists: its data/systems.yaml entries, and any System resource those do not carry.
  const existing = useMemo<Sys[]>(() => {
    const out = new Map<string, Sys>()
    for (const [id, e] of read.entries) out.set(id, { ...e, id } as Sys)
    for (const r of systems ?? []) {
      const id = r.source?.entityId
      if (!id || out.has(id)) continue
      const f = r.facts
      out.set(id, { id, kind: String(f.kind ?? ''), name: r.name, ...(typeof f.url === 'string' ? { url: f.url } : {}), ...(typeof f.chain === 'string' ? { chain: f.chain } : {}), ...(typeof f.address === 'string' ? { address: f.address } : {}) })
    }
    return [...out.values()]
  }, [read.entries, systems])

  // The manifest route already ran manifestImports against the instance's Systems: its rows are offered as they came,
  // minus any whose id the instance holds by now.
  const offered = useMemo<Sys[]>(() => (manifest.data ? (manifest.data.imports as Sys[]).filter(i => !existing.some(e => e.id === i.id)) : []), [manifest.data, existing])

  const pasted = useMemo(() => recogniseLines(recognised, [...existing, ...offered]), [recognised, existing, offered])
  const ownerNames = pasted.owners as string[]

  useEffect(() => {
    for (const o of ownerNames) {
      if (owners[o] !== undefined) continue
      setOwners(prev => ({ ...prev, [o]: 'loading' }))
      api.mapGithub(o).then(r => setOwners(prev => ({ ...prev, [o]: { repos: r.repos, more: r.more } })), (e: unknown) => setOwners(prev => ({ ...prev, [o]: { error: e instanceof Error ? e.message : 'GitHub could not be reached.' } })))
    }
  }, [ownerNames.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  const { manifestOut, pastedOut, githubOut } = useMemo(() => {
    const manifestOut: Row[] = offered.map(s => ({ key: `m:${s.id}`, source: 'manifest', system: s, duplicateOf: null }))
    const pastedOut: Row[] = (pasted.rows as { system: Sys; duplicateOf: string | null }[]).map((r, i) => ({ key: `p:${i}:${r.system.id}`, source: 'pasted', system: r.system, duplicateOf: r.duplicateOf }))
    // each owner's repos are checked against everything shown above them, and against the owners before
    const seen: Sys[] = [...existing, ...offered, ...pastedOut.map(r => r.system)]
    const githubOut: { owner: string; state: Owner; rows: Row[] }[] = ownerNames.map(owner => {
      const state = owners[owner] ?? 'loading'
      if (typeof state === 'string' || 'error' in state) return { owner, state, rows: [] }
      const list = githubRepoSystems(state.repos, seen) as Sys[]
      seen.push(...list)
      return { owner, state, rows: list.map(s => ({ key: `g:${s.id}`, source: 'github' as const, system: s, duplicateOf: null })) }
    })
    return { manifestOut, pastedOut, githubOut }
  }, [offered, pasted, owners, existing, ownerNames.join('\n')]) // eslint-disable-line react-hooks/exhaustive-deps

  const allRows = [...manifestOut, ...pastedOut, ...githubOut.flatMap(g => g.rows)]
  const isTicked = (r: Row) => r.duplicateOf === null && (ticked[r.system.id] ?? r.source !== 'github')
  const valueOf = (r: Row): Sys => {
    const s: Sys = { ...r.system, name: names[r.system.id] ?? r.system.name }
    const purpose = purposes[r.system.id]
    if (purpose) s.purpose = purpose
    if (clone[r.system.id]) s.mount = `repos/${s.name}`
    return s
  }
  const chosen = allRows.filter(isTicked)
  const touched = () => { setStaged(false); setFailure(null) }

  async function stage() {
    setBusy(true); setFailure(null); setStaged(false)
    try {
      await api.stage(chosen.map(valueOf).map(s => ({ op: 'create' as const, record: `systems:${s.id}`, value: s })))
      setStaged(true)
      setTicked(t => { const n = { ...t }; for (const r of chosen) n[r.system.id] = false; return n })
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The additions could not be staged.')
    } finally { setBusy(false) }
  }

  const row = (r: Row) => {
    const s = valueOf(r)
    const dup = r.duplicateOf !== null
    const repo = s.kind === 'repo' && r.source !== 'manifest'
    return (
      <tr key={r.key}>
        <td><input type="checkbox" aria-label={`Add ${s.name}`} checked={isTicked(r)} disabled={dup} onChange={e => { touched(); setTicked(t => ({ ...t, [r.system.id]: e.target.checked })) }} /></td>
        <td>{s.kind}</td>
        <td><input className="input" aria-label={`Name of ${r.system.name}`} value={s.name} disabled={dup} onChange={e => { touched(); setNames(n => ({ ...n, [r.system.id]: e.target.value })) }} /></td>
        <td className="mapr-link">
          {s.url ?? (typeof s.address === 'string' ? s.address : typeof s.space === 'string' ? s.space : '')}
          {repo && !dup && (
            <div className="mapr-extra">
              <label><input type="checkbox" checked={clone[r.system.id] === true} onChange={e => { touched(); setClone(c => ({ ...c, [r.system.id]: e.target.checked })) }} /> Clone into repos/{s.name} later</label>
              <label>Purpose{' '}
                <select aria-label="Purpose" value={purposes[r.system.id] ?? s.purpose ?? ''} onChange={e => { touched(); setPurposes(p => ({ ...p, [r.system.id]: e.target.value })) }}>
                  <option value="">None</option>
                  {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
          )}
        </td>
        <td>{dup ? `Already listed as ${r.duplicateOf}` : 'New'}</td>
      </tr>
    )
  }
  const head = <thead><tr><th><span className="sr-only">Add</span></th><th>Kind</th><th>Name</th><th>Link</th><th>Status</th></tr></thead>

  if (error !== undefined) return <><PageHead title="Map the rest" /><Note state="error">{error}</Note></>
  if (systems === null || read.pending) return <><PageHead title="Map the rest" /><Skeleton rows={4} shape="row" label="Systems" /></>

  return (
    <>
      <PageHead title="Map the rest" about={first ? 'Opened. Now list everything else the org runs: repos, docs, accounts, Safes.' : 'List everything else the org runs: repos, docs, accounts, Safes.'} />
      <div className="mapr">
        {manifestOut.length > 0 && (
          <section>
            <h2>Already in repos.manifest.json</h2>
            <table className="mapr-table">{head}<tbody>{manifestOut.map(row)}</tbody></table>
          </section>
        )}
        {manifest.error && <Note state="error">{manifest.error.message}</Note>}
        <section>
          <label htmlFor="mapr-text" className="mapr-label">One link per line</label>
          <textarea id="mapr-text" className="input" rows={6} value={text} onChange={e => setText(e.target.value)} />
          <div><Button onClick={() => { touched(); setRecognised(text) }}>Recognise</Button></div>
        </section>
        {(pastedOut.length > 0 || pasted.errors.length > 0) && (
          <section>
            <table className="mapr-table">
              {head}
              <tbody>
                {pastedOut.map(row)}
                {(pasted.errors as { line: string; error: string }[]).map((e, i) => (
                  <tr key={`e:${i}`}><td /><td /><td /><td className="mapr-link">{e.line}</td><td>{e.error}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {githubOut.map(g => (
          <section key={g.owner}>
            <h2>github.com/{g.owner}</h2>
            {g.state === 'loading' ? <Note state="loading">Reading the repos.</Note>
              : 'error' in (g.state as object) ? <Note state="error">{(g.state as { error: string }).error}</Note>
              : <>
                {g.rows.length === 0 && <Note state="empty">Nothing new here: every repo is already listed.</Note>}
                {g.rows.length > 0 && <table className="mapr-table">{head}<tbody>{g.rows.map(row)}</tbody></table>}
                {(g.state as { more: boolean }).more && <p>Showing the first 100.</p>}
              </>}
          </section>
        ))}
        <div className="mapr-stage">
          <Button primary disabled={chosen.length === 0 || busy} onClick={stage}>{`Stage ${chosen.length} additions`}</Button>
          {staged && <p role="status">Staged. Review them in Changes.</p>}
          {staged && <ButtonLink href="/changes">Open Changes</ButtonLink>}
          {failure !== null && <Note state="error">{failure}</Note>}
        </div>
      </div>
    </>
  )
}
