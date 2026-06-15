import { supabaseService } from '@/lib/supabase/service'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

type RefreshTrigger = 'manual' | 'scheduled_30_day' | 'xml_import' | 'backfill' | 'certificate_refresh'

type RefreshStatus = 'queued' | 'running' | 'completed' | 'not_found' | 'failed' | 'skipped'

type RefreshRoute = {
  actor_id: string | null
  route_id: string | null
  grid_owner_id: string | null
  company_id: string | null
  ediel_id: string | null
  subaddress: string | null
  environment: 'test' | 'production' | string | null
  communication_address: string | null
  lookup_address: string | null
  route_status: string | null
  source:
    | 'send_readiness_view'
    | 'platform_actor_routes'
    | 'candidate_view'
    | 'grid_owner_route_email'
    | 'grid_owner_communication_email'
    | 'grid_owner_email'
    | 'grid_owner_ediel_fallback'
    | 'actor_identifier_ediel_fallback'
}

type RefreshCounters = {
  found: number
  inserted: number
  updated: number
  valid: number
  expired: number
}

type RefreshResult = RefreshCounters & {
  ok: boolean
  skipped?: boolean
  reason?: string
  errors?: Array<Record<string, unknown>>
  routes?: RefreshRoute[]
  existingSync?: Record<string, unknown>
  cacheSync?: Record<string, unknown>
  metadata?: Record<string, unknown>
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

type GridOwnerLookupRow = {
  id?: string | null
  company_id?: string | null
  ediel_id?: string | null
  communication_email?: string | null
  email?: string | null
  platform_market_actor_id?: string | null
  name?: string | null
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

function jsonSafeString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error && value.message) return value.message
  if (value === null || value === undefined) return ''
  try {
    const serialized = JSON.stringify(value)
    if (serialized && serialized !== '{}') return serialized
  } catch {
    // Fall through to String below.
  }
  return String(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  const maybe = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown } | null
  const message = jsonSafeString(maybe?.message)
  if (message && message !== '[object Object]') return message
  const details = jsonSafeString(maybe?.details)
  const hint = jsonSafeString(maybe?.hint)
  const code = jsonSafeString(maybe?.code)
  const parts = [code, details, hint].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  const fallback = jsonSafeString(error)
  return fallback && fallback !== '[object Object]' ? fallback : 'Okänt fel'
}

function safeError(error: unknown): Record<string, unknown> {
  const maybe = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown; stack?: unknown } | null
  return {
    message: errorMessage(error),
    code: typeof maybe?.code === 'string' ? maybe.code : undefined,
    details: maybe?.details === undefined ? undefined : jsonSafeString(maybe.details),
    hint: maybe?.hint === undefined ? undefined : jsonSafeString(maybe.hint),
  }
}

function isTypeCastError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = errorMessage(error)
  return code === '22P02' || /invalid input syntax for type/i.test(message)
}

function refreshStatusFromCounts(input: { found: number; valid: number; errors?: unknown[] }): RefreshStatus {
  if ((input.errors?.length ?? 0) > 0) return 'failed'
  if (input.found <= 0) return 'not_found'
  return 'completed'
}

function refreshErrorMessage(status: RefreshStatus, lookupAddresses: string[], errors?: unknown[]): string | null {
  const addressText = lookupAddresses.join(', ') || 'valda söknycklar'
  const firstError = errors?.[0]
  const firstErrorText = firstError ? errorMessage(firstError) : null
  if (status === 'failed') {
    return firstErrorText
      ? `Certifikatsökningen misslyckades för ${addressText}. ${firstErrorText}`
      : `Certifikatsökningen misslyckades för ${addressText}.`
  }
  if (status === 'not_found') return `Sökte via ${addressText} men inget certifikat hittades i Expisoft.`
  return null
}

function isRouteSearchable(row: Record<string, unknown>): boolean {
  const family = upper(row.message_family)
  const environment = normalizeEnvironment(row.environment)
  const status = (clean(row.route_status) ?? clean(row.status) ?? 'active').toLowerCase()
  const subaddress = upper(row.subaddress)

  return family === 'PRODAT'
    && environment === 'production'
    && subaddress !== 'GAS'
    && status !== 'inactive'
    && status !== 'blocked'
}

function normalizeEmail(value: unknown): string | null {
  const email = clean(value)?.toLowerCase()
  if (!email) return null
  if (!email.includes('@')) return null
  return email
}

