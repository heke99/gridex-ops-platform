import nodemailer from 'nodemailer'
import { createHash } from 'node:crypto'
import * as tls from 'node:tls'
import MailComposer from 'nodemailer/lib/mail-composer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { assertEdielSmtpReadiness, edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { archiveTransportRawMime, type TransportMimeArchiveContext } from '@/lib/ediel/transport/rawMimeArchive'

/** Optional server-owned authority gate. The existing journal entry must have
 * completed before this is called; rejection leaves provider progress at zero.
 * It grants no production approval and must not retry or reset that journal. */
export type EdielFinalProviderGate = (binding: Readonly<Record<string, unknown>>) => Promise<void>

export type SendEdielEmailInput = (
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
) & { finalProviderGate?: EdielFinalProviderGate }

export type EdielProviderEntry = { archiveContext?: TransportMimeArchiveContext; captureLocalTransportEndpoint?: true; beforeProviderCall: (binding: Record<string, unknown>) => Promise<void> }

export async function sendEdielEmail(input: SendEdielEmailInput, entry?: EdielProviderEntry): Promise<{
  accepted: unknown[]
  rejected: unknown[]
  messageId?: string
  response?: string
}> {
  // Capture the function before the first await. A mutable caller cannot swap
  // the selected authority while archive/journal preparation is in flight.
  const finalProviderGate = input.finalProviderGate
  if (finalProviderGate !== undefined && typeof finalProviderGate !== 'function') {
    throw new Error('ediel_final_provider_gate_invalid')
  }
  const readiness = assertEdielSmtpReadiness()
  const config = edielSmtpConfig()
  const envelopeFrom = ('raw' in input ? input.envelopeFrom : input.from) ?? config.from
  const envelopeTo = input.to
  const transportOptions: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    auth: {
      user: config.user ?? '',
      pass: config.password,
    },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  }
  // This opt-in is a server-owned witness request, never delivery authority.
  // Production omits it. Capture only literal loopback and no auth fields.
  const captureLocalEndpoint = entry?.captureLocalTransportEndpoint === true
  let localEndpoint: Readonly<Record<string, unknown>> | null = null
  if (captureLocalEndpoint && String(config.provider).toLowerCase() === 'strato'
    && (transportOptions.host === '127.0.0.1' || transportOptions.host === '::1')) {
    try {
      const getCAs = (tls as typeof tls & { getCACertificates?: (kind: 'default') => string[] }).getCACertificates
      const defaults = getCAs?.('default')
      if (defaults?.length && defaults.every(certificate => typeof certificate === 'string')) {
        const capturedCAs = [...defaults]
        const caTrustSha256 = createHash('sha256').update(JSON.stringify(capturedCAs
          .map(certificate => createHash('sha256').update(certificate, 'utf8').digest('hex')).sort()), 'utf8').digest('hex')
        const endpoint = {
          version: 1, provider: 'strato', host: transportOptions.host, port: transportOptions.port,
          secure: transportOptions.secure === true, requireTLS: transportOptions.requireTLS === true,
          rejectUnauthorized: transportOptions.tls?.rejectUnauthorized === true,
          minVersion: transportOptions.tls?.minVersion ?? null, servername: transportOptions.tls?.servername ?? null,
          caTrustSha256,
        }
        const fingerprint = createHash('sha256').update([
          'local-smtp-endpoint-v1', endpoint.provider, endpoint.host, endpoint.port,
          endpoint.secure, endpoint.requireTLS, endpoint.rejectUnauthorized,
          endpoint.minVersion, endpoint.servername === null ? 'no-servername' : endpoint.servername, endpoint.caTrustSha256,
        ].map(String).join('\n'), 'utf8').digest('hex')
        // The SAME options given to createTransport now retain these actual CA
        // bytes. Later environment/default-store changes cannot swap its trust.
        transportOptions.tls = { ...transportOptions.tls, ca: capturedCAs }
        localEndpoint = Object.freeze({ ...endpoint, fingerprint })
      }
    } catch { /* Missing proof denies a configured LOCAL context in native SQL. */ }
  }
  const transporter = nodemailer.createTransport(transportOptions)

  if (!entry?.archiveContext) throw new Error('ediel_transport_archive_context_required')
  const providerEntry = entry
  const enterProvider = async (binding: Record<string, unknown>) => {
    // The optional final gate receives its own actual-MIME snapshot, rather
    // than an object an earlier callback could mutate during its awaits.
    const actualBinding = captureLocalEndpoint ? { ...binding, localSmtpEndpoint: localEndpoint } : binding
    const finalBinding = finalProviderGate ? structuredClone(actualBinding) : null
    await providerEntry.beforeProviderCall(actualBinding)
    if (finalProviderGate && finalBinding) await finalProviderGate(Object.freeze(finalBinding))
  }
  if ('raw' in input) {
    // Caller-owned bytes may change while archive/provider gates await I/O.
    const raw = Buffer.from(input.raw)
    const archive = await archiveTransportRawMime(raw, entry.archiveContext)
    await enterProvider({mode:'raw',from:envelopeFrom,to:envelopeTo,rawBase64:raw.toString('base64'),...archive})
    const result = await transporter.sendMail({
      envelope: {
        from: envelopeFrom,
        to: [envelopeTo],
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
    from: envelopeFrom,
    to: envelopeTo,
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
  await enterProvider({mode:'attachment',from:envelopeFrom,to:envelopeTo,replyTo:config.replyTo ?? null,subject:mailOptions.subject,text:mailOptions.text ?? null,html:mailOptions.html ?? null,
    attachments:mailOptions.attachments?.map(a=>({...a,content:undefined,contentBase64:Buffer.isBuffer(a.content)?a.content.toString('base64'):Buffer.from(a.content).toString('base64')})) ?? [],
    headers:mailOptions.headers,rawBase64:raw.toString('base64'),...archive})
  const result = await transporter.sendMail({ envelope: {from:envelopeFrom,to:[envelopeTo]}, raw })
  return {
    accepted: Array.isArray(result.accepted) ? result.accepted : [],
    rejected: Array.isArray(result.rejected) ? result.rejected : [],
    messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
    response: typeof result.response === 'string' ? result.response : undefined,
  }
}
