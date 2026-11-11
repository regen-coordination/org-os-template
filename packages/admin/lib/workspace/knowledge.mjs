// packages/admin/lib/workspace/knowledge.mjs
//
// The collection `knowledge` (DAO-OS L6 §7.5): kms's store as the instance holds it. Every `data/kb/<type>.yaml` whose top
// level `entries:` is a map holds records; a record's id is `<type>/<slug>` and its file is its kind's. A file under
// data/kb/ that is not such a map (an index, a list) holds none. Pure: texts in, records out, so the server, validate:data
// and validate:governance read the canon the same way.
import { isAlias, isMap as isYamlMap, isScalar, parse, parseDocument, visit } from 'yaml'

/** A kind's canon file: `data/kb/<type>.yaml`. */
export const KNOWLEDGE_FILE = /^data\/kb\/([a-z0-9][a-z0-9-]*)\.yaml$/

/** A knowledge record's id, `<type>/<slug>`, split; null when `id` is not one. @param {unknown} id
 *  @returns {{ type: string, slug: string } | null} */
export function knowledgeIdParts(id) {
  const m = /^([a-z0-9][a-z0-9-]*)\/([^/\s]+)$/.exec(String(id))
  return m ? { type: m[1], slug: m[2] } : null
}

/** The kind a canon file holds, from its path; null for any other path. @param {string} path @returns {string | null} */
export function kindOfFile(path) {
  return KNOWLEDGE_FILE.exec(path)?.[1] ?? null
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A canon file's objects by slug, from its text; null when the text is no `entries:` map (or cannot be read), so it holds
 *  no records. An entry that is not a mapping is left out. @param {string | null} text
 *  @returns {Map<string, Record<string, unknown>> | null} */
export function canonObjects(text) {
  if (text === null) return null
  let doc
  try { doc = parse(text) } catch { return null }
  if (!isMap(doc) || !isMap(doc.entries)) return null
  return new Map(Object.entries(doc.entries).filter(([, v]) => isMap(v)))
}

/** A canon file's records, each `{ id: '<type>/<slug>', ...its fields }` (the object's own `id` field, kms's, is not the
 *  record's and is left out, as a map-shaped registry leaves it). [] for a file that holds none.
 *  @param {string | null} text @param {string} type @returns {Record<string, unknown>[]} */
export function canonRecords(text, type) {
  const objects = canonObjects(text)
  if (objects === null) return []
  return [...objects].map(([slug, object]) => {
    const { id: _own, ...fields } = object
    return { id: `${type}/${slug}`, ...fields }
  })
}

/** A YAML timestamp as js-yaml 4 resolves one (YAML 1.1's `timestamp` type, which kms's loader keeps): an entry key that
 *  looks like one is a Date to kms and a text to the house. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::?\d{2})?))?)?$/

/** Why kms may read a canon text differently from the house (ruling PF-R2, fail closed), or null when the two read it alike.
 *  The house parses the canon with yaml 2 (YAML 1.2, merge keys off); kms loads it with js-yaml 4, which follows `<<` merge
 *  keys, resolves YAML 1.1 tags (`!!set`, `!!omap`, `!!binary`) and reads a timestamp key as a Date. The house does not
 *  try to reproduce that reading: a text that uses any of what the two read differently is one the house's writers and
 *  judges do not touch. Read anywhere in the document, not only under `entries:` (an anchor outside it can be merged into
 *  an entry, and a root merge key can supply `entries:` itself). A text that cannot be parsed is not judged here: every
 *  writer already refuses it. Answers the phrase a sentence completes ("…uses YAML anchors or merge keys").
 *  @param {string | null | undefined} text @returns {string | null} */
export function canonReadDiffers(text) {
  if (typeof text !== 'string') return null
  let doc
  try { doc = parseDocument(text) } catch { return null }
  if (doc.errors.length > 0) return null
  if (doc.directives?.yaml?.version !== '1.2') return 'declares a YAML version other than 1.2'
  let why = null
  visit(doc, {
    Pair(_k, pair) {
      if (isScalar(pair.key) && pair.key.value === '<<') { why = 'uses YAML anchors or merge keys'; return visit.BREAK }
    },
    Node(_k, node) {
      if (isAlias(node) || node.anchor) { why = 'uses YAML anchors or merge keys'; return visit.BREAK }
      if (node.tag) { why = 'uses YAML tags'; return visit.BREAK }
    },
  })
  if (why !== null) return why
  const entries = isYamlMap(doc.contents) ? doc.contents.get('entries', true) : null
  if (isYamlMap(entries)) {
    for (const pair of entries.items) {
      const key = pair.key
      if (!isScalar(key) || key.value === null || key.value === undefined || typeof key.value === 'object' || TIMESTAMP.test(String(key.value))) {
        return 'names an entry with a key that is not plain text'
      }
    }
  }
  return null
}

/** The sentence a canon file kms reads differently is refused with (PF-R2): the file, why, and what to do. `tail` is the
 *  refusal's last words ("Nothing was staged.", "Nothing was written."). @param {string} rel @param {string} why
 *  @param {string} tail @returns {string} */
export function canonReadDiffersSentence(rel, why, tail) {
  return `${rel} ${why}, which the commons reads differently; edit it by hand into plain entries first. ${tail}`
}