function edielFallbackAddress(edielId?: string | null): string | null {
  const ediel = clean(edielId)
  return ediel ? `${ediel.toLowerCase()}@ediel.se` : null
}

function routeLookupAddress(input: { communicationAddress?: string | null; edielId?: string | null }): string | null {
  return normalizeEmail(input.communicationAddress) ?? edielFallbackAddress(input.edielId)
}

function dedupeRoutes(routes: RefreshRoute[]): RefreshRoute[] {
  const seen = new Set<string>()
  const out: RefreshRoute[] = []
  for (const route of routes) {
    const key = [route.actor_id ?? '', route.route_id ?? '', route.lookup_address ?? '', route.ediel_id ?? '', route.subaddress ?? '', route.source].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(route)
  }
  return out
}

function lookupDiagnostics(routes: RefreshRoute[], extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    ldapHost: process.env.EDIEL_EXPISOFT_LDAP_HOST ?? 'sodir01.expisoft.se',
    ldapPort: Number(process.env.EDIEL_EXPISOFT_LDAP_PORT ?? '389'),
    ldapBaseDn: process.env.EDIEL_EXPISOFT_LDAP_BASE_DN ?? 'c=se',
    liveLookupAttempted: true,
    lookupAddresses: Array.from(new Set(routes.map((route) => route.lookup_address).filter((value): value is string => Boolean(value)))),
    lookupSources: Array.from(new Set(routes.map((route) => route.source))),
    routeSources: routes.map((route) => ({
      source: route.source,
      routeId: route.route_id,
      actorId: route.actor_id,
      gridOwnerId: route.grid_owner_id,
      edielId: route.ediel_id,
      subaddress: route.subaddress,
      communicationAddress: route.communication_address,
      lookupAddress: route.lookup_address,
      routeStatus: route.route_status,
      environment: route.environment,
    })),
  }
}

async function safeAudit(action: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseService
    .from('audit_logs')
    .insert({
      action,
      entity_type: 'ediel_certificate_refresh',
      entity_id: clean(metadata.gridOwnerId) ?? clean(metadata.actorId) ?? 'system',
      metadata,
      created_at: new Date().toISOString(),
    })
  if (error && !isMissingSchema(error)) console.error('ediel_certificate_refresh_audit_failed', error)
}

async function createRefreshJob(input: {
  triggeredBy: RefreshTrigger
  actorId?: string | null
  gridOwnerId?: string | null
  companyId?: string | null
  edielId?: string | null
  requestedBy?: string | null
  metadata?: Record<string, unknown>
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
      metadata: input.metadata ?? {},
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
  if (error && !isMissingSchema(error)) {
    console.error('ediel_certificate_refresh_job_finish_failed', error)
  }
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
    return error ? 'skipped' as const : 'updated' as const
  }

  const { error } = await supabaseService.from('platform_actor_certificates').insert(payload)
  if (error && !isMissingSchema(error)) throw error
  return error ? 'skipped' as const : 'inserted' as const
}

async function ownerForActor(actorId: string, gridOwnerId?: string | null): Promise<GridOwnerLookupRow> {
  let query = supabaseService
    .from('grid_owners')
    .select('id,name,company_id,ediel_id,communication_email,email,platform_market_actor_id')

  query = gridOwnerId ? query.eq('id', gridOwnerId) : query.eq('platform_market_actor_id', actorId)

  const { data, error } = await query.limit(1).maybeSingle()
  if (error && !isMissingSchema(error)) throw error
  return (data ?? {}) as GridOwnerLookupRow
}

async function actorEdielId(actorId: string): Promise<string | null> {
  const identifiers = await supabaseService
    .from('platform_actor_identifiers')
    .select('identifier_type,identifier_value,is_verified')
    .eq('actor_id', actorId)
    .in('identifier_type', ['EdielId', 'ediel_id', 'edielid'])
    .limit(20)
  if (identifiers.error) {
    if (!isMissingSchema(identifiers.error)) throw identifiers.error
    return null
  }
  const identifierRows = (identifiers.data ?? []) as Array<{ identifier_type?: unknown; identifier_value?: unknown; is_verified?: unknown }>
  const verified = identifierRows.find((row) => row.is_verified === true && clean(row.identifier_value))
  const first = verified ?? identifierRows.find((row) => clean(row.identifier_value))
  return clean(first?.identifier_value)
}

