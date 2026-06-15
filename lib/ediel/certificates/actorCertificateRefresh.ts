import { supabaseService } from '@/lib/supabase/service'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

type RefreshTrigger = 'manual' | 'scheduled_30_day' | 'xml_import' | 'backfill' | 'certificate_refresh'

type RefreshRoute = {
  actor_id: string
  route_id: string | null
  grid_owner_id: string | null
  company_id: string | null
  ediel_id: string | null
  subaddress: string | null
  environment: 'test' | 'production' | string | null
  communication_address: string | null
  lookup_address: string | null
  route_status: string | null
  source: 'send_readiness_view' | 'platform_actor_routes' | 'candidate_view'
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

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function upper(value: unknown): string {
  return clean(value)?.toUpperCase() ?? ''
}

function normalizeEnvironment(value: unknown): 'test' | 'production' {
  const normalized = clean(value)?.toLowerCase()
  if (normalized === 'test' || normalized === 'testing' || normalized === 'tst') return 'test'
  return 'production'
}

function normalizeCertificateStatus(value: string | null | undefined, validTo?: string | null): 'valid' | 'expires_soon' | 'expired' | 'invalid' | 'unknown' {
  const parsedValidTo = validTo ? Date.parse(validTo) : NaN
  if (Number.isFinite(parsedValidTo)) {
    if (parsedValidTo <= Date.now()) return 'expired'
    if (parsedValidTo <= Date.now() + 45 * 24 * 60 * 60 * 1000) return 'expires_soon'
  }
  if (value === 'valid' || value === 'expires_soon' || value === 'expired' || value === 'invalid') return value
  if (value === 'active') return 'valid'
  if (value === 'not_yet_valid' || value === 'revoked' || value === 'mismatch') return 'invalid'
  return 'unknown'
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

function isRouteSearchable(row: Record<string, unknown>): boolean {
  const family = upper(row.message_family)
  const environment = normalizeEnvironment(row.environment)
  const status = clean(row.route_status) ?? clean(row.status) ?? 'active'
  const subaddress = upper(row.subaddress)

  return family === 'PRODAT'
    && environment === 'production'
    && subaddress !== 'GAS'
    && status !== 'inactive'
    && status !== 'blocked'
}

function routeLookupAddress(input: { communicationAddress?: string | null; edielId?: string | null }): string | null {
  const communicationAddress = clean(input.communicationAddress)
  if (communicationAddress) return communicationAddress
  const edielId = clean(input.edielId)
  return edielId ? `${edielId}@ediel.se` : null
}

function dedupeRoutes(routes: RefreshRoute[]): RefreshRoute[] {
  const seen = new Set<string>()
  const out: RefreshRoute[] = []
  for (const route of routes) {
    const key = [route.actor_id, route.route_id ?? '', route.lookup_address ?? route.communication_address ?? '', route.ediel_id ?? '', route.subaddress ?? ''].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(route)
  }
  return out
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
  source: string
  sourceUrl: string | null
  metadata: Record<string, unknown>
}) {
  const fingerprint = clean(input.fingerprintSha256)?.toUpperCase()
  if (!fingerprint) return 'skipped' as const

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
    source: input.source,
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

async function ownerForActor(actorId: string, gridOwnerId?: string | null) {
  let query = supabaseService
    .from('grid_owners')
    .select('id,company_id,ediel_id,communication_email,email,platform_market_actor_id')

  query = gridOwnerId ? query.eq('id', gridOwnerId) : query.eq('platform_market_actor_id', actorId)

  const { data, error } = await query.limit(1).maybeSingle()
  if (error && !isMissingSchema(error)) throw error
  return (data ?? {}) as {
    id?: string | null
    company_id?: string | null
    ediel_id?: string | null
    communication_email?: string | null
    email?: string | null
    platform_market_actor_id?: string | null
  }
}

async function listRoutesFromSendReadinessView(actorId: string, owner: Awaited<ReturnType<typeof ownerForActor>>): Promise<RefreshRoute[]> {
  const { data, error } = await supabaseService
    .from('platform_actor_send_readiness_v')
    .select('actor_id,route_id,ediel_id,message_family,environment,subaddress,communication_address,route_status')
    .eq('actor_id', actorId)
    .limit(100)

  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(isRouteSearchable)
    .map((row) => {
      const edielId = clean(row.ediel_id) ?? clean(owner.ediel_id)
      const communicationAddress = clean(row.communication_address)
      return {
        actor_id: actorId,
        route_id: clean(row.route_id),
        grid_owner_id: clean(owner.id),
        company_id: clean(owner.company_id),
        ediel_id: edielId,
        subaddress: clean(row.subaddress),
        environment: normalizeEnvironment(row.environment),
        communication_address: communicationAddress,
        lookup_address: routeLookupAddress({ communicationAddress, edielId }),
        route_status: clean(row.route_status),
        source: 'send_readiness_view' as const,
      }
    })
    .filter((row) => Boolean(row.lookup_address))
}

async function listRoutesFromPlatformActorRoutes(actorId: string, owner: Awaited<ReturnType<typeof ownerForActor>>): Promise<RefreshRoute[]> {
  const { data, error } = await supabaseService
    .from('platform_actor_routes')
    .select('id,actor_id,message_family,environment,subaddress,communication_address,party_id,interchange_party_id,status')
    .eq('actor_id', actorId)
    .limit(100)

  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter(isRouteSearchable)
    .map((row) => {
      const edielId = clean(owner.ediel_id) ?? clean(row.party_id) ?? clean(row.interchange_party_id)
      const communicationAddress = clean(row.communication_address)
      return {
        actor_id: actorId,
        route_id: clean(row.id),
        grid_owner_id: clean(owner.id),
        company_id: clean(owner.company_id),
        ediel_id: edielId,
        subaddress: clean(row.subaddress),
        environment: normalizeEnvironment(row.environment),
        communication_address: communicationAddress,
        lookup_address: routeLookupAddress({ communicationAddress, edielId }),
        route_status: clean(row.status),
        source: 'platform_actor_routes' as const,
      }
    })
    .filter((row) => Boolean(row.lookup_address))
}

async function listRoutesForActor(actorId: string, gridOwnerId?: string | null): Promise<RefreshRoute[]> {
  const owner = await ownerForActor(actorId, gridOwnerId)
  const fromReadiness = await listRoutesFromSendReadinessView(actorId, owner)
  const fromRoutes = await listRoutesFromPlatformActorRoutes(actorId, owner)
  return dedupeRoutes([...fromReadiness, ...fromRoutes])
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
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const edielId = clean(row.ediel_id)
    const smtpEmail = clean(row.smtp_email)
    return {
      actor_id: clean(row.platform_market_actor_id) ?? '',
      route_id: null,
      grid_owner_id: clean(row.grid_owner_id),
      company_id: clean(row.company_id),
      ediel_id: edielId,
      subaddress: clean(row.subaddress),
      environment: normalizeEnvironment(row.environment),
      communication_address: smtpEmail,
      lookup_address: routeLookupAddress({ communicationAddress: smtpEmail, edielId }),
      route_status: 'active',
      source: 'candidate_view' as const,
    }
  }).filter((row) => Boolean(row.actor_id && row.lookup_address))
}

