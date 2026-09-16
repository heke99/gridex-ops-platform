import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  status: vi.fn(),
  event: vi.fn(),
  snapshot: vi.fn(),
}))

vi.mock('@/lib/ediel/db', () => ({
  updateEdielMessageStatus: mocks.status,
  createEdielMessageEvent: mocks.event,
  getEdielRouteProfileByCommunicationRouteId: vi.fn().mockResolvedValue({
    id: 'route-1',
    encryption_mode: 'smime',
    transport_security_mode: 'required_encrypted',
    receiver_certificate_id: 'cert-1',
    receiver_ediel_id: 'RECEIVER',
    receiver_sub_address: 'SUB',
  }),
}))

vi.mock('@/lib/email/sendEdielEmail', () => ({ sendEdielEmail: mocks.send }))
vi.mock('@/lib/ediel/mailReadiness', () => ({
  assertEdielSmtpReadiness: () => ({ from: 'sender@example.test', replyTo: null, provider: 'test', appLevelDkimEnabled: false }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }) },
}))
vi.mock('@/lib/ediel/security/outboundRecipientCertificate', () => ({
  describeCertificate: () => 'receiver cert',
  fullEdielAddress: () => 'RECEIVER:SUB',
  routeReceiverSubaddress: () => 'SUB',
  resolveOutboundRecipientCertificate: vi.fn().mockResolvedValue({
    id: 'cert-1',
    publicCertificatePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
    serialNumber: '01',
    fingerprintSha256: 'ab'.repeat(32),
    subject: 'CN=Receiver',
    issuer: 'CN=Issuer',
    raw: {},
  }),
}))
vi.mock('@/lib/ediel/transport/index.part-1', () => ({
  requireActorUserId: () => 'actor1',
  assertTransportFamily: vi.fn(),
  encryptionModeFromMimeMode: () => 'smime',
  applyMessageFamilyEncryptionPolicy: () => 'smime',
  assertRouteTransportSecurity: vi.fn(),
  inferAttachmentExtension: () => 'edi',
  inferBodyText: () => "UNB+original'UNZ+1+1'",
  inferMimeType: () => 'application/edifact',
  resolveSmtpMimeMode: () => 'ediel-smime-enveloped',
  isEdifactMessage: () => true,
  normalizeEdifactForSmtp: (s: string) => s,
  extractEdielSubjectFromPayload: () => 'TEST',
  safePreview: (s: string) => s,
  sanitizeMimeToken: (s: string) => s,
  buildInnerEdifactMimeForSmime: () => Buffer.from('INNER'),
  encryptSmimeEnvelopedData: vi.fn().mockResolvedValue(Buffer.from('DER')),
  inspectCmsRecipientInfo: vi.fn().mockResolvedValue({ raw: 'ok', serialNumbers: ['01'], expectedReceiverPresent: true }),
  buildOuterSmimeMime: () => Buffer.from('Message-ID: <archive-guard@example.test>\r\n\r\nRAW MIME'),
  encodeBase64Mime: (b: Buffer) => b.toString('base64'),
  buildMultipartValidationBase64Mime: vi.fn(),
  buildSinglePartEdielBase64Mime: vi.fn(),
  buildSinglePartEdielMime: vi.fn(),
  routeCertificateEnvironment: () => 'test',
  sha256: (value: string | Buffer) => `hash-${Buffer.from(value).length}`,
  storeTransportPayloadSnapshot: mocks.snapshot,
  findRelatedOutboundForInboundAck: vi.fn(),
  inferAckOutcomeFromPayload: vi.fn(),
  parseEdifactEnvelope: vi.fn(),
}))

import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'

describe('S/MIME archive pre-send guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.snapshot.mockRejectedValue(new Error('archive unavailable'))
    mocks.send.mockResolvedValue({ accepted: ['receiver@example.test'], rejected: [], messageId: '<smtp@example.test>' })
  })

  it('performs zero SMTP calls when exact MIME archival cannot be persisted', async () => {
    const message = {
      id: 'message-1',
      company_id: 'company-1',
      direction: 'outbound',
      message_standard: 'edifact',
      message_family: 'PRODAT',
      message_code: 'Z01',
      message_version: 'E2SE6A',
      environment: 'test',
      communication_route_id: 'route-1',
      receiver_email: 'receiver@example.test',
      receiver_ediel_id: 'RECEIVER',
      receiver_sub_address: 'SUB',
      file_name: 'message.edi',
    } as EdielMessageRow

    await expect(sendEdielMessageViaSmtp(message, { actorUserId: 'actor1', smtpMimeMode: 'ediel-smime-enveloped' }))
      .rejects.toThrow('archive unavailable')

    expect(mocks.snapshot).toHaveBeenCalledWith(expect.objectContaining({
      message,
      payloadKind: 'smime_enveloped',
      archivePayload: expect.any(Buffer),
      encryptionMode: 'smime',
    }))
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
