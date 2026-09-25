import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { assertEdielSmtpReadiness, edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { archiveSmimeRawMime, isSmimeRawMime } from '@/lib/ediel/transport/smimeTransportArchive'

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

export type EdielProviderEntry = { beforeProviderCall: (binding: Record<string, unknown>) => Promise<void> }

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
    auth: {
      user: config.user ?? '',
      pass: config.password,
    },
    tls: { rejectUnauthorized: true },
  }
  const transporter = nodemailer.createTransport(transportOptions)

  if ('raw' in input) {
    // S/MIME transport is an evidence-bearing operation. The exact RFC822 bytes
    // must be durably archived and read back before SMTP submission. The
    // archive binder also upgrades the immediately preceding transport snapshot
    // from its temporary smtp-smime:// reference to the private storage object.
    if (isSmimeRawMime(input.raw)) {
      await archiveSmimeRawMime(input.raw)
    }

    await entry?.beforeProviderCall({mode:'raw',from:input.envelopeFrom ?? config.from,to:input.to,rawBase64:input.raw.toString('base64')})
    const result = await transporter.sendMail({
      envelope: {
        from: input.envelopeFrom ?? config.from,
        to: [input.to],
      },
      raw: input.raw,
    })
    return {
      accepted: Array.isArray(result.accepted) ? result.accepted : [],
      rejected: Array.isArray(result.rejected) ? result.rejected : [],
      messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
      response: typeof result.response === 'string' ? result.response : undefined,
    }
  }

  await entry?.beforeProviderCall({mode:'attachment',from:input.from ?? config.from,to:input.to,replyTo:config.replyTo ?? null,subject:input.subject,text:input.text ?? null,html:input.html ?? null,
    attachments:input.attachments?.map(a=>({...a,content:undefined,contentBase64:Buffer.isBuffer(a.content)?a.content.toString('base64'):Buffer.from(a.content).toString('base64')})) ?? [],
    headers:{'X-Gridex-Mail-Lane':'ediel-strato','X-Gridex-Ediel-Provider':readiness.provider}})
  const result = await transporter.sendMail({
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
  })
  return {
    accepted: Array.isArray(result.accepted) ? result.accepted : [],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
    messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
    response: typeof result.response === 'string' ? result.response : undefined,
  }
}
