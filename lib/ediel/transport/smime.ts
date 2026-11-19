import { execFile } from 'child_process'
import forge from 'node-forge'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { formatErrorMessage } from '@/lib/errors'
import { encodeEdifactUnoc } from '@/lib/ediel/core/edifactEncoding'
import { inspectMimeStructure, mimeParameter, type MimeEntity } from '@/lib/inbound-mail/mimeStructure'
import { loadInboundPrivateCertificates, type InboundPrivateCertificateProfile } from '@/lib/ediel/security/privateCertificateStore'

const execFileAsync = promisify(execFile)

export type SmimeCertificateProfile = {
  certificateFingerprint: string
  certificateValidFrom: string | null
  certificateValidTo: string | null
  secretReference: string
  encryptionStatus: 'valid' | 'expired' | 'missing' | 'revoked' | 'unknown'
  lastValidationAt: string | null
}

export function assertSmimeProfileUsable(profile: SmimeCertificateProfile): void {
  if (!profile.secretReference) throw new Error('S/MIME secret_reference saknas.')
  if (profile.encryptionStatus !== 'valid') throw new Error(`S/MIME certifikat är inte giltigt: ${profile.encryptionStatus}.`)
}

export type InboundSmimeUnpackResult = {
  detected: boolean
  decryptedText: string | null
  encryptedPayloadRef: string | null
  securityStatus: 'not_encrypted' | 'decrypted' | 'decrypt_failed'
  validationError: string | null
  matchedCertificateId?: string | null
  matchedCompanyId?: string | null
  matchedOwnerEdielId?: string | null
  matchedOwnerSubaddress?: string | null
  recipientFingerprint?: string | null
  recipientSerialNumber?: string | null
  evidence?: Record<string, unknown>
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function looksLikeSmimeMessage(rawEmail: string | null | undefined): boolean {
  const text = String(rawEmail ?? '').toLowerCase()
  return (
    text.includes('application/pkcs7-mime') ||
    text.includes('application/x-pkcs7-mime') ||
    text.includes('smime-type=enveloped-data') ||
    text.includes('smime.p7m')
  )
}

const MIME_SELECTION_ERROR = {
  missing: 'S/MIME upptäcktes men den krypterade MIME-delen saknas.',
  ambiguous: 'S/MIME innehåller flera möjliga krypterade MIME-delar.',
  invalid: 'S/MIME upptäcktes men den krypterade MIME-delen kunde inte läsas.',
} as const

type SmimeMimeSelection = { der: Buffer } | { failure: keyof typeof MIME_SELECTION_ERROR; issues: string[] }

function belongsToOriginal(entity: MimeEntity, entities: readonly MimeEntity[]): boolean {
  // A forwarded message has its own source envelope, even inside a multipart.
  for (let parent = entity.parent; parent !== null; parent = entities[parent].parent) {
    if (!entities[parent].mediaType.startsWith('multipart/')) return false
  }
  return true
}

function isEncryptedMimePart(entity: MimeEntity): boolean {
  if (entity.mediaType === 'application/pkcs7-mime' || entity.mediaType === 'application/x-pkcs7-mime') return true
  if (entity.mediaType !== 'application/octet-stream') return false

  const name = mimeParameter(entity.contentType, 'name')
  const dispositions = entity.headers.get('content-disposition') ?? []
  return name?.toLowerCase() === 'smime.p7m' ||
    dispositions.some(disposition => mimeParameter(disposition, 'filename')?.toLowerCase() === 'smime.p7m')
}

function selectEncryptedMimePart(rawEmail: string): SmimeMimeSelection {
  const { entities, issues, exceededLimits } = inspectMimeStructure(rawEmail, { preserveBytes: true })
  if (exceededLimits || issues.length > 0) return { failure: 'invalid', issues }

  const candidates = entities.filter(entity => isEncryptedMimePart(entity) && belongsToOriginal(entity, entities))
  if (candidates.length !== 1) return { failure: candidates.length === 0 ? 'missing' : 'ambiguous', issues }
  const [part] = candidates
  if ((part.headers.get('content-disposition')?.length ?? 0) > 1) return { failure: 'invalid', issues }

  const encoding = part.headers.get('content-transfer-encoding')?.[0]?.toLowerCase()
  if (encoding === 'base64' && part.body.length > 0) return { der: Buffer.from(part.body, 'latin1') }
  if (encoding === undefined || encoding === '7bit' || encoding === '8bit' || encoding === 'binary') {
    // Older inputs can carry textual base64 without a base64 transfer label.
    const compact = part.body.replace(/[ \t\r\n]/g, '')
    if (compact.length > 32 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      return { der: Buffer.from(compact, 'base64') }
    }
  }
  return { failure: 'invalid', issues }
}

function readPkcs7Content(content: unknown): Buffer | null {
  if (!content) return null
  if (typeof content === 'string') return Buffer.from(content, 'binary')
  const maybe = content as { data?: unknown; getBytes?: () => string }
  if (typeof maybe.getBytes === 'function') return Buffer.from(maybe.getBytes(), 'binary')
  if (typeof maybe.data === 'string') return Buffer.from(maybe.data, 'binary')
  return null
}

function recipientSerial(recipient: unknown): string | null {
  const record = recipient && typeof recipient === 'object' ? recipient as Record<string, unknown> : {}
  const serial = record.serialNumber ?? record.serial
  return typeof serial === 'string' && serial.trim() ? serial.trim().toUpperCase() : null
}

function recipientMatchesProfile(recipient: unknown, profile: InboundPrivateCertificateProfile): boolean {
  const serial = recipientSerial(recipient)
  if (!serial || !profile.serialNumber) return false
  return serial.replace(/^0+/, '') === profile.serialNumber.replace(/^0+/, '')
}

function decryptPkcs7WithProfile(der: Buffer, profile: InboundPrivateCertificateProfile): { text: string; recipientSerialNumber: string | null } {
  const asn1 = forge.asn1.fromDer(der.toString('binary'))
  const p7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
    recipients?: unknown[]
    findRecipient?: (cert: forge.pki.Certificate) => unknown
    decrypt?: (recipient: unknown, privateKey: forge.pki.PrivateKey) => void
    content?: unknown
  }

  const recipient =
    (typeof p7.findRecipient === 'function' ? p7.findRecipient(profile.certificate) : null) ??
    (p7.recipients ?? []).find((candidate) => recipientMatchesProfile(candidate, profile)) ??
    null

  if (!recipient) throw new Error('CMS recipientInfo matchade inte certifikatet.')
  if (typeof p7.decrypt !== 'function') throw new Error('PKCS#7-dekryptering stöds inte av runtime-biblioteket.')

  p7.decrypt(recipient, profile.privateKey)
  const content = readPkcs7Content(p7.content)
  if (!content) throw new Error('S/MIME dekrypterades men innehållet kunde inte läsas.')
  const utf8 = content.toString('utf8')
  const latin1 = content.toString('latin1')
  return {
    text: utf8.includes('UNB+') || utf8.includes('Content-Type:') ? utf8 : latin1,
    recipientSerialNumber: recipientSerial(recipient),
  }
}

