import { X509Certificate, createHash } from 'crypto'
import { Client } from 'ldapts'
import { supabaseService } from '@/lib/supabase/service'

export type ExpisoftCertificateLookupResult = {
  lookupEmail: string
  ldapUrl: string
  fetchedFromLdap: boolean
  throttled: boolean
  certificatesFound: number
  certificates: Array<{
    certificateId: string | null
    fingerprintSha256: string
    pem: string
    subject: string
    issuer: string
    serialNumber: string
    validFrom: string
    validTo: string
    status: 'valid' | 'expired' | 'not_yet_valid' | 'invalid' | 'unknown'
    crlStatus: 'not_checked' | 'unknown'
    subjectAltNames: string | null
    crlDistributionPoints: string | null
  }>
  diagnostics: Record<string, unknown>
}

function clean(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function ldapHost() {
  return process.env.EDIEL_EXPISOFT_LDAP_HOST ?? 'sodir01.expisoft.se'
}

function ldapPort() {
  const parsed = Number(process.env.EDIEL_EXPISOFT_LDAP_PORT ?? '389')
  return Number.isFinite(parsed) ? parsed : 389
}

function ldapBaseDn() {
  return process.env.EDIEL_EXPISOFT_LDAP_BASE_DN ?? 'c=se'
}

export function expisoftLdapUrlForMail(email: string): string {
  return `ldap://${ldapHost()}:${ldapPort()}/${ldapBaseDn()}?userCertificate?sub?mail=${email}`
}

function escapeLdapFilter(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00')
}

function derToPem(raw: Buffer): string {
  const b64 = raw.toString('base64').match(/.{1,64}/g)?.join('\n') ?? raw.toString('base64')
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
}

function certStatus(cert: X509Certificate): 'valid' | 'expired' | 'not_yet_valid' | 'invalid' {
  const now = Date.now()
  const from = Date.parse(cert.validFrom)
  const to = Date.parse(cert.validTo)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'invalid'
  if (from > now) return 'not_yet_valid'
  if (to <= now) return 'expired'
  return 'valid'
}

function extractCrlDistributionPoints(cert: X509Certificate): string | null {
  const info = cert.infoAccess
  if (!info) return null
  const lines = info.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const crlLines = lines.filter((line) => /ca issuers|ocsp|crl/i.test(line))
  return crlLines.length > 0 ? crlLines.join('\n') : null
}

function looksLikeBase64Certificate(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.length > 200 && /^[A-Za-z0-9+/=]+$/.test(compact)
}

function normalizeLdapCertificateValue(value: unknown): Buffer[] {
  if (!value) return []
  if (Buffer.isBuffer(value)) return [value]
  if (value instanceof Uint8Array) return [Buffer.from(value)]
  if (Array.isArray(value)) return value.flatMap(normalizeLdapCertificateValue)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    const pemMatch = trimmed.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)
    if (pemMatch?.[1]) return [Buffer.from(pemMatch[1].replace(/\s+/g, ''), 'base64')]

    if (looksLikeBase64Certificate(trimmed)) return [Buffer.from(trimmed.replace(/\s+/g, ''), 'base64')]

    return [Buffer.from(trimmed, 'binary')]
  }
  return []
}

function getLdapEntryValue(entry: Record<string, unknown>, requestedName: string): unknown {
  const requestedLower = requestedName.toLowerCase()
  const foundKey = Object.keys(entry).find((key) => key.toLowerCase() === requestedLower)
  return foundKey ? entry[foundKey] : undefined
}

