import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  archive: vi.fn(),
  isSmime: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
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

vi.mock('@/lib/ediel/transport/smimeTransportArchive', () => ({
  archiveSmimeRawMime: mocks.archive,
  isSmimeRawMime: mocks.isSmime,
}))

import { sendEdielEmail } from '@/lib/email/sendEdielEmail'

const rawSmime = Buffer.from(
  'Message-ID: <archive-guard@example.test>\r\nContent-Type: application/pkcs7-mime\r\n\r\nZW5jcnlwdGVk\r\n',
  'ascii',
)

describe('S/MIME archive pre-send guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isSmime.mockReturnValue(true)
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
    })).rejects.toThrow('archive unavailable')

    expect(mocks.archive).toHaveBeenCalledWith(rawSmime)
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })

  it('submits the exact same bytes only after archival succeeds', async () => {
    await expect(sendEdielEmail({
      raw: rawSmime,
      to: 'receiver@example.test',
      envelopeFrom: 'sender@example.test',
    })).resolves.toMatchObject({ messageId: '<smtp@example.test>' })

    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      raw: rawSmime,
      envelope: { from: 'sender@example.test', to: ['receiver@example.test'] },
    }))
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendMail.mock.invocationCallOrder[0])
  })

  it('does not force the S/MIME archive path onto other raw MIME modes', async () => {
    mocks.isSmime.mockReturnValue(false)
    const raw = Buffer.from('Content-Type: application/EDIFACT\r\n\r\nUNB+test\'')

    await sendEdielEmail({ raw, to: 'receiver@example.test' })

    expect(mocks.archive).not.toHaveBeenCalled()
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
  })
})
