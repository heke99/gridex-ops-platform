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

async function listCertificateLookupRoutes(limit = 250): Promise<CertificateLookupRoute[]> {
  const result = await supabaseService
    .from('platform_actor_send_readiness_v')
    .select('actor_id,ediel_id,route_id,message_family,environment,subaddress,communication_address,certificate_status,certificate_next_check_at')
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
    if (!row.certificate_next_check_at) return true
    const next = Date.parse(row.certificate_next_check_at)
    return !Number.isFinite(next) || next <= now
  })
}

async function syncCertificateLookupRoutes(runType: 'certificate_refresh' | 'manual_actor_check' | 'manual' = 'certificate_refresh') {
  const routes = await listCertificateLookupRoutes()
  let lookedUp = 0
  let certificatesFound = 0
  let failed = 0
  const errors: Array<Record<string, unknown>> = []

  for (const route of routes) {
    const smtpEmail = route.communication_address?.trim()
    if (!smtpEmail) continue
    try {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail,
        edielId: route.ediel_id,
        subaddress: route.subaddress,
        partyId: route.actor_id,
        forceRefresh: runType === 'manual_actor_check' || runType === 'manual',
      })
      lookedUp += 1
      certificatesFound += lookup.certificatesFound

      for (const cert of lookup.certificates) {
        const status = certificateStatus(cert.status)
        const validFrom = parseDateToIso(cert.validFrom)
        const validTo = parseDateToIso(cert.validTo)
        const upsert = await supabaseService
          .from('platform_actor_certificates')
          .upsert({
            actor_id: route.actor_id,
            ediel_id: route.ediel_id,
            environment: route.environment ?? 'production',
            certificate_type: 'smime',
            purpose: 'encryption',
            subject: cert.subject,
            issuer: cert.issuer,
            serial_number: cert.serialNumber,
            fingerprint_sha256: cert.fingerprintSha256,
            valid_from: validFrom,
            valid_to: validTo,
            status,
            source: 'expisoft_ldap',
            source_url: lookup.ldapUrl,
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
            last_checked_at: new Date().toISOString(),
            next_check_at: nextCertificateCheck(status, validTo),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'fingerprint_sha256' })
        if (upsert.error) throw upsert.error
      }
    } catch (error) {
      failed += 1
      errors.push({ route_id: route.route_id, smtpEmail, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { lookedUp, certificatesFound, failed, errors }
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
  const autoSend = await applyActorAutoSendReadiness()
  return {
    ok: true,
    backfill,
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
