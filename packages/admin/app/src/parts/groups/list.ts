/** The /parts groups, in the approved gallery's order (ruling L4-R1), as plain data: the e2e screen
 *  harness (tests/e2e/parts.mts) reads this list under node, where a group's component cannot load.
 *  `drawn` is true once a task draws the group; the harness shoots only drawn groups. index.ts pairs
 *  each id with its component, and PartsPage.test.tsx checks the two agree. */
export interface GroupEntry { readonly id: string; readonly label: string; readonly drawn: boolean }

export const GROUPS: readonly GroupEntry[] = [
  { id: 'tokens', label: 'Tokens', drawn: true },
  { id: 'frame', label: 'The frame', drawn: true },
  { id: 'controls', label: 'Controls', drawn: true },
  { id: 'atoms', label: 'Data atoms', drawn: true },
  { id: 'rows', label: 'Rows and records', drawn: true },
  { id: 'needs', label: 'Needs you', drawn: true },
  { id: 'views', label: 'Views', drawn: true },
  { id: 'map', label: 'The map', drawn: true },
  { id: 'map-compose', label: 'The small map and compose', drawn: true },
  { id: 'gov', label: 'Governance and chain', drawn: true },
  { id: 'gov-roles', label: 'Roles and the fund flow', drawn: true },
  { id: 'work', label: 'Workspace', drawn: true },
  { id: 'lib', label: 'Library and wizards', drawn: true },
  { id: 'tray', label: 'Changes and sign-in', drawn: true },
  { id: 'door', label: 'The public door', drawn: true },
  { id: 'blocks', label: 'Blocks', drawn: true },
  { id: 'machines', label: 'Machines', drawn: true },
]
