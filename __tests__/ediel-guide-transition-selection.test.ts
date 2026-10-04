import { describe, expect, it } from 'vitest'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

describe('coherent two-week inbound guide selection', () => {
  it.each(['2026-10-01', '2026-10-14'])('uses a complete preceding package for a guide-valid prior message received %s', date => {
    const source = energyHandoffMessage('2026-09-30')
    const message = { ...source, message_received_at: `${date}T10:00:00Z`, raw_payload: source.raw_payload!.replace('735999260731000007::9', '735999260731000008::9') }
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-3')
    expect(selected.referenceDate).toBe(date)
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: selected })
    expect(runtime.validation.issues.some(issue => issue.code === 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(false)
    const decision = resolveCanonicalRuntimeDecision(message)
    expect(decision.validationReport.canonicalPolicy).toMatchObject({ guide: { guideRevision: '25-A-3' }, timeAnchors: { admissionDate: date } })
  })
  it('does not admit the preceding package after the two-week boundary', () => {
    const source = energyHandoffMessage('2026-09-30')
    const message = { ...source, message_received_at: '2026-10-15T10:00:00Z', raw_payload: source.raw_payload!.replace('735999260731000007::9', '735999260731000008::9') }
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    expect(runUtiltsRuntimeForMessage(message, { canonicalPolicy: selected }).validation.issues.some(issue => issue.code === 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(true)
  })
  it('retains the current guide when only functional object knowledge fails', () => {
    const message = { ...energyHandoffMessage('2026-10-01'), metering_point_id: null, business_match_status: 'unmatched' }
    const selected = resolveCanonicalMessagePolicy(message)!
    expect(selected.guide.guideRevision).toBe('25-A-4')
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: selected })
    expect(runtime.validation.issues.some(issue => issue.kind === 'functional' && issue.severity === 'error')).toBe(true)
  })
})
