// lib/ediel/transport.ts

import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getEdielMessageById,
  updateEdielMessageStatus,
  createEdielMessageEvent,
} from '@/lib/ediel/db'
import type {
  CreateEdielMessageInput,
  EdielMessageRow,
} from '@/lib/ediel/types'
import {
  ACTIVE_EDIEL_MESSAGE_FAMILIES,
  isActiveEdielMessageFamily,
} from '@/lib/ediel/types'
import {
  buildInboundUtiltsMessageInput,
  parseInboundUtilts,
} from '@/lib/ediel/utilts'
import { parseInboundProdat } from '@/lib/ediel/prodat'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'
import { computeCanonicalAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/core/ackPolicy'
import {
  inferInboundAiListExternalReference,
  normalizeInboundEmail,
  normalizeInboundMailboxIdentity,
} from '@/lib/ediel/core/referenceRegistry'
import {
  registerInboundCanonicalMessage,
  resolveInboundAcceptedVersions,
} from '@/lib/ediel/core/kernel'
import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'

const execFileAsync = promisify(execFile)

function requireEnv(name: string, fallback?: string | null): string {
  const value = process.env[name] ?? fallback ?? ''
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

function optionalEnv(name: string, fallback?: string | null): string | null {
  const value = process.env[name] ?? fallback ?? null
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requireActorUserId(value?: string | null): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error('Inloggad användare saknas för Ediel-åtgärden. Logga in igen och försök på nytt.')
  }
  return trimmed
}


function sanitizeMimeHeader(value: string | null | undefined, fallback = ''): string {
  const text = String(value ?? fallback).trim()
  return text.replace(/[\r\n]+/g, ' ').trim() || fallback
}

function quoteMimeParam(value: string): string {
  return sanitizeMimeHeader(value, 'ediel-message.edi').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export type EdielSmtpMimeMode =
  | 'ediel-singlepart-base64'
  | 'ediel-smime-enveloped'
  | 'ediel-multipart-validation-base64'
  | 'ediel-singlepart-lines'
  | 'ediel-singlepart-compact'
  | 'nodemailer-attachment'

function splitEdifactPayload(rawPayload: string): { hasUna: boolean; una: string; segments: string[] } {
  const normalized = rawPayload
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  if (!normalized) {
    return { hasUna: false, una: '', segments: [] }
  }

  if (normalized.toUpperCase().startsWith('UNA')) {
    // UNA is exactly 9 characters: UNA + six service characters. In Ediel's
    // default UNA the reserved character is a blank: UNA:+.? '. A normal
    // split/trim would remove that blank and make UNB disappear in validation.
    const una = normalized.slice(0, 9)
    const rest = normalized.slice(9)
    return {
      hasUna: true,
      una,
      segments: rest
        .split("'")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0),
    }
  }

  return {
    hasUna: false,
    una: '',
    segments: normalized
      .split("'")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0),
  }
}

function normalizeEdifactSegments(rawPayload: string): string[] {
  const parsed = splitEdifactPayload(rawPayload)
  return parsed.hasUna ? [parsed.una, ...parsed.segments] : parsed.segments
}

function normalizeEdifactForSmtp(rawPayload: string, mode: 'lines' | 'compact' = 'compact'): string {
  const parsed = splitEdifactPayload(rawPayload)
  if (parsed.segments.length === 0 && !parsed.hasUna) return ''

  if (mode === 'lines') {
    const body = parsed.segments.map((segment) => `${segment}'`).join('\r\n')
    return parsed.hasUna ? `${parsed.una}${body ? `\r\n${body}` : ''}` : body
  }

  const body = parsed.segments.map((segment) => `${segment}'`).join('')
  return parsed.hasUna ? `${parsed.una}${body}` : body
}

function encodeBase64Mime(buffer: Buffer, lineLength = 76): string {
  const encoded = buffer.toString('base64')
  const chunks: string[] = []
  for (let index = 0; index < encoded.length; index += lineLength) {
    chunks.push(encoded.slice(index, index + lineLength))
  }
  return chunks.join('\r\n')
}

function sanitizeMimeToken(value: string | null | undefined, fallback = 'edifact'): string {
  const cleaned = sanitizeMimeHeader(value, fallback).replace(/[^A-Za-z0-9._-]/g, '_')
  return cleaned.length > 0 ? cleaned : fallback
}

