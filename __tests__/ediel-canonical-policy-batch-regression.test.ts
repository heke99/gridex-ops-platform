import { describe, expect, it } from 'vitest'

import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalEdielBusinessSemantics } from '@/lib/ediel/rulebook/businessSemantics'
import { resolveEdielGuideAcceptance } from '@/lib/ediel/rulebook/guideRegistry'
import {
  PRODAT_SUBTYPE_RULES,
  type ProdatMessageCode,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {
  PRODAT_26A_DEPENDENT_CONDITION_REGISTRY,
  evaluateProdatDependentConditions,
} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {
  assertUtiltsMessageUseAllowed,
  resolveUtiltsProcessabilityPolicy,
} from '@/lib/ediel/rulebook/utilts25A4'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'
import { resolveUtiltsInboundBusinessOutcome } from '@/lib/ediel/utilts/inboundBusinessOutcome'

const EXPECTED_PRODAT_CODES: readonly ProdatMessageCode[] = [
  'Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18',
] as const

function resolveProdatCatalogPolicy(messageCode: ProdatMessageCode, subtype: string): CanonicalEdielPolicy {
  return resolveCanonicalEdielPolicy({
    family: 'PRODAT',
    messageCode,
    subtypeOrReasonCode: subtype,
    direction: 'outbound',
    referenceDate: '2026-08-28',
    bilateralCapabilityVerified: true,
    businessContext: subtype === 'E' ? 'death' : null,
    mode: 'catalog_evidence',
  })
}

function syntheticInboundUtiltsPolicy(code: string): CanonicalEdielPolicy {
  const family = code === 'ERR' ? 'UTILTS_ERR' : 'UTILTS'
  const semantics = resolveCanonicalEdielBusinessSemantics({ family, code })
  if (!semantics) throw new Error(`test_utilts_semantics_missing:${code}`)
  return {
    family,
    code,
    subtype: null,
    transactionReasonCode: null,
    direction: 'inbound',
    referenceDate: '2026-09-30',
    profileKey: `test_${code.toLowerCase()}`,
    processGroup: semantics.businessProcess,
    phase: null,
    semantics,
    guide: {} as CanonicalEdielPolicy['guide'],
    acceptedInboundGuides: [],
    acceptedOutboundGuides: [],
    previousGuideGraceActive: false,
    associationAssignedCode: 'E5SE5A',
    applicationReference: null,
    fieldRules: [],
    prodatDependentConditions: [],
    ackRule: {} as CanonicalEdielPolicy['ackRule'],
    utiltsProfile: null,
    utiltsProcessability: null,
    supplierUtiltsSupport: semantics.supplierUtiltsSupport,
    bilateralRequired: false,
    customerStatusRequired: false,
    businessResponses: semantics.expectedBusinessResponses,
    sourceTrace: [],
  }
}

describe('canonical Ediel policy batch regression', () => {
  it('resolves every supported PRODAT message/subtype combination from the canonical registry', () => {
    const coveredCodes = new Set<ProdatMessageCode>()
    let combinations = 0

    for (const rule of PRODAT_SUBTYPE_RULES) {
      for (const messageCode of rule.allowedMessageCodes) {
        const policy = resolveProdatCatalogPolicy(messageCode, rule.subtype)
        expect(policy.family).toBe('PRODAT')
        expect(policy.code).toBe(messageCode)
        expect(policy.subtype).toBe(rule.subtype)
        expect(policy.transactionReasonCode).toBe(rule.transactionReasonCode)
        expect(policy.profileKey).toBeTruthy()
        expect(policy.applicationReference).toMatch(/^23-(DDQ|DGI)-PRODAT$/)
        expect(policy.sourceTrace.length).toBeGreaterThanOrEqual(6)
        coveredCodes.add(messageCode)
        combinations += 1
      }
    }

    expect(combinations).toBeGreaterThan(30)
    expect([...coveredCodes].sort()).toEqual([...EXPECTED_PRODAT_CODES].sort())
  })

  it('evaluates every official D condition without undetermined when complete explicit facts are supplied', () => {
    const byCell = Object.fromEntries(PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.map((entry) => [entry.id, true]))

    for (const messageCode of EXPECTED_PRODAT_CODES) {
      const results = evaluateProdatDependentConditions({
        messageCode,
        facts: {
          canonicalSubtype: 'V',
          businessContext: 'death',
          market: 'gas',
          customerKind: 'private',
          meterReadingsSentInUtilts: true,
          multipleMeterRegisters: true,
          endUserAddressAvailable: true,
          invoiceeAddressDiffersFromEndUser: true,
          byCell,
        },
      })
      expect(results.every((entry) => entry.status !== 'undetermined')).toBe(true)
    }

    const evaluatedIds = EXPECTED_PRODAT_CODES.flatMap((messageCode) =>
      evaluateProdatDependentConditions({
        messageCode,
        facts: {
          canonicalSubtype: 'V', businessContext: 'death', market: 'gas', customerKind: 'private',
          meterReadingsSentInUtilts: true, multipleMeterRegisters: true, endUserAddressAvailable: true,
          invoiceeAddressDiffersFromEndUser: true, byCell,
        },
      }).map((entry) => entry.id),
    ).sort()
    expect(evaluatedIds).toEqual(PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.map((entry) => entry.id).sort())
  })

  it('preserves the Z01 ACK exception while allowing negative application rejection', () => {
    const policy = resolveProdatCatalogPolicy('Z01', 'L')
    expect(policy.ackRule.technicalAck).toBe('CONTRL')
    expect(policy.ackRule.applicationAck).toBe('none')
    expect(policy.ackRule.businessResponses).toContain('Z02')
    expect(policy.ackRule.negativeApplicationResponse).toBe('APERAK')
  })

  it('enforces the S08 live-use cutoff without breaking historical replay', () => {
    expect(() => assertUtiltsMessageUseAllowed({ referenceDate: '2026-04-14', messageCode: 'S08', mode: 'live_inbound' })).not.toThrow()
    expect(() => assertUtiltsMessageUseAllowed({ referenceDate: '2026-04-15', messageCode: 'S08', mode: 'live_inbound' })).toThrow(/utilts_s08_live_use_discontinued/)
    expect(() => assertUtiltsMessageUseAllowed({ referenceDate: '2026-08-28', messageCode: 'S08', mode: 'historical_replay' })).not.toThrow()
  })

  it('locks the UTILTS 25-A-3/25-A-4 cutover and two-week inbound grace window', () => {
    expect(resolveUtiltsProcessabilityPolicy('2026-09-30').guideRevision).toBe('25-A-3')
    expect(resolveUtiltsProcessabilityPolicy('2026-10-01').guideRevision).toBe('25-A-4')

    const oct1 = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-01', associationAssignedCode: 'E5SE5A' })
    const oct14 = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-14', associationAssignedCode: 'E5SE5A' })
    const oct15 = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-15', associationAssignedCode: 'E5SE5A' })

    expect(oct1.current.guideRevision).toBe('25-A-4')
    expect(oct1.previousGuideGraceActive).toBe(true)
    expect(oct1.acceptedInbound.map((guide) => guide.guideRevision).sort()).toEqual(['25-A-3', '25-A-4'])
    expect(oct14.previousGuideGraceActive).toBe(true)
    expect(oct14.acceptedInbound.map((guide) => guide.guideRevision).sort()).toEqual(['25-A-3', '25-A-4'])
    expect(oct15.previousGuideGraceActive).toBe(false)
    expect(oct15.acceptedInbound.map((guide) => guide.guideRevision)).toEqual(['25-A-4'])
    expect(oct15.acceptedOutbound.map((guide) => guide.guideRevision)).toEqual(['25-A-4'])
  })

  it('maps every canonical supplier-facing UTILTS profile to an explicit non-ignored business outcome', () => {
    for (const profile of UTILTS_CANONICAL_PROFILES) {
      const outcome = resolveUtiltsInboundBusinessOutcome(syntheticInboundUtiltsPolicy(profile.messageCode))
      expect(outcome.kind).not.toBe('ignored')
      expect(outcome.reason.length).toBeGreaterThan(0)
    }
  })

  it('keeps S02 forecast out of billing and E31 out of individual-customer scope', () => {
    const s02 = resolveUtiltsInboundBusinessOutcome(syntheticInboundUtiltsPolicy('S02'))
    expect(s02.kind).toBe('forecast_only')
    expect(s02.allowMeteringValueIngest).toBe(false)
    expect(s02.allowBillingConsumption).toBe(false)
    expect(s02.allowIndividualCustomerLink).toBe(true)

    const e31 = resolveUtiltsInboundBusinessOutcome(syntheticInboundUtiltsPolicy('E31'))
    expect(e31.kind).toBe('grid_area_aggregate')
    expect(e31.allowIndividualCustomerLink).toBe(false)
    expect(e31.allowMeteringValueIngest).toBe(false)
    expect(e31.allowBillingConsumption).toBe(false)
    expect(e31.requireGridAreaScope).toBe(true)

    const e66 = resolveUtiltsInboundBusinessOutcome(syntheticInboundUtiltsPolicy('E66'))
    expect(e66.kind).toBe('actual_metering_values')
    expect(e66.allowMeteringValueIngest).toBe(true)
    expect(e66.allowBillingConsumption).toBe(true)
  })
})
