import { AsyncLocalStorage } from 'node:async_hooks'
import { after, type NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { ipAllowedByRules, trustedClientIp } from '@/lib/integrations/ipPolicy'
import { tenantContextForIntegration, type TenantContext } from '@/lib/tenant/context'
import { publicRouteCost } from '@/lib/api/publicRouteRegistry'

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

export type IntegrationCredential =
  | { ok: true; token: string; legacyApiKey: boolean }
  | { ok: false; malformedAuthorization: boolean }

export function integrationCredential(request: Pick<NextRequest, 'headers'>): IntegrationCredential {
  const authorization = request.headers.get('authorization')
  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization)
    return match
      ? { ok: true, token: match[1], legacyApiKey: false }
      : { ok: false, malformedAuthorization: true }
  }
  const apiKey = request.headers.get('x-api-key')?.trim()
  return apiKey
    ? { ok: true, token: apiKey, legacyApiKey: true }
    : { ok: false, malformedAuthorization: false }
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
  return ['42P01', '42703', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
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
  if (status === 'onboarding') return { status: 403, code: 'organization_not_operationally_ready', message: 'The organization is not ready for production API access.' }
  if (status === 'paused') return { status: 423, code: 'organization_paused', message: 'API access for the organization is paused.' }
  if (status === 'closed') return { status: 410, code: 'organization_closed', message: 'The organization account is closed.' }
  if (status === 'suspended') return { status: 403, code: 'organization_suspended', message: 'API access for the organization is suspended.' }
  if (status === 'archived' || status === 'pending_deletion' || status === 'deleted_test_only') return { status: 410, code: 'organization_inactive', message: 'The organization is not active.' }
  return { status: 503, code: 'organization_status_unavailable', message: 'The organization status could not be verified.' }
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
  requestCount: number,
  resetAt: string | null
) {
  const cooldownUntil = resetAt ?? new Date(Date.now() + 60_000).toISOString()
  const metadata = {
    route: request.nextUrl.pathname,
    ip_address: requestIp(request),
    user_agent: request.headers.get('user-agent'),
    origin: requestOrigin(request),
    rate_limit_per_minute: client.rate_limit_per_minute,
    observed_requests_last_minute: requestCount,
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
      request_count: requestCount,
      limit_per_minute: client.rate_limit_per_minute,
      cooldown_until: cooldownUntil,
      metadata,
    })

  if (event.error && !missingSchema(event.error)) throw event.error

  await supabaseService
    .from('integration_api_clients')
    .update({
      rate_limited_until: cooldownUntil,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(client.metadata ?? {}),
        last_rate_limit: metadata,
      },
    })
    .eq('id', client.id)
    .then((result) => {
      if (result.error && !missingSchema(result.error)) throw result.error
    })
}

type AuthenticationRpcRow = {
  auth_outcome: 'allowed' | 'denied' | 'rate_limited' | 'unavailable'
  error_code: string | null
  tenant_status: string | null
  client_id: string | null
  company_id: string | null
  client_name: string | null
  client_status: string | null
  key_prefix: string | null
  secret_hash: string | null
  scopes: string[] | null
  allowed_ips: string[] | null
  allowed_origins: string[] | null
  metadata: Record<string, unknown> | null
  rate_limit_per_minute: number | null
  expires_at: string | null
  request_count: number | null
  route_limit: number | null
  reset_at: string | null
}

function splitScopeRequirement(requirement: IntegrationScopeRequirement): {
  requiredAll: string[]
  requiredAny: string[]
} {
  if (isScopeList(requirement)) {
    return { requiredAll: [...requirement], requiredAny: [] }
  }
  return {
    requiredAll: [...(requirement.allOf ?? [])],
    requiredAny: [...(requirement.anyOf ?? [])],
  }
}

function authenticationStatus(code: string, tenantStatus: string | null): number {
  if (code === 'invalid_api_token') return 401
  if (code === 'rate_limited') return 429
  if (
    code === 'tenant_status_unavailable' ||
    code === 'api_rate_limit_invalid' ||
    code === 'api_rate_limiter_unavailable' ||
    code === 'api_auth_unavailable'
  ) return 503
  if (code.startsWith('tenant_')) return tenantApiAccessError(tenantStatus)?.status ?? 403
  return 403
}