async function syncExistingEdielCertificatesForRoutes(routes: RefreshRoute[]) {
  const edielIds = Array.from(new Set(routes.map((route) => route.ediel_id).filter((value): value is string => Boolean(value))))
  if (edielIds.length === 0) return { synced: 0, candidates: 0, inserted: 0, updated: 0 }

  const selectColumns = 'id,owner_ediel_id,owner_party_id,environment,purpose,certificate_type,subject,issuer,serial_number,fingerprint_sha256,certificate_fingerprint,valid_from,valid_to,certificate_valid_from,certificate_valid_to,status,encryption_status,source,public_certificate_pem,metadata'
  const rowsById = new Map<string, ExistingEdielCertificateRow>()

  const queries = [
    supabaseService
      .from('ediel_certificates')
      .select(selectColumns)
      .in('owner_ediel_id', edielIds)
      .eq('purpose', 'encryption')
      .eq('environment', 'production')
      .order('certificate_valid_to', { ascending: false, nullsFirst: false }),
    supabaseService
      .from('ediel_certificates')
      .select(selectColumns)
      .in('owner_party_id', edielIds)
      .eq('purpose', 'encryption')
      .eq('environment', 'production')
      .order('certificate_valid_to', { ascending: false, nullsFirst: false }),
  ]

  for (const query of queries) {
    const result = await query
    if (result.error) {
      if (isMissingSchema(result.error)) continue
      throw result.error
    }
    for (const cert of (result.data ?? []) as ExistingEdielCertificateRow[]) {
      if (cert.id) rowsById.set(cert.id, cert)
    }
  }

  const byEdiel = new Map<string, ExistingEdielCertificateRow[]>()
  for (const cert of rowsById.values()) {
    const keys = [
      cert.owner_ediel_id,
      cert.owner_party_id,
      cert.metadata?.ownerEdielId as string | undefined,
      cert.metadata?.owner_ediel_id as string | undefined,
    ]
    for (const key of keys) {
      if (!key || !edielIds.includes(key)) continue
      byEdiel.set(key, [...(byEdiel.get(key) ?? []), cert])
    }
  }

  let synced = 0
  let inserted = 0
  let updated = 0
  let candidates = 0

  for (const route of routes) {
    const certs = route.ediel_id ? byEdiel.get(route.ediel_id) ?? [] : []
    candidates += certs.length
    for (const cert of certs) {
      const fingerprint = clean(cert.fingerprint_sha256) ?? clean(cert.certificate_fingerprint)
      if (!fingerprint) continue
      const validFrom = clean(cert.valid_from) ?? clean(cert.certificate_valid_from)
      const validTo = clean(cert.valid_to) ?? clean(cert.certificate_valid_to)
      const status = normalizeCertificateStatus(clean(cert.encryption_status) ?? clean(cert.status), validTo)
      const result = await upsertPlatformActorCertificate({
        actorId: route.actor_id,
        edielId: route.ediel_id,
        environment: route.environment ?? 'production',
        fingerprintSha256: fingerprint,
        status,
        subject: cert.subject,
        issuer: cert.issuer,
        serialNumber: cert.serial_number,
        validFrom,
        validTo,
        pem: cert.public_certificate_pem,
        source: cert.source ?? 'ediel_certificates',
        sourceUrl: null,
        metadata: {
          copiedFromEdielCertificateId: cert.id,
          routeId: route.route_id,
          ownerEdielId: cert.owner_ediel_id,
          source: 'existing_ediel_certificates_sync',
          route,
          existingCertificateMetadata: cert.metadata ?? {},
        },
      })
      if (result === 'inserted') inserted += 1
      if (result === 'updated') updated += 1
      if (result === 'inserted' || result === 'updated') synced += 1
    }
  }

  return { synced, candidates, inserted, updated }
}