function fallbackRoutesForOwner(input: {
  actorId: string | null
  owner: GridOwnerLookupRow
  edielId?: string | null
}): RefreshRoute[] {
  const edielId = clean(input.owner.ediel_id) ?? clean(input.edielId)
  const addresses = [
    { address: normalizeEmail(input.owner.communication_email), source: 'grid_owner_communication_email' as const },
    { address: normalizeEmail(input.owner.email), source: 'grid_owner_email' as const },
    { address: edielFallbackAddress(edielId), source: 'grid_owner_ediel_fallback' as const },
  ]

  return addresses
    .filter((item) => Boolean(item.address))
    .map((item) => ({
      actor_id: input.actorId,
      route_id: null,
      grid_owner_id: clean(input.owner.id),
      company_id: clean(input.owner.company_id),
      ediel_id: edielId,
      subaddress: null,
      environment: 'production',
      communication_address: item.source === 'grid_owner_ediel_fallback' ? null : item.address!,
      lookup_address: item.address!,
      route_status: 'lookup_only',
      source: item.source,
    }))
}

async function listRoutesFromSendReadinessView(actorId: string, owner: GridOwnerLookupRow): Promise<RefreshRoute[]> {
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

async function listRoutesFromPlatformActorRoutes(actorId: string, owner: GridOwnerLookupRow): Promise<RefreshRoute[]> {
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
  const edielId = clean(owner.ediel_id) ?? await actorEdielId(actorId)
  const fromReadiness = await listRoutesFromSendReadinessView(actorId, owner)
  const fromRoutes = await listRoutesFromPlatformActorRoutes(actorId, owner)
  const fallback = fallbackRoutesForOwner({ actorId, owner, edielId })
  return dedupeRoutes([...fromReadiness, ...fromRoutes, ...fallback])
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
    const smtpEmail = normalizeEmail(row.smtp_email)
    return {
      actor_id: clean(row.platform_market_actor_id),
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
  }).filter((row) => Boolean(row.actor_id && row.lookup_address)) as RefreshRoute[]
}

async function syncExistingEdielCertificatesForRoutes(routes: RefreshRoute[]) {
  const actorRoutes = routes.filter((route): route is RefreshRoute & { actor_id: string } => Boolean(route.actor_id))
  const edielIds = Array.from(new Set(actorRoutes.map((route) => route.ediel_id).filter((value): value is string => Boolean(value))))
  if (actorRoutes.length === 0 || edielIds.length === 0) return { synced: 0, candidates: 0, inserted: 0, updated: 0, skipped: true, reason: 'no_safe_actor_routes', queryWarnings: [] }

  const selectColumns = 'id,owner_ediel_id,owner_party_id,environment,purpose,certificate_type,subject,issuer,serial_number,fingerprint_sha256,certificate_fingerprint,valid_from,valid_to,certificate_valid_from,certificate_valid_to,status,encryption_status,source,public_certificate_pem,metadata'
  const rowsById = new Map<string, ExistingEdielCertificateRow>()

  const queryWarnings: Array<Record<string, unknown>> = []
  const queries = [
    {
      name: 'owner_ediel_id',
      query: supabaseService
        .from('ediel_certificates')
        .select(selectColumns)
        .in('owner_ediel_id', edielIds)
        .eq('purpose', 'encryption')
        .eq('environment', 'production')
        .order('certificate_valid_to', { ascending: false, nullsFirst: false }),
    },
  ]

  // Do not query owner_party_id with Ediel IDs. In some production schemas owner_party_id is UUID,
  // and passing values like "24200" produces Postgres 22P02 before LDAP lookup starts.
  for (const item of queries) {
    const result = await item.query
    if (result.error) {
      if (isMissingSchema(result.error) || isTypeCastError(result.error)) {
        queryWarnings.push({ source: item.name, error: safeError(result.error), skipped: true })
        continue
      }
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

  for (const route of actorRoutes) {
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

  return { synced, candidates, inserted, updated, queryWarnings }
}

async function syncDirectoryCacheForRoutes(routes: RefreshRoute[]) {
  const actorRoutes = routes.filter((route): route is RefreshRoute & { actor_id: string } => Boolean(route.actor_id))
  let inserted = 0
  let updated = 0
  let candidates = 0

  for (const route of actorRoutes) {
    const emails = Array.from(new Set([route.communication_address, route.lookup_address].map(normalizeEmail).filter((value): value is string => Boolean(value))))
    if (emails.length === 0) continue
    const { data, error } = await supabaseService
      .from('ediel_certificate_directory_cache')
      .select('smtp_email,ediel_id,environment,purpose,certificate_pem,public_certificate_pem,fingerprint_sha256,sha256_fingerprint,subject,issuer,serial_number,valid_from,valid_to,not_before,not_after,status,source,metadata,diagnostics')
      .in('smtp_email', emails)
      .limit(20)
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
          cacheDiagnostics: cert.diagnostics ?? {},
        },
      })
      if (result === 'inserted') inserted += 1
      if (result === 'updated') updated += 1
    }
  }

  return { candidates, inserted, updated }
}

