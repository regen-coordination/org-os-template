import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readGovernance, NO_MODEL } from '../../lib/governance-read.mjs'
import { isKnown, lowestHat, readingObservations, walletOf, type Actor } from '../actor.ts'
import { readRegistry } from '../registry.ts'
import { effectiveRules, resolveRoles, rulesForClasses, mayDecideAlone, mayPropose, type RoleBook } from '../../lib/rules.mjs'
import { orgName, str } from '../resources/util.ts'
import type { RuleSummary } from '../changes/types.ts'
import type { Rule } from '../../lib/rules.mjs'
import type { HatObservation } from '../../lib/hat-readings.mjs'
import { classOf } from '../../lib/change-classes.mjs'

/** What the rule is judged from. `readRuleContext` reads it; the judgement does no I/O. */
export interface RuleContext {
  org: string                                   // the org's name, as GET /api/status gives it
  governance: Record<string, unknown> | null    // F1 readGovernance(...).governance
  shape: string                                 // F1 readGovernance(...).shape
  problems: string[]                            // F1 readGovernance(...).problems
  modelImplied: boolean                         // F1 readGovernance(...).modelImplied: no model is stated, solo is assumed
  actor: Actor
  /** data/members.yaml's entries, to resolve roles. Absent: the actor is taken as the only member. */
  members?: Record<string, unknown>[]
  /** The actor's Hats reading as observations (L5 spec §7.3; `readingObservations`): for an act, read now. A role
   *  sourced from a hat holds the actor when they wear it, and not when the reading shows its hat taken off; with no
   *  reading, such a role holds nobody here. */
  observations?: HatObservation[]
}

/** The seam P2 replaces with the rule evaluator (architecture 4.5): same arguments, same answer.
 *  `classes` are F1 classOf's, one per class the change touches. */
export type RuleFor = (ctx: RuleContext, classes: string[]) => RuleSummary

export const SOLO_RULE: RuleSummary = Object.freeze({
  direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer',
}) as RuleSummary

/** No governance file, or none that names a model: the solo default (the operator's ruling). The
 *  source is F1's problem line, so the tray and the Governance page say the same thing. */
export const SOLO_DEFAULT: RuleSummary = Object.freeze({
  direct: true, sentence: 'the maintainer decides alone', source: NO_MODEL,
}) as RuleSummary

export function readRuleContext(repo: string, actor: Actor): RuleContext {
  const path = join(repo, 'data', 'governance.yaml')
  let text: string | null = null
  try { text = existsSync(path) ? readFileSync(path, 'utf8') : null } catch { text = null }
  let members: Record<string, unknown>[] = []
  try { members = existsSync(join(repo, 'data', 'members.yaml')) ? (readRegistry(repo, 'members').entries ?? []) : [] } catch { members = [] }
  const read = readGovernance(text) as {
    governance: Record<string, unknown> | null; shape: string; problems: string[]; modelImplied: boolean
  }
  return {
    org: orgName(repo), governance: read.governance, shape: read.shape, problems: read.problems, modelImplied: read.modelImplied, actor, members,
    observations: readingObservations(actor, roleHatsOf(read.governance)),
  }
}

/** The hats the governance roles are sourced from (L5 spec §7.1), each once. */
export function roleHatsOf(governance: Record<string, unknown> | null): string[] {
  if (governance === null) return []
  return [...new Set([...resolveRoles(governance, [], []).roles.values()].flatMap(r => (r.hat ? [r.hat] : [])))]
}

const STAYS = 'so this change stays staged.'

/** Written rules (F2): each class the change touches is looked up with `ruleFor`, and the change
 *  is direct only if the actor may apply every one of those classes alone (`mayDecideAlone`).
 *  Otherwise it is proposable when every class has a rule and the actor may propose under each
 *  (Propose, P2): the sentence says why it is not direct, and what to do. Nothing is opened,
 *  stored or evaluated here. */
function writtenRules(ctx: RuleContext, rules: readonly Rule[], classes: string[]): RuleSummary {
  const { actor, org } = ctx
  const SOURCE = 'data/governance.yaml rules'
  if (!isKnown(actor)) return { direct: false, proposable: false, source: 'data/members.yaml', sentence: 'Read-only: no member matches this git identity.' }
  if (classes.length === 0) {
    return { direct: false, proposable: false, source: SOURCE, sentence: `${org} has written rules in data/governance.yaml, and each change is judged by the rule of its class, ${STAYS}` }
  }
  const members = ctx.members ?? [{ id: actor.id, kind: actor.kind }]
  // Stage and apply have no proposal: the book holds the actor's own reading, read now for an act (L5 spec §7.3).
  const book: RoleBook = resolveRoles(ctx.governance, members, ctx.observations ?? [])
  const used: string[] = []
  let notAlone: { rule: Rule; sentence: string } | null = null
  for (const { class: cls, rule } of rulesForClasses(rules, classes)) {
    if (rule === null) return { direct: false, proposable: false, source: SOURCE, sentence: `No rule in data/governance.yaml covers the class ${cls}; nobody can propose it until a rule does.` }
    const proposed = mayPropose(rule, actor.id, book)
    if (proposed !== true) return { direct: false, proposable: false, source: `${SOURCE}: ${rule.id}`, sentence: proposed }
    const may = mayDecideAlone(rule, actor.id, book)
    if (may !== true && notAlone === null) notAlone = { rule, sentence: may }
    if (!used.includes(rule.id)) used.push(rule.id)
  }
  if (notAlone !== null) {
    return { direct: false, proposable: true, source: `${SOURCE}: ${notAlone.rule.id}`, sentence: `${notAlone.sentence} Propose it instead.` }
  }
  return { direct: true, source: `${SOURCE}: ${used.join(', ')}`, sentence: 'the maintainer decides alone' }
}

