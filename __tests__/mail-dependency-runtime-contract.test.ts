import { describe, expect, it } from 'vitest'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'

/**
 * Runtime contract for the mail libraries the platform depends on (no network).
 * Guards dependency upgrades: the exact APIs used by lib/auth/smtpTransactionalEmail.ts,
 * lib/email/sendEdielEmail.ts and lib/inbound-mail/*MailboxPoller* must keep working.
 */
describe('mail dependency runtime contract', () => {
  it('nodemailer builds and "sends" a message with attachments through a local stream transport', async () => {
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
    expect(typeof transporter.verify).toBe('function')
    const info = await transporter.sendMail({
      from: 'ops@example.test',
      replyTo: 'support@example.test',
      to: 'kund@example.test',
      subject: 'Testämne åäö',
      text: 'Hej',
      html: '<p>Hej</p>',
      attachments: [{ filename: 'PRODAT.edi', content: Buffer.from("UNA:+.? 'UNB+UNOC:3'") }],
    })
    const raw = (info.message as Buffer).toString('utf8')
    expect(info.envelope).toEqual({ from: 'ops@example.test', to: ['kund@example.test'] })
    expect(raw).toContain('Subject: =?UTF-8?')
    expect(raw).toContain('filename=PRODAT.edi')
  })

  it('nodemailer SMTP transport accepts the options shape used by the platform without connecting', () => {
    const transporter = nodemailer.createTransport({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      auth: { user: 'user', pass: 'pass' },
    })
    expect(typeof transporter.sendMail).toBe('function')
    expect(typeof transporter.verify).toBe('function')
    transporter.close()
  })

  it('ImapFlow constructs with the poller options and exposes the methods the pollers call', () => {
    const client = new ImapFlow({
      host: 'imap.example.test',
      port: 993,
      secure: true,
      auth: { user: 'user', pass: 'pass' },
      logger: false,
    })
    for (const method of ['connect', 'getMailboxLock', 'fetch', 'messageFlagsAdd', 'logout'] as const) {
      expect(typeof client[method]).toBe('function')
    }
  })
})