async function recordLookupMiss(input: {
  route: RefreshRoute
  lookupAddress: string
  diagnostics: Record<string, unknown>
}) {
  const payload = {
    company_id: input.route.company_id,
    platform_market_actor_id: input.route.actor_id,
    smtp_email: input.lookupAddress,
    ediel_id: input.route.ediel_id,
    subaddress: input.route.subaddress,
    source: 'expisoft_ldap',
    environment: normalizeEnvironment(input.route.environment),
    purpose: 'encryption',
    lookup_key: input.lookupAddress,
    lookup_status: 'not_found',
    last_checked_at: new Date().toISOString(),
    metadata: {
      source: 'expisoft_ldap_not_found',
      diagnostics: input.diagnostics,
      route: input.route,
    },
    diagnostics: input.diagnostics,
    fetched_at: new Date().toISOString(),
    status: 'unknown',
  }
  const { error } = await supabaseService.from('ediel_certificate_directory_cache').insert(payload)
  if (error && !isMissingSchema(error)) {
    // If the legacy unique constraint requires a fingerprint, keep diagnostics in the refresh job instead of failing the action.
    console.warn('ediel_certificate_lookup_miss_cache_skipped', error.message)
  }
}

async function syncLiveLookupForRoutes(input: {
  routes: RefreshRoute[]
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}) {
  const counters: RefreshCounters = { found: 0, inserted: 0, updated: 0, valid: 0, expired: 0 }
  const errors: Array<Record<string, unknown>> = []
  const lookupResults: Array<Record<string, unknown>> = []

  for (const route of input.routes) {
    if (!route.lookup_address) continue
    const startedAt = Date.now()
    try {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail: route.lookup_address,
        edielId: route.ediel_id,
        subaddress: route.subaddress,
        partyId: route.ediel_id,
        companyId: route.company_id,
        platformMarketActorId: route.actor_id,
        forceRefresh: input.triggeredBy === 'manual',
      })
      counters.found += lookup.certificatesFound
      lookupResults.push({
        route,
        lookupEmail: lookup.lookupEmail,
        requestedLookupAddress: route.lookup_address,
        ldapUrl: lookup.ldapUrl,
        fetchedFromLdap: lookup.fetchedFromLdap,
        throttled: lookup.throttled,
        status: lookup.certificatesFound > 0 ? 'found' : 'not_found',
        certificatesFound: lookup.certificatesFound,
        durationMs: Date.now() - startedAt,
        diagnostics: lookup.diagnostics,
      })

      if (lookup.certificatesFound === 0) {
        await recordLookupMiss({ route, lookupAddress: route.lookup_address, diagnostics: lookup.diagnostics })
      }

      for (const cert of lookup.certificates) {
        const status = normalizeCertificateStatus(cert.status, cert.validTo)
        if (status === 'valid' || status === 'expires_soon') counters.valid += 1
        if (status === 'expired') counters.expired += 1

        if (!route.actor_id) continue
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
        if (result === 'inserted') counters.inserted += 1
        if (result === 'updated') counters.updated += 1
      }
    } catch (error) {
      const diagnosticError = { route, lookupAddress: route.lookup_address, status: 'failed', durationMs: Date.now() - startedAt, error: safeError(error) }
      errors.push(diagnosticError)
      lookupResults.push(diagnosticError)
    }
  }

  return { ...counters, errors, lookupResults }
}

async function recalculateReadiness(actorId?: string | null) {
  if (!actorId) return { skipped: true, reason: 'missing_actor_id' }
  const recalc = await supabaseService.rpc('gridex_recalculate_actor_readiness', { p_platform_market_actor_id: actorId })
  if (recalc.error && !isMissingSchema(recalc.error)) throw recalc.error
  return { skipped: Boolean(recalc.error), error: recalc.error ? errorMessage(recalc.error) : null }
}

