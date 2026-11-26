import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import * as tls from 'node:tls'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { assertEdielSmtpReadiness, edielSmtpConfig } from '@/lib/ediel/mailReadiness'
import { SmtpCertificateRejectedBeforeSmtpError } from '@/lib/ediel/transport/smtpOutcome'
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

export type EdielProviderEntry = {
  archiveContext?: TransportMimeArchiveContext
  includeLocalSmtpIdentity?: true
  beforeProviderCall: (binding: Record<string, unknown>) => Promise<void>
}

// Node 22 builds before the runtime CA inspection API cannot qualify a
// local policy. Ordinary sends still use the existing default TLS context.
const getCACertificates = (tls as typeof tls & {
  getCACertificates?: (type: 'default') => readonly string[]
}).getCACertificates

function localSmtpIdentity(config: ReturnType<typeof edielSmtpConfig>) {
  if ((config.host !== '127.0.0.1' && config.host !== '::1') || config.provider !== 'strato'
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65_535
    || typeof getCACertificates !== 'function') return null
  const ca = [...getCACertificates('default')].sort()
  if (ca.length === 0) return null
  const caTrustSha256 = createHash('sha256').update(ca.join('\n')).digest('hex')
  const fingerprint = createHash('sha256').update([
    'local-smtp-endpoint-v1', config.provider, config.host, config.port, config.secure,
    true, true, 'TLSv1.2', 'no-servername', caTrustSha256,
  ].join('\n')).digest('hex')
  return { ca, endpoint: { version: 1, provider: config.provider, host: config.host, port: config.port,
    secure: config.secure, requireTLS: true, rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: null,
    caTrustSha256, fingerprint } }
}

// Retain the native verification result before Nodemailer can relabel socket
// errors. The SMTP client receives this socket only after strict TLS succeeds.
const connectImplicitSmtpTls = (ca?: string[]): NonNullable<SMTPTransport.Options['getSocket']> => (options, done) => {
  const { host } = options
  const port = Number(options.port)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
    done(new Error('ediel_smtp_endpoint_required'))
    return
  }
  const socket = tls.connect({
    host, port, servername: isIP(host) ? undefined : host,
    rejectUnauthorized: true, minVersion: 'TLSv1.2', ca,
  })
  const timeout = setTimeout(() => {
    socket.destroy(Object.assign(new Error('SMTP TLS connection timed out'), {code:'ETIMEDOUT', command:'CONN'}))
  }, options.connectionTimeout ?? 120_000)
  const cleanup = () => {
    clearTimeout(timeout)
    socket.off('secureConnect', secured)
    socket.off('error', failed)
    socket.off('close', closed)
  }
  const failed = (error: Error) => {
    cleanup()
    socket.destroy()
    done(SmtpCertificateRejectedBeforeSmtpError.fromTlsHandshake(error))
  }
  const closed = () => failed(Object.assign(new Error('SMTP TLS connection closed'), {code:'ECONNECTION', command:'CONN'}))
  const secured = () => {
    if (!socket.authorized) {
      failed(new Error('ediel_smtp_tls_authorization_required'))
      return
    }
    cleanup()
    socket.setKeepAlive(true)
    done(null, {connection: socket, secured: true})
  }
  socket.once('secureConnect', secured)
  socket.once('error', failed)
  socket.once('close', closed)
}

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
  const localIdentity = entry?.includeLocalSmtpIdentity ? localSmtpIdentity(config) : null
  const transportOptions: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.secure ? {getSocket: connectImplicitSmtpTls(localIdentity?.ca)} : {}),
    requireTLS: true,
    auth: {
      user: config.user ?? '',
      pass: config.password,
    },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: localIdentity?.ca },
  }
  const transporter = nodemailer.createTransport(transportOptions)

  if (!entry?.archiveContext) throw new Error('ediel_transport_archive_context_required')
  const providerEntry = entry
  const enterProvider = async (binding: Record<string, unknown>) => {
    // The optional final gate receives its own actual-MIME snapshot, rather
    // than an object an earlier callback could mutate during its awaits.
    if (localIdentity) binding.localSmtpEndpoint = localIdentity.endpoint
    const finalBinding = finalProviderGate ? structuredClone(binding) : null
    await providerEntry.beforeProviderCall(binding)
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
