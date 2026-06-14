import { supabaseService } from '@/lib/supabase/service'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

export type ActorReadinessRunResult = {
  ok: boolean
  run_id?: string
  actors_backfilled?: number
  routes_verified?: number
  certificates_refreshed?: number
  missing_certificate_placeholders_created?: number
  auto_enabled_count?: number
  auto_disabled_count?: number
  error?: string
  [key: string]: unknown
}

type RpcResult = ActorReadinessRunResult | string | null

function parseRpcResult(data: RpcResult): ActorReadinessRunResult {
  if (!data) return { ok: true }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as ActorReadinessRunResult
    } catch {
      return { ok: true, raw: data }
    }
  }
  return data
}


type CertificateLookupRoute = {
  actor_id: string
  ediel_id: string | null
  route_id: string
  message_family: string | null
  environment: string | null
  subaddress: string | null
  communication_address: string | null
  certificate_status: string | null
  certificate_next_check_at: string | null
  certificate_fingerprint_sha256?: string | null
}

function parseDateToIso(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function certificateStatus(value: string | null | undefined): 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown' {
  if (value === 'valid') return 'valid'
  if (value === 'expired') return 'expired'
  if (value === 'not_yet_valid' || value === 'invalid') return 'invalid'
  return 'unknown'
}

function nextCertificateCheck(status: string, validTo?: string | null): string {
  const validToMs = validTo ? Date.parse(validTo) : NaN
  const soon = Number.isFinite(validToMs) && validToMs <= Date.now() + 45 * 24 * 60 * 60 * 1000
  const days = status === 'expired' || status === 'invalid' || status === 'missing' || soon ? 7 : 30
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function platformCertificateStatus(value: string | null | undefined, validTo?: string | null): 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown' {
  const base = certificateStatus(value)
  const validToMs = validTo ? Date.parse(validTo) : NaN
  if (Number.isFinite(validToMs)) {
    if (validToMs <= Date.now()) return 'expired'
    if (validToMs <= Date.now() + 45 * 24 * 60 * 60 * 1000) return 'expires_soon'
  }
  return base
}

async function upsertPlatformActorCertificate(input: {
  actorId: string
  edielId: string | null
  environment: string
  certificateType?: string
  purpose?: string
  subject?: string | null
  issuer?: string | null
  serialNumber?: string | null
  fingerprintSha256: string
  validFrom?: string | null
  validTo?: string | null
  status: 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown'
  source: string
  sourceUrl?: string | null
  rawCertificatePem?: string | null
  metadata?: Record<string, unknown>
}) {
  const now = new Date().toISOString()
  const fingerprint = input.fingerprintSha256.toUpperCase()
  const payload = {
    actor_id: input.actorId,
    ediel_id: input.edielId,
    environment: input.environment,
    certificate_type: input.certificateType ?? 'smime',
    purpose: input.purpose ?? 'encryption',
    subject: input.subject ?? null,
    issuer: input.issuer ?? null,
    serial_number: input.serialNumber ?? null,
    fingerprint_sha256: fingerprint,
    valid_from: input.validFrom ?? null,
    valid_to: input.validTo ?? null,
    status: input.status,
    source: input.source,
    source_url: input.sourceUrl ?? null,
    raw_certificate_pem: input.rawCertificatePem ?? null,
    metadata: input.metadata ?? {},
    last_checked_at: now,
    next_check_at: nextCertificateCheck(input.status, input.validTo),
    updated_at: now,
  }

  const existing = await supabaseService
    .from('platform_actor_certificates')
    .select('id')
    .eq('actor_id', input.actorId)
    .eq('environment', input.environment)
    .eq('purpose', input.purpose ?? 'encryption')
    .eq('fingerprint_sha256', fingerprint)
    .limit(1)
    .maybeSingle()
  if (existing.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(existing.error.code ?? '')) throw existing.error

  if (existing.data?.id) {
    const update = await supabaseService.from('platform_actor_certificates').update(payload).eq('id', existing.data.id)
    if (update.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(update.error.code ?? '')) throw update.error
    return true
  }

  const insert = await supabaseService.from('platform_actor_certificates').insert(payload)
  if (insert.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(insert.error.code ?? '')) throw insert.error
  return !insert.error
}

type ExistingEdielCertificateRow = {
  id: string
  owner_ediel_id: string | null
  owner_party_id: string | null
  environment: string | null
  purpose: string | null
  certificate_type: string | null
  subject: string | null
  issuer: string | null
  serial_number: string | null
  fingerprint_sha256: string | null
  certificate_fingerprint: string | null
  valid_from: string | null
  valid_to: string | null
  certificate_valid_from: string | null
  certificate_valid_to: string | null
  status: string | null
  encryption_status: string | null
  source: string | null
  public_certificate_pem: string | null
  metadata: Record<string, unknown> | null
}

