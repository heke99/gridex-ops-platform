import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextRequest } from 'next/server'
import {
  effectiveRouteRateLimit,
  PUBLIC_API_RATE_LIMIT_COST,
  publicApiRateLimitClassForRequest,
  type PublicApiRateLimitClass,
} from '@/lib/api/publicRouteLookup'
import { supabaseService } from '@/lib/supabase/service'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { ipAllowedByRules, trustedClientIp } from '@/lib/integrations/ipPolicy'
import { tenantContextForIntegration, type TenantContext } from '@/lib/tenant/context'

export type IntegrationApiClient = {
  id: string
  company_id: string
  name: string
  status: string
  key_prefix: string
  secret_hash: string
  scopes: string[]
  allowed_ips: string[]
  allowed_origins?: string[] | null
  metadata?: Record<string, unknown> | null
  rate_limit_per_minute: number
  expires_at: string | null
}

export type IntegrationApiRateLimit = {
  limit: number
  count: number
  remaining: number
  resetAt: string | null
}

export type IntegrationTenantApiStatus =
  | 'active'
  | 'onboarding'
  | 'paused'
  | 'suspended'
  | 'closed'
  | 'archived'
  | 'pending_deletion'
  | 'deleted_test_only'

export type IntegrationScopeRequirement =
  | readonly string[]
  | { allOf?: readonly string[]; anyOf?: readonly string[] }

export type IntegrationApiResponseContext = {
  rateLimit?: IntegrationApiRateLimit
  retryAfterSeconds?: number
}

const integrationApiResponseContext = new AsyncLocalStorage<IntegrationApiResponseContext>()

export function currentIntegrationApiResponseContext(): IntegrationApiResponseContext | null {
  return integrationApiResponseContext.getStore() ?? null
}

export type IntegrationApiAuthResult =
  | { ok: true; client: IntegrationApiClient; context: TenantContext; rateLimit: IntegrationApiRateLimit }
  | {
      ok: false
      status: number
      error: string
      errorCode: string
      client?: IntegrationApiClient | null
      retryAfterSeconds?: number
      rateLimit?: IntegrationApiRateLimit
    }

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token) return token
  }
  const apiKey = request.headers.get('x-api-key')?.trim()
  return apiKey || null
}

export function expandIntegrationApiScopes(clientScopes: string[]): Set<string> {
  const expanded = new Set(clientScopes)
  if (expanded.has('*')) return expanded
  if (expanded.has('customer_portal.read')) {
    for (const scope of [
      'customer_profile.read', 'customer_sites.read', 'customer_contracts.read', 'customer_invoices.read',
      'customer_metering.read', 'customer_legal.read', 'customer_events.read', 'customer_documents.read',
      'customer_notifications.read', 'customer_power_of_attorney.read',
    ]) expanded.add(scope)
  }
  if (expanded.has('customer_portal.write')) {
    for (const scope of [
      'customer_sync.write', 'customer_contact.write', 'customer_facility_data.write',
      'customer_power_of_attorney.write', 'customer_notifications.write', 'customer_documents.write',
    ]) expanded.add(scope)
  }
  return expanded
}

export function missingIntegrationApiScopes(clientScopes: string[], requiredScopes: readonly string[]): string[] {
  if (clientScopes.includes('*')) return []
  const expanded = expandIntegrationApiScopes(clientScopes)
  return requiredScopes.filter((scope) => !expanded.has(scope))
}

function isScopeList(
  requirement: IntegrationScopeRequirement,
): requirement is readonly string[] {
  return Array.isArray(requirement)
}

function hasRequiredScopes(
  clientScopes: string[],
  requirement: IntegrationScopeRequirement,
): boolean {
  const expanded = expandIntegrationApiScopes(clientScopes)
  if (expanded.has('*')) return true
  if (isScopeList(requirement)) {
    return requirement.every((scope) => expanded.has(scope))
  }
  const allOf = requirement.allOf ?? []
  const anyOf = requirement.anyOf ?? []
  return allOf.every((scope) => expanded.has(scope))
    && (anyOf.length === 0 || anyOf.some((scope) => expanded.has(scope)))
}