function buildInnerEdifactMimeForSmime(params: {
  filename: string
  decodedPayload: string
  encoding: BufferEncoding
}): Buffer {
  const payloadBuffer = Buffer.from(params.decodedPayload, params.encoding)
  const payloadBase64 = encodeBase64Mime(payloadBuffer)
  const headers = [
    'Content-Type: application/EDIFACT',
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename=${sanitizeMimeToken(params.filename, 'edifact')}`,
  ]

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${payloadBase64}\r\n`, 'ascii')
}

function buildSinglePartEdielBase64Mime(params: {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  filename: string
  contentType: string
  decodedPayload: string
  encoding: BufferEncoding
}): Buffer {
  const payloadBuffer = Buffer.from(params.decodedPayload, params.encoding)
  const payloadBase64 = encodeBase64Mime(payloadBuffer)
  const headers = [
    `From: ${sanitizeMimeHeader(params.from)}`,
    `To: ${sanitizeMimeHeader(params.to)}`,
    `Subject: ${sanitizeMimeHeader(params.subject, params.filename)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildAsciiMessageId()}`,
    'MIME-Version: 1.0',
    `Content-Type: ${params.contentType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename=${sanitizeMimeToken(params.filename, 'edifact')}`,
  ]

  if (params.replyTo) {
    headers.splice(2, 0, `Reply-To: ${sanitizeMimeHeader(params.replyTo)}`)
  }

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${payloadBase64}\r\n`, 'ascii')
}

function buildMultipartValidationBase64Mime(params: {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  filename: string
  contentType: string
  decodedPayload: string
  encoding: BufferEncoding
}): Buffer {
  const boundary = `gridex_ediel_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const payloadBase64 = encodeBase64Mime(Buffer.from(params.decodedPayload, params.encoding))
  const headers = [
    `From: ${sanitizeMimeHeader(params.from)}`,
    `To: ${sanitizeMimeHeader(params.to)}`,
    `Subject: ${sanitizeMimeHeader(params.subject, params.filename)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildAsciiMessageId()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]

  if (params.replyTo) {
    headers.splice(2, 0, `Reply-To: ${sanitizeMimeHeader(params.replyTo)}`)
  }

  const parts = [
    `--${boundary}`,
    `Content-Type: ${params.contentType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename=${sanitizeMimeToken(params.filename, 'edifact')}`,
    '',
    payloadBase64,
    `--${boundary}--`,
    '',
  ]

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, 'ascii')
}


function buildOuterSmimeMime(params: {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  encryptedDer: Buffer
}): Buffer {
  const payloadBase64 = encodeBase64Mime(params.encryptedDer)
  const headers = [
    `From: ${sanitizeMimeHeader(params.from)}`,
    `To: ${sanitizeMimeHeader(params.to)}`,
    `Subject: ${sanitizeMimeHeader(params.subject, 'EDIEL_SMIME')}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildAsciiMessageId()}`,
    'MIME-Version: 1.0',
    'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename=smime.p7m',
  ]

  if (params.replyTo) {
    headers.splice(2, 0, `Reply-To: ${sanitizeMimeHeader(params.replyTo)}`)
  }

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${payloadBase64}\r\n`, 'ascii')
}

async function encryptSmimeEnvelopedData(params: {
  innerMime: Buffer
  recipientCertPath: string
}): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-smime-'))
  const inputPath = join(tempDir, 'inner.mime')
  const outputPath = join(tempDir, 'smime.der')

  try {
    await writeFile(inputPath, params.innerMime)

    try {
      await execFileAsync('openssl', [
        'smime',
        '-encrypt',
        '-binary',
        '-des3',
        '-outform',
        'DER',
        '-in',
        inputPath,
        '-out',
        outputPath,
        params.recipientCertPath,
      ])
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`S/MIME-kryptering misslyckades via OpenSSL. Kontrollera EDIEL_SMIME_RECIPIENT_CERT_PATH och att openssl finns installerat. ${detail}`)
    }

    return await readFile(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function buildAsciiMessageId(): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 10)
  return `<gridex-ediel-${stamp}-${random}@gridex.se>`
}

export function isSupportedSmtpMimeMode(value: string | null | undefined): value is EdielSmtpMimeMode {
  return (
    value === 'ediel-singlepart-base64' ||
    value === 'ediel-smime-enveloped' ||
    value === 'ediel-multipart-validation-base64' ||
    value === 'ediel-singlepart-lines' ||
    value === 'ediel-singlepart-compact' ||
    value === 'nodemailer-attachment'
  )
}

