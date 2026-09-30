import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { assertEdielSmtpReadiness, edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { archiveTransportRawMime, type TransportMimeArchiveContext } from '@/lib/ediel/transport/rawMimeArchive'

export type SendEdielEmailInput =
  | {
      raw: Buffer
      to: string
      envelopeFrom?: string | null
    }
  | {
      from?: string | null
      to: string
      subject: string
      text?: string
      html?: string
      attachments?: Array<{
        filename: string
        content: Buffer | string
        contentType?: string
        contentDisposition?: 'attachment' | 'inline'
      }>
    }

export type EdielProviderEntry = { archiveContext?: TransportMimeArchiveContext; beforeProviderCall: (binding: Record<string, unknown>) => Promise<void> }

export async function sendEdielEmail(input: SendEdielEmailInput, entry?: EdielProviderEntry): Promise<{
  accepted: unknown[]
  rejected: unknown[]
  messageId?: string
  response?: string
}> {
  const readiness = assertEdielSmtpReadiness()
  const config = edielSmtpConfig()
  const transportOptions: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    auth: {
      user: config.user ?? '',
      pass: config.password,
    },
    tls: { rejectUnauthorized: true },
  }
  const transporter = nodemailer.createTransport(transportOptions)

  if (!entry?.archiveContext) throw new Error('ediel_transport_archive_context_required')
  if ('raw' in input) {
    // Caller-owned bytes may change while archive/provider gates await I/O.
    const raw = Buffer.from(input.raw)
    const archive = await archiveTransportRawMime(raw, entry.archiveContext)
    await entry.beforeProviderCall({mode:'raw',from:input.envelopeFrom ?? config.from,to:input.to,rawBase64:raw.toString('base64'),...archive})
    const result = await transporter.sendMail({
      envelope: {
        from: input.envelopeFrom ?? config.from,
        to: [input.to],
      },
      raw,
    })
    return {
      accepted: Array.isArray(result.accepted) ? result.accepted : [],
      rejected: Array.isArray(result.rejected) ? result.rejected : [],
      messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
      response: typeof result.response === 'string' ? result.response : undefined,
    }
  }

  // Compile once before archival. Sending options again would let Nodemailer
  // create a different Message-ID/boundary/date after the evidence was stored.
  const mailOptions = {
    from: input.from ?? config.from,
    to: input.to,
    replyTo: config.replyTo ?? undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
    headers: {
      'X-Gridex-Mail-Lane': 'ediel-strato',
      'X-Gridex-Ediel-Provider': readiness.provider,
    },
  }
  const raw = await new MailComposer(mailOptions).compile().build()
  const archive = await archiveTransportRawMime(raw, entry.archiveContext)
  await entry.beforeProviderCall({mode:'attachment',from:input.from ?? config.from,to:input.to,replyTo:config.replyTo ?? null,subject:input.subject,text:input.text ?? null,html:input.html ?? null,
    attachments:input.attachments?.map(a=>({...a,content:undefined,contentBase64:Buffer.isBuffer(a.content)?a.content.toString('base64'):Buffer.from(a.content).toString('base64')})) ?? [],
    headers:mailOptions.headers,rawBase64:raw.toString('base64'),...archive})
  const result = await transporter.sendMail({ envelope: {from:input.from ?? config.from,to:[input.to]}, raw })
  return {
    accepted: Array.isArray(result.accepted) ? result.accepted : [],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
    messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
    response: typeof result.response === 'string' ? result.response : undefined,
  }
}
