import { Icon, kindIcon, type IconName } from './Icon.tsx'

export type KindTileSize = 'row' | 'needs' | 'header'
export type KindTileTone = 'plain' | 'attn' | 'moss'

/** The kind tile (§7.14): the kind's glyph, mute on --wash — 28 in a row, 32 on Needs you, 40 (and a 20px glyph)
 *  on a record header. `attn` is clay on --attn-soft (something needs a person); `moss` is an outcome done or
 *  added. `icon` draws another glyph than the kind's (Needs you's neutral check, a signature's pen). Decoration: the
 *  kind is said in the text beside it. */
export function KindTile({ kind, size = 'row', tone = 'plain', icon }: { kind: string; size?: KindTileSize; tone?: KindTileTone; icon?: IconName }) {
  const cls = ['ktile', `ktile-${size}`, tone === 'plain' ? null : `ktile-${tone}`].filter(Boolean).join(' ')
  return <span className={cls} aria-hidden="true"><Icon name={icon ?? kindIcon(kind)} size={size === 'header' ? 'lg' : 'md'} /></span>
}
