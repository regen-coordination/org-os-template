import { useActor } from '../actor.ts'
import { canCreate } from '../editable.ts'
import { newRecordHref } from '../hrefs.ts'
import { useRegistries, useResources, useSystemEntries } from '../queries.ts'
import { restrictedHat } from '../record/restricted.ts'
import type { SectionDef } from '../sections.ts'
import { AddPlate, BrokenPlate, CannotPlate, ConnectPlate, RestrictedPlate, type PlateLevel } from '../design/Plate.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { useImportSheet } from '../import/ImportSheet.tsx'
import { entryKinds, useEntryOf } from './entries.ts'
import { runQuery } from './query.ts'
import type { RecordSource } from './types.ts'

/** Where a section's Add goes, or undefined where this viewer has none: a known member, in a collection the house
 *  writes, never while previewing (New is a write, C-23). One rule for the page head's primary, the plate and the
 *  view header: Option A everywhere (DP-47, the operator's call; B is a phone's, and the setup checklist's). */
export function useAddHref(def: SectionDef | undefined): string | undefined {
  const registries = useRegistries()
  const { known } = useActor()
  const canWrite = useCanWrite()
  if (!def || def.newRegistry === undefined) return undefined
  const writable = canWrite && canCreate(def.newRegistry, registries.data?.find(g => g.name === def.newRegistry)?.kind, known)
  return writable ? newRecordHref(def.newRegistry) : undefined
}

/** A file the server could not read, from its own sentence (server/registry.ts: "data/x.yaml cannot be read: at line
 *  12, column 5, …", or a write's "… is not valid YAML …: at line 3, column 1, …"): the file, the line when the
 *  sentence carries one, and the reason. Null when the sentence names no data file it could not read. No second
 *  parser: only what the server already said. */
export function brokenFileOf(message: string): { file: string; line?: number; reason: string } | null {
  const file = /\b(data\/[\w.-]+\.ya?ml)\b/.exec(message)?.[1]
  if (!file || !/cannot be read|is not valid YAML/.test(message)) return null
  const at = /at line (\d+), column \d+, /.exec(message)
  const rest = at ? message.slice(at.index + at[0].length) : message.replace(/^.*?(?:cannot be read|is not valid YAML)[^:]*:\s*/, '')
  const said = rest.replace(/\s*Nothing was written\.\s*/g, ' ').trim()
  const reason = said === '' ? 'the server could not read it.' : said
  return { file, ...(at ? { line: Number(at[1]) } : {}), reason }
}

/** What the filters hid, by the value each hidden row reads ("4 are closed and 2 are draft."), most first. A row with
 *  no value "has no status". The values are as the viewer is shown them: a restricted one reads "<hat> only". */
export function hiddenWords(values: string[]): string {
  if (values.length === 0) return ''
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) =>
    v === '' ? `${n} ${n === 1 ? 'has' : 'have'} no status` : `${n} ${n === 1 ? 'is' : 'are'} ${v}`)
  const said = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
}

const fileOf = (def: SectionDef) => `data/${def.registry ?? def.newRegistry}.yaml`

/** A section's plate, by why it is empty: its file could not be read; everything in it is kept from this viewer; it
 *  is a System section with nothing connected; this viewer can add; or they cannot. */
export function SectionPlate({ def, level, hidden, broken }: {
  def: SectionDef & { words: NonNullable<SectionDef['words']> }; level: PlateLevel
  hidden?: { count: number; hat: string | null }; broken?: { file: string; line?: number; reason: string } | null
}) {
  const href = useAddHref(def)
  const w = def.words
  // Import from a sheet (§1c) is offered where Add is: it stages creates into the same file.
  const importer = useImportSheet(href ? def.newRegistry : undefined, w.nouns)
  if (broken) return <BrokenPlate title={def.label} file={broken.file} line={broken.line} reason={broken.reason} level={level} />
  if (hidden && hidden.count > 0) return <RestrictedPlate count={hidden.count} nouns={w.nouns} noun={w.noun} hat={hidden.hat} level={level} />
  if (w.connect) return <ConnectPlate connect={w.connect} href={href} level={level} />
  if (href) return <><AddPlate words={w} file={fileOf(def)} addHref={href} onImport={importer.start} level={level} />{importer.sheet}</>
  return <CannotPlate nouns={w.nouns} level={level} />
}

/** A section list's plate, read live: what the viewer's eyes keep from them (counted, never named: D-12) and the file
 *  card the records adapter leaves when the section's file cannot be read (`absent:records:<registry>`). */
export function LiveSectionPlate({ def, source, level }:
  { def: SectionDef & { words: NonNullable<SectionDef['words']> }; source: RecordSource; level: PlateLevel }) {
  const resources = useResources().data ?? []
  const systems = useSystemEntries()
  const entries = useEntryOf(entryKinds(source))
  const { sees } = useViewer()
  const visibility = useVisibilitySource()
  // the viewer's eyes are applied on each draw, as the list's own rows are (useListData)
  const hidden = (() => {
    const kept = runQuery(source, resources, systems, entries.entryOf).filter(r => !sees(r))
    const levels = new Set(kept.map(r => {
      const v = visibility.visibilityOf(r)
      return v.level === 'hat' ? restrictedHat(`hat:${v.hat}`, visibility) : v.level === 'members' ? restrictedHat('members', visibility) : ''
    }))
    const only = levels.size === 1 ? [...levels][0]! : ''
    return { count: kept.length, hat: only === '' ? null : only }
  })()
  const registry = def.registry ?? def.newRegistry
  const card = registry ? resources.find(r => r.id === `absent:records:${registry}`) : undefined
  const said = card ? card.attention?.text ?? (typeof card.facts.why === 'string' ? card.facts.why : '') : ''
  return <SectionPlate def={def} level={level} hidden={hidden} broken={said ? brokenFileOf(said) : null} />
}
