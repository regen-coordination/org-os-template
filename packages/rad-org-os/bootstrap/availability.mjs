// The availability spectrum (spec Q6). Honest framing: "private" on Radicle means
// selective replication, NOT encryption at rest — so a commercial/managed seed
// (garden) or a public seed is a reliability choice, not a censorship-resistance one.
export const AVAILABILITY_TIERS = [
  {
    key: 'self-hosted',
    label: 'Self-hosted seed node (our Docker recipe)',
    trust: 'none', privateOk: true, recommendedForPrivate: true,
    note: 'Maximum sovereignty; you run one container on a $5 VPS or spare laptop.',
  },
  {
    key: 'garden',
    label: 'radicle.garden managed node (€4.99/mo)',
    seed: 'https://app.radicle.garden', trust: 'garden-operators', privateOk: true, recommendedForPrivate: false,
    caveat: 'Private repos are replicated but NOT encrypted at rest — Garden operators may read your content.',
    note: 'Reliability without running infra; a commercial third party, so not the censorship-resistance path.',
  },
  {
    key: 'public',
    label: 'Public core-team seeds (iris / rosa / seed.radicle.xyz)',
    seed: 'https://seed.radicle.xyz', trust: 'public', privateOk: false, recommendedForPrivate: false,
    note: 'Reach/discovery for PUBLIC repos only; cannot host private repos.',
  },
];

export function chooseAvailability(tierKey, { seed } = {}) {
  const tier = AVAILABILITY_TIERS.find((t) => t.key === tierKey);
  if (!tier) throw new Error(`unknown availability tier: ${tierKey}`);
  return { ...tier, seed: seed || tier.seed || null };
}
