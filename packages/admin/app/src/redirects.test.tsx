// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Route, Switch } from 'wouter'
import { ProposalRedirect, RegistryRedirect, ToBoard } from './redirects.tsx'
import { renderAt } from './test/render.tsx'

const routes = (
  <Switch>
    <Route path="/maps/:map">{p => <ToBoard id={p.map} />}</Route>
    <Route path="/r/proposal/:id">{p => <ProposalRedirect id={p.id} />}</Route>
    <Route path="/r/:registry">{p => <RegistryRedirect registry={p.registry} />}</Route>
    <Route path="/b/:id">landed</Route>
    <Route>landed</Route>
  </Switch>
)

describe('old addresses (spec §5.4)', () => {
  it('/maps/:map goes to its board, keeping the selection', () => {
    expect(renderAt(routes, '/maps/systems?select=module%3Aa').loc.history.at(-1)).toBe('/b/systems?select=module%3Aa')
  })
  it("/r/:registry goes to the registry's section board, or to All records", () => {
    expect(renderAt(routes, '/r/projects').loc.history.at(-1)).toBe('/b/projects')
    expect(renderAt(routes, '/r/systems').loc.history.at(-1)).toBe('/b/outside-systems')
    expect(renderAt(routes, '/r/assets').loc.history.at(-1)).toBe('/all/assets')
  })
  it('/r/proposal/:id (where a proposal Card links) goes to the proposal page, one URL per proposal', () => {
    expect(renderAt(routes, '/r/proposal/p-2026-10-18-001').loc.history.at(-1)).toBe('/governance/proposals/p-2026-10-18-001')
    expect(renderAt(routes, '/r/proposal/p%2Fodd').loc.history.at(-1)).toBe('/governance/proposals/p%2Fodd')
  })
})
