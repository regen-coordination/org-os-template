import { useMemo } from 'react'
import { Link, useLocation } from 'wouter'
import type { Resource } from '../api.ts'
import { useResources } from '../queries.ts'
import { recordHref } from '../hrefs.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { driverOf } from '../systems/DriverView.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Note, NoteBlock } from '../design/Note.tsx'
import { roleTreeFrom, type RoleNode } from '../elements/governance/roles.ts'
import { RoleTree } from '../elements/governance/RoleTree.tsx'
import { systemKind } from '../elements/rows/systemState.ts'
import { derivedLinks } from '../map/fromRecords.ts'
import { useNow } from '../time.ts'
import { useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

/** What each hat does, from the reads (E-40): the hat whose wearers are a Safe's owners "signs 4 of 8"; the top hat a
 *  System holds is "top hat · held by the Safe" (or by that System, named). Names stay the pretty id until L7 reads
 *  the hats' details. */
export function rolesOf(tree: Resource, resources: Resource[]): RoleNode[] {
  const read = driverOf(tree)
  if (!read || !read.ok) return []
  const links = derivedLinks(resources)
  const byId = new Map(resources.map(r => [r.id, r]))
  const doesOf = (id: string): string => {
    const signs = links.filter(k => k.from === id && k.label.startsWith('signs'))
    const held = links.find(k => k.to === id && k.label === 'holds')
    const by = held ? byId.get(held.from) : undefined
    return [
      ...(by ? [`top hat · held by ${systemKind(by) === 'safe' ? 'the Safe' : by.name}`] : []),
      ...signs.map(k => (signs.length > 1 ? `${k.label} on ${byId.get(k.to)?.name ?? 'a Safe'}` : k.label)),
    ].join(' · ')
  }
  const walk = (nodes: RoleNode[]): RoleNode[] => nodes.map(n => ({ ...n, children: walk(n.children), does: doesOf(n.id) || n.does }))
  return walk(roleTreeFrom(read))
}

/** Roles (§9.7, section `/roles`): the Hats tree's role tree — the first hats-tree System the viewer may see, with
 *  what each hat does from the reads. The tree is not drawn for a viewer who may not see that System (E-39): a
 *  RoleNode carries no facts, so the gate is here. With no tree, "No Hats tree yet." and the way to add one. The
 *  head carries the from mark: the tree's own read (E-47). Enter opens the tree's record, Space inspects it. */
export default function Roles() {
  const resources = useResources()
  const { viewer, visible } = useViewer()
  const source = useVisibilitySource()
  const inspector = useInspector()
  const [, navigate] = useLocation()
  const now = useNow(false)
  const all = resources.data ?? []
  const tree = useMemo(() => visible(all.filter(r => r.kind === 'system' && systemKind(r) === 'hats-tree'))[0] ?? null, [resources.data, viewer, source])
  const nodes = useMemo(() => (tree ? rolesOf(tree, all) : []), [tree, resources.data])
  const read = tree ? driverOf(tree) : null
  return (
    <>
      <PageHead title="Roles" from={tree ? { system: tree.name, read } : undefined} now={now} />
      {resources.error ? <Note state="error">{resources.error.message}</Note>
        : resources.isPending ? <Skeleton rows={4} shape="row" label="Roles" />
        : !tree ? <NoteBlock title="No Hats tree yet." line="Roles are read from a Hats tree System." action={<Link href="/library">Add one from the Library.</Link>} />
        : nodes.length === 0 ? <NoteBlock title={read && !read.ok ? `${tree.name} couldn’t be read.` : `${tree.name} has no hats read yet.`} line="The tree’s record says when it was last read." />
        : <RoleTree nodes={nodes} label={`Roles in ${tree.name}`} onOpen={() => navigate(recordHref(tree.id))} onInspect={() => inspector.open(tree.id)} />}
    </>
  )
}
