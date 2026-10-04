// masterplan: TR-01, AT-TR-01
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  archive: vi.fn(),
  transport: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (options: unknown) => { mocks.transport(options); return { sendMail: mocks.sendMail } },
  },
}))

vi.mock('@/lib/ediel/mailReadiness', () => ({
  assertEdielSmtpReadiness: () => ({ provider: 'test', from: 'sender@example.test' }),
  edielSmtpConfig: () => ({
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    user: 'user',
    password: 'password',
    from: 'sender@example.test',
    replyTo: null,
  }),
}))

vi.mock('@/lib/ediel/transport/rawMimeArchive', () => ({ archiveTransportRawMime: mocks.archive }))

import { sendEdielEmail } from '@/lib/email/sendEdielEmail'

const rawSmime = Buffer.from(
  'Message-ID: <archive-guard@example.test>\r\nContent-Type: application/pkcs7-mime\r\n\r\nZW5jcnlwdGVk\r\n',
  'ascii',
)

const entry = { archiveContext: { companyId: '11111111-1111-4111-8111-111111111111', messageId: '22222222-2222-4222-8222-222222222222' }, beforeProviderCall: vi.fn().mockResolvedValue(undefined) }

describe('Exact MIME archive pre-send guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.archive.mockResolvedValue({ storageRef: 'storage://ediel-files/transport/evidence.eml' })
    mocks.sendMail.mockResolvedValue({
      accepted: ['receiver@example.test'],
      rejected: [],
      messageId: '<smtp@example.test>',
      response: '250 queued',
    })
  })

  it('performs zero SMTP calls when exact MIME archival cannot be persisted', async () => {
    mocks.archive.mockRejectedValue(new Error('archive unavailable'))

    await expect(sendEdielEmail({
      raw: rawSmime,
      to: 'receiver@example.test',
      envelopeFrom: 'sender@example.test',
    }, entry)).rejects.toThrow('archive unavailable')

    expect(mocks.archive).toHaveBeenCalledWith(rawSmime, entry.archiveContext)
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it('submits the exact same bytes only after archival succeeds', async () => {
    await expect(sendEdielEmail({
      raw: rawSmime,
      to: 'receiver@example.test',
      envelopeFrom: 'sender@example.test',
    }, entry)).resolves.toMatchObject({ messageId: '<smtp@example.test>' })

    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      raw: rawSmime,
      envelope: { from: 'sender@example.test', to: ['receiver@example.test'] },
    }))
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMail.mock.invocationCallOrder[0])
  })

  it('archives other raw MIME modes through the common exact-byte authority', async () => {
    const raw = Buffer.from('Content-Type: application/EDIFACT\r\n\r\nUNB+test\'')

    await sendEdielEmail({ raw, to: 'receiver@example.test' }, entry)

    expect(mocks.archive).toHaveBeenCalledWith(raw, entry.archiveContext)
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
  })
  it('compiles attachment MIME once and submits only archived bytes after the provider fence', async () => {
    await sendEdielEmail({ to: 'receiver@example.test', subject: 'Ediel', attachments: [{ filename: 'payload.edi', content: Buffer.from("UNB+test'") }] }, entry)
    const raw = mocks.archive.mock.calls[0][0] as Buffer
    expect(raw.toString()).toMatch(/Message-ID: <[^>]+>/)
    expect(mocks.sendMail.mock.calls[0][0].raw.equals(raw)).toBe(true)
    expect(entry.beforeProviderCall.mock.calls[0][0]).toMatchObject({ mode: 'attachment', rawBase64: raw.toString('base64') })
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(entry.beforeProviderCall.mock.invocationCallOrder[0])
    expect(entry.beforeProviderCall.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMail.mock.invocationCallOrder[0])
  })
  it('blocks direct helper callers without durable tenant archive scope', async () => {
    await expect(sendEdielEmail({ raw: rawSmime, to: 'receiver@example.test' })).rejects.toThrow('ediel_transport_archive_context_required')
    expect(mocks.archive).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
  it('keeps archived provider bytes private across a mutating entry callback', async () => {
    const callerRaw = Buffer.from(rawSmime)
    const original = Buffer.from(callerRaw)
    const beforeProviderCall = vi.fn(async (binding: Record<string, unknown>) => { expect(binding.mode).toBe('raw'); callerRaw.fill(88) })
    await sendEdielEmail({ raw: callerRaw, to: 'receiver@example.test' }, { ...entry, beforeProviderCall })
    expect(mocks.archive.mock.calls[0][0].equals(original)).toBe(true)
    expect(mocks.sendMail.mock.calls[0][0].raw.equals(original)).toBe(true)
    expect(mocks.sendMail.mock.calls[0][0].raw).not.toBe(callerRaw)
    expect(beforeProviderCall.mock.calls[0]).toEqual([expect.objectContaining({ rawBase64: original.toString('base64') })])
  })
  it('requires TLS and certificate validation for the provider hop', async () => {
    await sendEdielEmail({ raw: rawSmime, to: 'receiver@example.test' }, entry)
    expect(mocks.transport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } }))
  })
})
