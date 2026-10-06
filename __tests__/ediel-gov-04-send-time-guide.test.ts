// masterplan: GOV-04, AT-GOV-04
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalAdmissionDate } from '@/lib/ediel/core/messagePolicy'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { resolveEdielGuideAcceptance } from '@/lib/ediel/rulebook/guideRegistry'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

afterEach(() => vi.useRealTimers())
const policy = (direction: 'outbound' | 'inbound', referenceDate: string, selectedGuideRevision?: string) => () => resolveCanonicalEdielPolicy({
  family: 'UTILTS', messageCode: 'E73', direction, referenceDate, mode: 'parse', bilateralCapabilityVerified: true,
  applicationReference: '23-DDQ-E73-T', selectedGuideRevision,
} as Parameters<typeof resolveCanonicalEdielPolicy>[0])
const guideRejected = (run: () => unknown) => { try { run(); return false } catch (error) { return String((error as Error).message).startsWith('canonical_ediel_guide_candidate_not_accepted') } }

describe('GOV-04: outbound is tried against the guide in force at send time', () => {
  it('condition: outbound acceptance holds only the current guide, even inside the inbound two-week window', () => {
    const acceptance = resolveEdielGuideAcceptance({ family: 'UTILTS', referenceDate: '2026-10-05' })
    expect(acceptance.acceptedOutbound.map(guide => guide.guideRevision)).toEqual(['25-A-4'])
    expect(acceptance.acceptedInbound.map(guide => guide.guideRevision)).toEqual(expect.arrayContaining(['25-A-3', '25-A-4']))
  })
  it.each(['2026-10-01', '2026-10-05', '2026-10-14', '2026-10-15'])('prohibited: an outbound message cannot be tried against the preceding guide on %s', date => {
    expect(guideRejected(policy('outbound', date, '25-A-3'))).toBe(true)
    expect(guideRejected(policy('outbound', date, '25-A-4'))).toBe(false)
  })
  it('control: before the version boundary the then-current guide is the outbound guide', () => {
    expect(guideRejected(policy('outbound', '2026-09-30', '25-A-3'))).toBe(false)
    expect(guideRejected(policy('outbound', '2026-09-30', '25-A-4'))).toBe(true)
  })
  it('on_pass: a payload queued before the boundary is re-tried at the actual send instant and kept unchanged as history', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-05T09:00:00Z'))
    const queued = { ...observationHandoffMessage('2026-09-30'), direction: 'outbound' as const, message_received_at: null }
    const before = queued.raw_payload
    expect(canonicalAdmissionDate(queued)).toBe('2026-10-05')
    expect(guideRejected(policy('outbound', canonicalAdmissionDate(queued), '25-A-3'))).toBe(true)
    expect(queued.raw_payload).toBe(before)
  })
})