function scopeRequirementParts(requirement: IntegrationScopeRequirement): {
  allOf: string[]
  anyOf: string[]
} {
  if (isScopeList(requirement)) {
    return { allOf: [...requirement], anyOf: [] }
  }
  return {
    allOf: [...(requirement.allOf ?? [])],
    anyOf: [...(requirement.anyOf ?? [])],
  }
}

function requestIp(request: NextRequest): string | null {
  return trustedClientIp(request.headers)
}

function ipAllowed(client: IntegrationApiClient, ip: string | null): boolean {
  return ipAllowedByRules(ip, client.allowed_ips ?? [])
}

function requestOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')?.trim()
  if (origin) return origin
  const referer = request.headers.get('referer')?.trim()
  if (!referer) return null
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

function originAllowed(client: IntegrationApiClient, origin: string | null): boolean {
  const metadata = client.metadata ?? {}
  const columnOrigins = Array.isArray(client.allowed_origins)
    ? client.allowed_origins.map((item) => String(item).trim()).filter(Boolean)
    : []
  const metadataOrigins = Array.isArray(metadata.allowed_origins)
    ? metadata.allowed_origins.map((item) => String(item).trim()).filter(Boolean)
    : []
  const allowedOrigins = columnOrigins.length > 0 ? columnOrigins : metadataOrigins
  if (allowedOrigins.length === 0 || !origin) return true
  return allowedOrigins.includes(origin)
}

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(code)
    || /schema cache|does not exist|column .* does not exist|function .* not found/i.test(message)
}

function publicError(input: {
  status: number
  message: string
  code: string
  client?: IntegrationApiClient | null
  retryAfterSeconds?: number
  rateLimit?: IntegrationApiRateLimit
}): IntegrationApiAuthResult {
  return {
    ok: false,
    status: input.status,
    error: input.message,
    errorCode: input.code,
    client: input.client ?? null,
    retryAfterSeconds: input.retryAfterSeconds,
    rateLimit: input.rateLimit,
  }
}

export function tenantApiAccessError(status: string | null | undefined): {
  status: number
  code: string
  message: string
} | null {
  if (status === 'active') return null
  if (status === 'onboarding') return { status: 403, code: 'tenant_not_operationally_ready', message: 'Tenantens onboarding är inte klar.' }
  if (status === 'paused') return { status: 423, code: 'tenant_paused', message: 'Tenantens API-åtkomst är pausad.' }
  if (status === 'closed') return { status: 410, code: 'tenant_closed', message: 'Tenantens konto är stängt.' }
  if (status === 'suspended') return { status: 403, code: 'tenant_suspended', message: 'Tenantens konto är avstängt.' }
  if (status === 'archived' || status === 'pending_deletion' || status === 'deleted_test_only') {
    return { status: 410, code: 'tenant_inactive', message: 'Tenantens konto är inte aktivt.' }
  }
  return { status: 503, code: 'tenant_status_unavailable', message: 'Tenantens driftstatus kunde inte verifieras.' }
}

function retryAfterSeconds(resetAt: string | null): number {
  if (!resetAt) return 60
  const resetAtMs = new Date(resetAt).getTime()
  if (!Number.isFinite(resetAtMs)) return 60
  return Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))
}

