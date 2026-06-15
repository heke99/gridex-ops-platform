import { supabaseService } from '@/lib/supabase/service'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

type RefreshTrigger = 'manual' | 'scheduled_30_day' | 'xml_import' | 'backfill' | 'certificate_refresh'

type RefreshRoute = {
  actor_id: string
  grid_owner_id: string | null
  company_id: string | null
  ediel_id: string | null
  subaddress: string | null
  environment: 'test' | 'production' | string | null
  communication_address: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function normalizeCertificateStatus(value: string | null | undefined, validTo?: string | null): 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown' {
  const parsedValidTo = validTo ? Date.parse(validTo) : NaN
  if (Number.isFinite(parsedValidTo)) {
    if (parsedValidTo <= Date.now()) return 'expired'
    if (parsedValidTo <= Date.now() + 45 * 24 * 60 * 60 * 1000) return 'expires_soon'
  }
  if (value === 'valid' || value === 'expired' || value === 'invalid') return value
  if (value === 'not_yet_valid') return 'invalid'
  return 'unknown'
}

async function createRefreshJob(input: {
  triggeredBy: RefreshTrigger
  actorId?: string | null
  gridOwnerId?: string | null
  companyId?: string | null
  edielId?: string | null
  requestedBy?: string | null
}) {
  const { data, error } = await supabaseService
    .from('ediel_certificate_refresh_jobs')
    .insert({
      triggered_by: input.triggeredBy,
      platform_market_actor_id: input.actorId ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      company_id: input.companyId ?? null,
      ediel_id: input.edielId ?? null,
      requested_by: input.requestedBy ?? null,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return clean((data as { id?: string } | null)?.id)
}

async function finishRefreshJob(jobId: string | null, payload: Record<string, unknown>) {
  if (!jobId) return
  const { error } = await supabaseService
    .from('ediel_certificate_refresh_jobs')
    .update({ ...payload, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error && !isMissingSchema(error)) throw error
}

async function upsertPlatformActorCertificate(input: {
  actorId: string
  edielId: string | null
  environment: string
  fingerprintSha256: string
  status: 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown'
  subject: string | null
  issuer: string | null
  serialNumber: string | null
  validFrom: string | null
  validTo: string | null
  pem: string | null
  sourceUrl: string | null
  metadata: Record<string, unknown>
}) {
  const fingerprint = input.fingerprintSha256.toUpperCase()
  const existing = await supabaseService
    .from('platform_actor_certificates')
    .select('id')
    .eq('actor_id', input.actorId)
    .eq('environment', input.environment)
    .eq('purpose', 'encryption')
    .eq('fingerprint_sha256', fingerprint)
    .maybeSingle()
  if (existing.error && !isMissingSchema(existing.error)) throw existing.error

  const payload = {
    actor_id: input.actorId,
    ediel_id: input.edielId,
    environment: input.environment,
    certificate_type: 'smime',
    purpose: 'encryption',
    subject: input.subject,
    issuer: input.issuer,
    serial_number: input.serialNumber,
    fingerprint_sha256: fingerprint,
    valid_from: input.validFrom,
    valid_to: input.validTo,
    status: input.status,
    source: 'expisoft_ldap',
    source_url: input.sourceUrl,
    raw_certificate_pem: input.pem,
    metadata: input.metadata,
    last_checked_at: new Date().toISOString(),
    next_check_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existing.data?.id) {
    const { error } = await supabaseService.from('platform_actor_certificates').update(payload).eq('id', existing.data.id)
    if (error && !isMissingSchema(error)) throw error
    return 'updated' as const
  }

  const { error } = await supabaseService.from('platform_actor_certificates').insert(payload)
  if (error && !isMissingSchema(error)) throw error
  return error ? 'skipped' as const : 'inserted' as const
}

async function listRoutesForActor(actorId: string): Promise<RefreshRoute[]> {
  const { data, error } = await supabaseService
    .from('platform_actor_routes')
    .select('actor_id,message_family,environment,subaddress,communication_address,party_id,interchange_party_id')
    .eq('actor_id', actorId)
    .eq('message_family', 'PRODAT')
    .eq('environment', 'production')
    .eq('status', 'active')
    .limit(50)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }

  const owner = await supabaseService
    .from('grid_owners')
    .select('id,company_id,ediel_id')
    .eq('platform_market_actor_id', actorId)
    .limit(1)
    .maybeSingle()
  if (owner.error && !isMissingSchema(owner.error)) throw owner.error
  const ownerRow = (owner.data ?? {}) as { id?: string | null; company_id?: string | null; ediel_id?: string | null }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      actor_id: actorId,
      grid_owner_id: ownerRow.id ?? null,
      company_id: ownerRow.company_id ?? null,
      ediel_id: clean(ownerRow.ediel_id) ?? clean(row.party_id) ?? clean(row.interchange_party_id),
      subaddress: clean(row.subaddress),
      environment: clean(row.environment) ?? 'production',
      communication_address: clean(row.communication_address),
    }))
    .filter((row) => Boolean(row.communication_address))
}

