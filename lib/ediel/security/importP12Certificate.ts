import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export type ImportedP12CertificateMetadata = {
  fingerprintSha256: string
  subject: string | null
  issuer: string | null
  serialNumber: string | null
  validFrom: string | null
  validTo: string | null
  publicCertificatePem: string | null
  p12SecretReference: string
  privateKeySecretReference: string
  p12Alias: string | null
}

function cleanLine(value: string | undefined, prefix: string): string | null {
  if (!value?.startsWith(prefix)) return null
  const text = value.slice(prefix.length).trim()
  return text.length > 0 ? text : null
}

function parseOpenSslDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeFingerprint(value: string | null): string {
  const normalized = String(value ?? '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase()
  if (normalized.length !== 64) {
    throw new Error('Kunde inte läsa SHA-256 fingerprint från P12-certifikatet.')
  }
  return normalized
}

function secretReferenceForFingerprint(fingerprint: string, kind: 'p12' | 'private-key'): string {
  return `secret://ediel-certificates/${fingerprint}/${kind}`
}

function publicCertificateSecretReference(fingerprint: string): string {
  return `secret://ediel-certificates/${fingerprint}/public-certificate`
}

async function parsePublicCertificatePem(input: {
  publicCertificatePem: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  if (!input.publicCertificatePem.includes('BEGIN CERTIFICATE')) {
    throw new Error('Inklistrat certifikat måste innehålla BEGIN CERTIFICATE eller vara base64-kodad .p12/.pfx.')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-public-cert-'))
  const certPath = join(tempDir, 'certificate.pem')

  try {
    await writeFile(certPath, input.publicCertificatePem, { mode: 0o600 })
    const x509 = await execFileAsync('openssl', [
      'x509',
      '-in',
      certPath,
      '-noout',
      '-subject',
      '-issuer',
      '-serial',
      '-fingerprint',
      '-sha256',
      '-startdate',
      '-enddate',
    ])

    const lines = x509.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const fingerprint = normalizeFingerprint(cleanLine(lines.find((line) => line.startsWith('sha256 Fingerprint=')) ?? lines.find((line) => line.startsWith('SHA256 Fingerprint=')), 'sha256 Fingerprint=') ?? cleanLine(lines.find((line) => line.startsWith('SHA256 Fingerprint=')), 'SHA256 Fingerprint='))

    return {
      fingerprintSha256: fingerprint,
      subject: cleanLine(lines.find((line) => line.startsWith('subject=')), 'subject='),
      issuer: cleanLine(lines.find((line) => line.startsWith('issuer=')), 'issuer='),
      serialNumber: cleanLine(lines.find((line) => line.startsWith('serial=')), 'serial='),
      validFrom: parseOpenSslDate(cleanLine(lines.find((line) => line.startsWith('notBefore=')), 'notBefore=')),
      validTo: parseOpenSslDate(cleanLine(lines.find((line) => line.startsWith('notAfter=')), 'notAfter=')),
      publicCertificatePem: input.publicCertificatePem,
      p12SecretReference: publicCertificateSecretReference(fingerprint),
      privateKeySecretReference: '',
      p12Alias: input.displayName?.trim() || null,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function importPublicCertificatePem(input: {
  publicCertificatePem: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  return parsePublicCertificatePem(input)
}

export async function importP12Certificate(input: {
  p12Bytes: Buffer
  password: string
  displayName?: string | null
}): Promise<ImportedP12CertificateMetadata> {
  if (input.p12Bytes.length === 0) {
    throw new Error('P12-filen är tom.')
  }
  if (!input.password) {
    throw new Error('PIN/lösenord krävs för att validera P12-certifikatet.')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'gridex-ediel-p12-'))
  const p12Path = join(tempDir, 'certificate.p12')
  const passwordPath = join(tempDir, 'pin.txt')
  const certPath = join(tempDir, 'certificate.pem')

  try {
    await writeFile(p12Path, input.p12Bytes, { mode: 0o600 })
    await writeFile(passwordPath, input.password, { mode: 0o600 })

    let publicCertificatePem: string
    try {
      const extracted = await execFileAsync('openssl', [
        'pkcs12',
        '-in',
        p12Path,
        '-clcerts',
        '-nokeys',
        '-passin',
        `file:${passwordPath}`,
      ])
      publicCertificatePem = extracted.stdout
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`P12-certifikatet kunde inte öppnas med angiven PIN. ${detail}`)
    }

    if (!publicCertificatePem.includes('BEGIN CERTIFICATE')) {
      throw new Error('P12-filen innehåller inget publikt certifikat.')
    }

    await writeFile(certPath, publicCertificatePem, { mode: 0o600 })

    const x509 = await execFileAsync('openssl', [
      'x509',
      '-in',
      certPath,
      '-noout',
      '-subject',
      '-issuer',
      '-serial',
      '-fingerprint',
      '-sha256',
      '-startdate',
      '-enddate',
    ])

    const lines = x509.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const fingerprint = normalizeFingerprint(cleanLine(lines.find((line) => line.startsWith('sha256 Fingerprint=')) ?? lines.find((line) => line.startsWith('SHA256 Fingerprint=')), 'sha256 Fingerprint=') ?? cleanLine(lines.find((line) => line.startsWith('SHA256 Fingerprint=')), 'SHA256 Fingerprint='))

    return {
      fingerprintSha256: fingerprint,
      subject: cleanLine(lines.find((line) => line.startsWith('subject=')), 'subject='),
      issuer: cleanLine(lines.find((line) => line.startsWith('issuer=')), 'issuer='),
      serialNumber: cleanLine(lines.find((line) => line.startsWith('serial=')), 'serial='),
      validFrom: parseOpenSslDate(cleanLine(lines.find((line) => line.startsWith('notBefore=')), 'notBefore=')),
      validTo: parseOpenSslDate(cleanLine(lines.find((line) => line.startsWith('notAfter=')), 'notAfter=')),
      publicCertificatePem,
      p12SecretReference: secretReferenceForFingerprint(fingerprint, 'p12'),
      privateKeySecretReference: secretReferenceForFingerprint(fingerprint, 'private-key'),
      p12Alias: input.displayName?.trim() || null,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
