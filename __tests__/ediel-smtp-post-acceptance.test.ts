import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'
import { SmtpDeliveryUncertainError } from '@/lib/ediel/transport/smtpOutcome'
import type { EdielMessageRow } from '@/lib/ediel/types'

const mocks = vi.hoisted(() => ({ send: vi.fn(), status: vi.fn(), event: vi.fn(), auditError: null as Error | null }))
vi.mock('@/lib/ediel/db', () => ({ updateEdielMessageStatus: mocks.status, createEdielMessageEvent: mocks.event, getEdielRouteProfileByCommunicationRouteId: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: mocks.send }))
vi.mock('@/lib/ediel/mailReadiness', () => ({ assertEdielSmtpReadiness: () => ({ from: 'sender@example.test' }) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: mocks.auditError }) }) }) } }))
vi.mock('@/lib/ediel/transport/index.part-1', () => ({
  requireActorUserId: () => 'actor1', assertTransportFamily: vi.fn(),
  encryptionModeFromMimeMode: () => 'none', applyMessageFamilyEncryptionPolicy: () => 'none', assertRouteTransportSecurity: vi.fn(),
  inferAttachmentExtension: () => 'edi', inferBodyText: () => "UNB+original'", resolveSmtpMimeMode: () => 'nodemailer-attachment',
  isEdifactMessage: () => true, normalizeEdifactForSmtp: (s: string) => s, extractEdielSubjectFromPayload: () => 'TEST',
  safePreview: (s: string) => s, storeTransportPayloadSnapshot: vi.fn().mockResolvedValue(undefined),
}))

describe('SMTP acceptance followed by persistence failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auditError = null
    mocks.send.mockResolvedValue({ accepted: ['recipient@example.test'], rejected: [], messageId: '<smtp1@example.test>' })
    mocks.status.mockResolvedValue(undefined)
    mocks.event.mockResolvedValue(undefined)
  })
  const send = () => sendEdielMessageViaSmtp({ id: 'message1', message_family: 'PRODAT', message_code: 'Z01', receiver_email: 'recipient@example.test', file_name: 'message.edi' } as EdielMessageRow, { actorUserId: 'actor1' })
  it.each(['status', 'event'])('preserves acceptance evidence when the %s write throws', async (failure) => {
    if (failure === 'status') mocks.status.mockRejectedValue(new Error('DB unavailable'))
    else mocks.event.mockImplementation(async (event) => { if (event.eventType === 'sent') throw new Error('DB unavailable') })
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain', smtpMessageId: '<smtp1@example.test>' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('preserves successful SMTP results when persistence succeeds', async () => {
    await expect(send()).resolves.toMatchObject({ messageId: '<smtp1@example.test>' })
  })
  it('treats a returned audit persistence error as reconciliation-required', async () => {
    mocks.auditError = new Error('Audit update rejected')
    await expect(send()).rejects.toMatchObject({ code: 'ediel_delivery_uncertain', smtpMessageId: '<smtp1@example.test>' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('does not relabel a pre-send failure as uncertain', async () => {
    mocks.event.mockRejectedValue(new Error('Pre-send event failed'))
    await expect(send()).rejects.not.toBeInstanceOf(SmtpDeliveryUncertainError)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