async function recordRateLimitEvent(
  client: IntegrationApiClient,
  request: NextRequest,
  rateLimit: IntegrationApiRateLimit,
  rateLimitClass: PublicApiRateLimitClass,
) {
  const cooldownUntil = rateLimit.resetAt ?? new Date(Date.now() + 60_000).toISOString()
  const metadata = {
    route: request.nextUrl.pathname,
    rate_limit_class: rateLimitClass,
    ip_address: requestIp(request),
    user_agent: request.headers.get('user-agent'),
    origin: requestOrigin(request),
    client_base_rate_limit_per_minute: client.rate_limit_per_minute,
    route_rate_limit_per_minute: rateLimit.limit,
    observed_requests_last_minute: rateLimit.count,
    cooldown_until: cooldownUntil,
  }

  const event = await supabaseService
    .from('integration_api_rate_limit_events')
    .insert({
      company_id: client.company_id,
      api_client_id: client.id,
      route: request.nextUrl.pathname,
      ip_address: requestIp(request),
      user_agent: request.headers.get('user-agent'),
      request_count: rateLimit.count,
      limit_per_minute: rateLimit.limit,
      cooldown_until: cooldownUntil,
      metadata,
    })
  if (event.error && !missingSchema(event.error)) throw event.error

  const update = await supabaseService
    .from('integration_api_clients')
    .update({
      rate_limited_until: cooldownUntil,
      updated_at: new Date().toISOString(),
      metadata: { ...(client.metadata ?? {}), last_rate_limit: metadata },
    })
    .eq('id', client.id)
  if (update.error && !missingSchema(update.error)) throw update.error
}

type RateLimitDecision =
  | { outcome: 'allowed'; rateLimit: IntegrationApiRateLimit; rateLimitClass: PublicApiRateLimitClass }
  | { outcome: 'limited'; rateLimit: IntegrationApiRateLimit; rateLimitClass: PublicApiRateLimitClass }
  | { outcome: 'misconfigured'; reason: string }
  | { outcome: 'unavailable'; reason: string; databaseCode: string | null }

async function rateLimitDecision(client: IntegrationApiClient, request: NextRequest): Promise<RateLimitDecision> {
  const baseLimit = Number(client.rate_limit_per_minute ?? 0)
  if (!Number.isSafeInteger(baseLimit) || baseLimit <= 0) {
    return { outcome: 'misconfigured', reason: 'rate_limit_per_minute must be a positive integer' }
  }
  const route = request.nextUrl.pathname
  const rateLimitClass = publicApiRateLimitClassForRequest(request.method, route)
  const limit = effectiveRouteRateLimit(baseLimit, rateLimitClass)
  const { data, error } = await supabaseService.rpc('integration_api_rate_limit_check', {
    p_api_client_id: client.id,
    p_route: route,
    p_limit: limit,
    p_window_seconds: 60,
  })
  if (error) {
    console.error('[integration-api] atomic rate limiter unavailable', {
      route,
      code: error.code,
      message: error.message,
      apiClientId: client.id,
    })
    return { outcome: 'unavailable', reason: 'atomic rate limiter RPC failed', databaseCode: error.code ?? null }
  }

  const row = Array.isArray(data) ? data[0] : data
  const allowed = Boolean((row as { allowed?: unknown } | null)?.allowed)
  const count = Number((row as { request_count?: unknown } | null)?.request_count ?? 0)
  const resetAt = String((row as { reset_at?: unknown } | null)?.reset_at ?? '') || null
  const rateLimit: IntegrationApiRateLimit = {
    limit,
    count: Number.isFinite(count) ? count : 0,
    remaining: Math.max(0, limit - (Number.isFinite(count) ? count : 0)),
    resetAt,
  }
  if (!allowed) {
    void recordRateLimitEvent(client, request, rateLimit, rateLimitClass).catch((recordError) => {
      console.warn('[integration-api] rate limit event logging skipped', recordError)
    })
    return { outcome: 'limited', rateLimit, rateLimitClass }
  }
  return { outcome: 'allowed', rateLimit, rateLimitClass }
}

type CanonicalAuthRpcRow = {
  auth_outcome?: string | null
  error_code?: string | null
  tenant_status?: string | null
  client_id?: string | null
  company_id?: string | null
  client_name?: string | null
  client_status?: string | null
  key_prefix?: string | null
  secret_hash?: string | null
  scopes?: string[] | null
  allowed_ips?: string[] | null
  allowed_origins?: string[] | null
  metadata?: Record<string, unknown> | null
  rate_limit_per_minute?: number | null
  expires_at?: string | null
  request_count?: number | null
  route_limit?: number | null
  reset_at?: string | null
}

