import { execFile } from 'child_process'
import forge from 'node-forge'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { formatErrorMessage } from '@/lib/errors'
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

function extractBase64PayloadFromSmimeMime(rawEmail: string): string | null {
  const blocks: string[] = []
  const pkcs7Regex = /content-type:\s*application\/(?:x-)?pkcs7-mime[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)(?=\r?\n--|$)/gi
  let match: RegExpExecArray | null
  while ((match = pkcs7Regex.exec(rawEmail)) !== null) {
    if (match[1]) blocks.push(match[1])
  }

  if (blocks.length === 0) {
    const firstBlank = rawEmail.search(/\r?\n\r?\n/)
    if (firstBlank >= 0 && looksLikeSmimeMessage(rawEmail.slice(0, firstBlank))) {
      blocks.push(rawEmail.slice(firstBlank).trim())
    }
  }

  for (const block of blocks) {
    const compact = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('--') && !line.includes(':'))
      .join('')
    if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > 32) return compact
  }

  return null
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
  rawEmail: string
  environment?: string | null
  companyId?: string | null
}): Promise<InboundSmimeUnpackResult | null> {
  const base64Payload = extractBase64PayloadFromSmimeMime(input.rawEmail)
  if (!base64Payload) return null

  const der = Buffer.from(base64Payload, 'base64')
  const loaded = await loadInboundPrivateCertificates({
    environment: input.environment,
    companyId: input.companyId,
  })
  const errors: string[] = []

  for (const profile of loaded.profiles) {
    try {
      const decrypted = decryptPkcs7WithProfile(der, profile)
      return {
        detected: true,
        decryptedText: decrypted.text,
        encryptedPayloadRef: `inbound-smime://${sha256(input.rawEmail).slice(0, 32)}`,
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
    encryptedPayloadRef: `inbound-smime://${sha256(input.rawEmail).slice(0, 32)}`,
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

  const storeDecrypt = await decryptSmimeWithPrivateStore({
    rawEmail,
    environment: input.environment,
    companyId: input.companyId,
  })
  if (storeDecrypt?.securityStatus === 'decrypted') return storeDecrypt

  const certPath = process.env.EDIEL_SMIME_DECRYPT_CERT_PATH ?? process.env.EDIEL_SMIME_RECIPIENT_CERT_PATH
  const keyPath = process.env.EDIEL_SMIME_DECRYPT_KEY_PATH ?? process.env.EDIEL_SMIME_PRIVATE_KEY_PATH
  const keyPassword = process.env.EDIEL_SMIME_PRIVATE_KEY_PASSWORD ?? null

  if (!certPath || !keyPath) {
    return storeDecrypt ?? {
      detected: true,
      decryptedText: null,
      encryptedPayloadRef,
      securityStatus: 'decrypt_failed',
      validationError: 'S/MIME upptäcktes men varken DB/env-PFX eller decrypt-certifikat/privat nyckel finns konfigurerat.',
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-inbound-smime-'))
  const inputPath = join(tempDir, 'message.eml')
  const outputPath = join(tempDir, 'decrypted.mime')

  try {
    await writeFile(inputPath, rawEmail, 'utf8')
    const args = [
      'smime',
      '-decrypt',
      '-in',
      inputPath,
      '-recip',
      certPath,
      '-inkey',
      keyPath,
      '-out',
      outputPath,
    ]
    if (keyPassword) {
      args.push('-passin', `env:EDIEL_SMIME_PRIVATE_KEY_PASSWORD`)
    }

    await execFileAsync('openssl', args)
    const decrypted = await readFile(outputPath, 'utf8')
    return {
      detected: true,
      decryptedText: decrypted,
      encryptedPayloadRef,
      securityStatus: 'decrypted',
      validationError: null,
      evidence: {
        decryptMethod: 'openssl_fallback',
        dbAttempt: storeDecrypt?.evidence ?? null,
      },
    }
  } catch (error) {
    return {
      detected: true,
      decryptedText: null,
      encryptedPayloadRef,
      securityStatus: 'decrypt_failed',
      validationError: [
        storeDecrypt?.validationError,
        formatErrorMessage(error, 'S/MIME-dekryptering misslyckades.'),
      ].filter(Boolean).join(' | '),
      evidence: {
        decryptMethod: 'openssl_fallback_failed',
        dbAttempt: storeDecrypt?.evidence ?? null,
      },
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
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
  if (!input.publicCertificatePem.includes('BEGIN CERTIFICATE')) {
    throw new Error('Publikt S/MIME-certifikat saknas eller är ogiltigt.')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-test-smime-'))
  const inputPath = join(tempDir, 'inner.mime')
  const outputPath = join(tempDir, 'smime.der')
  const certPath = join(tempDir, 'recipient.pem')
  const filename = input.filename?.replace(/[^A-Za-z0-9._-]/g, '_') || 'ediel-test.edi'

  try {
    const payloadBase64 = encodeBase64Mime(Buffer.from(input.rawEdifact, 'latin1'))
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
