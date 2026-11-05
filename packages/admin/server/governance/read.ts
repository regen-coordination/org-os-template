import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusGroup } from '../../lib/decision-status.mjs'
import { memberKind } from '../../lib/members.mjs'
import { readRegistry, type Entity } from '../registry.ts'
import { loadSchema } from '../schema.ts'
import { str } from '../resources/util.ts'
import { effectiveRules, describeRule } from '../../lib/rules.mjs'
import { effectiveRule, readRuleContext, type RuleContext } from './effective.ts'
import { parseDecisions, sectionText } from './decisions.ts'
import type { DecisionRow, GovernanceView, RuleSummary } from '../changes/types.ts'
import { NO_MODEL } from '../../lib/governance-read.mjs'

/** The models the framework knows: governance.schema.json's own enum, so there is one list. */
export const KNOWN_MODELS: string[] = (
  (loadSchema('governance') as unknown as { properties: { model: { enum: string[] } } }).properties.model.enum
)

/** Rules are shown for the org, not for whoever is looking: a member who is a person. */
const ANYONE = { id: '', name: '', kind: 'person' }

const readText = (path: string): string | null => {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null } catch { return null }
}
const members = (repo: string): Entity[] => {
  try { return existsSync(join(repo, 'data', 'members.yaml')) ? (readRegistry(repo, 'members').entries ?? []) : [] } catch { return [] }
}
const groupOf = (status: string): string | null => (status ? (statusGroup(status) as string | null) : null)

/** The rules in force, as sentences: written rules as written (P2 evaluates them), else the rule
 *  the model implies, which `effectiveRule` decides (its direct flag and source), so the Governance
 *  page and the tray never disagree. A file that cannot be read states no rule. */
function rulesInForce(ctx: RuleContext): RuleSummary[] {
  const g = ctx.governance
  if (g === null) return []
  const written = Array.isArray(g.rules) ? (g.rules as unknown[]) : []
  if (written.length > 0) {
    return written.map((raw, i) => {
      const rule = effectiveRules({ rules: [raw] }).rules[0]
      const id = rule?.id || `#${i + 1}`
      return { direct: rule?.decide.method === 'direct', source: `data/governance.yaml rules: ${id}`, sentence: describeRule(rule ?? {}) }
    })
  }
  const rule = effectiveRule(ctx, [])
  if (rule.direct) return [{ ...rule, sentence: `applies to everything · a maintainer proposes · ${rule.sentence}` }]
  const model = str(g.model) ?? 'no model'
  return [{ direct: false, source: rule.source, sentence: `applies to everything · decided by ${model.replace(/-/g, ' ')}; no rule is written, so nothing can be proposed` }]
}

function yamlDecisions(g: Record<string, unknown> | null): DecisionRow[] {
  const raw = Array.isArray(g?.decisions) ? (g!.decisions as unknown[]) : []
  return raw.flatMap((d): DecisionRow[] => {
    if (!d || typeof d !== 'object') return []
    const e = d as Record<string, unknown>
    const status = str(e.status) ?? ''
    return [{ date: e.date === undefined || e.date === null ? '' : String(e.date), id: str(e.id) ?? '', title: str(e.title) ?? '',
      status, group: groupOf(status), where: 'governance.yaml' }]
  })
}

/** GET /api/governance. It reads governance.yaml through F1's lenient reader and DECISIONS.md, and never writes. */
export function governanceView(repo: string): GovernanceView {
  const ctx = readRuleContext(repo, ANYONE)
  const g = ctx.governance
  // A model the file does not state is the solo default, not a declared model.
  const model = ctx.modelImplied ? null : (g ? str(g.model) : null)
  // The lenient reader words a fault of the file without its subject ("is not valid YAML: …"); the view says it with
  // the file as its subject, as server/registry.ts does. NO_MODEL is a default, not a fault, and keeps its words.
  const problems = ctx.problems.map(p => (p === NO_MODEL ? p : `data/governance.yaml ${p}`))
  if (model && !KNOWN_MODELS.includes(model)) {
    problems.push(`data/governance.yaml names the model "${model}", which the framework does not know (it knows ${KNOWN_MODELS.join(', ')}).`)
  }
  if (ctx.modelImplied || model === 'solo-maintainer') {
    const people = members(repo).filter(m => memberKind(m) === 'person').length
    if (people > 1) {
      problems.push(`The model is solo-maintainer, but data/members.yaml lists ${people} people, and the solo rule lets each of them apply changes alone. ` +
        `Name the model the org uses, or give the members who are not people their kind.`)
    }
  }
  const md = readText(join(repo, 'DECISIONS.md'))
  const fromMd: DecisionRow[] = md ? parseDecisions(md).map(s => ({
    date: s.date, id: s.id, title: s.title, status: s.status, group: groupOf(s.status), where: 'DECISIONS.md', anchor: s.anchor,
  })) : []
  const decisions = [...yamlDecisions(g), ...fromMd]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.date.localeCompare(a.d.date) || a.i - b.i)
    .map(x => x.d)
  return { model, description: g ? str(g.description) : null, rules: rulesInForce(ctx), decisions, problems: [...new Set(problems)] }
}

/** A DECISIONS.md section's text by its anchor, or null. */
export function decisionMarkdown(repo: string, anchor: string): string | null {
  const md = readText(join(repo, 'DECISIONS.md'))
  if (!md) return null
  const section = parseDecisions(md).find(s => s.anchor === anchor)
  return section ? sectionText(md, section) : null
}
