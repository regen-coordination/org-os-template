import type { PortalModel } from './portal.ts'
import { PageHeading } from '../design/PageHeading.tsx'

/** The tagline with its phrase in moss italic: the one `<em>` of the H1. A phrase the tagline does not hold follows
 *  it; an empty phrase leaves the tagline plain. */
function Tagline({ tagline, phrase }: { tagline: string; phrase: string }) {
  const p = phrase.trim()
  if (!p) return <>{tagline}</>
  const at = tagline.indexOf(p)
  if (at < 0) return <>{tagline} <em>{p}</em></>
  return <>{tagline.slice(0, at)}<em>{p}</em>{tagline.slice(at + p.length)}</>
}

/** The hero (§12.2): two columns, 1.25 : 1, bottom-aligned (one under 900px). The eyebrow in Mono ("A network
 *  cooperative · since 2024"), the H1 in the portal's display size with one moss phrase; then the description and the
 *  facts, each a Fraunces figure over a mute label. */
export function Hero({ org, facts }: { org: PortalModel['org']; facts: PortalModel['facts'] }) {
  const eyebrow = [org.kind?.trim() || null, org.since ? `since ${org.since}` : null].filter(Boolean).join(' · ')
  return (
    <div className="portal-hero">
      <div>
        {eyebrow && <p className="portal-eyebrow">{eyebrow}</p>}
        <PageHeading className="portal-h1"><Tagline tagline={org.tagline} phrase={org.phrase} /></PageHeading>
      </div>
      <div>
        {org.description && <p className="portal-desc">{org.description}</p>}
        {facts.length > 0 && (
          <ul className="portal-facts">
            {facts.map(f => <li key={f.label} className="portal-fact"><span className="portal-fact-f">{f.figure}</span> <span className="portal-fact-l">{f.label}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
