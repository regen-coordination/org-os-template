// @vitest-environment jsdom
// Review Focus 1, on the fixture source: L5 Task 20 calls describePublicPreview again with houseSource (E-44).
import { describePublicPreview } from './publicPreview.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'

describePublicPreview('Public preview of a members-only instance (fixture source)', FIXTURE_SOURCE)