async function syncExistingEdielCertificatesForRoutes(routes: CertificateLookupRoute[]) {
  const edielIds = Array.from(new Set(routes.map((route) => route.ediel_id).filter((value): value is string => Boolean(value))))
  if (edielIds.length === 0) return { synced: 0, candidates: 0 }

  const result = await supabaseService
    .from('ediel_certificates')
    .select('id,owner_ediel_id,owner_party_id,environment,purpose,certificate_type,subject,issuer,serial_number,fingerprint_sha256,certificate_fingerprint,valid_from,valid_to,certificate_valid_from,certificate_valid_to,status,encryption_status,source,public_certificate_pem,metadata')
    .in('owner_ediel_id', edielIds)
    .eq('purpose', 'encryption')
    .eq('environment', 'production')
    .order('certificate_valid_to', { ascending: false, nullsFirst: false })
  if (result.error) {
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) return { synced: 0, candidates: 0 }
    throw result.error
  }

  const byEdiel = new Map<string, ExistingEdielCertificateRow[]>()
  for (const cert of (result.data ?? []) as ExistingEdielCertificateRow[]) {
    if (!cert.owner_ediel_id) continue
    byEdiel.set(cert.owner_ediel_id, [...(byEdiel.get(cert.owner_ediel_id) ?? []), cert])
  }

  let synced = 0
  let candidates = 0
  for (const route of routes) {
    const certs = route.ediel_id ? byEdiel.get(route.ediel_id) ?? [] : []
    candidates += certs.length
    for (const cert of certs) {
      const fingerprint = cert.fingerprint_sha256 ?? cert.certificate_fingerprint
      if (!fingerprint) continue
      const validFrom = cert.valid_from ?? cert.certificate_valid_from
      const validTo = cert.valid_to ?? cert.certificate_valid_to
      const status = platformCertificateStatus(cert.encryption_status ?? cert.status, validTo)
      const ok = await upsertPlatformActorCertificate({
        actorId: route.actor_id,
        edielId: route.ediel_id,
        environment: route.environment ?? 'production',
        certificateType: cert.certificate_type ?? 'smime',
        purpose: 'encryption',
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serial_number,
        fingerprintSha256: fingerprint,
        validFrom,
        validTo,
        status,
        source: cert.source ?? 'ediel_certificates',
        rawCertificatePem: cert.public_certificate_pem,
        metadata: {
          copiedFromEdielCertificateId: cert.id,
          routeId: route.route_id,
          ownerEdielId: cert.owner_ediel_id,
          source: 'existing_ediel_certificates_sync',
          existingCertificateMetadata: cert.metadata ?? {},
        },
      })
      if (ok) synced += 1
    }
  }
  return { synced, candidates }
}

