// packages/admin/lib/standards/daoip5.mjs
//
// DAOIP-5's funding mechanisms and application statuses, as literal lists (lane L8). No imports at all, so any
// module may use it, vendored into instances included. Source: the template's enums in
// https://github.com/metagov/daostar/blob/c71b94ba47cd9d09bae9afb530bdb70c640e25cc/DAOIPs/daoip-5.md
// (the plain names of the template enum, not the longer spellings of the bullet list). A test keeps these equal to
// the JSON Schemas under schemas/standards/ and to the grant_pool enum in schemas/systems.schema.json.

export const MECHANISMS = Object.freeze([
  'Direct Grants', 'Quadratic Funding', 'Streaming Quadratic Funding', 'Retro Funding', 'Conviction Voting',
  'Self-Curated Registries', 'Gift Circles', 'Social Media-Based Capital Allocation', 'Futarchy', 'Assurance Contracts',
  'Cookie Jar', 'Impact Attestations', 'Stokvel', 'Request for Proposal', 'Delegated Domain Allocation',
  'Evolutionary Grants Games', 'Direct to Contract Incentives', 'Angel Investment', 'Dominant Assurance Contracts',
  'Community Currencies', 'Universal Basic Income', 'Bounties', 'Gnosis Safe', 'Waqf', 'Ranked Choice Voting', 'Honour',
  'Mutual Aid Networks', 'Bonding Curves', 'Zakat', 'Decentralized Validators', 'Revnets',
])

export const APPLICATION_STATUSES = Object.freeze(['pending', 'in_review', 'approved', 'funded', 'rejected', 'completed'])
