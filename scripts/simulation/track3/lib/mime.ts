// MIME-byggare för syntetiska inkommande Ediel-mejl (byte-stabil, CRLF).
import { randomUUID } from 'node:crypto'

export type EdifactMimeOptions = {
  from: string
  to: string
  subject: string
  raw: string
  /** Sätts för att kunna dedupe/identifiera; default genereras. */
  messageId?: string
  /** 'attachment' = multipart/mixed med application/edifact-bilaga (vanligast); 'inline' = enbart text/edifact-body. */
  placement?: 'attachment' | 'inline'
  filename?: string
  date?: Date
}

export function buildEdifactMime(o: EdifactMimeOptions): { mime: Buffer; messageId: string } {
  const messageId = o.messageId ?? `<${randomUUID()}@t3.sim.invalid>`
  const date = (o.date ?? new Date()).toUTCString().replace('GMT', '+0000')
  const head = [
    `From: ${o.from}`, `To: ${o.to}`, `Subject: ${o.subject}`, `Date: ${date}`, `Message-ID: ${messageId}`, 'MIME-Version: 1.0',
  ]
  const body = o.raw.replace(/\r?\n/g, '\r\n')
  if ((o.placement ?? 'attachment') === 'inline') {
    return { messageId, mime: Buffer.from([...head, 'Content-Type: application/edifact', 'Content-Transfer-Encoding: 8bit', '', body, ''].join('\r\n')) }
  }
  const boundary = `t3sim-${randomUUID().replaceAll('-', '').slice(0, 16)}`
  const lines = [
    ...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', 'Synthetic Track 3 EDIFACT interchange attached.', '',
    `--${boundary}`, 'Content-Type: application/edifact', `Content-Disposition: attachment; filename="${o.filename ?? 'interchange.edi'}"`,
    'Content-Transfer-Encoding: 8bit', '', body, '', `--${boundary}--`, '',
  ]
  return { messageId, mime: Buffer.from(lines.join('\r\n')) }
}
