import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { formatErrorMessage } from '@/lib/errors'

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

export async function unpackInboundSmimeIfNeeded(input: {
  rawEmail: string | null
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

  const certPath = process.env.EDIEL_SMIME_DECRYPT_CERT_PATH ?? process.env.EDIEL_SMIME_RECIPIENT_CERT_PATH
  const keyPath = process.env.EDIEL_SMIME_DECRYPT_KEY_PATH ?? process.env.EDIEL_SMIME_PRIVATE_KEY_PATH
  const keyPassword = process.env.EDIEL_SMIME_PRIVATE_KEY_PASSWORD ?? null
  const encryptedPayloadRef = `inbound-smime://${sha256(rawEmail).slice(0, 32)}`

  if (!certPath || !keyPath) {
    return {
      detected: true,
      decryptedText: null,
      encryptedPayloadRef,
      securityStatus: 'decrypt_failed',
      validationError: 'S/MIME upptäcktes men decrypt-certifikat eller privat nyckel saknas i miljön.',
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
    }
  } catch (error) {
    return {
      detected: true,
      decryptedText: null,
      encryptedPayloadRef,
      securityStatus: 'decrypt_failed',
      validationError: formatErrorMessage(error, 'S/MIME-dekryptering misslyckades.'),
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

    const encrypted = await readFile(outputPath)
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
