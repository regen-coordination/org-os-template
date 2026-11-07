import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError, type WizardDef } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Note } from '../design/Note.tsx'
import NotFound from '../pages/NotFound.tsx'
import ClaimHandle from './ClaimHandle.tsx'
import OpenInstance from './OpenInstance.tsx'
import { PageLoading } from '../frame/PageLoading.tsx'

/** The screens each wizard definition has. A definition is data (wizards/*.yaml); the page that draws
 *  its steps is code, one per wizard, and a definition without one says so rather than draw nothing. */
const FLOWS: Record<string, ComponentType<{ def: WizardDef }>> = { 'claim-handle': ClaimHandle, 'open-instance': OpenInstance }

export default function WizardPage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['wizard', id], queryFn: () => api.wizard(id), retry: false })
  if (q.isPending) return <PageLoading title="Wizard" shape="row-1" rows={4} />
  // A read that failed says it failed (R8): only a 404 means there is no such wizard, and only that is the not-found page.
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />
    return <><PageHead title="Wizard" meta={[id]} /><Note state="error">{q.error.message}</Note></>
  }
  const def = q.data
  const Flow = FLOWS[def.id]
  return (
    <>
      <PageHead title={def.title} meta={['wizard', `${def.steps.length + 1} steps`, def.id === 'open-instance' ? 'runs nothing yet' : 'nothing is written until the last is confirmed']} />
      {Flow ? <Flow def={def} /> : <Note state="notYet">This wizard has no screens in this app yet.</Note>}
    </>
  )
}
