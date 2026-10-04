// masterplan: TR-01, AT-TR-01
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ smtp: vi.fn(), transport: vi.fn(), resend: vi.fn(), archive: vi.fn(), entry: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: (options: unknown) => {
  io.transport(options)
  return { sendMail: io.smtp }
} } }))
vi.mock('resend', () => ({ Resend: class { emails = { send: io.resend } } }))
vi.mock('@/lib/ediel/transport/rawMimeArchive', () => ({ archiveTransportRawMime: io.archive }))

import { sendEdielEmail } from '@/lib/email/sendEdielEmail'
import { sendApplicationEmail } from '@/lib/email/sendApplicationEmail'

// Actual channel selection, configuration and MIME composer; only external
// providers and durable archive I/O are finite ports. No network mail is sent.
const ediel = { to: 'dso@example.invalid', subject: 'PRODAT', attachments: [{ filename: 'message.edi', content: Buffer.from("UNB+UNCHANGED'") }] }
const application = { from: 'events@example.invalid', to: 'customer@example.invalid', subject: 'Customer notification', html: '<p>Notification</p>' }
const entry = { archiveContext: { companyId: 'own-company', messageId: 'owned-original' }, beforeProviderCall: io.entry }

beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic-local-only',
    EDIEL_EMAIL_PROVIDER: 'strato', EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_PORT: '587', EDIEL_SMTP_SECURE: 'false',
    EDIEL_SMTP_USER: 'synthetic-user', EDIEL_SMTP_PASS: 'synthetic-local-only', EDIEL_SMTP_FROM: 'esco@example.invalid', EDIEL_SMTP_REPLY_TO: 'reply@example.invalid',
  })) vi.stubEnv(key, value)
  io.archive.mockResolvedValue({ mimeArchiveRef: 'synthetic-exact-archive' })
  io.entry.mockResolvedValue(undefined)
  io.smtp.mockResolvedValue({ accepted: [ediel.to], rejected: [], messageId: '<provider@example.invalid>', response: '250 queued as OBSERVED-ONLY' })
  io.resend.mockResolvedValue({ data: { id: 'application-provider-id' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

it('TR-01 sends the configured counterpart and exact compiled MIME through Ediel SMTP', async () => {
  expect(await sendEdielEmail(ediel, entry)).toMatchObject({ accepted: [ediel.to], response: '250 queued as OBSERVED-ONLY' })
  expect(io.transport).toHaveBeenCalledWith({ host: 'smtp.example.invalid', port: 587, secure: false, requireTLS: true,
    auth: { user: 'synthetic-user', pass: 'synthetic-local-only' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  const archived = io.archive.mock.calls[0][0] as Buffer
  expect(archived.toString()).toContain('X-Gridex-Mail-Lane: ediel-strato')
  expect(archived.toString()).toContain('Content-Disposition: attachment; filename=message.edi')
  expect(io.smtp).toHaveBeenCalledWith({ envelope: { from: 'esco@example.invalid', to: [ediel.to] }, raw: archived })
  expect(io.entry.mock.calls[0][0]).toMatchObject({ to: ediel.to, rawBase64: archived.toString('base64') })
  expect(io.resend).not.toHaveBeenCalled()
})

it('TR-01 keeps application notifications on the actual Resend provider', async () => {
  expect(await sendApplicationEmail(application)).toEqual({ providerMessageId: 'application-provider-id', status: 'sent' })
  expect(io.resend).toHaveBeenCalledWith(expect.objectContaining(application))
  expect(io.smtp).not.toHaveBeenCalled()
  expect(io.transport).not.toHaveBeenCalled()
  expect(io.archive).not.toHaveBeenCalled()
})

it('TR-01 propagates SMTP failure without Resend fallback', async () => {
  io.smtp.mockRejectedValue(new Error('Synthetic SMTP unavailable'))
  await expect(sendEdielEmail(ediel, entry)).rejects.toThrow('Synthetic SMTP unavailable')
  expect(io.resend).not.toHaveBeenCalled()
  expect(io.smtp).toHaveBeenCalledTimes(1)
})

it('TR-01 propagates Resend failure without Ediel SMTP fallback', async () => {
  io.resend.mockResolvedValue({ data: null, error: { message: 'Synthetic application provider unavailable' } })
  await expect(sendApplicationEmail(application)).rejects.toThrow('Resend-fel: Synthetic application provider unavailable')
  expect(io.smtp).not.toHaveBeenCalled()
  expect(io.transport).not.toHaveBeenCalled()
})

it('TR-01 rejects Resend as the Ediel provider before either external provider call', async () => {
  vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'resend')
  await expect(sendEdielEmail(ediel, entry)).rejects.toThrow(/får inte använda Resend/)
  expect(io.smtp).not.toHaveBeenCalled()
  expect(io.resend).not.toHaveBeenCalled()
  expect(io.archive).not.toHaveBeenCalled()
})

it('TR-01 rejects a global SMTP application provider without changing channels', async () => {
  vi.stubEnv('EMAIL_PROVIDER', 'strato')
  await expect(sendApplicationEmail(application)).rejects.toThrow(/Okänd e-postleverantör/)
  await expect(sendEdielEmail(ediel, entry)).rejects.toThrow(/EMAIL_PROVIDER får inte sättas till strato globalt/)
  expect(io.smtp).not.toHaveBeenCalled()
  expect(io.resend).not.toHaveBeenCalled()
})
