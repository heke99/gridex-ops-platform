import { importP12Certificate, type ImportedP12CertificateMetadata } from '@/lib/ediel/security/importP12Certificate'

export type EnvP12ValidationResult = ImportedP12CertificateMetadata & {
  p12SecretReference: string
  passwordSecretReference: string
  privateKeyPresent: boolean
  validatedAt: string
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function envNameFromReference(reference: string, label: string): string {
  const trimmed = reference.trim()
  if (!trimmed.startsWith('env:')) {
    throw new Error(`${label} måste börja med env:.`)
  }
  const envName = trimmed.slice(4).trim()
  if (!/^[A-Z0-9_]+$/.test(envName)) {
    throw new Error(`${label} har ogiltigt env-namn.`)
  }
  return envName
}

function readEnvReference(reference: string, label: string): string {
  const envName = envNameFromReference(reference, label)
  const value = clean(process.env[envName])
  if (!value) {
    throw new Error(`${label} pekar på ${envName}, men env-värdet finns inte i runtime. Lägg in variabeln i Vercel Production och redeploya.`)
  }
  return value
}

function base64ToBuffer(value: string): Buffer {
  const compact = value
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const buffer = Buffer.from(compact, 'base64')
  if (buffer.length === 0) throw new Error('P12-env innehåller ingen base64-data.')
  return buffer
}

export async function validateP12FromEnvReferences(input: {
  p12SecretReference: string
  passwordSecretReference: string
  displayName?: string | null
}): Promise<EnvP12ValidationResult> {
  const p12Base64 = readEnvReference(input.p12SecretReference, 'P12 secret reference')
  const password = readEnvReference(input.passwordSecretReference, 'Password secret reference')
  const metadata = await importP12Certificate({
    p12Bytes: base64ToBuffer(p12Base64),
    password,
    displayName: input.displayName,
  })

  return {
    ...metadata,
    p12SecretReference: input.p12SecretReference,
    passwordSecretReference: input.passwordSecretReference,
    privateKeyPresent: Boolean(metadata.privateKeySecretReference),
    validatedAt: new Date().toISOString(),
  }
}