export async function refreshCertificatesForActor(input: {
  actorId: string
  gridOwnerId?: string | null
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}): Promise<RefreshResult> {
  let routes: RefreshRoute[] = []
  let jobId: string | null = null
  let inserted = 0
  let updated = 0
  let existingSync: Record<string, unknown> = { skipped: true, reason: 'not_started' }
  let cacheSync: Record<string, unknown> = { skipped: true, reason: 'not_started' }
  let live: Awaited<ReturnType<typeof syncLiveLookupForRoutes>> = { found: 0, inserted: 0, updated: 0, valid: 0, expired: 0, errors: [], lookupResults: [] }
  let recalc: Record<string, unknown> = { skipped: true, reason: 'not_started' }

  try {
    routes = await listRoutesForActor(input.actorId, input.gridOwnerId)
    const first = routes[0]
    jobId = await createRefreshJob({
      actorId: input.actorId,
      gridOwnerId: input.gridOwnerId ?? first?.grid_owner_id ?? null,
      companyId: first?.company_id ?? null,
      edielId: first?.ediel_id ?? null,
      requestedBy: input.requestedBy ?? null,
      triggeredBy: input.triggeredBy,
      metadata: lookupDiagnostics(routes, { actorId: input.actorId, gridOwnerId: input.gridOwnerId ?? null, stage: 'started' }),
    })

    if (routes.length === 0) {
      const metadata = lookupDiagnostics(routes, { reason: 'missing_lookup_address', actorId: input.actorId, gridOwnerId: input.gridOwnerId ?? null, stage: 'skipped' })
      await finishRefreshJob(jobId, {
        status: 'skipped',
        error_message: 'Aktören saknar EDIEL-id, SMTP-adress eller fallback-adress för certifikatsökning.',
        metadata,
      })
      return { ok: false, skipped: true, reason: 'missing_lookup_address', found: 0, inserted: 0, updated: 0, valid: 0, expired: 0, routes, metadata }
    }

    existingSync = await syncExistingEdielCertificatesForRoutes(routes)
    inserted += Number(existingSync.inserted ?? 0)
    updated += Number(existingSync.updated ?? 0)

    cacheSync = await syncDirectoryCacheForRoutes(routes)
    inserted += Number(cacheSync.inserted ?? 0)
    updated += Number(cacheSync.updated ?? 0)

    live = await syncLiveLookupForRoutes({ routes, triggeredBy: input.triggeredBy, requestedBy: input.requestedBy })
    inserted += live.inserted
    updated += live.updated

    recalc = await recalculateReadiness(input.actorId)

    const status = refreshStatusFromCounts({ found: live.found, valid: live.valid, errors: live.errors })
    const metadata = lookupDiagnostics(routes, {
      stage: status,
      existingSync,
      cacheSync,
      lookupResults: live.lookupResults,
      errors: live.errors,
      recalc,
    })

    await finishRefreshJob(jobId, {
      status,
      found_count: live.found,
      inserted_count: inserted,
      updated_count: updated,
      valid_count: live.valid,
      expired_count: live.expired,
      error_message: refreshErrorMessage(status, metadata.lookupAddresses as string[], live.errors),
      metadata,
    })

    await safeAudit('ediel_certificate_refresh.actor_completed', {
      actorId: input.actorId,
      gridOwnerId: input.gridOwnerId ?? null,
      triggeredBy: input.triggeredBy,
      status,
      found: live.found,
      inserted,
      updated,
      valid: live.valid,
      expired: live.expired,
      errors: live.errors,
    })

    return { ok: status !== 'failed', found: live.found, inserted, updated, valid: live.valid, expired: live.expired, errors: live.errors, routes, existingSync, cacheSync, metadata }
  } catch (error) {
    const routesForDiagnostics = routes.length > 0 ? routes : []
    const metadata = lookupDiagnostics(routesForDiagnostics, {
      stage: 'failed',
      actorId: input.actorId,
      gridOwnerId: input.gridOwnerId ?? null,
      existingSync,
      cacheSync,
      lookupResults: live.lookupResults,
      errors: [...(live.errors ?? []), safeError(error)],
      recalc,
    })
    await finishRefreshJob(jobId, {
      status: 'failed',
      found_count: live.found,
      inserted_count: inserted,
      updated_count: updated,
      valid_count: live.valid,
      expired_count: live.expired,
      error_message: errorMessage(error),
      metadata,
    })
    await safeAudit('ediel_certificate_refresh.actor_failed', {
      actorId: input.actorId,
      gridOwnerId: input.gridOwnerId ?? null,
      triggeredBy: input.triggeredBy,
      error: safeError(error),
      lookupAddresses: metadata.lookupAddresses,
    })
    return { ok: false, found: live.found, inserted, updated, valid: live.valid, expired: live.expired, errors: [...(live.errors ?? []), safeError(error)], routes, existingSync, cacheSync, metadata }
  }
}

