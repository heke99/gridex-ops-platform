import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'

export type IntegrationApiClient = {
  id: string
  company_id: string
  name: string
  status: string
  key_prefix: string
  secret_hash: string
  scopes: string[]
  allowed_ips: string[]
  rate_limit_per_minute: number
  expires_at: string | null
}

export type IntegrationApiAuthResult =
  | { ok: true; client: IntegrationApiClient }
  | { ok: false; status: number; error: string }

export function hashIntegrationApiSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  return token || null
}

function hasRequiredScopes(clientScopes: string[], requiredScopes: string[]): boolean {
  if (clientScopes.includes('*')) return true
  return requiredScopes.every((scope) => clientScopes.includes(scope))
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

export async function requireIntegrationApiAccess(
  request: NextRequest,
  requiredScopes: string[]
): Promise<IntegrationApiAuthResult> {
  const token = bearerToken(request)
  if (!token) return { ok: false, status: 401, error: 'API-token saknas.' }

  const keyPrefix = token.slice(0, 12)
  const secretHash = hashIntegrationApiSecret(token)

  const { data, error } = await supabaseService
    .from('integration_api_clients')
    .select('*')
    .eq('key_prefix', keyPrefix)
    .eq('secret_hash', secretHash)
    .maybeSingle()

  if (error) return { ok: false, status: 503, error: 'API-åtkomst kunde inte verifieras.' }
  if (!data) return { ok: false, status: 401, error: 'API-token är ogiltig.' }

  const client = data as IntegrationApiClient
  if (client.status !== 'active') return { ok: false, status: 403, error: 'API-klienten är inte aktiv.' }
  if (client.expires_at && new Date(client.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 403, error: 'API-token har gått ut.' }
  }
  if (!hasRequiredScopes(client.scopes ?? [], requiredScopes)) {
    return { ok: false, status: 403, error: 'API-klienten saknar scope.' }
  }
  if (!ipAllowed(client, requestIp(request))) {
    return { ok: false, status: 403, error: 'IP-adressen är inte tillåten.' }
  }

  await supabaseService
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