function clientFromCanonicalAuthRow(row: CanonicalAuthRpcRow): IntegrationApiClient | null {
  if (!row.client_id || !row.company_id) return null
  return {
    id: row.client_id,
    company_id: row.company_id,
    name: row.client_name ?? 'Integration API client',
    status: row.client_status ?? 'unknown',
    key_prefix: row.key_prefix ?? '',
    secret_hash: row.secret_hash ?? '',
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    allowed_ips: Array.isArray(row.allowed_ips) ? row.allowed_ips : [],
    allowed_origins: Array.isArray(row.allowed_origins) ? row.allowed_origins : [],
    metadata: row.metadata ?? {},
    rate_limit_per_minute: Number(row.rate_limit_per_minute ?? 0),
    expires_at: row.expires_at ?? null,
  }
}

function rateLimitFromCanonicalAuthRow(row: CanonicalAuthRpcRow): IntegrationApiRateLimit | null {
  const limit = Number(row.route_limit ?? 0)
  const count = Number(row.request_count ?? 0)
  if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isFinite(count)) return null
  return {
    limit,
    count,
    remaining: Math.max(0, limit - count),
    resetAt: row.reset_at ?? null,
  }
}

async function tryCanonicalAuthRpc(input: {
  request: NextRequest
  keyPrefix: string
  secretHash: string
  requiredScopes: IntegrationScopeRequirement
}): Promise<IntegrationApiAuthResult | null> {
  const route = input.request.nextUrl.pathname
  const rateLimitClass = publicApiRateLimitClassForRequest(input.request.method, route)
  const scopeParts = scopeRequirementParts(input.requiredScopes)
  const { data, error } = await supabaseService.rpc('authenticate_integration_request_v1', {
    p_key_prefix: input.keyPrefix,
    p_secret_hash: input.secretHash,
    p_route: route,
    p_required_all: scopeParts.allOf,
    p_required_any: scopeParts.anyOf,
    p_client_ip: requestIp(input.request),
    p_origin: requestOrigin(input.request),
    p_rate_limit_cost: PUBLIC_API_RATE_LIMIT_COST[rateLimitClass],
    p_window_seconds: 60,
  })

  if (error) {
    if (missingSchema(error)) return null
    console.error('[integration-api] canonical auth RPC unavailable', {
      route,
      code: error.code,
      message: error.message,
    })
    return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API-åtkomst kunde inte verifieras.' })
  }

  const row = (Array.isArray(data) ? data[0] : data) as CanonicalAuthRpcRow | null
  if (!row) return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API-åtkomst kunde inte verifieras.' })
  const client = clientFromCanonicalAuthRow(row)
  const rateLimit = rateLimitFromCanonicalAuthRow(row)
  const errorCode = row.error_code ?? ''

  if (row.auth_outcome === 'allowed') {
    if (!client || !rateLimit) {
      return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API-åtkomst kunde inte verifieras.' })
    }
    // Defense in depth: the optimized database path must never be more
    // permissive than the existing application policy, including legacy
    // metadata-based origin lists.
    if (!hasRequiredScopes(client.scopes, input.requiredScopes)) {
      return publicError({ status: 403, code: 'api_scope_missing', message: 'API-klienten saknar scope.', client })
    }
    if (!ipAllowed(client, requestIp(input.request))) {
      return publicError({ status: 403, code: 'api_ip_not_allowed', message: 'IP-adressen är inte tillåten.', client })
    }
    if (!originAllowed(client, requestOrigin(input.request))) {
      return publicError({ status: 403, code: 'api_origin_not_allowed', message: 'Domänen är inte tillåten för API-klienten.', client })
    }
    const context = tenantContextForIntegration({
      companyId: client.company_id,
      clientId: client.id,
      scopes: [...expandIntegrationApiScopes(client.scopes)],
      correlationId: input.request.headers.get('x-request-id'),
    })
    void supabaseService
      .from('integration_api_clients')
      .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', client.id)
      .then(() => null)
    return { ok: true, client, context, rateLimit }
  }

  if (row.auth_outcome === 'rate_limited') {
    if (client && rateLimit) {
      void recordRateLimitEvent(client, input.request, rateLimit, rateLimitClass).catch((recordError) => {
        console.warn('[integration-api] rate limit event logging skipped', recordError)
      })
    }
    return publicError({
      status: 429,
      code: 'rate_limited',
      message: 'API-klientens trafikgräns har överskridits. Försök igen när rate-limit-fönstret har återställts.',
      client,
      retryAfterSeconds: retryAfterSeconds(rateLimit?.resetAt ?? null),
      rateLimit: rateLimit ?? undefined,
    })
  }

  if (errorCode === 'invalid_api_token') {
    return publicError({ status: 401, code: errorCode, message: 'API-token är ogiltig.' })
  }
  if (errorCode === 'api_client_inactive') {
    return publicError({ status: 403, code: errorCode, message: 'API-klienten är inte aktiv.', client })
  }
  if (errorCode === 'api_token_expired') {
    return publicError({ status: 403, code: errorCode, message: 'API-token har gått ut.', client })
  }
  if (errorCode === 'api_scope_missing') {
    return publicError({ status: 403, code: errorCode, message: 'API-klienten saknar scope.', client })
  }
  if (errorCode === 'api_ip_not_allowed') {
    return publicError({ status: 403, code: errorCode, message: 'IP-adressen är inte tillåten.', client })
  }
  if (errorCode === 'api_origin_not_allowed') {
    return publicError({ status: 403, code: errorCode, message: 'Domänen är inte tillåten för API-klienten.', client })
  }
  if (errorCode.startsWith('tenant_')) {
    const tenantError = tenantApiAccessError(row.tenant_status)
    if (tenantError) {
      return publicError({ status: tenantError.status, code: tenantError.code, message: tenantError.message, client })
    }
  }
  return publicError({
    status: 503,
    code: errorCode || 'api_auth_unavailable',
    message: 'API-åtkomst kunde inte verifieras.',
    client,
  })
}

