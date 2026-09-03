import fs from 'node:fs'
import path from 'node:path'
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

  it('keeps the source projector wired before an outbox can be finalized as sent', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/outbox/sendOutboxItem.ts'), 'utf8')
    expect(source).toContain("import { projectSentEdielSourceState } from '@/lib/ediel/outbox/projectSentSources'")

    const smtpAccepted = source.indexOf('providerAccepted = true')
    const projectionAfterSmtp = source.indexOf('await projectSentEdielSourceState({', smtpAccepted)
    const outboxSent = source.indexOf("status: 'sent'", projectionAfterSmtp)

    expect(smtpAccepted).toBeGreaterThan(-1)
    expect(projectionAfterSmtp).toBeGreaterThan(smtpAccepted)
    expect(outboxSent).toBeGreaterThan(projectionAfterSmtp)
    expect(source).toContain("status: 'delivery_uncertain'")
    expect(source).toContain('delivery_uncertain_after_smtp_send')
  })
})
