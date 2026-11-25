import { useEffect, useId, useState, type FormEvent } from 'react'
import { useSearch } from 'wouter'
import { useQuery } from '@tanstack/react-query'
import { PageHead } from '../design/PageHead.tsx'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import { useStatus } from '../queries.ts'
import { useAccountStart } from '../session/accountSignIn.ts'

// /network-account (refi-dao-os network app spec §5.4, §5.7; final review of B8): a node adds or removes its own account
// on the ReFi DAO Network from the Hub, by a click here, never from a link alone (a returning account may be approved
// without a screen at its own server). The page names the node and what will happen, then leaves for the node's
// account's own sign-in, Certified by default or a Bluesky handle, and comes back to `return` (judged by I6 on the Hub).
// It never signs anyone in or changes who they are here.

interface NodeCard { id: string; title: string; account: { handle: string } | null }
const PURPOSES = ['add-node', 'withdraw-node'] as const
type Purpose = typeof PURPOSES[number]
const NODE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/
const OTHER = 'This page adds or removes a node’s own account on the ReFi DAO Network. Start again from the node’s page.'
const ABOUT = 'Sign in with the node’s own Bluesky or Certified account: that proves the account is the node’s. '
  + 'This does not sign you in here or change who you are.'

async function readNode(id: string): Promise<NodeCard> {
  const res = await fetch(`/api/network/nodes/${encodeURIComponent(id)}`)
  const read = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof read.error === 'string' ? read.error : `HTTP ${res.status}`)
  return read as unknown as NodeCard
}

export default function NetworkAccount() {
  const org = useStatus().data?.org ?? 'org-os'
  const q = new URLSearchParams(useSearch())
  const purpose = (PURPOSES as readonly string[]).includes(q.get('purpose') ?? '') ? q.get('purpose') as Purpose : null
  const nodeId = q.get('node') ?? ''
  const valid = purpose !== null && NODE_ID.test(nodeId)
  const back = q.get('return')
  const node = useQuery({ queryKey: ['network', 'node', nodeId], queryFn: () => readNode(nodeId), enabled: valid, retry: false })
  const start = useAccountStart(purpose ?? 'add-node', { node: nodeId, back })
  const handleId = useId()
  const [handle, setHandle] = useState('')
  const adding = purpose === 'add-node'
  const title = node.data ? (adding ? `Add ${node.data.title}’s account to the ReFi DAO Network` : `Remove ${node.data.title}’s account from the ReFi DAO Network`) : 'A node’s account'

  useEffect(() => { document.title = `${title} · ${org}` }, [title, org])
  const byHandle = (e: FormEvent) => { e.preventDefault(); if (handle.trim() !== '') start.start(handle) }

  return (
    <div className="account-links">
      <PageHead title={title} about={valid && node.data ? ABOUT : undefined} />
      {!valid && <Note state="unavailable">{OTHER}</Note>}
      {node.error && <Note state="unavailable">{node.error.message}</Note>}
      {valid && node.data && <>
        {!adding && node.data.account && <p className="signin-p">{`Its account on the network now: ${node.data.account.handle}. Sign in with that account to remove it.`}</p>}
        {adding && node.data.account && <p className="signin-p">{`It already has an account on the network (${node.data.account.handle}); another one waits for a steward until that one is removed.`}</p>}
        <div className="signin-go"><Button primary onClick={() => start.start()} {...(start.busy ? { busy: 'Opening…' } : {})}>Continue with Certified</Button></div>
        <form className="signin-form" onSubmit={byHandle}>
          <label className="signin-label" htmlFor={handleId}>Or the node’s Bluesky handle</label>
          <input className="input" id={handleId} name="handle" autoComplete="off" placeholder="your-node.bsky.social"
            value={handle} onChange={e => setHandle(e.target.value)} />
          <div className="signin-go"><Button type="submit">Continue with this handle</Button></div>
        </form>
        {start.error && <Note state="error">{start.error}</Note>}
      </>}
    </div>
  )
}
