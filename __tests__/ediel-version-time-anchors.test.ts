import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalAdmissionDate, canonicalBusinessDate, resolveCanonicalMessagePolicy, resolveEdielMessageTimeAnchors } from '@/lib/ediel/core/messagePolicy'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

afterEach(() => vi.useRealTimers())

describe('source-owned version admission time', () => {
  it('uses receipt rather than the sender document date after the October transition', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: '2026-10-15T09:00:00Z' }
    expect(canonicalBusinessDate(message)).toBe('2026-09-30')
    expect(resolveCanonicalMessagePolicy(message)?.guide.guideRevision).toBe('25-A-4')
    expect(canonicalAdmissionDate(message)).toBe('2026-10-15')
  })
  it('uses Stockholm calendar dates for a physical receipt instant', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: '2026-09-30T22:30:00Z' }
    expect(canonicalAdmissionDate(message)).toBe('2026-10-01')
  })
  it('uses recorded local persistence when receipt is missing, never document time', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: null, created_at: '2026-10-15T08:00:00Z' }
    expect(canonicalAdmissionDate(message)).toBe('2026-10-15')
  })
  it('does not silently replace an invalid recorded receipt with document time', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: 'not-a-date' }
    expect(() => canonicalAdmissionDate(message)).toThrow(/admission_time_invalid/)
  })
  it('holds an inbound row with no recorded ingress or persistence time', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: null, created_at: '' }
    expect(() => canonicalAdmissionDate(message)).toThrow(/admission_time_missing/)
  })
  it('rechecks queued outbound content at the current pre-send instant', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-15T09:00:00Z'))
    const message = { ...observationHandoffMessage('2026-09-30'), direction: 'outbound' as const }
    expect(canonicalAdmissionDate(message)).toBe('2026-10-15')
    expect(message.raw_payload).toContain('20260930')
  })
  it('captures document, ingress, measurement and replay separately and freezes the decision', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: '2026-10-15T09:00:00Z' }
    const anchors = resolveEdielMessageTimeAnchors(message, undefined, { replayAt: '2027-01-15T10:00:00Z' })
    expect(anchors).toMatchObject({ documentDate: '2026-09-30', localIngressAt: '2026-10-15T09:00:00.000Z', admissionAt: '2026-10-15T09:00:00.000Z', admissionDate: '2026-10-15', replayAt: '2027-01-15T10:00:00.000Z' })
    expect(anchors.measurementPeriods.length).toBeGreaterThan(0)
    expect(Object.isFrozen(anchors)).toBe(true)
    expect(Object.isFrozen(anchors.measurementPeriods)).toBe(true)
    expect(resolveCanonicalMessagePolicy(message)?.timeAnchors).toEqual(resolveEdielMessageTimeAnchors(message))
  })
  it('preserves an explicit assessment instant as an explicit time anchor', () => {
    const message = observationHandoffMessage('2026-09-30')
    expect(resolveEdielMessageTimeAnchors(message, undefined, { admissionAt: '2026-10-01T10:00:00Z' })).toMatchObject({ admissionSource: 'explicit', admissionDate: '2026-10-01' })
  })
})

describe('local time context hold', () => {
  it('does not manufacture an external APERAK code for a missing local admission timestamp', () => {
    const message = { ...observationHandoffMessage('2026-09-30'), message_received_at: null, created_at: '' }
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('manual_review')
    expect(decision.functionalDecision).toBe('not_applicable')
    expect(decision.responsePlan.some(item => item.responseType === 'negative_aperak' || item.responseType === 'utilts_err')).toBe(false)
    expect(decision.issues.some(issue => issue.description.includes('ediel_admission_time_missing'))).toBe(true)
  })
})
