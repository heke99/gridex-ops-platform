import { describe, expect, it } from 'vitest'
import {
  PRODAT_SUBTYPE_RULES,
  assertProdatSubtypeRegistryConsistency,
  resolveProdatSubtype,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'

describe('PRODAT 26.A subtype registry', () => {
  it('contains every current subtype/reason mapping exactly once, including E -> E34', () => {
    expect(() => assertProdatSubtypeRegistryConsistency()).not.toThrow()
    expect(Object.fromEntries(PRODAT_SUBTYPE_RULES.map((rule) => [rule.subtype, rule.transactionReasonCode]))).toEqual({
      L: 'Z22', LK: 'Z23', C: 'Z24', H: 'Z25', A: 'Z26', D: 'Z70', B: 'Z27', N: 'Z96',
      E: 'E34', G: 'E32', F: 'E64', M: 'E58', V: 'S17', VH: 'S18',
    })
    expect(PRODAT_SUBTYPE_RULES.some((rule) => rule.transactionReasonCode === ('Z34' as never))).toBe(false)
  })

  it('derives the exact current message/subtype combinations from field 223', () => {
    const expected: Record<string, string[]> = {
      Z01: ['L', 'LK'],
      Z02: ['L', 'LK'],
      Z03: ['L', 'LK', 'C', 'H'],
      Z04: ['L', 'LK', 'C', 'H', 'A', 'D'],
      Z05: ['L', 'LK', 'C', 'H'],
      Z06: ['E', 'G', 'F'],
      Z08: ['LK', 'H'],
      Z09: ['D', 'B', 'E', 'G', 'F'],
      Z10: ['M'],
      Z13: ['V', 'VH'],
      Z14: ['N', 'V', 'VH'],
      Z15: ['C', 'V', 'VH'],
      Z18: ['V'],
    }
    for (const profile of PRODAT_CANONICAL_PROFILES) {
      expect(profile.subtypeRules.map((rule) => rule.subtype)).toEqual(expected[profile.messageCode])
    }
  })

  it('fail-closes unknown and forbidden combinations', () => {
    expect(resolveProdatSubtype({ messageCode: 'Z10', subtypeOrReasonCode: 'E' })).toMatchObject({
      ok: false, reason: 'prodat_subtype_not_allowed:Z10:E',
    })
    expect(resolveProdatSubtype({ messageCode: 'Z03', subtypeOrReasonCode: 'ZZZ' })).toMatchObject({
      ok: false, reason: 'prodat_subtype_unknown:ZZZ',
    })
  })

  it('requires explicit bilateral capability for bilateral-only combinations', () => {
    expect(resolveProdatSubtype({ messageCode: 'Z03', subtypeOrReasonCode: 'H' })).toMatchObject({
      ok: false, bilateralRequired: true, reason: 'prodat_bilateral_capability_required:Z03:H',
    })
    expect(resolveProdatSubtype({ messageCode: 'Z03', subtypeOrReasonCode: 'Z25', bilateralCapabilityVerified: true })).toMatchObject({
      ok: true, subtype: 'H', transactionReasonCode: 'Z25', bilateralRequired: true,
    })
    expect(resolveProdatSubtype({ messageCode: 'Z08', subtypeOrReasonCode: 'LK' })).toMatchObject({
      ok: false, bilateralRequired: true, reason: 'prodat_bilateral_capability_required:Z08:LK',
    })
    expect(resolveProdatSubtype({ messageCode: 'Z08', subtypeOrReasonCode: 'H' })).toMatchObject({
      ok: true, bilateralRequired: false,
    })
  })
})
