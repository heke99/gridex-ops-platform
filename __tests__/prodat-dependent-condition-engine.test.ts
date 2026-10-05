// masterplan: P-03, AT-P-03, SC-032
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import {
  PRODAT_26A_FIELD_MATRIX,
  PRODAT_26A_MESSAGE_CODES,
} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import {
  PRODAT_26A_DEPENDENT_CONDITION_REGISTRY,
  PRODAT_26A_DEPENDENT_EVIDENCE_PROJECTION,
  PRODAT_26A_DEPENDENT_SOURCE_DOCUMENT,
  assertCanonicalProdatDependentConditionCoverage,
  assertProdatDependentConditionsDetermined,
  evaluateProdatDependentConditions,
  resolveProdatDependentCondition,
} from '@/lib/ediel/prodat/prodatDependentConditionEngine'

function matrixDependentCellIds(): string[] {
  const ids: string[] = []
  for (const row of PRODAT_26A_FIELD_MATRIX) {
    for (const [index, requirement] of row.requirements.entries()) {
      if (requirement !== 'D') continue
      ids.push(`${PRODAT_26A_MESSAGE_CODES[index]}:${row.fieldNumber}`)
    }
  }
  return ids.sort()
}

describe('PRODAT 26-A dependent-condition engine', () => {
  it('keeps the actual canonical legacy D229 hint after an attempted source-predicate change', async () => {
    vi.resetModules()
    const { PRODAT_26A_DEPENDENT_CONDITION_REGISTRY } = await import('@/lib/ediel/prodat/prodatDependentConditionEngine')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const source = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.find(row => row.messageCode === 'Z01' && row.fieldNumber === '229')!
    const original = source.predicate
    const changed = Reflect.set(source, 'predicate', () => true)
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L',
        direction: 'outbound', referenceDate: '2026-10-15', prodatDependentFacts: { endUserAddressAvailable: false }, mode: 'catalog_evidence' })
      expect(policy.prodatDependentConditions.find(row => row.fieldNumber === '229')).toMatchObject({
        status: 'not_required', decisionPhase: 'legacy_pre_wire_address_hint',
      })
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(source, 'predicate', original)
      vi.resetModules()
    }
  })

  it('retains the published D-cell source record in the actual canonical projection', async () => {
    vi.resetModules()
    const { PRODAT_26A_DEPENDENT_CONDITION_REGISTRY } = await import('@/lib/ediel/prodat/prodatDependentConditionEngine')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const source = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.find(row => row.messageCode === 'Z01' && row.fieldNumber === '229')!.source
    const original = { ...source }
    const changed = Reflect.set(source, 'section', 'unqualified locator')
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L',
        direction: 'outbound', referenceDate: '2026-10-15', prodatDependentFacts: { endUserAddressAvailable: false }, mode: 'catalog_evidence' })
      expect(policy.prodatDependentConditions.find(row => row.fieldNumber === '229')?.source).toEqual(original)
      expect(changed).toBe(false)
    } finally {
      vi.resetModules()
    }
  })

  it('keeps the canonical legacy D229 hint after an attempted backing-registry row replacement', async () => {
    vi.resetModules()
    const { PRODAT_26A_DEPENDENT_CONDITION_REGISTRY } = await import('@/lib/ediel/prodat/prodatDependentConditionEngine')
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    const registry = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY
    const index = registry.findIndex(row => row.messageCode === 'Z01' && row.fieldNumber === '229')
    const original = registry[index]
    const changed = Reflect.set(registry, String(index), { ...original, predicate: () => true })
    try {
      const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z01', subtypeOrReasonCode: 'L',
        direction: 'outbound', referenceDate: '2026-10-15', prodatDependentFacts: { endUserAddressAvailable: false }, mode: 'catalog_evidence' })
      expect(policy.prodatDependentConditions.find(row => row.fieldNumber === '229')).toMatchObject({
        status: 'not_required', decisionPhase: 'legacy_pre_wire_address_hint',
      })
      expect(changed).toBe(false)
    } finally {
      if (changed) Reflect.set(registry, String(index), original)
      vi.resetModules()
    }
  })

  it('has exact executable coverage for every official D cell', () => {
    const official = matrixDependentCellIds()
    const executable = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.map((entry) => entry.id).sort()

    expect(official).toHaveLength(120)
    expect(executable).toHaveLength(120)
    expect(new Set(executable).size).toBe(120)
    expect(executable).toEqual(official)
    expect(() => assertCanonicalProdatDependentConditionCoverage()).not.toThrow()
  })

  it('makes every predicate source-traceable', () => {
    for (const entry of PRODAT_26A_DEPENDENT_CONDITION_REGISTRY) {
      expect(entry.source.document).toBe(PRODAT_26A_DEPENDENT_SOURCE_DOCUMENT)
      expect(entry.source.evidenceProjection).toBe(PRODAT_26A_DEPENDENT_EVIDENCE_PROJECTION)
      expect(entry.source.section).toContain(`${entry.messageCode} / field ${entry.fieldNumber} / D`)
      expect(entry.source.note.trim().length).toBeGreaterThan(0)
      expect(entry.conditionId.trim().length).toBeGreaterThan(0)
    }
  })

  it('never guesses when required business facts are missing', () => {
    const evaluations = evaluateProdatDependentConditions({ messageCode: 'Z06' })
    expect(evaluations.some((entry) => entry.status === 'undetermined')).toBe(true)
    expect(() => assertProdatDependentConditionsDetermined(evaluations)).toThrow(/prodat_dependent_condition_undetermined/)
  })

  it('evaluates directly evidenced subtype/context/market conditions deterministically', () => {
    expect(resolveProdatDependentCondition({ messageCode: 'Z14', fieldNumber: '209', facts: { canonicalSubtype: 'N' } })?.status).toBe('not_required')
    expect(resolveProdatDependentCondition({ messageCode: 'Z14', fieldNumber: '209', facts: { canonicalSubtype: 'V' } })?.status).toBe('required')

    expect(resolveProdatDependentCondition({ messageCode: 'Z04', fieldNumber: '319', facts: { canonicalSubtype: 'D' } })?.status).toBe('required')
    expect(resolveProdatDependentCondition({ messageCode: 'Z04', fieldNumber: '319', facts: { canonicalSubtype: 'A' } })?.status).toBe('not_required')

    expect(resolveProdatDependentCondition({ messageCode: 'Z05', fieldNumber: '310', facts: { businessContext: 'death' } })?.status).toBe('undetermined')
    expect(resolveProdatDependentCondition({ messageCode: 'Z05', fieldNumber: '310', facts: { businessContext: 'bankruptcy' } })?.status).toBe('undetermined')

    expect(resolveProdatDependentCondition({ messageCode: 'Z04', fieldNumber: '320', facts: { market: 'gas' } })?.status).toBe('required')
    expect(resolveProdatDependentCondition({ messageCode: 'Z04', fieldNumber: '320', facts: { market: 'electricity' } })?.status).toBe('not_required')
  })

  it('evaluates customer, address and invoicee dependencies without deriving them from field presence', () => {
    expect(resolveProdatDependentCondition({ messageCode: 'Z13', fieldNumber: '323', facts: { customerKind: 'private' } })?.status).toBe('undetermined')
    expect(resolveProdatDependentCondition({ messageCode: 'Z13', fieldNumber: '323', facts: { customerKind: 'business' } })?.status).toBe('undetermined')
    expect(resolveProdatDependentCondition({ messageCode: 'Z14', fieldNumber: '323', facts: { canonicalSubtype: 'N', customerKind: 'private' } })?.status).toBe('undetermined')

    expect(resolveProdatDependentCondition({ messageCode: 'Z01', fieldNumber: '229', facts: { endUserAddressAvailable: true } })?.status).toBe('required')
    expect(resolveProdatDependentCondition({ messageCode: 'Z01', fieldNumber: '229', facts: { endUserAddressAvailable: false } })?.status).toBe('not_required')

    expect(resolveProdatDependentCondition({ messageCode: 'Z03', fieldNumber: 'INVOICEE_GROUP', facts: { invoiceeAddressDiffersFromEndUser: true } })?.status).toBe('required')
    expect(resolveProdatDependentCondition({ messageCode: 'Z03', fieldNumber: 'INVOICEE_GROUP', facts: { invoiceeAddressDiffersFromEndUser: false } })?.status).toBe('not_required')
  })

  it('rejects byCell as date-event authority', () => {
    const id = 'Z06:210'
    expect(resolveProdatDependentCondition({ messageCode: 'Z06', fieldNumber: '210' })?.status).toBe('undetermined')
    expect(resolveProdatDependentCondition({ messageCode: 'Z06', fieldNumber: '210', facts: { byCell: { [id]: true } } })?.status).toBe('undetermined')
    expect(resolveProdatDependentCondition({ messageCode: 'Z06', fieldNumber: '210', facts: { byCell: { [id]: false } } })?.status).toBe('undetermined')
  })
})
