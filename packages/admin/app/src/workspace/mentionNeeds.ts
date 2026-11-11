// Mentions as rows of Needs you (DAO-OS L6 Task 18, spec §8.3, §15): each unread notification the server sends is one
// row — "<name> mentioned you on <title>", the target's link — beside 0.6's attention, in the same list, the sidebar's
// count and Home's. The server has judged each row against its target's level now (one the member may no longer see is
// absent, and not counted); the row carries that level, so a preview as someone else drops it too (§6.3). Opening the
// target marks it read (useMarkRead), and the row goes.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type NotificationRow } from '../api.ts'
import { useActor } from '../actor.ts'
import type { NeedItem } from '../elements/needs/needs.ts'
import { entryHref } from '../hrefs.ts'
import { ageText } from '../time.ts'
import { pageHref } from './share.ts'

/** Where a target opens: a page's address, or a record's page. */
export function targetHref(target: string): string {
  if (target.startsWith('page:')) return pageHref(target.slice('page:'.length))
  const m = /^record:([^:]+):(.+)$/.exec(target)
  return m ? entryHref(m[1]!, m[2]!) : '/'
}

/** The unread notifications as Needs you's items, in the order served; `now` dates each. */
export function mentionNeeds(rows: readonly NotificationRow[], now: Date): NeedItem[] {
  return rows.filter(n => !n.read).map(n => ({
    id: `mention:${n.id}`, kind: 'mention' as const, title: n.text, href: targetHref(n.target), context: ageText(n.at, now),
    nodes: [], facts: { visibility: n.visibility },
  }))
}

/** This member's mention rows, live (the `conversation` event makes them stale, events.ts). None for the public or an
 *  unknown actor, and none while the store cannot answer: Needs you's other rows never wait on them. */
export function useMentionNeeds(now: Date): NeedItem[] {
  const { known } = useActor()
  const q = useQuery({ queryKey: ['notifications'], queryFn: api.notifications, enabled: known, retry: false })
  const minute = Math.floor(now.getTime() / 60_000) // the rows' ages move by the minute, not with every tick
  return useMemo(() => (q.data ? mentionNeeds(q.data, now) : NONE), [q.data, minute])
}
const NONE: NeedItem[] = []
