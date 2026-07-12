import forge from 'node-forge'
import { supabaseService } from '@/lib/supabase/service'
import { formatErrorMessage } from '@/lib/errors'

type CertificateRow = Record<string, unknown>

export type InboundPrivateCertificateProfile = {
  id: string | null
  companyId: string | null
  environment: string | null
  ownerEdielId: string | null
  ownerSubaddress: string | null
  displayName: string | null
  fingerprintSha256: string | null
  serialNumber: string | null
  issuer: string | null
  subject: string | null
  certificate: forge.pki.Certificate
  privateKey: forge.pki.PrivateKey
  source: 'database_secret_reference' | 'env_fallback'
  sourceReference: string | null
  warnings: string[]
}

export type PrivateCertificateLoadResult = {
  profiles: InboundPrivateCertificateProfile[]
  warnings: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function upper(value: unknown): string | null {
  const normalized = clean(value)?.toUpperCase() ?? null
  return normalized && normalized.length > 0 ? normalized : null
}

function metadata(row: CertificateRow): Record<string, unknown> {
  const value = row.metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function metadataText(row: CertificateRow, ...keys: string[]): string | null {
  const meta = metadata(row)
  for (const key of keys) {
    const value = clean(meta[key])
    if (value) return value
  }
  return null
}

function resolveSecretReference(reference: string | null | undefined): string | null {
  const ref = clean(reference)
  if (!ref) return null

  if (ref.startsWith('env:')) {
    return process.env[ref.slice(4)] ?? null
  }

  // Vercel/production friendly: allow the actual env name to be stored directly.
  const direct = process.env[ref]
  if (direct) return direct

  // Do not pretend secret:// references are readable in-process. They need a real secret-manager adapter.
  return null
}

function maybeBase64ToBuffer(value: string | null): Buffer | null {
  if (!value) return null
  const compact = value
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!compact) return null
  const buffer = Buffer.from(compact, 'base64')
  return buffer.length > 0 ? buffer : null
}

function distinguishedName(attributes: forge.pki.CertificateField[]): string | null {
  const text = attributes
    .map((attribute) => {
      const key = attribute.shortName ?? attribute.name ?? attribute.type ?? 'attr'
      const value = typeof attribute.value === 'string' ? attribute.value.trim() : String(attribute.value ?? '').trim()
      return value ? `${key}=${value}` : null
    })
    .filter((value): value is string => Boolean(value))
    .join(', ')
  return text || null
}

function fingerprintSha256(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  const md = forge.md.sha256.create()
  md.update(der)
  return md.digest().toHex().toUpperCase()
}

function certificateFromP12(input: {
  p12Bytes: Buffer
  password: string
}): { certificate: forge.pki.Certificate; privateKey: forge.pki.PrivateKey } {
  const p12Der = input.p12Bytes.toString('binary')
  const p12Asn1 = forge.asn1.fromDer(p12Der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, input.password)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const certificate = certBags.find((bag) => bag.cert)?.cert
  const privateKey = keyBags.find((bag) => bag.key)?.key
  if (!certificate) throw new Error('PFX/P12 saknar publikt certifikat.')
  if (!privateKey) throw new Error('PFX/P12 saknar privat nyckel.')
  return { certificate, privateKey }
}

function profileFromP12(params: {
  p12Bytes: Buffer
  password: string
  row?: CertificateRow | null
  source: InboundPrivateCertificateProfile['source']
  sourceReference: string | null
  warnings?: string[]
}): InboundPrivateCertificateProfile {
  const { certificate, privateKey } = certificateFromP12({
    p12Bytes: params.p12Bytes,
    password: params.password,
  })
  const row = params.row ?? {}
  const fingerprint = upper(row.fingerprint_sha256) ?? upper(row.certificate_fingerprint) ?? fingerprintSha256(certificate)
  return {
    id: clean(row.id),
    companyId: clean(row.company_id),
    environment: clean(row.environment),
    ownerEdielId: clean(row.owner_ediel_id) ?? metadataText(row, 'ownerEdielId', 'owner_ediel_id'),
    ownerSubaddress: clean(row.owner_subaddress) ?? metadataText(row, 'ownerSubaddress', 'owner_subaddress'),
    displayName: clean(row.display_name) ?? metadataText(row, 'displayName'),
    fingerprintSha256: fingerprint,
    serialNumber: upper(row.serial_number) ?? upper(certificate.serialNumber),
    issuer: clean(row.issuer) ?? distinguishedName(certificate.issuer.attributes),
    subject: clean(row.subject) ?? distinguishedName(certificate.subject.attributes),
    certificate,
    privateKey,
    source: params.source,
    sourceReference: params.sourceReference,
    warnings: params.warnings ?? [],
  }
}

function rowP12SecretReference(row: CertificateRow): string | null {
  return clean(row.p12_secret_reference) ?? clean(row.p12_secret_ref) ?? metadataText(row, 'p12SecretReference', 'p12_secret_reference', 'p12SecretRef', 'p12_secret_ref', 'p12Base64Env', 'p12Env')
}

function rowPasswordSecretReference(row: CertificateRow): string | null {
  return clean(row.p12_password_secret_ref) ?? clean(row.password_secret_reference) ?? metadataText(
    row,
    'p12PasswordSecretReference',
    'p12_password_secret_reference',
    'passwordSecretReference',
    'password_secret_reference',
    'p12PasswordEnv',
    'passwordEnv',
  )
}

function envFallbackProfile(environment?: string | null): InboundPrivateCertificateProfile | null {
  const envKey = String(environment ?? '').trim().toUpperCase()
  const p12Base64 =
    (envKey ? process.env[`EDIEL_${envKey}_SMIME_P12_BASE64`] : null) ??
    process.env.EDIEL_SMIME_P12_BASE64 ??
    process.env.EDIEL_SMIME_PFX_BASE64 ??
    process.env.EDIEL_SMIME_DECRYPT_P12_BASE64 ??
    null
  const password =
    (envKey ? process.env[`EDIEL_${envKey}_SMIME_P12_PASSWORD`] : null) ??
    process.env.EDIEL_SMIME_P12_PASSWORD ??
    process.env.EDIEL_SMIME_PRIVATE_KEY_PASSWORD ??
    process.env.EDIEL_SMIME_DECRYPT_P12_PASSWORD ??
    null
  const p12Bytes = maybeBase64ToBuffer(p12Base64)
  if (!p12Bytes || !password) return null

  return profileFromP12({
    p12Bytes,
    password,
    source: 'env_fallback',
    sourceReference: envKey ? `EDIEL_${envKey}_SMIME_P12_BASE64` : 'EDIEL_SMIME_P12_BASE64',
    row: {
      id: null,
      company_id: process.env.EDIEL_SMIME_CERT_COMPANY_ID ?? null,
      environment: environment ?? null,
      owner_ediel_id: process.env.EDIEL_SMIME_CERT_OWNER_EDIEL_ID ?? process.env.EDIEL_ACTOR_EDIEL_ID ?? null,
      owner_subaddress: process.env.EDIEL_SMIME_CERT_OWNER_SUBADDRESS ?? null,
      display_name: 'Env fallback inbound private S/MIME certificate',
    },
    warnings: ['Certifikatet lästes från env-fallback. Koppla helst PFX via ediel_certificates med env: secret_reference.'],
  })
}

export async function loadInboundPrivateCertificates(input: {
  environment?: string | null
  companyId?: string | null
} = {}): Promise<PrivateCertificateLoadResult> {
  const warnings: string[] = []
  const profiles: InboundPrivateCertificateProfile[] = []

  let query = supabaseService
    .from('ediel_certificates')
    .select('id,company_id,environment,display_name,subject,issuer,serial_number,fingerprint_sha256,certificate_fingerprint,owner_ediel_id,owner_subaddress,usage,purpose,status,p12_secret_reference,p12_secret_ref,p12_password_secret_ref,password_secret_reference,private_key_secret_reference,secret_reference,metadata')
    .in('usage', ['inbound_private', 'sender_signing'])

  if (input.environment) query = query.eq('environment', input.environment)
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query.limit(50)
  if (error) {
    warnings.push(`Kunde inte läsa ediel_certificates för inbound-dekryptering: ${error.message}`)
  }

  for (const row of (data ?? []) as CertificateRow[]) {
    const rowStatus = clean(row.status)?.toLowerCase() ?? null
    if (rowStatus === 'archived' || rowStatus === 'deleted' || rowStatus === 'inactive') {
      continue
    }

    const ref = rowP12SecretReference(row) ?? clean(row.secret_reference)
    const p12Base64 = resolveSecretReference(ref)
    const password =
      resolveSecretReference(rowPasswordSecretReference(row)) ??
      process.env.EDIEL_SMIME_P12_PASSWORD ??
      process.env.EDIEL_SMIME_PRIVATE_KEY_PASSWORD ??
      null
    const p12Bytes = maybeBase64ToBuffer(p12Base64)

    if (!p12Bytes || !password) {
      warnings.push(
        `Privat certifikat ${clean(row.id) ?? clean(row.display_name) ?? 'utan id'} saknar läsbar P12-env eller lösenord. Använd p12_secret_reference=env:VAR och passwordSecretReference=env:VAR i metadata.`,
      )
      continue
    }

    try {
      profiles.push(profileFromP12({
        p12Bytes,
        password,
        row,
        source: 'database_secret_reference',
        sourceReference: ref,
      }))
    } catch (error) {
      warnings.push(formatErrorMessage(error, `Privat certifikat ${clean(row.id) ?? ''} kunde inte läsas.`))
    }
  }

  const fallback = envFallbackProfile(input.environment)
  const fallbackMatchesTenant = !input.companyId || fallback?.companyId === input.companyId
  if (fallback && fallbackMatchesTenant && !profiles.some((profile) => profile.fingerprintSha256 === fallback.fingerprintSha256)) {
    profiles.push(fallback)
  } else if (fallback && input.companyId && !fallbackMatchesTenant) {
    warnings.push('Env-fallback för S/MIME ignorerades eftersom EDIEL_SMIME_CERT_COMPANY_ID inte matchar aktuell tenant.')
  }

  return { profiles, warnings }
}