async function resolveActorIdForGridOwner(owner: GridOwnerLookupRow): Promise<{ actorId: string | null; source: string }> {
  const existingActorId = clean(owner.platform_market_actor_id)
  if (existingActorId) return { actorId: existingActorId, source: 'grid_owners.platform_market_actor_id' }

  const edielId = clean(owner.ediel_id)
  if (!edielId) return { actorId: null, source: 'missing_grid_owner_ediel_id' }

  const identifierResult = await supabaseService
    .from('platform_actor_identifiers')
    .select('actor_id,identifier_type,identifier_value')
    .eq('identifier_value', edielId)
    .limit(20)

  if (identifierResult.error) {
    if (!isMissingSchema(identifierResult.error)) throw identifierResult.error
  } else {
    const identifierRows = (identifierResult.data ?? []) as Array<{ actor_id?: unknown; identifier_type?: unknown; identifier_value?: unknown }>
    const actorIds = Array.from(new Set(identifierRows
      .filter((row) => ['edielid', 'ediel_id'].includes(String(row.identifier_type ?? '').toLowerCase()))
      .map((row) => clean(row.actor_id))
      .filter((value): value is string => Boolean(value))))
    if (actorIds.length === 1) {
      const actorId = String(actorIds[0])
      const { error: updateError } = await supabaseService
        .from('grid_owners')
        .update({ platform_market_actor_id: actorId, updated_at: new Date().toISOString() })
        .eq('id', owner.id)
      if (updateError && !isMissingSchema(updateError)) throw updateError
      return { actorId: actorId ?? null, source: 'platform_actor_identifiers.ediel_id' }
    }
    if (actorIds.length > 1) return { actorId: null, source: 'ambiguous_platform_actor_identifiers_ediel_id' }
  }

  return { actorId: null, source: 'no_platform_actor_match_for_grid_owner_ediel_id' }
}

async function lookupOnlyForGridOwner(input: {
  owner: GridOwnerLookupRow
  reason: string
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}): Promise<RefreshResult> {
  const routes = dedupeRoutes(fallbackRoutesForOwner({ actorId: null, owner: input.owner }))
  let jobId: string | null = null
  let live: Awaited<ReturnType<typeof syncLiveLookupForRoutes>> = { found: 0, inserted: 0, updated: 0, valid: 0, expired: 0, errors: [], lookupResults: [] }

  try {
    jobId = await createRefreshJob({
      gridOwnerId: clean(input.owner.id),
      companyId: clean(input.owner.company_id),
      edielId: clean(input.owner.ediel_id),
      requestedBy: input.requestedBy ?? null,
      triggeredBy: input.triggeredBy,
      metadata: lookupDiagnostics(routes, { reason: input.reason, lookupOnly: true, stage: 'started' }),
    })

    if (routes.length === 0) {
      const metadata = lookupDiagnostics(routes, { reason: input.reason, lookupOnly: true, missing: 'ediel_id_or_email', stage: 'skipped' })
      await finishRefreshJob(jobId, {
        status: 'skipped',
        error_message: 'Nätägaren saknar EDIEL-id och e-postadress för certifikatsökning.',
        metadata,
      })
      return { ok: false, skipped: true, reason: 'missing_grid_owner_ediel_or_email', found: 0, inserted: 0, updated: 0, valid: 0, expired: 0, routes, metadata }
    }

    live = await syncLiveLookupForRoutes({ routes, triggeredBy: input.triggeredBy, requestedBy: input.requestedBy })
    const status = refreshStatusFromCounts({ found: live.found, valid: live.valid, errors: live.errors })
    const metadata = lookupDiagnostics(routes, { reason: input.reason, lookupOnly: true, stage: status, lookupResults: live.lookupResults, errors: live.errors })
    await finishRefreshJob(jobId, {
      status,
      found_count: live.found,
      inserted_count: 0,
      updated_count: 0,
      valid_count: live.valid,
      expired_count: live.expired,
      error_message: refreshErrorMessage(status, metadata.lookupAddresses as string[], live.errors),
      metadata,
    })

    await safeAudit('ediel_certificate_refresh.grid_owner_lookup_only_completed', {
      gridOwnerId: input.owner.id ?? null,
      edielId: input.owner.ediel_id ?? null,
      reason: input.reason,
      status,
      found: live.found,
      valid: live.valid,
      expired: live.expired,
      errors: live.errors,
    })

    return { ok: status !== 'failed', found: live.found, inserted: 0, updated: 0, valid: live.valid, expired: live.expired, errors: live.errors, routes, metadata }
  } catch (error) {
    const metadata = lookupDiagnostics(routes, { reason: input.reason, lookupOnly: true, stage: 'failed', lookupResults: live.lookupResults, errors: [...(live.errors ?? []), safeError(error)] })
    await finishRefreshJob(jobId, {
      status: 'failed',
      found_count: live.found,
      inserted_count: 0,
      updated_count: 0,
      valid_count: live.valid,
      expired_count: live.expired,
      error_message: errorMessage(error),
      metadata,
    })
    await safeAudit('ediel_certificate_refresh.grid_owner_lookup_only_failed', {
      gridOwnerId: input.owner.id ?? null,
      edielId: input.owner.ediel_id ?? null,
      reason: input.reason,
      error: safeError(error),
      lookupAddresses: metadata.lookupAddresses,
    })
    return { ok: false, found: live.found, inserted: 0, updated: 0, valid: live.valid, expired: live.expired, errors: [...(live.errors ?? []), safeError(error)], routes, metadata }
  }
}