/** The solo default (architecture 4.5): `model: solo-maintainer` (or no model declared at all) with
 *  no `rules` lets every member resolved as a person decide directly. Written rules go through
 *  `writtenRules`. Everything else is "not direct", with the sentence the tray shows. */
export const effectiveRule: RuleFor = (ctx, classes) => {
  const { actor, org } = ctx
  if (!isKnown(actor)) {
    return { direct: false, proposable: false, source: 'data/members.yaml', sentence: actor.unknown
      ? `Read-only: your git email \`${actor.unknown}\` matches no member in \`data/members.yaml\`.`
      : 'Read-only: git has no user.email set here, so no member in `data/members.yaml` can be matched.' }
  }
  if (ctx.governance === null) {
    return { direct: false, proposable: false, source: 'data/governance.yaml',
      sentence: `${org}'s data/governance.yaml cannot be read (${ctx.problems[0] ?? ctx.shape}), ${STAYS}` }
  }
  const g = ctx.governance
  const written = effectiveRules(g)
  if (!written.implied && written.rules.length > 0) return writtenRules(ctx, written.rules, classes)
  const model = str(g.model)
  if (ctx.modelImplied || model === 'solo-maintainer') {
    const solo = ctx.modelImplied ? SOLO_DEFAULT : SOLO_RULE
    if (actor.kind !== 'person') {
      return { direct: false, proposable: false, source: solo.source,
        sentence: `${actor.name} is a member of kind ${actor.kind}, and under solo-maintainer only a person decides; ${STAYS}` }
    }
    return { ...solo }
  }
  return { direct: false, proposable: false, source: `model: ${model}`,
    sentence: `${org} decides changes by ${String(model).replace(/-/g, ' ')}, and data/governance.yaml writes no rule for it, so nothing can be proposed until a rule is written.` }
}

/** May the context's actor write a thing of `registry` (coordinator Q77)? Yes when the rule for its class lets them apply
 *  a change of it alone, or propose one (`effectiveRule(...).direct || .proposable`). The one predicate for who may narrow
 *  (narrow.ts) and for who is drawn the visibility control (GET /api/visibility `writable`). True, or the rule's sentence
 *  for why not. */
export function mayWrite(ctx: RuleContext, registry: string): true | string {
  const rule = effectiveRule(ctx, [String(classOf({ registry }))])
  return rule.direct || rule.proposable === true ? true : rule.sentence
}

/** The ids of the rules a change is judged by: one per rule that covers a class it touches, in class
 *  order, each once. The solo default is the rule `solo`. A class no rule covers adds none (the
 *  caller has already refused it). This is what `Org-Rule` names, with the method (P2-R14). */
export function ruleIds(ctx: RuleContext, classes: string[]): string[] {
  const governance = ctx.governance ?? { model: 'solo-maintainer' }
  const ids: string[] = []
  for (const { rule } of rulesForClasses(effectiveRules(governance).rules, classes)) {
    if (rule !== null && !ids.includes(rule.id)) ids.push(rule.id)
  }
  return ids
}

/** The hats of the roles sourced from a hat (L5 spec §7.1) that the written rules for `classes` name, each once, in rule
 *  order: to decide (`decide.by`) and, unless `deciding` alone is asked, to propose. None under the solo default or an
 *  unreadable governance file. */
export function ruleHats(ctx: RuleContext, classes: string[], which: 'deciding' | 'both' = 'both'): string[] {
  if (ctx.governance === null) return []
  const written = effectiveRules(ctx.governance)
  if (written.implied) return []
  const book = resolveRoles(ctx.governance, [], [])
  const hats: string[] = []
  for (const { rule } of rulesForClasses(written.rules, classes)) {
    for (const id of rule ? (which === 'deciding' ? [rule.decide?.by] : [rule.decide?.by, rule.propose]) : []) {
      const hat = typeof id === 'string' ? book.roles.get(id)?.hat : undefined
      if (hat && !hats.includes(hat)) hats.push(hat)
    }
  }
  return hats
}

/** The value of `Org-Hat` for a direct apply of `classes` by the context's actor (L5 spec §6.4 "one per hat used", §7.5;
 *  Task 10 M1, R-L5-21.2), each `<hat ref> @<block>` at the block of the reading the context carries (read now for an
 *  act): the hats of the roles sourced from a hat that hold the actor by that reading, the deciding ones and the proposing
 *  ones, one per hat used, so validate:governance grants a role only from a hat the commit names. An actor who acts as
 *  their CAIP-10 id always carries one: under the solo default, or when no deciding role's hat is one they wear, the
 *  lowest hat they wear (the hat they are named by, R-L5-7.4). Commit trailers are permanent: a direct apply by an
 *  address says which hat let it in. */
export function hatsActedUnder(ctx: RuleContext, classes: string[]): string[] {
  const { actor } = ctx
  if (!isKnown(actor) || ctx.governance === null) return []
  const worn = new Map((ctx.observations ?? []).filter(o => o.wears).map(o => [o.hat, o.block]))
  const book = resolveRoles(ctx.governance, ctx.members ?? [], ctx.observations ?? [])
  const used = ruleHats(ctx, classes, 'both')
    .filter(hat => worn.has(hat) && [...book.roles.values()].some(r => r.hat === hat && r.members.includes(actor.id)))
  if (used.length === 0 && walletOf(actor)?.account === actor.id) {
    const lowest = lowestHat([...worn.keys()])
    if (lowest) used.push(lowest)
  }
  return used.map(hat => `${hat} @${worn.get(hat)}`)
}