async function resolveIntegrationApiAccess(
  request: NextRequest,
  requiredScopes: IntegrationScopeRequirement,
): Promise<IntegrationApiAuthResult> {
  // Reject unauthenticated traffic before touching Supabase. Besides being the
  // correct security boundary, this keeps public 401 responses deterministic
  // during schema outages and prevents route tests from waiting on the network.
  const credential = integrationCredential(request)
  if (!credential.ok) return publicError({
    status: 401,
    code: credential.malformedAuthorization ? 'malformed_authorization' : 'missing_api_token',
    message: credential.malformedAuthorization ? 'Authorization must use the Bearer token format.' : 'API token is missing.',
  })
  const token = credential.token

  try {
    await assertPlatformSchemaReady()
  } catch {
    return publicError({ status: 503, code: 'platform_schema_not_ready', message: 'The API is temporarily unavailable while the platform schema is being verified.' })
  }

  const keyPrefix = token.slice(0, 12)
  const secretHash = hashIntegrationApiSecret(token)
  const scopes = splitScopeRequirement(requiredScopes)
  const route = request.nextUrl.pathname
  const routeCost = publicRouteCost(request.method, route)
  const { data, error } = await supabaseService.rpc('authenticate_integration_request_v1', {
    p_key_prefix: keyPrefix,
    p_secret_hash: secretHash,
    p_route: route,
    p_required_all: scopes.requiredAll,
    p_required_any: scopes.requiredAny,
    p_client_ip: requestIp(request),
    p_origin: requestOrigin(request),
    p_rate_limit_cost: routeCost,
    p_window_seconds: 60,
  })
  if (error) {
    return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API access and traffic protection could not be verified.' })
  }
  const row = (Array.isArray(data) ? data[0] : data) as AuthenticationRpcRow | null
  if (!row) return publicError({ status: 503, code: 'api_auth_unavailable', message: 'API authentication returned no verifiable result.' })

  const client = row.client_id && row.company_id ? {
    id: row.client_id,
    company_id: row.company_id,
    name: row.client_name ?? '',
    status: row.client_status ?? '',
    key_prefix: row.key_prefix ?? '',
    secret_hash: row.secret_hash ?? '',
    scopes: row.scopes ?? [],
    allowed_ips: row.allowed_ips ?? [],
    allowed_origins: row.allowed_origins ?? [],
    metadata: row.metadata ?? {},
    rate_limit_per_minute: Number(row.rate_limit_per_minute ?? 0),
    expires_at: row.expires_at,
  } satisfies IntegrationApiClient : null
  const limit = Number(row.route_limit ?? 0)
  const count = Number(row.request_count ?? 0)
  const rateLimit: IntegrationApiRateLimit = {
    limit: Number.isFinite(limit) ? limit : 0,
    count: Number.isFinite(count) ? count : 0,
    remaining: Math.max(0, limit - count),
    resetAt: row.reset_at ?? null,
  }

  if (row.auth_outcome !== 'allowed' || !client) {
    const internalCode = row.error_code ?? 'api_auth_unavailable'
    const code = internalCode.startsWith('tenant_')
      ? internalCode.replace(/^tenant_/, 'organization_')
      : internalCode
    const status = authenticationStatus(internalCode, row.tenant_status)
    const message = code === 'rate_limited'
      ? 'The API client rate limit has been exceeded.'
      : code === 'api_rate_limiter_unavailable'
        ? 'API traffic protection could not be verified.'
      : code === 'invalid_api_token'
        ? 'The API token is invalid.'
        : code === 'api_scope_missing'
          ? 'The API client does not have the required scope.'
          : 'API access was denied by the authentication policy.'
    if (code === 'rate_limited' && client) {
      await recordRateLimitEvent(client, request, rateLimit.count, rateLimit.resetAt).catch(() => undefined)
    }
    return publicError({
      status,
      code,
      message,
      client,
      retryAfterSeconds: status === 429 ? retryAfterSeconds(rateLimit.resetAt) : undefined,
      rateLimit: status === 429 ? rateLimit : undefined,
    })
  }

  // Usage telemetry must not hold the response path open. The update is best
  // effort and intentionally detached from the authenticated request.
  void supabaseService
    .from('integration_api_clients')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', client.id)
    .then(() => null)

  if (credential.legacyApiKey) {
    void supabaseService.rpc('gridex_record_legacy_api_key_use_v1', {
      p_api_client_id: client.id,
      p_route: route,
    }).then(() => null)
  }

  const context = tenantContextForIntegration({
    companyId: client.company_id,
    clientId: client.id,
    scopes: [...expandIntegrationApiScopes(client.scopes ?? [])],
    correlationId: request.headers.get('x-request-id'),
  })

  return { ok: true, client, context, rateLimit }
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
  // Anonymous 401 traffic has no tenant-safe persistence target. Skipping the
  // database write also prevents unauthenticated requests from turning an
  // integration-database outage into a slow public endpoint.
  if (!input.client && input.statusCode === 401) return

  const payload = {
    company_id: input.client?.company_id ?? null,
    api_client_id: input.client?.id ?? null,
    request_id: input.request.headers.get('x-request-id'),
    method: input.request.method,
    route: input.request.nextUrl.pathname,
    status_code: input.statusCode,
    duration_ms: Math.max(0, Date.now() - input.startedAt),
    ip_address: requestIp(input.request),
    user_agent: input.request.headers.get('user-agent'),
    idempotency_key: input.request.headers.get('idempotency-key'),
    error_code: input.errorCode ?? null,
    metadata: input.metadata ?? {},
  }

  const persist = async () => {
    await supabaseService
      .from('integration_api_requests')
      .insert(payload)
      .then(() => null)
  }

  // API audit/telemetry is secondary to the tenant response. Next.js after()
  // keeps the serverless invocation alive while the write completes, without
  // adding the PostgREST insert latency to every public API request. If this
  // helper is invoked outside a request context (for example a direct unit
  // test), fall back to the previous awaited persistence semantics.
  try {
    after(persist)
  } catch {
    await persist()
  }
}
