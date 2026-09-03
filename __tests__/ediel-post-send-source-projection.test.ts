import { describe, expect, it } from 'vitest'
import { customerInfoPostSendStatus } from '@/lib/ediel/outbox/projectSentSources'

describe('Ediel post-send customer-info projection', () => {
  it('waits for CONTRL when technical acknowledgement is required and pending', () => {
    expect(customerInfoPostSendStatus({
      requires_contrl: true,
      contrl_status: 'pending',
      requires_aperak: false,
      aperak_status: 'not_required',
    })).toBe('waiting_for_contrl')
  })

  it('moves to APERAK after CONTRL has been received when APERAK is still required', () => {
    expect(customerInfoPostSendStatus({
      requires_contrl: true,
      contrl_status: 'received',
      requires_aperak: true,
      aperak_status: 'pending',
    })).toBe('waiting_for_aperak')
  })

  it('waits for Z02 when all required acknowledgements are already satisfied or not required', () => {
    expect(customerInfoPostSendStatus({
      requires_contrl: true,
      contrl_status: 'received',
      requires_aperak: false,
      aperak_status: 'not_required',
    })).toBe('waiting_for_z02')
  })
})