async function listCertificateLookupRoutes(limit = 1000): Promise<CertificateLookupRoute[]> {
  const result = await supabaseService
    .from('platform_actor_send_readiness_v')
    .select('actor_id,ediel_id,route_id,message_family,environment,subaddress,communication_address,certificate_status,certificate_next_check_at,certificate_fingerprint_sha256')
    .eq('requires_certificate', true)
    .eq('message_family', 'PRODAT')
    .eq('environment', 'production')
    .order('certificate_next_check_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }

  const now = Date.now()
  return ((result.data ?? []) as CertificateLookupRoute[]).filter((row) => {
    if (!row.communication_address) return false
    if (String(row.subaddress ?? '').toUpperCase() === 'GAS') return false
    if (!row.certificate_status || ['missing', 'unknown', 'invalid', 'expired'].includes(row.certificate_status)) return true
    if (row.certificate_status === 'valid' && !row.certificate_fingerprint_sha256) return true
    if (!row.certificate_next_check_at) return true
    const next = Date.parse(row.certificate_next_check_at)
    return !Number.isFinite(next) || next <= now
  })
}

async function syncCertificateLookupRoutes(runType: 'certificate_refresh' | 'manual_actor_check' | 'manual' = 'certificate_refresh') {
  const routes = await listCertificateLookupRoutes()
  const existingSync = await syncExistingEdielCertificatesForRoutes(routes)
  const routesAfterExistingSync = routes.filter((route) => !route.certificate_fingerprint_sha256 || ['missing', 'unknown', 'invalid', 'expired'].includes(String(route.certificate_status ?? '')))
  let lookedUp = 0
  let certificatesFound = 0
  let failed = 0
  const errors: Array<Record<string, unknown>> = []

  for (const route of routesAfterExistingSync) {
    const smtpEmail = route.communication_address?.trim()
    if (!smtpEmail) continue
    try {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail,
        edielId: route.ediel_id,
        subaddress: route.subaddress,
        partyId: route.ediel_id,
        forceRefresh: runType === 'manual_actor_check' || runType === 'manual',
      })
      lookedUp += 1
      certificatesFound += lookup.certificatesFound

      for (const cert of lookup.certificates) {
        const status = certificateStatus(cert.status)
        const validFrom = parseDateToIso(cert.validFrom)
        const validTo = parseDateToIso(cert.validTo)
        await upsertPlatformActorCertificate({
          actorId: route.actor_id,
          edielId: route.ediel_id,
          environment: route.environment ?? 'production',
          certificateType: 'smime',
          purpose: 'encryption',
          subject: cert.subject,
          issuer: cert.issuer,
          serialNumber: cert.serialNumber,
          fingerprintSha256: cert.fingerprintSha256,
          validFrom,
          validTo,
          status: platformCertificateStatus(status, validTo),
          source: 'expisoft_ldap',
          sourceUrl: lookup.ldapUrl,
          rawCertificatePem: cert.pem,
          metadata: {
            routeId: route.route_id,
            lookupEmail: lookup.lookupEmail,
            fetchedFromLdap: lookup.fetchedFromLdap,
            throttled: lookup.throttled,
            certificateId: cert.certificateId,
            subjectAltNames: cert.subjectAltNames,
            crlDistributionPoints: cert.crlDistributionPoints,
            crlStatus: cert.crlStatus,
            diagnostics: lookup.diagnostics,
          },
        })
      }
    } catch (error) {
      failed += 1
      errors.push({ route_id: route.route_id, smtpEmail, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { lookedUp, certificatesFound, failed, errors, existingCertificatesSynced: existingSync.synced, existingCertificateCandidates: existingSync.candidates }
}

export async function runActorReadinessBackfill(runType: 'nightly_backfill' | 'manual_actor_check' | 'xml_import_followup' | 'manual' = 'manual_actor_check') {
  const result = await supabaseService.rpc('gridex_actor_readiness_backfill', { p_run_type: runType })
  if (result.error) throw result.error
  return parseRpcResult(result.data as RpcResult)
}

export async function refreshActorCertificateStatuses(runType: 'certificate_refresh' | 'manual_actor_check' | 'manual' = 'certificate_refresh') {
  const externalLookup = await syncCertificateLookupRoutes(runType)
  const result = await supabaseService.rpc('gridex_refresh_actor_certificate_statuses', { p_run_type: runType })
  if (result.error) throw result.error
  return {
    ...parseRpcResult(result.data as RpcResult),
    external_certificate_lookup: externalLookup,
  }
}

export async function applyActorAutoSendReadiness() {
  const result = await supabaseService.rpc('gridex_apply_actor_auto_send_readiness')
  if (result.error) throw result.error
  return parseRpcResult(result.data as RpcResult)
}

export async function runFullActorAutoReadiness() {
  const backfill = await runActorReadinessBackfill('nightly_backfill')
  const certificates = await refreshActorCertificateStatuses('certificate_refresh')
  const autoSend = await applyActorAutoSendReadiness()
  return {
    ok: true,
    backfill,
    certificates,
    autoSend,
  }
}

export type ActorSendReadinessRow = {
  actor_id: string
  actor_name: string | null
  legal_name: string | null
  org_number: string | null
  actor_status: string | null
  match_status: string | null
  visible_to_tenants: boolean | null
  actor_roles: string[] | null
  ediel_id: string | null
  ediel_id_verified: boolean | null
  route_id: string
  message_family: string | null
  application_reference: string | null
  environment: string | null
  subaddress: string | null
  communication_type: string | null
  communication_address: string | null
  party_id: string | null
  interchange_party_id: string | null
  route_status: string | null
  route_verified: boolean | null
  auto_send_allowed: boolean | null
  requires_certificate: boolean | null
  certificate_id: string | null
  certificate_status: string | null
  certificate_fingerprint_sha256: string | null
  certificate_subject: string | null
  certificate_issuer: string | null
  certificate_valid_from: string | null
  certificate_valid_to: string | null
  certificate_last_checked_at: string | null
  certificate_next_check_at: string | null
  blocking_reasons: string[] | null
  warnings: string[] | null
  readiness_status: string | null
  last_checked_at: string | null
  next_check_at: string | null
}

export async function listActorSendReadiness(limit = 500): Promise<ActorSendReadinessRow[]> {
  const result = await supabaseService
    .from('platform_actor_send_readiness_v')
    .select('*')
    .order('readiness_status', { ascending: true })
    .order('actor_name', { ascending: true })
    .limit(limit)

  if (result.error) {
    if (['42P01', '42703', 'PGRST205'].includes(result.error.code ?? '')) return []
    throw result.error
  }

  return (result.data ?? []) as ActorSendReadinessRow[]
}