function resolveSmtpMimeMode(override?: string | null): EdielSmtpMimeMode {
  const requested = override?.trim() || process.env.EDIEL_SMTP_MIME_MODE?.trim()
  if (isSupportedSmtpMimeMode(requested)) return requested

  return 'ediel-smime-enveloped'
}


function isEdifactMessage(message: EdielMessageRow): boolean {
  return message.message_standard === 'edifact' || message.mime_type?.toLowerCase().includes('edifact') === true
}

function buildSinglePartEdielMime(params: {
  from: string
  to: string
  replyTo?: string | null
  subject: string
  filename: string
  contentType: string
  rawPayload: string
  encoding: BufferEncoding
}): Buffer {
  const headers = [
    `From: ${sanitizeMimeHeader(params.from)}`,
    `To: ${sanitizeMimeHeader(params.to)}`,
    `Subject: ${sanitizeMimeHeader(params.subject, params.filename)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildAsciiMessageId()}`,
    'MIME-Version: 1.0',
    `Content-Type: ${params.contentType}; name="${quoteMimeParam(params.filename)}"`,
    'Content-Transfer-Encoding: 8bit',
    `Content-Disposition: attachment; filename="${quoteMimeParam(params.filename)}"`,
  ]

  if (params.replyTo) {
    headers.splice(2, 0, `Reply-To: ${sanitizeMimeHeader(params.replyTo)}`)
  }

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${params.rawPayload}\r\n`, params.encoding)
}

function safePreview(value: string, maxLength = 600): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, maxLength)
}
function resolveSmtpPort(value?: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const env = process.env.EDIEL_SMTP_PORT
  return env ? Number(env) : 465
}

function resolveImapPort(value?: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const env = process.env.EDIEL_IMAP_PORT
  return env ? Number(env) : 993
}

function assertTransportFamily(messageFamily: string | null | undefined, context: string) {
  if (!isActiveEdielMessageFamily(messageFamily)) {
    throw new Error(
      `${context}: message family ${messageFamily ?? 'null'} ligger utanför aktiv release (${ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')})`
    )
  }
}

function inferAttachmentExtension(message: EdielMessageRow): 'edi' | 'csv' | 'xml' {
  if (message.message_standard === 'ai_list') return 'csv'
  if (message.message_standard === 'xml') return 'xml'
  return 'edi'
}

function inferMimeType(message: EdielMessageRow): string {
  if (message.mime_type?.trim()) return message.mime_type
  if (message.message_standard === 'ai_list') return 'text/csv; charset=utf-8'
  if (message.message_standard === 'xml') return 'application/xml; charset=utf-8'
  return 'application/edifact'
}

function inferBodyText(message: EdielMessageRow): string {
  if (typeof message.raw_payload === 'string' && message.raw_payload.length > 0) {
    return message.raw_payload
  }

  if (message.message_standard === 'ai_list') {
    return 'AI-list payload missing'
  }

  return ''
}