async function listScheduledCandidates(limit: number): Promise<RefreshRoute[]> {
  const { data, error } = await supabaseService
    .from('ediel_certificate_refresh_candidates_v')
    .select('platform_market_actor_id,grid_owner_id,company_id,ediel_id,smtp_email,subaddress,environment')
    .limit(limit)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    actor_id: String(row.platform_market_actor_id),
    grid_owner_id: clean(row.grid_owner_id),
    company_id: clean(row.company_id),
    ediel_id: clean(row.ediel_id),
    subaddress: clean(row.subaddress),
    environment: clean(row.environment) ?? 'production',
    communication_address: clean(row.smtp_email),
  })).filter((row) => Boolean(row.actor_id && row.communication_address))
}

export async function refreshCertificatesForActor(input: {
  actorId: string
  gridOwnerId?: string | null
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}) {
  const routes = await listRoutesForActor(input.actorId)
  const first = routes[0]
  const jobId = await createRefreshJob({
    actorId: input.actorId,
    gridOwnerId: input.gridOwnerId ?? first?.grid_owner_id ?? null,
    companyId: first?.company_id ?? null,
    edielId: first?.ediel_id ?? null,
    requestedBy: input.requestedBy ?? null,
    triggeredBy: input.triggeredBy,
  })

  if (routes.length === 0) {
    await finishRefreshJob(jobId, { status: 'skipped', error_message: 'Aktören saknar aktiv PRODAT-route med SMTP-adress.' })
    return { ok: false, skipped: true, reason: 'missing_route_or_smtp', found: 0, inserted: 0, updated: 0, valid: 0, expired: 0 }
  }

  let found = 0
  let inserted = 0
  let updated = 0
  let valid = 0
  let expired = 0
  const errors: Array<Record<string, unknown>> = []

  for (const route of routes) {
    if (!route.communication_address) continue
    try {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail: route.communication_address,
        edielId: route.ediel_id,
        subaddress: route.subaddress,
        partyId: route.ediel_id,
        companyId: route.company_id,
        forceRefresh: input.triggeredBy === 'manual',
      })
      found += lookup.certificatesFound
      for (const cert of lookup.certificates) {
        const status = normalizeCertificateStatus(cert.status, cert.validTo)
        if (status === 'valid' || status === 'expires_soon') valid += 1
        if (status === 'expired') expired += 1
        const result = await upsertPlatformActorCertificate({
          actorId: route.actor_id,
          edielId: route.ediel_id,
          environment: route.environment ?? 'production',
          fingerprintSha256: cert.fingerprintSha256,
          status,
          subject: cert.subject,
          issuer: cert.issuer,
          serialNumber: cert.serialNumber,
          validFrom: cert.validFrom ? new Date(cert.validFrom).toISOString() : null,
          validTo: cert.validTo ? new Date(cert.validTo).toISOString() : null,
          pem: cert.pem,
          sourceUrl: lookup.ldapUrl,
          metadata: {
            source: 'manual_or_scheduled_expisoft_lookup',
            triggeredBy: input.triggeredBy,
            lookupEmail: lookup.lookupEmail,
            fetchedFromLdap: lookup.fetchedFromLdap,
            throttled: lookup.throttled,
            route,
            diagnostics: lookup.diagnostics,
          },
        })
        if (result === 'inserted') inserted += 1
        if (result === 'updated') updated += 1
      }
    } catch (error) {
      errors.push({ route, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const recalc = await supabaseService.rpc('gridex_recalculate_actor_readiness', { p_platform_market_actor_id: input.actorId })
  if (recalc.error && !isMissingSchema(recalc.error)) throw recalc.error

  const status = errors.length > 0 ? 'failed' : 'completed'
  await finishRefreshJob(jobId, {
    status,
    found_count: found,
    inserted_count: inserted,
    updated_count: updated,
    valid_count: valid,
    expired_count: expired,
    error_message: errors.length ? 'En eller flera certifikatsökningar misslyckades.' : null,
    metadata: { errors },
  })

  return { ok: errors.length === 0, found, inserted, updated, valid, expired, errors }
}

export async function refreshCertificatesForGridOwner(input: {
  gridOwnerId: string
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}) {
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id,platform_market_actor_id')
    .eq('id', input.gridOwnerId)
    .maybeSingle()
  if (error) throw error
  const actorId = clean((data as { platform_market_actor_id?: string | null } | null)?.platform_market_actor_id)
  if (!actorId) return { ok: false, skipped: true, reason: 'grid_owner_missing_platform_actor_id', found: 0, inserted: 0, updated: 0, valid: 0, expired: 0 }
  return refreshCertificatesForActor({ actorId, gridOwnerId: input.gridOwnerId, triggeredBy: input.triggeredBy, requestedBy: input.requestedBy ?? null })
}

export async function refreshScheduledActorCertificates(input: { limit?: number } = {}) {
  const candidates = await listScheduledCandidates(input.limit ?? 100)
  let processed = 0
  let found = 0
  let inserted = 0
  let updated = 0
  let valid = 0
  let expired = 0
  const errors: Array<Record<string, unknown>> = []

  for (const candidate of candidates) {
    try {
      const result = await refreshCertificatesForActor({ actorId: candidate.actor_id, gridOwnerId: candidate.grid_owner_id, triggeredBy: 'scheduled_30_day' })
      processed += 1
      found += result.found
      inserted += result.inserted
      updated += result.updated
      valid += result.valid
      expired += result.expired
      if (!result.ok) errors.push({ actorId: candidate.actor_id, errors: result.errors })
    } catch (error) {
      errors.push({ actorId: candidate.actor_id, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { ok: errors.length === 0, processed, found, inserted, updated, valid, expired, errors }
}