async function resolveIntegrationApiAccessLegacy(
  request: NextRequest,
  requiredScopes: IntegrationScopeRequirement,
  token: string,
): Promise<IntegrationApiAuthResult> {
  const keyPrefix = token.slice(0, 12)
  const secretHash = hashIntegrationApiSecret(token)
  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('id,company_id,name,status,key_prefix,secret_hash,scopes,allowed_ips,allowed_origins,metadata,rate_limit_per_minute,expires_at')
    .eq('key_prefix', keyPrefix)
    .eq('secret_hash', secretHash)
    .maybeSingle()

  if (error) return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API-åtkomst kunde inte verifieras.' })
  if (!data) return publicError({ status: 401, code: 'invalid_api_token', message: 'API-token är ogiltig.' })

  const client = data as IntegrationApiClient
  if (client.status !== 'active') return publicError({ status: 403, code: 'api_client_inactive', message: 'API-klienten är inte aktiv.', client })
  if (client.expires_at && new Date(client.expires_at).getTime() <= Date.now()) {
    return publicError({ status: 403, code: 'api_token_expired', message: 'API-token har gått ut.', client })
  }

  const { data: company, error: companyError } = await supabaseService
    .from('companies')
    .select('id,status')
    .eq('id', client.company_id)
    .maybeSingle()
  if (companyError || !company) {
    return publicError({ status: 503, code: 'tenant_status_unavailable', message: 'Tenantens driftstatus kunde inte verifieras.', client })
  }
  const tenantAccessError = tenantApiAccessError(String(company.status ?? ''))
  if (tenantAccessError) {
    return publicError({ status: tenantAccessError.status, code: tenantAccessError.code, message: tenantAccessError.message, client })
  }
  if (!hasRequiredScopes(client.scopes ?? [], requiredScopes)) {
    return publicError({ status: 403, code: 'api_scope_missing', message: 'API-klienten saknar scope.', client })
  }
  if (!ipAllowed(client, requestIp(request))) {
    return publicError({ status: 403, code: 'api_ip_not_allowed', message: 'IP-adressen är inte tillåten.', client })
  }
  if (!originAllowed(client, requestOrigin(request))) {
    return publicError({ status: 403, code: 'api_origin_not_allowed', message: 'Domänen är inte tillåten för API-klienten.', client })
  }

  const rateLimit = await rateLimitDecision(client, request)
  if (rateLimit.outcome === 'misconfigured') {
    return publicError({ status: 503, code: 'api_rate_limit_invalid', message: 'API-klientens trafikgräns är felkonfigurerad.', client })
  }
  if (rateLimit.outcome === 'unavailable') {
    return publicError({ status: 503, code: 'api_rate_limiter_unavailable', message: 'API:ts trafikskydd kunde inte verifieras. Försök igen senare.', client })
  }
  if (rateLimit.outcome === 'limited') {
    return publicError({
      status: 429,
      code: 'rate_limited',
      message: 'API-klientens trafikgräns har överskridits. Försök igen när rate-limit-fönstret har återställts.',
      client,
      retryAfterSeconds: retryAfterSeconds(rateLimit.rateLimit.resetAt),
      rateLimit: rateLimit.rateLimit,
    })
  }

  void supabaseService
    .from('integration_api_clients')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', client.id)
    .then(() => null)

  const context = tenantContextForIntegration({
    companyId: client.company_id,
    clientId: client.id,
    scopes: [...expandIntegrationApiScopes(client.scopes ?? [])],
    correlationId: request.headers.get('x-request-id'),
  })
  return { ok: true, client, context, rateLimit: rateLimit.rateLimit }
}

