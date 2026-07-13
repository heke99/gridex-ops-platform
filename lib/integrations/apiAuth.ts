import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { hashIntegrationApiSecret } from '@/lib/integrations/apiClientSecrets'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'

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

export type IntegrationApiAuthResult =
  | { ok: true; client: IntegrationApiClient }
  | { ok: false; status: number; error: string; errorCode: string; client?: IntegrationApiClient | null }

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token) return token
  }

  const apiKey = request.headers.get('x-api-key')?.trim()
  return apiKey || null
}

function hasRequiredScopes(clientScopes: string[], requiredScopes: string[]): boolean {
  if (clientScopes.includes('*')) return true
  const expanded = new Set(clientScopes)
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
  return requiredScopes.every((scope) => expanded.has(scope))
}

function requestIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    null
  )
}

function ipAllowed(client: IntegrationApiClient, ip: string | null): boolean {
  if (client.allowed_ips.length === 0) return true
  return Boolean(ip && client.allowed_ips.includes(ip))
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

function publicError(input: { status: number; message: string; code: string; client?: IntegrationApiClient | null }): IntegrationApiAuthResult {
  return {
    ok: false,
    status: input.status,
    error: input.message,
    errorCode: input.code,
    client: input.client ?? null,
  }
}

async function recordRateLimitEvent(client: IntegrationApiClient, request: NextRequest, requestCount: number) {
  const cooldownUntil = new Date(Date.now() + 60_000).toISOString()
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

async function rateLimitAllowed(client: IntegrationApiClient, request: NextRequest): Promise<{ allowed: boolean; count: number; resetAt: string | null }> {
  const limit = Number(client.rate_limit_per_minute ?? 0)
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: false, count: 0, resetAt: null }

  const route = request.nextUrl.pathname
  const { data, error } = await supabaseService.rpc('integration_api_rate_limit_check', {
    p_api_client_id: client.id,
    p_route: route,
    p_limit: limit,
    p_window_seconds: 60,
  })

  if (error) {
    // Fail closed for authenticated integration APIs. A broken limiter must not
    // turn into unlimited access or a database-log COUNT on every request.
    console.error('[integration-api] atomic rate limiter unavailable', { route, code: error.code })
    return { allowed: false, count: 0, resetAt: null }
  }

  const row = Array.isArray(data) ? data[0] : data
  const allowed = Boolean((row as { allowed?: unknown } | null)?.allowed)
  const count = Number((row as { request_count?: unknown } | null)?.request_count ?? 0)
  const resetAt = String((row as { reset_at?: unknown } | null)?.reset_at ?? '') || null

  if (!allowed) {
    await recordRateLimitEvent(client, request, count).catch((recordError) => {
      console.warn('[integration-api] rate limit event logging skipped', recordError)
    })
  }

  return { allowed, count, resetAt }
}

export async function requireIntegrationApiAccess(
  request: NextRequest,
  requiredScopes: string[]
): Promise<IntegrationApiAuthResult> {
  try {
    await assertPlatformSchemaReady()
  } catch {
    return publicError({ status: 503, code: 'platform_schema_not_ready', message: 'API:t är tillfälligt avstängt tills databasschemat är verifierat.' })
  }
  const token = bearerToken(request)
  if (!token) return publicError({ status: 401, code: 'missing_api_token', message: 'API-token saknas.' })

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
  if (!hasRequiredScopes(client.scopes ?? [], requiredScopes)) {
    return publicError({ status: 403, code: 'api_scope_missing', message: 'API-klienten saknar scope.', client })
  }
  if (!ipAllowed(client, requestIp(request))) {
    return publicError({ status: 403, code: 'api_ip_not_allowed', message: 'IP-adressen är inte tillåten.', client })
  }
  if (!originAllowed(client, requestOrigin(request))) {
    return publicError({ status: 403, code: 'api_origin_not_allowed', message: 'Domänen är inte tillåten för API-klienten.', client })
  }
  const rateLimit = await rateLimitAllowed(client, request)
  if (!rateLimit.allowed) {
    return publicError({
      status: 429,
      code: 'rate_limited',
      message: 'Tjänsten svarar långsamt just nu. Försök igen senare eller hantera ärendet manuellt.',
      client,
    })
  }

  // Usage telemetry must not hold the response path open. The update is best
  // effort and intentionally detached from the authenticated request.
  void supabaseService
    .from('integration_api_clients')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', client.id)
    .then(() => null)

  return { ok: true, client }
}

export async function logIntegrationApiRequest(input: {
  client?: IntegrationApiClient | null
  request: NextRequest
  statusCode: number
  startedAt: number
  errorCode?: string | null
  metadata?: Record<string, unknown>
}) {
  const route = input.request.nextUrl.pathname

  await supabaseService
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
    })
    .then(() => null)
}
