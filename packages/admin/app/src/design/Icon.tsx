import type { ComponentType, SVGProps } from 'react'
import {
  House, Inbox, GitPullRequest, Box, Network, FileText, Library, Layers, Search, ChevronDown, ChevronRight,
  ChevronLeft, ChevronsUpDown, ArrowRight, ExternalLink, Copy, Check, X, Globe, Users, Lock, Eye, Ellipsis,
  Plus, Minus, ListFilter, ArrowDownWideNarrow, Calendar, Table, Kanban, List, Share2, Sprout, Vote, Wallet,
  Link, Clock, TriangleAlert, MessageSquare, AtSign, Sun, Moon, PanelLeft, Pen, Pencil, Key, GripVertical, Bold,
  Italic, Heading, Maximize, Info, RefreshCw, CircleDashed, Menu, File,
} from 'lucide-react'
import { HOUSE_GLYPHS, type HouseGlyphName } from './glyphs.ts'

export type IconName = 'home'|'needs'|'proposal'|'systems'|'roles'|'safe'|'workspace'|'library'|'changes'|'search'
  |'chevron-down'|'chevron-right'|'chevron-left'|'up-down'|'arrow-right'|'external'|'copy'|'check'|'x'|'globe'
  |'members'|'hat'|'lock'|'eye'|'more'|'plus'|'minus'|'filter'|'sort'|'calendar'|'table'|'board'|'list'|'map'
  |'sprout'|'pool'|'ballot'|'wallet'|'link'|'clock'|'alert'|'comment'|'at'|'sun'|'moon'|'sidebar'|'pen'|'key'
  |'grip'|'bold'|'italic'|'heading'|'fit'|'info'|'refresh'|'dashed-circle'|'seal'|'menu'|'layers'|'file'|'people'|'pencil'|'doc'
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' // 13 · 14 · 16 · 20 (tokens --ic-*)

type Glyph = ComponentType<SVGProps<SVGSVGElement>>

/** Every name that is not a house glyph is a Lucide component. */
const LUCIDE: Record<Exclude<IconName, HouseGlyphName>, Glyph> = {
  home: House, needs: Inbox, proposal: GitPullRequest, systems: Box, roles: Network, workspace: FileText,
  library: Library, changes: Layers, search: Search, 'chevron-down': ChevronDown, 'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft, 'up-down': ChevronsUpDown, 'arrow-right': ArrowRight, external: ExternalLink,
  copy: Copy, check: Check, x: X, globe: Globe, members: Users, lock: Lock, eye: Eye, more: Ellipsis, plus: Plus,
  minus: Minus, filter: ListFilter, sort: ArrowDownWideNarrow, calendar: Calendar, table: Table, board: Kanban,
  list: List, map: Share2, sprout: Sprout, ballot: Vote, wallet: Wallet, link: Link, clock: Clock,
  alert: TriangleAlert, comment: MessageSquare, at: AtSign, sun: Sun, moon: Moon, sidebar: PanelLeft, pen: Pen,
  key: Key, grip: GripVertical, bold: Bold, italic: Italic, heading: Heading, fit: Maximize, info: Info,
  refresh: RefreshCw, 'dashed-circle': CircleDashed, menu: Menu, layers: Layers, file: File, people: Users,
  pencil: Pencil, doc: FileText, // the gallery's page-mention and editing-badge glyphs: a lined document, a pencil with its ferrule
}

/** Only arrows and chevrons mirror under dir="rtl" (§3.9). */
const MIRRORS = new Set<IconName>(['arrow-right', 'chevron-left', 'chevron-right'])

export function Icon({ name, size = 'md', label }: { name: IconName; size?: IconSize; label?: string }) {
  const cls = `i i-${size}${MIRRORS.has(name) ? ' i-mirror' : ''}`
  const a11y = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const }
  const house = (HOUSE_GLYPHS as Record<string, (typeof HOUSE_GLYPHS)[HouseGlyphName] | undefined>)[name]
  if (house) {
    const solid = 'fill' in house && house.fill
    return (
      <svg className={solid ? `${cls} i-solid` : cls} viewBox="0 0 24 24" focusable="false" stroke="currentColor"
        strokeLinecap="round" strokeLinejoin="round" fill="none" {...a11y}>
        {house.paths.map((d) => <path key={d} d={d} />)}
      </svg>
    )
  }
  const Lucide = LUCIDE[name as keyof typeof LUCIDE]
  return <Lucide className={cls} focusable="false" {...a11y} />
}

/** The glyph for a kind of thing (§3.9). Unknown kinds read as a file. */
export function kindIcon(kind: string): IconName {
  switch (kind) {
    case 'safe': return 'safe'
    case 'hats-tree': case 'hat': return 'hat'
    case 'snapshot-space': return 'ballot'
    case 'gardens-community': return 'sprout'
    case 'gardens-pool': return 'pool'
    case 'link': return 'link'
    case 'wallet': return 'wallet'
    case 'proposal': return 'proposal'
    case 'meeting': return 'people'
    case 'task': return 'check'
    case 'page': case 'project': default: return 'file'
  }
}