async function decryptSmimeWithPrivateStore(input: {
  der: Buffer
  encryptedPayloadRef: string
  environment?: string | null
  companyId?: string | null
}): Promise<InboundSmimeUnpackResult> {
  const loaded = await loadInboundPrivateCertificates({
    environment: input.environment,
    companyId: input.companyId,
  })
  const errors: string[] = []

  for (const profile of loaded.profiles) {
    try {
      const decrypted = decryptPkcs7WithProfile(input.der, profile)
      return {
        detected: true,
        decryptedText: decrypted.text,
        encryptedPayloadRef: input.encryptedPayloadRef,
        securityStatus: 'decrypted',
        validationError: null,
        matchedCertificateId: profile.id,
        matchedCompanyId: profile.companyId,
        matchedOwnerEdielId: profile.ownerEdielId,
        matchedOwnerSubaddress: profile.ownerSubaddress,
        recipientFingerprint: profile.fingerprintSha256,
        recipientSerialNumber: decrypted.recipientSerialNumber ?? profile.serialNumber,
        evidence: {
          decryptMethod: 'node_forge_pkcs7',
          certificateSource: profile.source,
          certificateSourceReference: profile.sourceReference,
          certificateWarnings: profile.warnings,
          loadWarnings: loaded.warnings,
        },
      }
    } catch (error) {
      errors.push(`${profile.displayName ?? profile.id ?? profile.fingerprintSha256 ?? 'cert'}: ${formatErrorMessage(error, 'Dekryptering misslyckades.')}`)
    }
  }

  return {
    detected: true,
    decryptedText: null,
    encryptedPayloadRef: input.encryptedPayloadRef,
    securityStatus: 'decrypt_failed',
    validationError: [
      loaded.profiles.length === 0
        ? 'S/MIME upptäcktes men inget läsbart privat PFX-certifikat finns för miljön/bolaget.'
        : 'S/MIME upptäcktes men inget privat certifikat kunde dekryptera CMS recipientInfo.',
      ...loaded.warnings,
      ...errors,
    ].filter(Boolean).join(' | '),
    evidence: {
      decryptMethod: 'node_forge_pkcs7',
      privateCertificateProfiles: loaded.profiles.length,
      loadWarnings: loaded.warnings,
      errors,
    },
  }
}

