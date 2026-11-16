import { describe, it, expect } from 'vitest'
import { recordTarget } from './useRecord.ts'

describe('recordTarget', () => {
  it("a kind's page reads the resource and its registry entry; a registry's own address still reads the entry", () => {
    // the meeting kind's page (where a meetings entry links): the resource, beside data/meetings.yaml's entry
    expect(recordTarget('meeting', 'm-1')).toEqual({ resourceId: 'meeting:m-1', registry: 'meetings' })
    // an address written before the meeting kind (/r/meetings/<id>) keeps working: the registry's entry
    expect(recordTarget('meetings', 'm-1')).toEqual({ resourceId: null, registry: 'meetings' })
    // an entry with no id, by its position, through the kind or the registry
    expect(recordTarget('meeting', '#2')).toEqual({ resourceId: null, registry: 'meetings' })
    expect(recordTarget('meetings', '#2')).toEqual({ resourceId: null, registry: 'meetings' })
  })
})
