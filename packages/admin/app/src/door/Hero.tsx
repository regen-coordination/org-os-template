import type { DoorModel } from './door.ts'
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
 *  society · since 2022"), the H1 in the door's display size with one moss phrase; then the description and the
 *  facts, each a Fraunces figure over a mute label. */
export function Hero({ org, facts }: { org: DoorModel['org']; facts: DoorModel['facts'] }) {
  const eyebrow = [org.kind?.trim() || null, org.since ? `since ${org.since}` : null].filter(Boolean).join(' · ')
  return (
    <div className="door-hero">
      <div>
        {eyebrow && <p className="door-eyebrow">{eyebrow}</p>}
        <PageHeading className="door-h1"><Tagline tagline={org.tagline} phrase={org.phrase} /></PageHeading>
      </div>
      <div>
        {org.description && <p className="door-desc">{org.description}</p>}
        {facts.length > 0 && (
          <ul className="door-facts">
            {facts.map(f => <li key={f.label} className="door-fact"><span className="door-fact-f">{f.figure}</span> <span className="door-fact-l">{f.label}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
