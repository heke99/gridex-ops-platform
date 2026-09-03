// Extracted from index.ts; keep public imports on the facade module.
import forge from 'node-forge'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promisify } from 'util'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import type { EdielMessageRow } from '@/lib/ediel/types'
import { ACTIVE_EDIEL_MESSAGE_FAMILIES, isActiveEdielMessageFamily } from '@/lib/ediel/types'


import { extractEdifactPayloadFromText } from '@/lib/ediel/classify'



import { getEdielRouteProfileByCommunicationRouteId } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateProductionTransportSecurity } from '@/lib/ediel/config'
import { evaluateCertificateStatus } from '@/lib/ediel/security/certificateStatus'
import { routeReceiverSubaddress } from '@/lib/ediel/security/outboundRecipientCertificate'
import { isAgtPortalProdatAddress, resolveRouteTransportSecurityMode } from '@/lib/ediel/partyRegistry'


import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'

export const execFileAsync = promisify(execFile)

export type SmtpSendResult = {
  accepted?: unknown[]
  rejected?: unknown[]
  messageId?: string
  response?: string
}

export function requireActorUserId(value?: string | null): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error('Inloggad användare saknas för Ediel-åtgärden. Logga in igen och försök på nytt.')
  }
  return trimmed
}

export function routeText(routeProfile: Record<string, unknown> | null | undefined, column: string): string | null {
  const value = routeProfile?.[column]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function routeMetadataText(routeProfile: Record<string, unknown> | null | undefined, key: string): string | null {
  const metadata = routeProfile?.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function normalizeRouteToken(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

export function routeLooksLikeAgtProdat(routeProfile: Record<string, unknown> | null | undefined): boolean {
  const messageFamily = normalizeRouteToken(
    routeText(routeProfile, 'message_family') ??
      routeMetadataText(routeProfile, 'messageFamily') ??
      routeMetadataText(routeProfile, 'message_family'),
  )
  if (messageFamily !== 'prodat') return false

  const environmentType = normalizeRouteToken(
    routeText(routeProfile, 'environment_type') ??
      routeMetadataText(routeProfile, 'environmentType') ??
      routeMetadataText(routeProfile, 'environment_type'),
  )
  const targetSystem = normalizeRouteToken(
    routeText(routeProfile, 'target_system') ??
      routeMetadataText(routeProfile, 'targetSystem') ??
      routeMetadataText(routeProfile, 'target_system'),
  )
  const testSuiteType = normalizeRouteToken(
    routeMetadataText(routeProfile, 'testSuiteType') ?? routeMetadataText(routeProfile, 'test_suite_type'),
  )
  const setupPackage = normalizeRouteToken(routeMetadataText(routeProfile, 'setupPackage') ?? routeMetadataText(routeProfile, 'setup_package'))

  return (
    environmentType === 'agt_test' ||
    targetSystem === 'ediel_portalen_agt' ||
    testSuiteType === 'agt' ||
    Boolean(setupPackage?.startsWith('agt_'))
  )
}

export function routeCertificateEnvironment(routeProfile: Record<string, unknown> | null | undefined, fallbackEnvironment?: string | null): string | null {
  // Ediel actor tests are logical test runs, but Ediel/Expisoft requires production certificates.
  // Old route rows may still have certificate_environment='test', so AGT PRODAT routes must be normalized here too.
  if (routeLooksLikeAgtProdat(routeProfile)) return 'production'

  return (
    routeText(routeProfile, 'certificate_environment') ??
    routeMetadataText(routeProfile, 'certificateEnvironment') ??
    routeMetadataText(routeProfile, 'certificate_environment') ??
    (fallbackEnvironment && fallbackEnvironment.trim().length > 0 ? fallbackEnvironment.trim() : null)
  )
}

export function sanitizeMimeHeader(value: string | null | undefined, fallback = ''): string {
  const text = String(value ?? fallback).trim()
  return text.replace(/[\r\n]+/g, ' ').trim() || fallback
}

export function quoteMimeParam(value: string): string {
  return sanitizeMimeHeader(value, 'ediel-message.edi').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export type EdielSmtpMimeMode =
  | 'ediel-singlepart-base64'
  | 'ediel-smime-enveloped'
  | 'ediel-multipart-validation-base64'
  | 'ediel-singlepart-lines'
  | 'ediel-singlepart-compact'
  | 'nodemailer-attachment'

export function splitEdifactPayload(rawPayload: string): { hasUna: boolean; una: string; segments: string[] } {
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

export function normalizeEdifactSegments(rawPayload: string): string[] {
  const parsed = splitEdifactPayload(rawPayload)
  return parsed.hasUna ? [parsed.una, ...parsed.segments] : parsed.segments
}

export function normalizeEdifactForSmtp(rawPayload: string, mode: 'lines' | 'compact' = 'compact'): string {
  const parsed = splitEdifactPayload(rawPayload)
  if (parsed.segments.length === 0 && !parsed.hasUna) return ''

  if (mode === 'lines') {
    const body = parsed.segments.map((segment) => `${segment}'`).join('\r\n')
    return parsed.hasUna ? `${parsed.una}${body ? `\r\n${body}` : ''}` : body
  }

  const body = parsed.segments.map((segment) => `${segment}'`).join('')
  return parsed.hasUna ? `${parsed.una}${body}` : body
}

export function extractEdielSubjectFromPayload(rawPayload: string, fallbackSubject: string): string {
  const parsed = splitEdifactPayload(rawPayload)
  const unb = parsed.segments.find((segment) => segment.toUpperCase().startsWith('UNB+'))
  const unh = parsed.segments.find((segment) => segment.toUpperCase().startsWith('UNH+'))

  if (!unb) return fallbackSubject

  const familyFromUnh = unh?.split('+')[2]?.split(':')[0]?.trim().toUpperCase()
  const family = familyFromUnh && /^[A-Z0-9_]+$/.test(familyFromUnh)
    ? familyFromUnh
    : fallbackSubject.split(/[_\s-]+/)[1]?.toUpperCase() || 'EDIEL'

  // Edielportalen använder subject-formatet "APERAK UNB+..." / "CONTRL UNB+...".
  // Detta ändrar bara Subject-headern, inte MIME/transporten.
  return sanitizeMimeHeader(`${family} ${unb}'`, fallbackSubject)
}

export function encodeBase64Mime(buffer: Buffer, lineLength = 76): string {
  const encoded = buffer.toString('base64')
  const chunks: string[] = []
  for (let index = 0; index < encoded.length; index += lineLength) {
    chunks.push(encoded.slice(index, index + lineLength))
  }
  return chunks.join('\r\n')
}

export function sanitizeMimeToken(value: string | null | undefined, fallback = 'edifact'): string {
  const cleaned = sanitizeMimeHeader(value, fallback).replace(/[^A-Za-z0-9._-]/g, '_')
  return cleaned.length > 0 ? cleaned : fallback
}

export function buildInnerEdifactMimeForSmime(params: {
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

export function buildSinglePartEdielBase64Mime(params: {
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

export function buildMultipartValidationBase64Mime(params: {
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

export function buildOuterSmimeMime(params: {
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

export async function encryptSmimeEnvelopedData(params: {
  innerMime: Buffer
  recipientCertPath?: string | null
  recipientCertificatePem?: string | null
}): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-smime-'))
  const inputPath = join(tempDir, 'inner.mime')
  const outputPath = join(tempDir, 'smime.der')
  const certPath = params.recipientCertPath ?? join(tempDir, 'recipient.pem')
  let recipientCertificatePem = params.recipientCertificatePem ?? null

  try {
    await writeFile(inputPath, params.innerMime)
    if (!params.recipientCertPath) {
      if (!recipientCertificatePem?.includes('BEGIN CERTIFICATE')) {
        throw new Error('S/MIME recipient certificate saknas.')
      }
      await writeFile(certPath, recipientCertificatePem, 'utf8')
    } else if (!recipientCertificatePem) {
      try {
        recipientCertificatePem = await readFile(params.recipientCertPath, 'utf8')
      } catch {
        recipientCertificatePem = null
      }
    }

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
        certPath,
      ])
    } catch (error) {
      if (recipientCertificatePem?.includes('BEGIN CERTIFICATE')) {
        return encryptSmimeEnvelopedDataWithForge({
          innerMime: params.innerMime,
          recipientCertificatePem,
        })
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`S/MIME-kryptering misslyckades via OpenSSL och ingen användbar PEM-fallback fanns. Kontrollera certifikat i route/databas eller EDIEL_SMIME_RECIPIENT_CERT_PATH. ${detail}`)
    }

    return await readFile(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export function encryptSmimeEnvelopedDataWithForge(params: {
  innerMime: Buffer
  recipientCertificatePem: string
}): Buffer {
  try {
    const certificate = forge.pki.certificateFromPem(params.recipientCertificatePem)
    const envelope = forge.pkcs7.createEnvelopedData()
    envelope.addRecipient(certificate)
    const content = forge.util.createBuffer()
    content.putBytes(params.innerMime.toString('binary'))
    envelope.content = content
    envelope.encrypt(undefined, forge.pki.oids['des-EDE3-CBC'])
    return Buffer.from(forge.asn1.toDer(envelope.toAsn1()).getBytes(), 'binary')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`S/MIME-kryptering misslyckades med Node/forge-fallback. ${detail}`)
  }
}

export function buildAsciiMessageId(): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 10)
  const smtpFromDomain = process.env.EDIEL_SMTP_FROM?.split('@')[1]
  const domain = String(process.env.EDIEL_MESSAGE_ID_DOMAIN ?? process.env.EDIEL_MAIL_DOMAIN ?? smtpFromDomain ?? 'ediel.local').trim().toLowerCase()
  return `<ediel-${stamp}-${random}@${domain || 'ediel.local'}>`
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

export function normalizeCmsSerial(value: unknown): string | null {
  if (value == null) return null
  if (Buffer.isBuffer(value)) return value.toString('hex').toUpperCase()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex').toUpperCase()

  const raw = String(value).trim()
  if (!raw) return null

  const hexLike = raw.replace(/[^0-9A-Fa-f]/g, '')
  if (hexLike.length > 0 && hexLike.length >= raw.replace(/\s+/g, '').length / 2) {
    return hexLike.toUpperCase()
  }

  return Buffer.from(raw, 'binary').toString('hex').toUpperCase()
}

export function serialMatchesExpected(serial: string | null | undefined, expectedSerial: string | null | undefined): boolean {
  const serialHex = normalizeCmsSerial(serial)
  const expectedHex = normalizeCmsSerial(expectedSerial)
  if (!serialHex || !expectedHex) return false
  const normalizedSerial = serialHex.replace(/^0+/, '') || serialHex
  const normalizedExpected = expectedHex.replace(/^0+/, '') || expectedHex
  return serialHex === expectedHex || normalizedSerial === normalizedExpected
}

export function findExpectedSerialAsDerInteger(encryptedDer: Buffer, expectedSerialNumber?: string | null): boolean {
  const expected = normalizeCmsSerial(expectedSerialNumber)
  if (!expected) return false
  const evenHex = expected.length % 2 === 0 ? expected : `0${expected}`
  const serialBytes = Buffer.from(evenHex, 'hex')
  if (serialBytes.length === 0 || serialBytes.length > 127) return false

  const derInteger = Buffer.concat([Buffer.from([0x02, serialBytes.length]), serialBytes])
  if (encryptedDer.includes(derInteger)) return true

  // DER INTEGER values with the high bit set are prefixed by 00 to keep them positive.
  if ((serialBytes[0] ?? 0) >= 0x80) {
    const positiveDerInteger = Buffer.concat([Buffer.from([0x02, serialBytes.length + 1, 0x00]), serialBytes])
    return encryptedDer.includes(positiveDerInteger)
  }

  return false
}

export function inspectCmsRecipientInfoWithForge(params: {
  encryptedDer: Buffer
  expectedSerialNumber?: string | null
  opensslDiagnostic?: string | null
}): {
  raw: string | null
  serialNumbers: string[]
  expectedReceiverPresent: boolean
} {
  const diagnostics: string[] = ['node-forge CMS recipientInfo inspection']
  if (params.opensslDiagnostic) diagnostics.push(`OpenSSL diagnostic: ${params.opensslDiagnostic}`)

  try {
    const asn1 = forge.asn1.fromDer(params.encryptedDer.toString('binary'))
    const message = forge.pkcs7.messageFromAsn1(asn1) as unknown as { recipients?: Array<Record<string, unknown>> }
    const recipients = Array.isArray(message.recipients) ? message.recipients : []
    const serialNumbers = recipients
      .map((recipient) => normalizeCmsSerial(recipient.serialNumber))
      .filter((serial): serial is string => Boolean(serial))
    const expectedReceiverPresent = Boolean(
      params.expectedSerialNumber && serialNumbers.some((serial) => serialMatchesExpected(serial, params.expectedSerialNumber)),
    )

    return {
      raw: `${diagnostics.join(' | ')} | recipients=${recipients.length}`,
      serialNumbers,
      expectedReceiverPresent,
    }
  } catch (error) {
    const forgeDetail = error instanceof Error ? error.message : String(error)
    diagnostics.push(`node-forge parse failed: ${forgeDetail}`)

    const expectedReceiverPresent = findExpectedSerialAsDerInteger(params.encryptedDer, params.expectedSerialNumber)
    return {
      raw: `${diagnostics.join(' | ')} | DER serial fallback=${expectedReceiverPresent ? 'matched' : 'not_matched'}`,
      serialNumbers: expectedReceiverPresent && params.expectedSerialNumber ? [normalizeCmsSerial(params.expectedSerialNumber) ?? params.expectedSerialNumber] : [],
      expectedReceiverPresent,
    }
  }
}

export async function inspectCmsRecipientInfo(params: {
  encryptedDer: Buffer
  expectedSerialNumber?: string | null
}): Promise<{
  raw: string | null
  serialNumbers: string[]
  expectedReceiverPresent: boolean
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-cms-inspect-'))
  const inputPath = join(tempDir, 'smime.der')
  try {
    await writeFile(inputPath, params.encryptedDer)
    try {
      const { stdout } = await execFileAsync('openssl', [
        'cms',
        '-inform',
        'DER',
        '-cmsout',
        '-print',
        '-in',
        inputPath,
      ], { maxBuffer: 1024 * 1024 * 6 })
      const raw = String(stdout ?? '')
      const serialNumbers = Array.from(raw.matchAll(/serialNumber:\s*([0-9A-Fa-f]+)/g))
        .map((match) => normalizeCmsSerial(match[1]))
        .filter((serial): serial is string => Boolean(serial))
      const expectedReceiverPresent = Boolean(
        params.expectedSerialNumber && serialNumbers.some((serial) => serialMatchesExpected(serial, params.expectedSerialNumber)),
      )
      return { raw, serialNumbers, expectedReceiverPresent }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const fallback = inspectCmsRecipientInfoWithForge({
        encryptedDer: params.encryptedDer,
        expectedSerialNumber: params.expectedSerialNumber,
        opensslDiagnostic: detail,
      })
      if (fallback.expectedReceiverPresent) return fallback
      throw new Error(`S/MIME CMS recipientInfo kunde inte verifieras före SMTP: ${detail}; Node/forge fallback hittade inte förväntat mottagarcertifikat.`)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export function resolveSmtpMimeMode(
  override?: string | null,
  encryptionMode?: string | null
): EdielSmtpMimeMode {
  if (isSupportedSmtpMimeMode(override)) return override
  if (String(encryptionMode ?? '').toLowerCase() === 'smime') return 'ediel-smime-enveloped'
  return 'ediel-singlepart-base64'
}

export function isEdifactMessage(message: EdielMessageRow): boolean {
  return message.message_standard === 'edifact' || message.mime_type?.toLowerCase().includes('edifact') === true
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeRouteEncryptionMode(value: string | null | undefined): 'none' | 'smime' | 'pgp' | null {
  if (value === 'none' || value === 'smime' || value === 'pgp') return value
  return null
}

export function encryptionModeFromMimeMode(value?: string | null): 'none' | 'smime' | null {
  if (value === 'ediel-smime-enveloped') return 'smime'
  if (
    value === 'ediel-singlepart-base64' ||
    value === 'ediel-singlepart-lines' ||
    value === 'ediel-singlepart-compact' ||
    value === 'nodemailer-attachment' ||
    value === 'ediel-multipart-validation-base64'
  ) {
    return 'none'
  }
  return null
}

export function routeAllowsNonProdatSmime(routeProfile: Awaited<ReturnType<typeof getEdielRouteProfileByCommunicationRouteId>> | null): boolean {
  const metadata = routeProfile?.metadata
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      ((metadata as Record<string, unknown>).bilateralSmimeException === true ||
        (metadata as Record<string, unknown>).allowNonProdatSmime === true),
  )
}

export function applyMessageFamilyEncryptionPolicy(params: {
  messageFamily?: string | null
  requestedEncryptionMode: string | null
  routeProfile: Awaited<ReturnType<typeof getEdielRouteProfileByCommunicationRouteId>> | null
}): 'none' | 'smime' | 'pgp' | string | null {
  const family = String(params.messageFamily ?? '').toUpperCase()
  if (family === 'PRODAT') return params.requestedEncryptionMode
  if (params.requestedEncryptionMode === 'smime' && !routeAllowsNonProdatSmime(params.routeProfile)) {
    return 'none'
  }
  return params.requestedEncryptionMode
}

export async function resolveMailboxSecurityDefaults(params: {
  mailbox?: string | null
  environment?: string | null
}): Promise<{
  encryptionMode: string | null
  certificateId: string | null
} | null> {
  const mailbox = String(params.mailbox ?? '').trim()
  const environment = String(params.environment ?? '').trim()
  if (!mailbox || !environment) return null

  const { data, error } = await supabaseService
    .from('ediel_mailboxes')
    .select('encryption_mode,certificate_id')
    .ilike('email_address', mailbox)
    .eq('environment', environment)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return {
    encryptionMode: String(data.encryption_mode ?? '') || null,
    certificateId: String(data.certificate_id ?? '') || null,
  }
}

export async function assertRouteTransportSecurity(params: {
  message: EdielMessageRow
  routeProfile: Awaited<ReturnType<typeof getEdielRouteProfileByCommunicationRouteId>> | null
  effectiveEncryptionMode?: string | null
  effectiveCertificateId?: string | null
}) {
  const { message, routeProfile } = params
  const effectiveEncryptionMode = params.effectiveEncryptionMode ?? routeProfile?.encryption_mode ?? null
  const effectiveCertificateId = params.effectiveCertificateId ?? routeProfile?.receiver_certificate_id ?? routeProfile?.certificate_id ?? null
  const receiverSubaddress = routeReceiverSubaddress(routeProfile) ?? message.receiver_sub_address ?? null
  const transportSecurityMode = resolveRouteTransportSecurityMode({
    transportSecurityMode: routeProfile?.transport_security_mode,
    encryptionMode: effectiveEncryptionMode,
  })
  const family = String(message.message_family ?? routeProfile?.message_family ?? '').toUpperCase()
  const nonProdatSmimeAllowed = family === 'PRODAT' || routeAllowsNonProdatSmime(routeProfile)
  const agtPortalUnencryptedAllowed =
    effectiveEncryptionMode === 'none' &&
    routeProfile?.allow_unencrypted_test === true &&
    isAgtPortalProdatAddress({
      receiverEdielId: routeProfile?.receiver_ediel_id ?? message.receiver_ediel_id ?? null,
      receiverSubaddress,
      messageFamily: String(message.message_family ?? routeProfile?.message_family ?? ''),
      environment: message.environment,
    })

  if (transportSecurityMode === 'needs_verification') {
    throw new Error('Sändning stoppad: transport security är inte verifierad för routen.')
  }

  if (transportSecurityMode === 'required_encrypted' && effectiveEncryptionMode !== 'smime' && !agtPortalUnencryptedAllowed && nonProdatSmimeAllowed) {
    throw new Error('Sändning stoppad: routen kräver S/MIME-kryptering.')
  }

  if (transportSecurityMode === 'unencrypted' && effectiveEncryptionMode === 'smime') {
    throw new Error('Sändning stoppad: routen är explicit okrypterad men meddelandet försöker skickas som S/MIME.')
  }

  if (
    String(message.message_family ?? '').toUpperCase() === 'PRODAT' &&
    message.environment === 'production' &&
    effectiveEncryptionMode !== 'smime' &&
    routeProfile?.allow_unencrypted_production !== true
  ) {
    throw new Error('Sändning stoppad: real grid owner PRODAT i produktion kräver required_encrypted/S/MIME.')
  }

  if (message.environment !== 'production') {
    if (effectiveEncryptionMode === 'smime' && nonProdatSmimeAllowed && !effectiveCertificateId) {
      throw new Error('Sändning stoppad: krypterat Ediel-test kräver mottagarens publika S/MIME-certifikat på routen.')
    }
    return
  }

  const security = evaluateProductionTransportSecurity({
    runtime: {
      environment: message.environment,
      message_standard: message.message_standard,
      message_family: String(message.message_family),
      encryption_mode: normalizeRouteEncryptionMode(effectiveEncryptionMode),
      certificate_id: effectiveCertificateId,
      allow_unencrypted_production: routeProfile?.allow_unencrypted_production ?? false,
      allow_unencrypted_production_expires_at: routeProfile?.allow_unencrypted_production_expires_at ?? null,
      allow_unencrypted_production_reason: routeProfile?.allow_unencrypted_production_reason ?? null,
    },
    messageFamily: String(message.message_family),
  })

  if (!security.ok) {
    throw new Error(
      security.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => `${issue.key}: ${issue.label}. ${issue.resolution}`)
        .join(' | ') || 'Ediel transport security blockerade utskick.'
    )
  }

  if (effectiveEncryptionMode === 'smime' && effectiveCertificateId) {
    const { data, error } = await supabaseService
      .from('ediel_certificates')
      .select('id,valid_from,valid_to,certificate_valid_from,certificate_valid_to,renewal_window_days,warning_days_before_expiry,critical_days_before_expiry,status')
      .eq('id', effectiveCertificateId)
      .maybeSingle()

    if (error) throw error
    const certStatus = evaluateCertificateStatus(data ?? {})
    if (!data || !certStatus.isUsableForSmime) {
      throw new Error(`S/MIME-certifikat saknas eller är inte användbart: ${certStatus.message}`)
    }
  }
}

export async function storeTransportPayloadSnapshot(input: {
  message: EdielMessageRow
  payloadKind: 'raw_edifact' | 'smime_enveloped'
  rawPayload?: string | null
  encryptedPayloadRef?: string | null
  encryptionMode: 'none' | 'smime'
  certificateFingerprint?: string | null
  metadata?: Record<string, unknown>
}) {
  const rawPayloadHash = input.rawPayload ? sha256(input.rawPayload) : null
  await supabaseService.from('ediel_message_payloads').insert({
    company_id: input.message.company_id ?? null,
    ediel_message_id: input.message.id,
    payload_kind: input.payloadKind,
    raw_payload: input.rawPayload ?? null,
    raw_payload_hash: rawPayloadHash,
    encryption_mode: input.encryptionMode,
    signing_mode: 'none',
    security_status: input.encryptionMode === 'smime' ? 'encrypted' : 'stored',
    certificate_fingerprint: input.certificateFingerprint ?? null,
    certificate_fingerprint_sha256: input.certificateFingerprint ?? null,
    encrypted_payload_ref: input.encryptedPayloadRef ?? null,
    metadata: input.metadata ?? {},
    status: 'stored',
  })
}

export function buildSinglePartEdielMime(params: {
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

export function safePreview(value: string, maxLength = 600): string {
  return value.replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, maxLength)
}

export type ParsedInboundEnvelope = {
  family: string
  code: string
  messageVersion: string | null
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  interchangeReference: string | null
  applicationReference: string | null
  externalReference: string | null
  transactionReference: string | null
  parsedPayload: Record<string, unknown>
}

export function unfoldMimeHeaders(rawText: string): string {
  return rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]+/g, ' ')
}

export function extractHeaderValue(rawText: string, headerName: string): string | null {
  const prefix = headerName.toLowerCase() + ':'
  for (const line of unfoldMimeHeaders(rawText).split('\n')) {
    if (line.toLowerCase().startsWith(prefix)) {
      return line.slice(prefix.length).trim() || null
    }
  }
  return null
}

export function decodeBase64Body(rawText: string): string | null {
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = normalized.split(/\n\n/)
  if (parts.length < 2) return null

  const headers = parts[0] ?? ''
  const body = parts.slice(1).join('\n\n')
  if (!/content-transfer-encoding:\s*base64/i.test(headers)) return null

  const base64 = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line))
    .join('')

  if (!base64) return null

  try {
    const decoded = Buffer.from(base64, 'base64').toString('latin1')
    return decoded.includes('UNB+') || decoded.includes('UNA') ? decoded.trim() : null
  } catch {
    return null
  }
}

export function extractInboundEdifactPayload(params: { rawSource: string; subject?: string | null }): string {
  const decoded = decodeBase64Body(params.rawSource)
  if (decoded) return extractEdifactPayloadFromText(decoded, params.subject)
  return extractEdifactPayloadFromText(params.rawSource, params.subject)
}

export function normalizeInboundSubject(rawSource: string, envelopeSubject?: string | null): string | null {
  const headerSubject = extractHeaderValue(rawSource, 'Subject')
  const value = envelopeSubject ?? headerSubject ?? null
  return value?.replace(/\s+/g, ' ').trim() || null
}

export function isEdielPortalValidationReport(params: { rawSource: string; subject?: string | null }): boolean {
  const subject = params.subject?.toLowerCase() ?? ''
  const raw = params.rawSource.toLowerCase()

  return (
    subject.includes('valideringsrapport') ||
    raw.includes('valideringsrapport') ||
    raw.includes('valideringsfel') ||
    raw.includes('valideringsrapport för inbäddat meddelande') ||
    raw.includes('could not find addressing details for sender') ||
    raw.includes('okänd e-postadress till avsändare')
  )
}

export function looksLikeCompleteEdifactInterchange(value: string): boolean {
  const text = value.trim().toUpperCase()
  return text.includes('UNB+') && text.includes("UNZ+") && /UNZ\+[^']*'/i.test(value)
}

export function splitEdifactSegmentsLoose(rawPayload: string): string[] {
  return rawPayload
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function inferAperakOutcomeFromPayload(rawPayload: string): 'positive' | 'negative' {
  const segments = splitEdifactSegmentsLoose(rawPayload)

  const erc = segments.find((segment) => segment.toUpperCase().startsWith('ERC+')) ?? null
  const ftxAao = segments.find((segment) => segment.toUpperCase().startsWith('FTX+AAO')) ?? null

  const ercCode = erc?.split('+')[1]?.split(':')[0]?.trim() ?? null
  const freeText = ftxAao?.toUpperCase() ?? ''

  // Edielportalens positiva APERAK i PRODAT-flödet använder ERC+100::260 och FTX+AAO+++OK.
  // Viktigt: sök aldrig efter "12" i hela payloaden. UNT+12+1 betyder bara antal segment.
  if (ercCode === '100' && freeText.includes('OK')) {
    return 'positive'
  }

  if (ercCode && ercCode !== '100') {
    return 'negative'
  }

  if (/\b(REJECT|REJECTED|ERROR|FAILED|NEGATIVE|AVVISAD|FEL)\b/i.test(rawPayload)) {
    return 'negative'
  }

  return 'positive'
}

export function inferContrlOutcomeFromPayload(rawPayload: string): 'positive' | 'negative' {
  const segments = splitEdifactSegmentsLoose(rawPayload)
  const uci = segments.find((segment) => segment.toUpperCase().startsWith('UCI+')) ?? null

  if (uci) {
    const uciParts = uci.split('+')
    const actionCode = uciParts[4]?.trim()
    if (actionCode && actionCode !== '1') return 'negative'
    return 'positive'
  }

  if (/\b(REJECT|REJECTED|ERROR|FAILED|NEGATIVE|AVVISAD|FEL)\b/i.test(rawPayload)) {
    return 'negative'
  }

  return 'positive'
}

export function inferAckOutcomeFromPayload(params: {
  family: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  rawPayload: string
}): 'positive' | 'negative' {
  if (params.family === 'APERAK') {
    return inferAperakOutcomeFromPayload(params.rawPayload)
  }

  if (params.family === 'CONTRL') {
    return inferContrlOutcomeFromPayload(params.rawPayload)
  }

  if (/\b(REJECT|REJECTED|ERROR|FAILED|NEGATIVE|AVVISAD|FEL)\b/i.test(params.rawPayload)) {
    return 'negative'
  }

  return 'positive'
}

export function parseEdifactEnvelope(rawPayload: string, fallbackFamily: string, fallbackCode: string): ParsedInboundEnvelope {
  const segments = splitEdifactSegmentsLoose(rawPayload)
  const unb = segments.find((segment) => segment.toUpperCase().startsWith('UNB+')) ?? null
  const unh = segments.find((segment) => segment.toUpperCase().startsWith('UNH+')) ?? null
  const bgm = segments.find((segment) => segment.toUpperCase().startsWith('BGM+')) ?? null
  const uci = segments.find((segment) => segment.toUpperCase().startsWith('UCI+')) ?? null
  const rffSegments = segments.filter((segment) => segment.toUpperCase().startsWith('RFF+'))

  const envelope = EdifactEnvelopeCodec.decode(rawPayload)
  const unhMessage = unh?.split('+')[2] ?? null
  const unhParts = unhMessage?.split(':') ?? []
  const bgmParts = bgm?.split('+') ?? []
  const uciParts = uci?.split('+') ?? []

  function ref(qualifier: string): string | null {
    const prefix = 'RFF+' + qualifier.toUpperCase() + ':'
    const hit = rffSegments.find((segment) => segment.toUpperCase().startsWith(prefix))
    return hit?.split('+')[1]?.split(':').slice(1).join(':')?.trim() || null
  }

  const family = unhParts[0]?.trim() || fallbackFamily
  const originalInterchangeReference = uciParts[1]?.trim() || null
  const bgmReference = bgmParts[2]?.trim() || null
  const acwReference = ref('ACW')
  const lineItemReference = ref('LI')
  const transactionReference = ref('TN') || ref('CR') || ref('AAS')

  const isAckFamily = family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR'
  const externalReference = isAckFamily
    ? originalInterchangeReference || acwReference || bgmReference || ref('ACE') || null
    : bgmReference || ref('ACE') || acwReference || originalInterchangeReference || null
  const canonicalTransactionReference = isAckFamily
    ? originalInterchangeReference || acwReference || transactionReference || lineItemReference || null
    : lineItemReference || transactionReference || acwReference || originalInterchangeReference || null

  return {
    family,
    code:
      isAckFamily
        ? family
        : bgmParts[1]?.split(':')[0]?.trim() || fallbackCode,
    messageVersion: unhMessage,
    senderEdielId: envelope.sender,
    senderSubAddress: envelope.senderSubAddress,
    receiverEdielId: envelope.receiver,
    receiverSubAddress: envelope.receiverSubAddress,
    interchangeReference: envelope.interchangeReference,
    applicationReference: envelope.applicationReference,
    externalReference,
    transactionReference: canonicalTransactionReference,
    parsedPayload: {
      rawSegments: segments,
      segmentCount: segments.length,
      unb,
      unh,
      envelopeEnvironment: envelope.environment,
      testIndicator: envelope.testIndicator,
      bgm,
      uci,
      rff: rffSegments,
      bgmReference,
      documentReference: bgmReference,
      originalInterchangeReference,
      acwReference,
      lineItemReference,
    },
  }
}

export async function findRelatedOutboundForInboundAck(params: {
  senderEdielId: string | null
  receiverEdielId: string | null
  applicationReference: string | null
  transactionReference: string | null
  externalReference: string | null
}): Promise<EdielMessageRow | null> {
  const exactRefs = [params.transactionReference, params.externalReference]
    .filter((value): value is string => Boolean(value && value.trim()))

  for (const ref of exactRefs) {
    const { data, error } = await supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('direction', 'outbound')
      .or('interchange_reference.eq.' + ref + ',transaction_reference.eq.' + ref + ',external_reference.eq.' + ref + ',correlation_reference.eq.' + ref)
      .order('message_sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data) return data as EdielMessageRow
  }

  if (params.applicationReference?.trim()) {
    let applicationReferenceQuery = supabaseService
      .from('ediel_messages')
      .select('*')
      .eq('direction', 'outbound')
      .eq('application_reference', params.applicationReference.trim())
      .in('status', ['draft', 'prepared', 'queued', 'sent', 'acknowledged'])

    if (params.receiverEdielId) applicationReferenceQuery = applicationReferenceQuery.eq('sender_ediel_id', params.receiverEdielId)
    if (params.senderEdielId) applicationReferenceQuery = applicationReferenceQuery.eq('receiver_ediel_id', params.senderEdielId)

    const { data, error } = await applicationReferenceQuery
      .order('message_sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (data) return data as EdielMessageRow
  }

  let query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'outbound')
    .in('status', ['draft', 'prepared', 'queued', 'sent', 'acknowledged'])

  if (params.receiverEdielId) query = query.eq('sender_ediel_id', params.receiverEdielId)
  if (params.senderEdielId) query = query.eq('receiver_ediel_id', params.senderEdielId)

  const { data, error } = await query
    .order('message_sent_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return (data as EdielMessageRow | null) ?? null
}

export function assertTransportFamily(messageFamily: string | null | undefined, context: string) {
  if (!isActiveEdielMessageFamily(messageFamily)) {
    throw new Error(
      `${context}: message family ${messageFamily ?? 'null'} ligger utanför aktiv release (${ACTIVE_EDIEL_MESSAGE_FAMILIES.join(', ')})`
    )
  }
}

export function inferAttachmentExtension(message: EdielMessageRow): 'edi' | 'csv' | 'xml' {
  if (message.message_standard === 'ai_list') return 'csv'
  if (message.message_standard === 'xml') return 'xml'
  return 'edi'
}

export function inferMimeType(message: EdielMessageRow): string {
  if (message.mime_type?.trim()) return message.mime_type
  if (message.message_standard === 'ai_list') return 'text/csv; charset=utf-8'
  if (message.message_standard === 'xml') return 'application/xml; charset=utf-8'
  return 'application/edifact'
}

export function inferBodyText(message: EdielMessageRow): string {
  if (typeof message.raw_payload === 'string' && message.raw_payload.length > 0) {
    return message.raw_payload
  }

  if (message.message_standard === 'ai_list') {
    return 'AI-list payload missing'
  }

  return ''
}
