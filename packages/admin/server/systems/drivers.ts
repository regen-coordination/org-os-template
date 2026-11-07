import type { Driver } from './driver.ts'
import { link } from './link.ts'
import { safe } from './safe.ts'
import { gardensCommunity, gardensPool } from './gardens.ts'
import { hatsTree } from './hats.ts'
import { snapshotSpace } from './snapshot.ts'
import { daoUriRegistration } from './registration.ts'

/** Every driver this server has. An entry names one in `driver` (absent = link, F1 §3.4). */
export const DRIVERS: Driver[] = [link, safe, hatsTree, snapshotSpace, gardensCommunity, gardensPool, daoUriRegistration]
