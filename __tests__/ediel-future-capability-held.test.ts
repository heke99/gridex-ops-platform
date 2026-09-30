import { describe, expect, it } from 'vitest'
import { EDIEL_ENERGY_SHARING_CAPABILITY, assertEdielFutureCapabilityHeld, requestedEdielCapability } from '@/lib/ediel/core/futureCapabilityPolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

describe('source-defined energy-sharing capability remains held', () => {
  it.each(['2026-12-31', '2027-01-01', '2030-01-01'])('does not activate from publication or the date alone: %s', date => {
    expect(() => assertEdielFutureCapabilityHeld('energy_sharing', date)).toThrow(/ediel_energy_sharing_activation_held/)
  })
  it('retains the frozen source constraints without adopting proposed wire codes', () => {
    expect(EDIEL_ENERGY_SHARING_CAPABILITY).toMatchObject({ effectiveFrom: '2027-01-01', activation: 'held', forbiddenTransactionReasons: ['S18'], installationType: 'production', measurementResolution: '15_minutes', measurementMethod: '15_minutes' })
    expect(EDIEL_ENERGY_SHARING_CAPABILITY.messageCodes).toEqual(['Z13', 'Z14', 'Z15', 'Z18'])
  })
  it('does not infer energy sharing from ordinary S17 data sharing', () => {
    expect(requestedEdielCapability({ message_intent: null, parsed_payload: { transactionReasonCode: 'S17' } })).toBeNull()
    expect(() => resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z13', subtypeOrReasonCode: 'V', direction: 'inbound', referenceDate: '2027-01-01', applicationReference: '23-DGI-PRODAT', requestedCapability: 'energy_sharing' })).toThrow(/activation_held/)
  })
  it('uses internal review with no national APERAK for an explicitly requested blocked capability', () => {
    const message = { ...energyHandoffMessage('2026-09-30'), message_intent: 'energy_sharing' }
    const result = resolveCanonicalRuntimeDecision(message)
    expect(result.applicationDecision).toBe('manual_review')
    expect(result.functionalDecision).toBe('not_applicable')
    expect(result.responsePlan.some(item => item.family === 'APERAK')).toBe(false)
    expect(result.sourceRules).toContain('GOV-07:LOCAL_CONTEXT')
  })
})