async function syncDirectoryCacheForRoutes(routes: RefreshRoute[]) {
  let inserted = 0
  let updated = 0
  let candidates = 0

  for (const route of routes) {
    const emails = Array.from(new Set([route.communication_address, route.lookup_address].map(clean).filter((value): value is string => Boolean(value))))
    const query = supabaseService
      .from('ediel_certificate_directory_cache')
      .select('smtp_email,ediel_id,environment,purpose,certificate_pem,public_certificate_pem,fingerprint_sha256,sha256_fingerprint,subject,issuer,serial_number,valid_from,valid_to,not_before,not_after,status,source,metadata')
      .in('smtp_email', emails)
      .limit(20)
    const { data, error } = await query
    if (error) {
      if (isMissingSchema(error)) continue
      throw error
    }

    for (const cert of (data ?? []) as Array<Record<string, unknown>>) {
      const fingerprint = clean(cert.fingerprint_sha256) ?? clean(cert.sha256_fingerprint)
      if (!fingerprint) continue
      candidates += 1
      const validFrom = clean(cert.valid_from) ?? clean(cert.not_before)
      const validTo = clean(cert.valid_to) ?? clean(cert.not_after)
      const result = await upsertPlatformActorCertificate({
        actorId: route.actor_id,
        edielId: clean(cert.ediel_id) ?? route.ediel_id,
        environment: normalizeEnvironment(cert.environment ?? route.environment),
        fingerprintSha256: fingerprint,
        status: normalizeCertificateStatus(clean(cert.status), validTo),
        subject: clean(cert.subject),
        issuer: clean(cert.issuer),
        serialNumber: clean(cert.serial_number),
        validFrom,
        validTo,
        pem: clean(cert.certificate_pem) ?? clean(cert.public_certificate_pem),
        source: clean(cert.source) ?? 'ediel_certificate_directory_cache',
        sourceUrl: null,
        metadata: {
          source: 'directory_cache_sync',
          route,
          cacheMetadata: cert.metadata ?? {},
        },
      })
      if (result === 'inserted') inserted += 1
      if (result === 'updated') updated += 1
    }
  }

  return { candidates, inserted, updated }
}

export async function refreshCertificatesForActor(input: {
  actorId: string
  gridOwnerId?: string | null
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}) {
  const routes = await listRoutesForActor(input.actorId, input.gridOwnerId)
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
    await finishRefreshJob(jobId, {
      status: 'skipped',
      error_message: 'Aktören saknar sökbar PRODAT-route eller EDIEL-adress. Kontrollera route-status, message_family, environment och SMTP-adress.',
      metadata: { reason: 'missing_searchable_prodat_route_or_lookup_address', actorId: input.actorId, gridOwnerId: input.gridOwnerId ?? null },
    })
    return { ok: false, skipped: true, reason: 'missing_searchable_prodat_route_or_lookup_address', found: 0, inserted: 0, updated: 0, valid: 0, expired: 0, routes: [] }
  }

  let found = 0
  let inserted = 0
  let updated = 0
  let valid = 0
  let expired = 0
  const errors: Array<Record<string, unknown>> = []

  const existingSync = await syncExistingEdielCertificatesForRoutes(routes)
  inserted += existingSync.inserted
  updated += existingSync.updated

  const cacheSync = await syncDirectoryCacheForRoutes(routes)
  inserted += cacheSync.inserted
  updated += cacheSync.updated

  for (const route of routes) {
    if (!route.lookup_address) continue
    try {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail: route.lookup_address,
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
          source: 'expisoft_ldap',
          sourceUrl: lookup.ldapUrl,
          metadata: {
            source: 'manual_or_scheduled_expisoft_lookup',
            triggeredBy: input.triggeredBy,
            lookupEmail: lookup.lookupEmail,
            requestedLookupAddress: route.lookup_address,
            routeCommunicationAddress: route.communication_address,
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
    metadata: { errors, routes, existingSync, cacheSync },
  })

  return { ok: errors.length === 0, found, inserted, updated, valid, expired, errors, routes, existingSync, cacheSync }
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
