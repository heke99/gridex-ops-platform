import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const renderer = readFileSync(
  new URL('../lib/ediel/intent/renderers/customerMasterdataZ01.ts', import.meta.url),
  'utf8',
)

describe('PRODAT Z01 canonical process-group projection', () => {
  it('persists the canonical business process on the Ediel message row', () => {
    expect(renderer).toContain("processType: 'customer_masterdata'")
    expect(renderer).not.toContain("processType: 'customer_masterdata_request'")
  })

  it('keeps the legacy request label only as non-authoritative audit metadata', () => {
    expect(renderer).toContain("processLabel: 'customer_masterdata_request'")
  })
})
