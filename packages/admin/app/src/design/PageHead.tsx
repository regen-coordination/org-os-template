import type { ReactNode } from 'react'
import { FromMark, type From } from '../elements/atoms/FromMark.tsx'

/** 0.6's page head, drawn as the house's record header (§9.1): the title (Sans 600 24), the "what this is" line
 *  under it (`about`: a section's, design pass 2026-11-04), a meta line (kind · file · branch…, then where the page
 *  was read from, E-2) and the buttons under it. L4c moves the pages to `RecordHeader`. `now` dates the from mark's
 *  age (now by default). */
export function PageHead({ title, about, meta = [], from, now, children }:
  { title: string; about?: ReactNode; meta?: (string | null | undefined | false)[]; from?: From; now?: Date; children?: ReactNode }) {
  const line = meta.filter((m): m is string => typeof m === 'string' && m !== '')
  return (
    <header className="rh">
      <h1 className="rh-title" title={title}>{title}</h1>
      {about && <p className="rh-about">{about}</p>}
      {(line.length > 0 || from) && (
        <div className="rh-meta">{line.join(' · ')}{line.length > 0 && from && ' · '}{from && <FromMark from={from} now={now ?? new Date()} />}</div>
      )}
      {children && <div className="rh-acts">{children}</div>}
    </header>
  )
}
