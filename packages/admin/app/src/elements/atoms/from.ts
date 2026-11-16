import type { DriverRead } from '../../../../server/systems/driver.ts'

/** Where a thing on screen was read from (the from mark, E-1; rulings Q70; R-L6-FM): a file of this repository, a
 *  file of another repository, a System's driver read, an import (a Notion export), or the instance itself (a page, and
 *  a record the private store keeps: DAO-OS L6 §10, PF-R42). Plain data with no React in
 *  it, so the workspace lane (L6) can carry it on the wire as it is: this module is that shape's stable home.
 *  `readAt` and `exportedAt` are ISO times; null or left out where nobody knows when. */
export type From =
  | { file: string; readAt?: string | null }
  | { repo: string; file?: string; readAt?: string | null }
  | { system: string; read: DriverRead | null }
  | { import: string; exportedAt: string | null }
  | { instance: string; readAt?: string | null }

export type { DriverRead }
