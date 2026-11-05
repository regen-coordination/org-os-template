export type SkeletonShape = 'row' | 'row-1' | 'card' | 'node' | 'needs'

/** One row's bars, in the shape of the element it stands for (§6.2). */
function Bars({ shape }: { shape: SkeletonShape }) {
  if (shape === 'row') return <><span className="ktile ktile-row" /><span className="skel-main"><span className="skel-bar skel-t" /><span className="skel-bar skel-s" /></span><span className="skel-bar skel-e" /></>
  if (shape === 'needs') return <><span className="ktile ktile-needs" /><span className="skel-main"><span className="skel-bar skel-t" /><span className="skel-bar skel-s" /></span><span className="skel-bar skel-e" /></>
  if (shape === 'row-1') return <><span className="skel-main"><span className="skel-bar skel-t" /></span><span className="skel-bar skel-e" /></>
  return <><span className="skel-bar skel-s skel-k" /><span className="skel-bar skel-t" /><span className="skel-bar skel-s" /></>
}

/** The first load of a list, a board or a map (§6.2): rows of the element's own shape at its real height, so
 *  nothing jumps when it arrives. A busy region named "Loading <label>"; its bars are hidden and breathe only
 *  while it is busy. Never a full-page spinner, and never for what renders from cache. */
export function Skeleton({ rows, shape, label }: { rows: number; shape: SkeletonShape; label: string }) {
  return (
    <div className="skel" data-shape={shape} role="region" aria-busy="true" aria-label={`Loading ${label}`}>
      {Array.from({ length: Math.max(0, rows) }, (_, i) => (
        <div key={i} className={`skel-row skel-row-${shape}`} aria-hidden="true"><Bars shape={shape} /></div>
      ))}
    </div>
  )
}