async function resolveIntegrationApiAccess(
  request: NextRequest,
  requiredScopes: IntegrationScopeRequirement,
): Promise<IntegrationApiAuthResult> {
  const token = bearerToken(request)
  if (!token) return publicError({ status: 401, code: 'missing_api_token', message: 'API-token saknas.' })

  try {
    await assertPlatformSchemaReady()
  } catch {
    return publicError({ status: 503, code: 'platform_schema_not_ready', message: 'API:t är tillfälligt avstängt tills databasschemat är verifierat.' })
  }

  const keyPrefix = token.slice(0, 12)
  const secretHash = hashIntegrationApiSecret(token)
  const canonical = await tryCanonicalAuthRpc({
    request,
    keyPrefix,
    secretHash,
    requiredScopes,
  })
  if (canonical) return canonical
  return resolveIntegrationApiAccessLegacy(request, requiredScopes, token)
}

export async function requireIntegrationApiAccess(
  request: NextRequest,
  requiredScopes: IntegrationScopeRequirement,
): Promise<IntegrationApiAuthResult> {
  const result = await resolveIntegrationApiAccess(request, requiredScopes)
  integrationApiResponseContext.enterWith({
    rateLimit: result.rateLimit,
    retryAfterSeconds: result.ok ? undefined : result.retryAfterSeconds,
  })
  return result
}

export async function logIntegrationApiRequest(input: {
  client?: IntegrationApiClient | null
  request: NextRequest
  statusCode: number
  startedAt: number
  errorCode?: string | null
  metadata?: Record<string, unknown>
}) {
  if (!input.client && input.statusCode === 401) return
  const route = input.request.nextUrl.pathname
  // Integration request rows are operational telemetry, not the legal/economic
  // transaction itself. Detach the insert so a successful API response is not
  // held open by a second write roundtrip.
  void Promise.resolve(
    supabaseService
      .from('integration_api_requests')
      .insert({
        company_id: input.client?.company_id ?? null,
        api_client_id: input.client?.id ?? null,
        request_id: input.request.headers.get('x-request-id'),
        method: input.request.method,
        route,
        status_code: input.statusCode,
        duration_ms: Math.max(0, Date.now() - input.startedAt),
        ip_address: requestIp(input.request),
        user_agent: input.request.headers.get('user-agent'),
        idempotency_key: input.request.headers.get('idempotency-key'),
        error_code: input.errorCode ?? null,
        metadata: input.metadata ?? {},
      }),
  )
    .then(({ error }) => {
      if (error) console.warn('[integration-api] request telemetry write failed', { route, code: error.code })
    })
    .catch((error: unknown) => {
      console.warn('[integration-api] request telemetry write failed', { route, error })
    })
}
