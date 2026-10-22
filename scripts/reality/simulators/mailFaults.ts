// Reality simulator for scenario J3: a grid owner (or someone pretending to be one) that sends broken, duplicated,
// misaddressed and out-of-order Ediel mail to the platform's shared Ediel mailbox over real SMTPS.
//
// Every fault is a complete RFC 5322 message built here (nodemailer's MailComposer for well-formed MIME, hand-written
// bytes where the MIME itself is the fault) and submitted unchanged with `raw`, so the platform's IMAP poller sees
// exactly these bytes. Synthetic parties only (example.invalid, 7359990… metering points, Ediel ids 7xxxx/8xxxx).
//
// The IMAP/SMTP outage steps are designed, not executed here: they need GreenMail to be stopped and started, which
// only the owner of the shared world may do (REALITY_J3_GREENMAIL_STOP / REALITY_J3_GREENMAIL_START, see
// scripts/reality/chain-j3-inbound-robustness.test.ts J3-6).
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { LIVE } from '../../helpers/live-chain-fixture'

export type FaultMail = {
  key: string
  subject: string
  messageId: string
  /** Exact bytes the grid owner submits. */
  raw: Buffer
  /** Interchange references carried by the mail (for CONTRL/ediel_messages lookups). */
  references: string[]
}

type Attachment = { filename: string; content: string | Buffer; contentType: string; encoding?: string }

const messageIdFor = (key: string) => `<j3-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@grid-owner.example.invalid>`

/** Well-formed MIME with the given attachments (what a normal grid-owner system produces). */
export async function composeMail(input: { key: string; from: string; to?: string; subject: string; text?: string; attachments: Attachment[];
  references: string[]; messageId?: string }): Promise<FaultMail> {
  const messageId = input.messageId ?? messageIdFor(input.key)
  const raw = await new Promise<Buffer>((resolve, reject) => new MailComposer({ from: input.from, to: input.to ?? LIVE.platformMailbox,
    subject: input.subject, text: input.text ?? 'Ediel', messageId, attachments: input.attachments })
    .compile().build((error: Error | null, message: Buffer) => error ? reject(error) : resolve(message)))
  return { key: input.key, subject: input.subject, messageId, raw, references: input.references }
}

/** A single-part message whose whole body is the given bytes (some senders put the file in the body). */
export function singlePartMail(input: { key: string; from: string; to?: string; subject: string; contentType: string; transferEncoding: 'base64' | '7bit';
  body: Buffer; references: string[]; messageId?: string }): FaultMail {
  const messageId = input.messageId ?? messageIdFor(input.key)
  const content = input.transferEncoding === 'base64' ? (input.body.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n') : input.body.toString('latin1')
  const raw = Buffer.from([
    `From: ${input.from}`, `To: ${input.to ?? LIVE.platformMailbox}`, `Subject: ${input.subject}`, `Message-ID: ${messageId}`,
    `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', `Content-Type: ${input.contentType}`, `Content-Transfer-Encoding: ${input.transferEncoding}`,
    '', content, '',
  ].join('\r\n'), 'latin1')
  return { key: input.key, subject: input.subject, messageId, raw, references: input.references }
}

/** Submits the exact bytes over SMTPS as the grid owner (TLS verified against the local CA, like gridOwnerSends). */
export async function sendRaw(from: string, mail: FaultMail, to: string = LIVE.platformMailbox) {
  const transport = nodemailer.createTransport({ host: LIVE.mailHost, port: LIVE.smtpsPort, secure: true, requireTLS: true,
    auth: { user: from, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  try {
    await transport.sendMail({ envelope: { from, to: [to] }, raw: mail.raw })
  } finally {
    transport.close()
  }
}

/** UTF-16LE bytes of an EDIFACT text: a wrong encoding that decodes with a NUL after every character. */
export const utf16 = (text: string) => Buffer.from(text, 'utf16le')

/** A few bytes of a ZIP local file header followed by binary noise (NUL bytes included). */
export const zipBytes = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]), Buffer.alloc(32, 0), Buffer.from('UNZ unb una', 'latin1')])

/** A minimal PDF whose stream text happens to contain "unz" (as compressed PDF streams do by chance). */
export const pdfBytes = () => Buffer.from('%PDF-1.4\n1 0 obj<<>>stream\nx\u009c Kunz unzip \u0000\u0001\nendstream\nendobj\n%%EOF\n', 'latin1')