export async function refreshCertificatesForGridOwner(input: {
  gridOwnerId: string
  triggeredBy: RefreshTrigger
  requestedBy?: string | null
}): Promise<RefreshResult> {
  const { data, error } = await supabaseService
    .from('grid_owners')
    .select('id,name,company_id,ediel_id,communication_email,email,platform_market_actor_id')
    .eq('id', input.gridOwnerId)
    .maybeSingle()
  if (error) throw error

  const owner = (data ?? {}) as GridOwnerLookupRow
  if (!owner.id) {
    const fakeOwner: GridOwnerLookupRow = { id: input.gridOwnerId }
    return lookupOnlyForGridOwner({ owner: fakeOwner, reason: 'grid_owner_not_found', triggeredBy: input.triggeredBy, requestedBy: input.requestedBy })
  }

  const resolved = await resolveActorIdForGridOwner(owner)
  if (!resolved.actorId) {
    return lookupOnlyForGridOwner({ owner, reason: resolved.source, triggeredBy: input.triggeredBy, requestedBy: input.requestedBy })
  }

  return refreshCertificatesForActor({
    actorId: resolved.actorId,
    gridOwnerId: input.gridOwnerId,
    triggeredBy: input.triggeredBy,
    requestedBy: input.requestedBy ?? null,
  })
}

export async function refreshScheduledActorCertificates(input: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 50))
  const candidates = await listScheduledCandidates(limit)
  let processed = 0
  let found = 0
  let inserted = 0
  let updated = 0
  let valid = 0
  let expired = 0
  const errors: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []

  for (const candidate of candidates) {
    try {
      if (!candidate.actor_id) {
        skipped.push({ candidate, reason: 'missing_actor_id' })
        continue
      }
      const result = await refreshCertificatesForActor({ actorId: candidate.actor_id, gridOwnerId: candidate.grid_owner_id, triggeredBy: 'scheduled_30_day' })
      processed += 1
      found += result.found
      inserted += result.inserted
      updated += result.updated
      valid += result.valid
      expired += result.expired
      if (result.skipped) skipped.push({ actorId: candidate.actor_id, reason: result.reason })
      if (!result.ok && result.errors?.length) errors.push({ actorId: candidate.actor_id, errors: result.errors })
    } catch (error) {
      errors.push({ actorId: candidate.actor_id, gridOwnerId: candidate.grid_owner_id, error: errorMessage(error) })
    }
  }

  await safeAudit('ediel_certificate_refresh.scheduled_bulk_completed', {
    processed,
    found,
    inserted,
    updated,
    valid,
    expired,
    errors,
    skipped,
    limit,
  })

  return { ok: errors.length === 0, processed, found, inserted, updated, valid, expired, errors, skipped, limit }
}
