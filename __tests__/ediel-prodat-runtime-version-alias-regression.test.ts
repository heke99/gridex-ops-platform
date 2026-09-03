import { describe, expect, it } from 'vitest'

import type { ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

function parsedZ01(): ParsedRulebookMessage {
  return {
    family: 'PRODAT',
    code: 'Z01',
    subtype: 'L',
    sender: '21660',
    receiver: '27700',
    senderSubAddress: 'GRIDEX',
    receiverSubAddress: 'PRODAT',
    applicationReference: '23-DDQ-PRODAT',
    interchangeReference: 'TEST-Z01',
    messageReference: 'TEST-Z01',
    transactionReference: 'TEST-Z01',
    relatedReference: null,
    facilityId: '735999147062804224',
    meteringPointId: '735999147062804224',
    permissionId: null,
    period: null,
    outcome: null,
    processGroup: 'customer_masterdata',
    rawSegments: [],
    facts: {},
    errors: [],
    warnings: [],
  }
}

function validateVersion(version: string) {
  return validateRulebookMessage({
    family: 'PRODAT',
    code: 'Z01',
    parsed: parsedZ01(),
    direction: 'outbound',
    mode: 'test',
    environment: 'test',
    businessDate: '2026-09-03',
    applicationReference: '23-DDQ-PRODAT',
    version,
  })
}

describe('PRODAT runtime version aliases in canonical validation', () => {
  it('does not misinterpret guide revision 26A as an association-assigned code', () => {
    const result = validateVersion('26A')
    expect(result.issues.map((entry) => entry.description).join('\n')).not.toContain(
      'ediel_guide_resolution_missing:PRODAT:2026-09-03:26A',
    )
  })

  it('continues to accept the canonical association-assigned code E2SE6A', () => {
    const result = validateVersion('E2SE6A')
    expect(result.issues.map((entry) => entry.description).join('\n')).not.toContain(
      'ediel_guide_resolution_missing:PRODAT:2026-09-03:E2SE6A',
    )
  })

  it('keeps unknown PRODAT versions fail-closed', () => {
    const result = validateVersion('BOGUS')
    expect(result.blocking).toBe(true)
    expect(result.issues.map((entry) => entry.description).join('\n')).toContain(
      'ediel_guide_resolution_missing:PRODAT:2026-09-03:BOGUS',
    )
  })
})
