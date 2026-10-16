// An instance's own funding records, as .well-known/funding.json. Read by co-fund (and anyone):
// pools it runs, money it gave (contributions) or promised (pledges), calls it has open.
// Only the listed fields are published; anything else in data/funding.yaml stays internal.
const asText = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, asText(o[k])]));

export function fundingRegistry(funding, identity) {
  if (!funding) return null;
  return {
    '@context': 'https://www.daostar.org/schemas',
    type: 'FundingRegistry',
    org: { id: funding.org?.id ?? identity?.id, name: funding.org?.name ?? identity?.name, ...(identity?.daoURI ? { daoURI: identity.daoURI } : {}) },
    pools: (funding.pools ?? []).map((p) => pick(p, ['id', 'name', 'rule', 'started', 'ended', 'url'])),
    flows: (funding.flows ?? []).map((f) => {
      const to = pick(f.to, ['name', 'url', 'addresses']);
      return { ...pick(f, ['id', 'type', 'pool', 'amount_usd', 'date', 'evidence']), ...(Object.keys(to).length ? { to } : {}) };
    }),
    calls: (funding.calls ?? []).map((c) => pick(c, ['id', 'title', 'url', 'closes', 'call_type', 'amount', 'region'])),
  };
}