export async function unpackInboundSmimeIfNeeded(input: {
  rawEmail: string | null
  environment?: string | null
  companyId?: string | null
}): Promise<InboundSmimeUnpackResult> {
  const rawEmail = input.rawEmail ?? ''
  if (!looksLikeSmimeMessage(rawEmail)) {
    return {
      detected: false,
      decryptedText: null,
      encryptedPayloadRef: null,
      securityStatus: 'not_encrypted',
      validationError: null,
    }
  }

  const encryptedPayloadRef = `inbound-smime://${sha256(rawEmail).slice(0, 32)}`

  const selection = selectEncryptedMimePart(rawEmail)
  if ('der' in selection) {
    return decryptSmimeWithPrivateStore({
      der: selection.der,
      encryptedPayloadRef,
      environment: input.environment,
      companyId: input.companyId,
    })
  }

  return {
    detected: true,
    decryptedText: null,
    encryptedPayloadRef,
    securityStatus: 'decrypt_failed',
    validationError: MIME_SELECTION_ERROR[selection.failure],
    evidence: {
      decryptMethod: 'node_forge_pkcs7_required',
      dbAttempt: null,
      dbValidationError: null,
      mimeSelection: selection.failure,
      mimeIssues: selection.issues,
    },
  }
}

function encodeBase64Mime(buffer: Buffer, lineLength = 76): string {
  const encoded = buffer.toString('base64')
  const chunks: string[] = []
  for (let index = 0; index < encoded.length; index += lineLength) {
    chunks.push(encoded.slice(index, index + lineLength))
  }
  return chunks.join('\r\n')
}

function encryptSmimeEnvelopedDataWithForge(params: {
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

export async function createSmimeEncryptedPayloadReference(input: {
  rawEdifact: string
  publicCertificatePem: string
  filename?: string | null
}): Promise<{
  encryptedPayloadRef: string
  encryptedPayloadSha256: string
  encryptedPayloadLength: number
}> {
  const payloadBytes = encodeEdifactUnoc(input.rawEdifact)
  if (!input.publicCertificatePem.includes('BEGIN CERTIFICATE')) {
    throw new Error('Publikt S/MIME-certifikat saknas eller är ogiltigt.')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-test-smime-'))
  const inputPath = join(tempDir, 'inner.mime')
  const outputPath = join(tempDir, 'smime.der')
  const certPath = join(tempDir, 'recipient.pem')
  const filename = input.filename?.replace(/[^A-Za-z0-9._-]/g, '_') || 'ediel-test.edi'

  try {
    const payloadBase64 = encodeBase64Mime(payloadBytes)
    const innerMime = [
      'Content-Type: application/EDIFACT',
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename=${filename}`,
      '',
      payloadBase64,
      '',
    ].join('\r\n')

    await writeFile(inputPath, innerMime, 'ascii')
    await writeFile(certPath, input.publicCertificatePem, 'utf8')
    let encrypted: Buffer
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
      encrypted = await readFile(outputPath)
    } catch {
      encrypted = encryptSmimeEnvelopedDataWithForge({
        innerMime: Buffer.from(innerMime, 'ascii'),
        recipientCertificatePem: input.publicCertificatePem,
      })
    }

    const digest = sha256(encrypted)
    return {
      encryptedPayloadRef: `test-center-smime://${digest.slice(0, 32)}`,
      encryptedPayloadSha256: digest,
      encryptedPayloadLength: encrypted.length,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
