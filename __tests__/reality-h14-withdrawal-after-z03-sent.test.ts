// reality-defects: H-14
// H-14 (reality H run 3): W withdrew after its Z03 was sent, but the case was assessed 'before_prodat_sent'
// (no cancellation required), so no Z03C was ever built. The send time was read only from the switch row, whose
// submitted_at is never written for a sent Z03 (GOR-06). The bound outbound Z03 message is the evidence.
import { describe, expect, it } from 'vitest'
import { switchProdatSentAt } from '@/lib/customer-cases/switchProdatSentAt'
import { assessWithdrawal } from '@/lib/customer-cases/engine'

const SWITCH = { id: 'sw', status: 'prepared', submitted_at: null, outbound_z03_message_id: 'z03' }
const SENT = { id: 'z03', status: 'sent', message_sent_at: '2026-10-24T20:13:07Z' }

describe('H-14 a withdrawal after the Z03 is sent requires a cancellation', () => {
  it('reads the send time from the bound, sent Z03 when the switch row has none', () => {
    expect(switchProdatSentAt(SWITCH, SENT)).toBe('2026-10-24T20:13:07Z')
    expect(switchProdatSentAt({ ...SWITCH, submitted_at: '2026-10-24T20:00:00Z' }, SENT)).toBe('2026-10-24T20:00:00Z')
  })

  it('does not count a Z03 that has not left, or another message', () => {
    expect(switchProdatSentAt(SWITCH, { ...SENT, status: 'queued' })).toBeNull()
    expect(switchProdatSentAt(SWITCH, { ...SENT, id: 'other' })).toBeNull()
    expect(switchProdatSentAt({ ...SWITCH, outbound_z03_message_id: null }, SENT)).toBeNull()
    expect(switchProdatSentAt(SWITCH, null)).toBeNull()
  })

  it('the assessment then requires a Z03C instead of treating the switch as never sent', () => {
    const base = { caseType: 'withdrawal' as const, agreementChannel: 'web', agreementCreatedAt: '2026-10-24T20:10:00Z',
      withdrawalRequestedAt: '2026-10-24T20:13:25Z', deliveryStartAt: '2026-11-23', now: new Date('2026-10-24T20:13:25Z') }
    expect(assessWithdrawal({ ...base, prodatSentAt: null }).scenario).toBe('before_prodat_sent')
    const after = assessWithdrawal({ ...base, prodatSentAt: switchProdatSentAt(SWITCH, SENT) })
    expect(after.scenario).not.toBe('before_prodat_sent')
    expect(after.cancellationRequired).toBe(true)
  })
})
