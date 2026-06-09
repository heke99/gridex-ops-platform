import { NextRequest, NextResponse } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
} from '@/lib/integrations/apiAuth'

export type LinkedPortalIdentity = {
  id: string
  company_id: string
  customer_id: string
  external_customer_id: string
  email: string | null
  match_strength: string | null
  match_method: string | null
}

export type CustomerPortalApiContext = {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
}

export function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function normalizeFacility(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function identityExternalCustomerId(request: NextRequest): string | null {
  const fromHeader = request.headers.get('x-gridex-external-customer-id')?.trim()
  if (fromHeader) return fromHeader
  const fromQuery = request.nextUrl.searchParams.get('external_customer_id')?.trim()
  if (fromQuery) return fromQuery
  const legacyQuery = request.nextUrl.searchParams.get('customer_external_id')?.trim()
  return legacyQuery || null
}

export async function resolveLinkedPortalIdentity(
  request: NextRequest,
  client: IntegrationApiClient
): Promise<{ ok: true; identity: LinkedPortalIdentity } | { ok: false; status: number; error: string }> {
  const externalCustomerId = identityExternalCustomerId(request)
  if (!externalCustomerId) {
    return { ok: false, status: 400, error: 'external_customer_id saknas.' }
  }

  const { data, error } = await supabaseService
    .from('customer_portal_identities')
    .select('id,company_id,customer_id,external_customer_id,email,status,match_strength,match_method')
    .eq('company_id', client.company_id)
    .eq('external_customer_id', externalCustomerId)
    .eq('status', 'active')
    .not('customer_id', 'is', null)
    .maybeSingle()

  if (error) return { ok: false, status: 503, error: 'Kundlänk kunde inte verifieras.' }
  if (!data?.customer_id) return { ok: false, status: 403, error: 'Kundkontot är inte länkat eller kräver granskning.' }

  return { ok: true, identity: data as LinkedPortalIdentity }
}

export async function requireCustomerPortalApiContext(
  request: NextRequest,
  scopes: string[] = ['customer_portal.read']
): Promise<
  | { ok: true; client: IntegrationApiClient; identity: LinkedPortalIdentity; startedAt: number }
  | { ok: false; response: NextResponse; startedAt: number }
> {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, scopes)
  if (!auth.ok) {
    await logIntegrationApiRequest({ request, statusCode: auth.status, startedAt, errorCode: auth.error })
    return { ok: false, response: jsonError(auth.error, auth.status), startedAt }
  }

  const identity = await resolveLinkedPortalIdentity(request, auth.client)
  if (!identity.ok) {
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: identity.status,
      startedAt,
      errorCode: identity.error,
      metadata: { external_customer_id: identityExternalCustomerId(request) },
    })
    return { ok: false, response: jsonError(identity.error, identity.status), startedAt }
  }

  return { ok: true, client: auth.client, identity: identity.identity, startedAt }
}

export async function logCustomerPortalSuccess(input: {
  request: NextRequest
  client: IntegrationApiClient
  startedAt: number
  resultCount?: number
  metadata?: Record<string, unknown>
}) {
  await logIntegrationApiRequest({
    client: input.client,
    request: input.request,
    statusCode: 200,
    startedAt: input.startedAt,
    metadata: {
      result_count: input.resultCount ?? null,
      ...(input.metadata ?? {}),
    },
  })
}

export function handleCustomerPortalRouteError(input: {
  request: NextRequest
  client?: IntegrationApiClient | null
  startedAt: number
  error: unknown
}) {
  const message = input.error instanceof Error ? input.error.message : 'Kundportal-API kunde inte behandla anropet.'
  void logIntegrationApiRequest({
    client: input.client ?? null,
    request: input.request,
    statusCode: 500,
    startedAt: input.startedAt,
    errorCode: message,
  })
  return jsonError(message, 500)
}
