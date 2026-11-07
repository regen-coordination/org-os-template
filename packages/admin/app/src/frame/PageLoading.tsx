import { useLocation } from 'wouter'
import { PageHead } from '../design/PageHead.tsx'
import { Skeleton, type SkeletonShape } from '../design/Skeleton.tsx'
import { pathOf } from './path.ts'

/** A page's first frame (§6.2; walk 2026-11-04): its heading — `title`, else the page's name in the path, which the
 *  address alone gives (a record's or a proposal's id until its name is read) — and a skeleton in the page's own
 *  shape, busy and named "Loading <page>". Never the spinner and "Loading…", and never a page with no h1. */
export function PageLoading({ title, shape = 'row', rows = 4, meta }: { title?: string; shape?: SkeletonShape; rows?: number; meta?: (string | null)[] }) {
  const [location] = useLocation()
  const name = title ?? pathOf(location, {}).at(-1)?.label ?? ''
  return <><PageHead title={name} meta={meta} /><Skeleton rows={rows} shape={shape} label={name} /></>
}