function extractCertificateValuesFromLdapEntry(entry: Record<string, unknown>): Buffer[] {
  const values: Buffer[] = []
  const directAttributeNames = [
    'userCertificate',
    'userCertificate;binary',
    'usercertificate',
    'usercertificate;binary',
    'userSMIMECertificate',
    'userSMIMECertificate;binary',
    'usersmimecertificate',
    'usersmimecertificate;binary',
  ]

  for (const attributeName of directAttributeNames) {
    values.push(...normalizeLdapCertificateValue(getLdapEntryValue(entry, attributeName)))
  }

  // Some LDAP clients normalize attribute names to lowercase or include options.
  // Expisoft/OpenLDAP output may show "usercertificate::" even when requesting
  // "userCertificate". Accept any userCertificate attribute, case-insensitively,
  // but avoid duplicate buffers later by fingerprint.
  for (const [key, value] of Object.entries(entry)) {
    if (key.toLowerCase().startsWith('usercertificate') || key.toLowerCase().startsWith('usersmimecertificate')) {
      values.push(...normalizeLdapCertificateValue(value))
    }
  }

  const seen = new Set<string>()
  return values.filter((buffer) => {
    if (buffer.length === 0) return false
    const fingerprint = createHash('sha256').update(buffer).digest('hex')
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

async function cachedLookup(email: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseService
    .from('ediel_certificate_directory_cache')
    .select('*')
    .eq('smtp_email', email)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) throw error
  return (data as Record<string, unknown> | null) ?? null
}

async function upsertCacheRow(input: {
  partyId?: string | null
  companyId?: string | null
  smtpEmail: string
  edielId?: string | null
  subaddress?: string | null
  certificateId: string | null
  pem: string
  rawDer: Buffer
  cert: X509Certificate
  status: string
  diagnostics: Record<string, unknown>
}) {
  await supabaseService.from('ediel_certificate_directory_cache').upsert({
    party_id: clean(input.partyId),
    company_id: clean(input.companyId),
    smtp_email: input.smtpEmail,
    ediel_id: clean(input.edielId),
    subaddress: clean(input.subaddress),
    source: 'expisoft_ldap',
    certificate_id: input.certificateId,
    public_certificate_pem: input.pem,
    raw_der_base64: input.rawDer.toString('base64'),
    subject: input.cert.subject,
    issuer: input.cert.issuer,
    serial_number: input.cert.serialNumber,
    not_before: new Date(input.cert.validFrom).toISOString(),
    not_after: new Date(input.cert.validTo).toISOString(),
    sha256_fingerprint: createHash('sha256').update(input.rawDer).digest('hex').toUpperCase(),
    key_usage: null,
    subject_alt_names: input.cert.subjectAltName,
    crl_distribution_points: extractCrlDistributionPoints(input.cert),
    fetched_at: new Date().toISOString(),
    last_validated_at: new Date().toISOString(),
    status: input.status,
    diagnostics: input.diagnostics,
  }, { onConflict: 'smtp_email,sha256_fingerprint' }).then(({ error }) => {
    if (error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) throw error
  })
}

async function upsertOutboundRecipientCertificate(input: {
  partyId?: string | null
  companyId?: string | null
  smtpEmail: string
  edielId?: string | null
  subaddress?: string | null
  pem: string
  rawDer: Buffer
  cert: X509Certificate
  status: string
}): Promise<string | null> {
  const fingerprint = createHash('sha256').update(input.rawDer).digest('hex').toUpperCase()
  const publicSecretReference = `public://ediel-certificates/expisoft_ldap/${encodeURIComponent(input.smtpEmail)}/${fingerprint}`
  const now = new Date().toISOString()
  const payload = {
    company_id: clean(input.companyId),
    owner_party_id: clean(input.partyId),
    owner_ediel_id: clean(input.edielId),
    owner_subaddress: clean(input.subaddress),
    environment: 'production',
    usage: 'outbound_recipient',
    purpose: 'encryption',
    certificate_type: 'smime',
    display_name: `Expisoft ${input.edielId ?? input.smtpEmail}${input.subaddress ? `:${input.subaddress}` : ''}`,
    message_family: 'PRODAT',
    message_type: 'PRODAT',
    source: 'expisoft_ldap',
    public_certificate_pem: input.pem,
    subject: input.cert.subject,
    issuer: input.cert.issuer,
    serial_number: input.cert.serialNumber,
    fingerprint_sha256: fingerprint,
    certificate_fingerprint: fingerprint,
    certificate_valid_from: new Date(input.cert.validFrom).toISOString(),
    certificate_valid_to: new Date(input.cert.validTo).toISOString(),
    valid_from: new Date(input.cert.validFrom).toISOString(),
    valid_to: new Date(input.cert.validTo).toISOString(),
    encryption_status: input.status === 'valid' ? 'valid' : input.status,
    status: input.status === 'valid' ? 'active' : input.status,
    secret_reference: publicSecretReference,
    p12_secret_reference: null,
    private_key_secret_reference: null,
    is_private_material_available: false,
    has_private_material: false,
    needs_verification: false,
    last_validation_at: now,
    last_verified_at: now,
    updated_at: now,
    metadata: {
      source: 'expisoft_ldap',
      lookupMail: input.smtpEmail,
      ldapUrl: expisoftLdapUrlForMail(input.smtpEmail),
      ownerEdielId: clean(input.edielId),
      owner_ediel_id: clean(input.edielId),
      ownerSubaddress: clean(input.subaddress),
      owner_subaddress: clean(input.subaddress),
      messageFamily: 'PRODAT',
      message_family: 'PRODAT',
      messageType: 'PRODAT',
      message_type: 'PRODAT',
      usage: 'outbound_recipient',
      purpose: 'encryption',
      secretReference: publicSecretReference,
      publicCertificateOnly: true,
      isPrivateMaterialAvailable: false,
      privateMaterialStoredAsSecretReferenceOnly: false,
      subjectAltName: input.cert.subjectAltName,
      crlDistributionPoints: extractCrlDistributionPoints(input.cert),
      crlStatus: 'not_checked',
    },
  }

  const existing = await supabaseService
    .from('ediel_certificates')
    .select('id')
    .eq('fingerprint_sha256', fingerprint)
    .limit(1)
    .maybeSingle()
  if (existing.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(existing.error.code ?? '')) throw existing.error

  const { data, error } = existing.data?.id
    ? await supabaseService
        .from('ediel_certificates')
        .update(payload)
        .eq('id', existing.data.id)
        .select('id')
        .maybeSingle()
    : await supabaseService
        .from('ediel_certificates')
        .insert(payload)
        .select('id')
        .maybeSingle()
  if (error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '')) return null
    throw error
  }
  return clean((data as { id?: string } | null)?.id)
}