function buildInboundProdatMessageInput(params: {
  rawPayload: string
  communicationRouteId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
}): CreateEdielMessageInput {
  const parsed = parseInboundProdat(params.rawPayload)
  const ack = deriveEdielAckDefaults({
    family: 'PRODAT',
    code: parsed.messageCode ?? 'Z03',
  })

  const receivedAt = new Date().toISOString()

  return {
    actorUserId: 'system',
    direction: 'inbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: parsed.messageCode ?? 'Z03',
    messageVersion: parsed.messageVersion ?? 'D:03A:UN:1.0',
    status: 'received',
    transportType: 'imap',
    mailbox: params.mailbox ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
    senderEdielId: parsed.senderEdielId,
    receiverEdielId: parsed.receiverEdielId,
    senderSubAddress: parsed.senderSubAddress,
    receiverSubAddress: parsed.receiverSubAddress,
    senderEmail: params.senderEmail ?? null,
    receiverEmail: params.receiverEmail ?? null,
    subject: params.subject ?? null,
    fileName: inferEdielFileName({
      family: 'PRODAT',
      code: parsed.messageCode ?? 'Z03',
      direction: 'inbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    externalReference: parsed.externalReference,
    transactionReference: parsed.transactionReference,
    applicationReference: parsed.applicationReference,
    communicationRouteId: params.communicationRouteId ?? null,
    rawPayload: params.rawPayload,
    parsedPayload: parsed.parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    syntaxCheckStatus: 'pending',
    functionalCheckStatus: 'pending',
    messageReceivedAt: receivedAt,
    ackDueAt: computeCanonicalAckDueAt(receivedAt),
  }
}

function buildInboundAiListMessageInput(params: {
  rawPayload: string
  listType: 'AI' | 'BI'
  communicationRouteId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  subject?: string | null
}): CreateEdielMessageInput {
  const externalReference = inferInboundAiListExternalReference({
    subject: params.subject ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
  })

  return {
    actorUserId: 'system',
    direction: 'inbound',
    messageStandard: 'ai_list',
    messageFamily: 'AI_LIST',
    messageCode: params.listType,
    messageVersion: 'Ver20140401',
    status: 'received',
    transportType: 'imap',
    mailbox: params.mailbox ?? null,
    mailboxMessageId: params.mailboxMessageId ?? null,
    senderEmail: params.senderEmail ?? null,
    receiverEmail: params.receiverEmail ?? null,
    subject: params.subject ?? null,
    fileName: inferEdielFileName({
      family: 'AI_LIST',
      code: params.listType,
      direction: 'inbound',
      extension: 'csv',
    }),
    mimeType: 'text/csv; charset=utf-8',
    externalReference,
    communicationRouteId: params.communicationRouteId ?? null,
    rawPayload: params.rawPayload,
    parsedPayload: {
      listType: params.listType,
      lineCount: params.rawPayload.split(/\r?\n/).filter(Boolean).length,
      separator: ';',
      importedVia: 'imap',
      controlOnly: true,
    },
    requiresContrl: false,
    requiresAperak: false,
    contrlStatus: 'not_required',
    aperakStatus: 'not_required',
    utiltsErrStatus: 'not_required',
    syntaxCheckStatus: 'not_checked',
    functionalCheckStatus: 'not_checked',
    messageReceivedAt: new Date().toISOString(),
  }
}

async function withAcceptedInboundVersions(
  input: CreateEdielMessageInput
): Promise<CreateEdielMessageInput> {
  const acceptedVersions = await resolveInboundAcceptedVersions({
    family: input.messageFamily,
    code: String(input.messageCode),
    standard: input.messageStandard,
    date:
      typeof input.messageReceivedAt === 'string'
        ? input.messageReceivedAt.slice(0, 10)
        : null,
  })

  const currentVersion = typeof input.messageVersion === 'string' ? input.messageVersion : null
  const acceptedVersionCodes = acceptedVersions.map((row) => row.version_code)
  const versionAccepted =
    currentVersion === null
      ? acceptedVersionCodes.length === 0
      : acceptedVersionCodes.includes(currentVersion)

  return {
    ...input,
    validationReport: {
      ...(input.validationReport ?? {}),
      acceptedInboundVersions: acceptedVersionCodes,
      inboundVersionAccepted: versionAccepted,
      inboundVersionCheckDate:
        typeof input.messageReceivedAt === 'string'
          ? input.messageReceivedAt.slice(0, 10)
          : new Date().toISOString().slice(0, 10),
    },
  }
}

export async function sendEdielMessageViaSmtp(
  message: EdielMessageRow,
  params?: { actorUserId?: string | null; smtpMimeMode?: EdielSmtpMimeMode | null }
): Promise<{
  accepted: string[]
  rejected: string[]
  messageId: string | null
}> {
  const actorUserId = requireActorUserId(params?.actorUserId)
  assertTransportFamily(message.message_family, 'sendEdielMessageViaSmtp')

  if (!message.receiver_email?.trim()) {
    throw new Error(`Kan inte skicka Ediel-meddelande ${message.id} utan receiver_email.`)
  }

  const routeProfile = message.communication_route_id
    ? await getEdielRouteProfileByCommunicationRouteId(message.communication_route_id)
    : null

  const host = requireEnv('EDIEL_SMTP_HOST', routeProfile?.smtp_host ?? null)
  const port = resolveSmtpPort(routeProfile?.smtp_port ?? null)
  const user = requireEnv(
    'EDIEL_SMTP_USER',
    routeProfile?.mailbox ?? process.env.EDIEL_SMTP_USER ?? null
  )
  const pass = requireEnv('EDIEL_SMTP_PASS')
  const from = optionalEnv('EDIEL_SMTP_FROM', routeProfile?.mailbox ?? null) ?? user
  const replyTo = optionalEnv('EDIEL_SMTP_REPLY_TO', null)

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  })

  const extension = inferAttachmentExtension(message)
  const bodyText = inferBodyText(message)
  const fileName =
    message.file_name ??
    inferEdielFileName({
      family: message.message_family,
      code: String(message.message_code),
      direction: message.direction,
      extension,
    })
  const mimeMode = resolveSmtpMimeMode(params?.smtpMimeMode)
  const edifactPayloadMode =
    mimeMode === 'ediel-singlepart-lines' || mimeMode === 'nodemailer-attachment'
      ? 'lines'
      : 'compact'
  const normalizedPayload = isEdifactMessage(message)
    ? normalizeEdifactForSmtp(bodyText, edifactPayloadMode)
    : bodyText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  const contentType = isEdifactMessage(message)
    ? 'application/EDIFACT'
    : message.message_standard === 'xml'
      ? 'application/xml'
      : inferMimeType(message)
  const mimeEncoding: BufferEncoding = isEdifactMessage(message) ? 'latin1' : 'utf8'
  const contentTransferEncoding =
    mimeMode === 'nodemailer-attachment'
      ? 'nodemailer-managed'
      : mimeMode === 'ediel-singlepart-lines' || mimeMode === 'ediel-singlepart-compact'
        ? '8bit'
        : 'base64'
  const smtpSubject = `EDIEL_${String(message.message_family).toUpperCase()}_${String(message.message_code).toUpperCase()}_${String(message.interchange_reference ?? message.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'manual_note',
    eventStatus: 'info',
    message: 'SMTP-skick förberett. Kontrollera denna payload om Edielportalen inte registrerar meddelandet.',
    payload: {
      mimeMode,
      contentType,
      contentTransferEncoding,
      envelopeFrom: from,
      envelopeTo: message.receiver_email,
      headerFrom: from,
      headerTo: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      fileName,
      payloadLength: normalizedPayload.length,
      payloadPreview: safePreview(normalizedPayload),
      receiverEdielId: message.receiver_ediel_id,
      receiverSubAddress: message.receiver_sub_address,
      applicationReference: message.application_reference,
    },
  })

  let result: any
  let rawMimePreview: string | null = null
  let decodedPayloadPreview: string | null = null
  let encodedPayloadPreview: string | null = null
  let encryptedPayloadLength: number | null = null
  let innerMimePreview: string | null = null

  if (mimeMode === 'nodemailer-attachment') {
    result = await transporter.sendMail({
      from,
      to: message.receiver_email,
      replyTo: replyTo ?? undefined,
      subject: smtpSubject,
      text: '',
      headers: {
        'X-Gridex-Ediel-Message-Id': message.id,
      },
      attachments: [
        {
          filename: fileName,
          content: Buffer.from(normalizedPayload, mimeEncoding),
          contentType,
          contentDisposition: 'attachment',
        },
      ],
    })
  } else if (mimeMode === 'ediel-smime-enveloped') {
    if (!isEdifactMessage(message)) {
      throw new Error('S/MIME-läget stöder just nu EDIFACT. Använd ediel-singlepart-base64 för XML/AI-listor tills separat XML-S/MIME är byggt.')
    }

    const recipientCertPath = requireEnv('EDIEL_SMIME_RECIPIENT_CERT_PATH')
    const innerMime = buildInnerEdifactMimeForSmime({
      filename: fileName,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })
    const encryptedDer = await encryptSmimeEnvelopedData({
      innerMime,
      recipientCertPath,
    })
    const rawMime = buildOuterSmimeMime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      encryptedDer,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 900)
    innerMimePreview = safePreview(innerMime.toString('ascii'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)
    encryptedPayloadLength = encryptedDer.length

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'S/MIME envelope byggt enligt Ediel-regler före SMTP-skickning.',
      payload: {
        mimeMode,
        recipientCertPath,
        outerContentType: 'application/pkcs7-mime; smime-type=enveloped-data; name=smime.p7m',
        outerContentTransferEncoding: 'base64',
        outerContentDisposition: 'attachment; filename=smime.p7m',
        innerContentType: 'application/EDIFACT',
        innerContentTransferEncoding: 'base64',
        innerContentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        innerMimePreview,
        encryptedPayloadLength,
        rawMimePreview,
      },
    })

    result = await transporter.sendMail({
      envelope: {
        from,
        to: [message.receiver_email],
      },
      raw: rawMime,
    })
  } else if (mimeMode === 'ediel-multipart-validation-base64') {
    if (!isEdifactMessage(message)) {
      throw new Error('Multipart-diagnostikläget är endast avsett för EDIFACT/PRODAT-test.')
    }

    const rawMime = buildMultipartValidationBase64Mime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 1200)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'SMTP diagnostik-MIME byggt: multipart/mixed med application/EDIFACT attachment base64.',
      payload: {
        mimeMode,
        purpose: 'Diagnostik för att återskapa valideringsrespons från Edielportalen utan 8bit.',
        outerContentType: 'multipart/mixed',
        attachmentContentType: contentType,
        attachmentContentTransferEncoding: 'base64',
        attachmentContentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        encodedPayloadLength: Buffer.from(normalizedPayload, mimeEncoding).toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await transporter.sendMail({
      envelope: {
        from,
        to: [message.receiver_email],
      },
      raw: rawMime,
    })
  } else if (mimeMode === 'ediel-singlepart-base64') {
    const rawMime = buildSinglePartEdielBase64Mime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      decodedPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('ascii'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)
    encodedPayloadPreview = safePreview(encodeBase64Mime(Buffer.from(normalizedPayload, mimeEncoding)), 900)

    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'manual_note',
      eventStatus: 'info',
      message: 'SMTP MIME byggt enligt Ediel-regler före skickning.',
      payload: {
        mimeMode,
        contentType,
        contentTransferEncoding: 'base64',
        contentDisposition: `attachment; filename=${sanitizeMimeToken(fileName, 'edifact')}`,
        decodedPayloadLength: normalizedPayload.length,
        decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
        decodedPayloadPreview,
        encodedPayloadLength: Buffer.from(normalizedPayload, mimeEncoding).toString('base64').length,
        encodedPayloadPreview,
        rawMimePreview,
      },
    })

    result = await transporter.sendMail({
      envelope: {
        from,
        to: [message.receiver_email],
      },
      raw: rawMime,
    })
  } else {
    const rawMime = buildSinglePartEdielMime({
      from,
      to: message.receiver_email,
      replyTo,
      subject: smtpSubject,
      filename: fileName,
      contentType,
      rawPayload: normalizedPayload,
      encoding: mimeEncoding,
    })

    rawMimePreview = safePreview(rawMime.toString('latin1'), 900)
    decodedPayloadPreview = safePreview(normalizedPayload, 900)

    result = await transporter.sendMail({
      envelope: {
        from,
        to: [message.receiver_email],
      },
      raw: rawMime,
    })
  }

  const accepted = Array.isArray(result.accepted) ? result.accepted.map(String) : []
  const rejected = Array.isArray(result.rejected) ? result.rejected.map(String) : []

  if (rejected.length > 0 || accepted.length === 0) {
    await createEdielMessageEvent({
      actorUserId,
      edielMessageId: message.id,
      eventType: 'failed',
      eventStatus: 'error',
      message: 'SMTP-servern accepterade inte Ediel-meddelandet fullt ut.',
      payload: {
        smtpMessageId: result.messageId ?? null,
        accepted,
        rejected,
        response: result.response ?? null,
        mimeMode,
      },
    })

    throw new Error(`SMTP accepterade inte mottagaren. accepted=${accepted.join(',') || 'tomt'} rejected=${rejected.join(',') || 'tomt'}`)
  }
  await updateEdielMessageStatus({
    actorUserId,
    edielMessageId: message.id,
    status: 'sent',
    messageSentAt: new Date().toISOString(),
  })

  await createEdielMessageEvent({
    actorUserId,
    edielMessageId: message.id,
    eventType: 'sent',
    eventStatus: 'success',
    message: 'Ediel-meddelande skickat via SMTP.',
    payload: {
      smtpMessageId: result.messageId ?? null,
      smtpResponse: result.response ?? null,
      accepted,
      rejected,
      mimeMode,
      contentType,
      contentTransferEncoding,
      subject: smtpSubject,
      fileName,
      payloadLength: normalizedPayload.length,
      payloadPreview: safePreview(normalizedPayload),
      rawMimePreview,
      decodedPayloadLength: normalizedPayload.length,
      decodedPayloadHasLineBreaks: /[\r\n]/.test(normalizedPayload),
      decodedPayloadPreview,
      encodedPayloadPreview,
      encryptedPayloadLength,
      innerMimePreview,
    },
  })

  return {
    accepted,
    rejected,
    messageId: result.messageId ?? null,
  }
}

export async function pollEdielMailboxViaImap(params?: {
  actorUserId?: string | null
  mailbox?: string | null
  communicationRouteId?: string | null
  limit?: number
}): Promise<EdielMessageRow[]> {
  const actorUserId = requireActorUserId(params?.actorUserId)
  const routeProfile = params?.communicationRouteId
    ? await getEdielRouteProfileByCommunicationRouteId(params.communicationRouteId)
    : null

  const host = requireEnv('EDIEL_IMAP_HOST', routeProfile?.imap_host ?? null)
  const port = resolveImapPort(routeProfile?.imap_port ?? null)
  const user = requireEnv(
    'EDIEL_IMAP_USER',
    routeProfile?.mailbox ?? params?.mailbox ?? null
  )
  const pass = requireEnv('EDIEL_IMAP_PASS')
  const mailbox = params?.mailbox ?? routeProfile?.mailbox ?? 'INBOX'
  const limit = params?.limit ?? 10

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
  })

  const created: EdielMessageRow[] = []

  await client.connect()
  await client.mailboxOpen(mailbox)

  try {
    const lock = await client.getMailboxLock(mailbox)

    try {
      const messages = client.fetch(
        { seen: false },
        {
          uid: true,
          envelope: true,
          source: true,
        }
      )

      let count = 0

      for await (const item of messages) {
        if (count >= limit) break

        const mailboxMessageId = normalizeInboundMailboxIdentity(item.uid)
        if (!mailboxMessageId) continue

        const rawSource =
          typeof item.source === 'string'
            ? item.source
            : Buffer.isBuffer(item.source)
              ? item.source.toString('utf8')
              : ''

        const content = rawSource || ''
        if (!content.trim()) continue

        const senderEmail = normalizeInboundEmail(item.envelope?.from?.[0]?.address)
        const receiverEmail = normalizeInboundEmail(item.envelope?.to?.[0]?.address)
        const subject =
          typeof item.envelope?.subject === 'string' ? item.envelope.subject : null

        const inferred = inferEdielFamilyAndCodeFromRawPayload(content)
        let input: CreateEdielMessageInput | null = null

        if (inferred.messageFamily === 'UTILTS') {
          const utiltsCode =
            inferred.messageCode === 'S01' ||
            inferred.messageCode === 'S02' ||
            inferred.messageCode === 'S03' ||
            inferred.messageCode === 'S04' ||
            inferred.messageCode === 'E31' ||
            inferred.messageCode === 'E66' ||
            inferred.messageCode === 'E73'
              ? inferred.messageCode
              : 'E66'

          const parsed = parseInboundUtilts(content)
          if (!isActiveEdielMessageFamily(parsed.messageFamily)) continue

          input = await withAcceptedInboundVersions(
            buildInboundUtiltsMessageInput({
              code: utiltsCode,
              communicationRouteId: params?.communicationRouteId ?? null,
              mailbox,
              mailboxMessageId,
              senderEmail,
              receiverEmail,
              rawPayload: content,
            })
          )
        } else if (inferred.messageFamily === 'PRODAT') {
          input = await withAcceptedInboundVersions(
            buildInboundProdatMessageInput({
              rawPayload: content,
              communicationRouteId: params?.communicationRouteId ?? null,
              mailbox,
              mailboxMessageId,
              senderEmail,
              receiverEmail,
              subject,
            })
          )

          assertTransportFamily(input.messageFamily, 'pollEdielMailboxViaImap/PRODAT')
        } else if (inferred.messageFamily === 'AI_LIST') {
          const listType = inferred.messageCode === 'BI' ? 'BI' : 'AI'
          input = await withAcceptedInboundVersions(
            buildInboundAiListMessageInput({
              rawPayload: content,
              listType,
              communicationRouteId: params?.communicationRouteId ?? null,
              mailbox,
              mailboxMessageId,
              senderEmail,
              receiverEmail,
              subject,
            })
          )

          assertTransportFamily(input.messageFamily, 'pollEdielMailboxViaImap/AI_LIST')
        } else {
          continue
        }

        const createdMessage = await registerInboundCanonicalMessage({
          actorUserId,
          input,
        })

        const justCreated = await getEdielMessageById(createdMessage.id)
        if (justCreated) {
          created.push(justCreated)
          count += 1
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout()
  }

  return created
}