export async function fetchReceiverCertificatesFromExpisoft(input: {
  smtpEmail: string
  edielId?: string | null
  subaddress?: string | null
  partyId?: string | null
  companyId?: string | null
  forceRefresh?: boolean
}): Promise<ExpisoftCertificateLookupResult> {
  const smtpEmail = clean(input.smtpEmail)?.toLowerCase()
  if (!smtpEmail) throw new Error('SMTP email krävs för Expisoft certificate lookup.')
  const ldapUrl = expisoftLdapUrlForMail(smtpEmail)
  const previous = await cachedLookup(smtpEmail)
  const fetchedAt = text(previous?.fetched_at)
  const throttled = Boolean(
    !input.forceRefresh &&
      fetchedAt &&
      Date.now() - Date.parse(fetchedAt) < 60 * 60 * 1000,
  )

  if (throttled && previous) {
    return {
      lookupEmail: smtpEmail,
      ldapUrl,
      fetchedFromLdap: false,
      throttled: true,
      certificatesFound: 1,
      certificates: [{
        certificateId: text(previous.certificate_id),
        fingerprintSha256: text(previous.sha256_fingerprint) ?? '',
        pem: text(previous.public_certificate_pem) ?? '',
        subject: text(previous.subject) ?? '',
        issuer: text(previous.issuer) ?? '',
        serialNumber: text(previous.serial_number) ?? '',
        validFrom: text(previous.not_before) ?? '',
        validTo: text(previous.not_after) ?? '',
        status: (text(previous.status) as 'valid') ?? 'unknown',
        crlStatus: 'unknown',
        subjectAltNames: text(previous.subject_alt_names),
        crlDistributionPoints: text(previous.crl_distribution_points),
      }],
      diagnostics: { source: 'cache', fetchedAt },
    }
  }

  const client = new Client({ url: `ldap://${ldapHost()}:${ldapPort()}` })
  try {
    const attributes = [
      'userCertificate',
      'userCertificate;binary',
      'userSMIMECertificate',
      'userSMIMECertificate;binary',
      'mail',
      'cn',
      'uid',
    ]
    const filters = [`(mail=${escapeLdapFilter(smtpEmail)})`]
    if (input.edielId) {
      const ediel = escapeLdapFilter(input.edielId)
      filters.push(`(uid=${ediel})`, `(cn=*${ediel}*)`, `(o=${ediel})`)
      filters.push(`(mail=${ediel}@ediel.se)`)
    }

    const entries: Record<string, unknown>[] = []
    const seenEntryKeys = new Set<string>()
    for (const filter of filters) {
      const search = await client.search(ldapBaseDn(), {
        scope: 'sub',
        filter,
        attributes,
      })
      for (const entry of search.searchEntries as Record<string, unknown>[]) {
        const key = JSON.stringify(entry)
        if (seenEntryKeys.has(key)) continue
        seenEntryKeys.add(key)
        entries.push(entry)
      }
      if (entries.length > 0) break
    }

    const rawCertificates = entries.flatMap((entry) =>
      extractCertificateValuesFromLdapEntry(entry as Record<string, unknown>),
    )

    const certs: ExpisoftCertificateLookupResult['certificates'] = []
    for (const rawDer of rawCertificates) {
      const cert = new X509Certificate(rawDer)
      const pem = derToPem(rawDer)
      const status = certStatus(cert)
      const certificateId = await upsertOutboundRecipientCertificate({
        partyId: input.partyId,
        companyId: input.companyId,
        smtpEmail,
        edielId: input.edielId,
        subaddress: input.subaddress,
        pem,
        rawDer,
        cert,
        status,
      })
      await upsertCacheRow({
        partyId: input.partyId,
        companyId: input.companyId,
        smtpEmail,
        edielId: input.edielId,
        subaddress: input.subaddress,
        certificateId,
        pem,
        rawDer,
        cert,
        status,
        diagnostics: {
          ldapUrl,
          crlStatus: 'not_checked',
          note: 'CRL URL extraction is stored for admin diagnostics; revoked status requires CRL fetch support in deployment.',
        },
      })
      certs.push({
        certificateId,
        fingerprintSha256: createHash('sha256').update(rawDer).digest('hex').toUpperCase(),
        pem,
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serialNumber,
        validFrom: cert.validFrom,
        validTo: cert.validTo,
        status,
        crlStatus: 'not_checked',
        subjectAltNames: cert.subjectAltName ?? null,
        crlDistributionPoints: extractCrlDistributionPoints(cert),
      })
    }

    return {
      lookupEmail: smtpEmail,
      ldapUrl,
      fetchedFromLdap: true,
      throttled: false,
      certificatesFound: certs.length,
      certificates: certs,
      diagnostics: {
        entries: entries.length,
        attemptedFilters: filters,
        ldapAttributeKeys: entries.map((entry) => Object.keys(entry as Record<string, unknown>)),
      },
    }
  } finally {
    await client.unbind().catch(() => undefined)
  }
}
