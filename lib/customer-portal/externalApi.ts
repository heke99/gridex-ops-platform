import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
} from '@/lib/integrations/apiAuth'
import { portalIdentifiersFromRequest, resolvePortalCustomer, type CustomerPortalIdentifiers } from '@/lib/customer-portal/customerResolver'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { canonicalApiError, normalizeApiBlockers } from '@/lib/api/apiError'

export type LinkedPortalIdentity = {
  id: string | null
  company_id: string
  customer_id: string
  external_customer_id: string | null
  email: string | null
  customer_number: string | null
  auth_user_id: string | null
  customer_portal_user_id: string | null
  match_strength: string | null
  match_method: string | null
  provider: string | null
  customer: Record<string, unknown>
}

export type CustomerPortalApiContext = {
  client: IntegrationApiClient
  identity: LinkedPortalIdentity
}

export function customerPortalJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Gridex-Contract-Version', WEBSITE_INTEGRATION_CONTRACT_VERSION)
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  const rawError = record?.error
  const errorRecord =
    rawError && typeof rawError === 'object' && !Array.isArray(rawError)
      ? (rawError as Record<string, unknown>)
      : null
  const requestId =
    typeof record?.request_id === 'string'
      ? record.request_id
      : typeof errorRecord?.request_id === 'string'
        ? errorRecord.request_id
        : randomUUID()
  const correlationId =
    typeof record?.correlation_id === 'string'
      ? record.correlation_id
      : typeof errorRecord?.correlation_id === 'string'
        ? errorRecord.correlation_id
        : undefined

  const envelope = record
    ? rawError !== undefined
      ? canonicalApiError({
          code:
            typeof errorRecord?.code === 'string'
              ? errorRecord.code
              : typeof record.code === 'string'
                ? record.code
                : 'request_failed',
          message:
            typeof errorRecord?.message === 'string'
              ? errorRecord.message
              : typeof rawError === 'string'
                ? rawError
                : typeof record.message === 'string'
                  ? record.message
                  : 'Förfrågan kunde inte behandlas.',
          requestId,
          correlationId,
          stage:
            typeof errorRecord?.stage === 'string'
              ? errorRecord.stage
              : typeof record.error_stage === 'string'
                ? record.error_stage
                : typeof record.stage === 'string'
                  ? record.stage
                  : undefined,
          field:
            typeof errorRecord?.field === 'string'
              ? errorRecord.field
              : typeof record.field === 'string'
                ? record.field
                : undefined,
          hint:
            typeof errorRecord?.hint === 'string'
              ? errorRecord.hint
              : typeof record.hint === 'string'
                ? record.hint
                : undefined,
          retryable:
            errorRecord?.retryable === true || record.retryable === true,
          blockers:
            normalizeApiBlockers(
              errorRecord?.blockers ?? record.blockers,
            ),
          details: errorRecord?.details ?? record.details,
        })
      : {
          ...record,
          request_id: requestId,
        }
    : body
  const versionedEnvelope =
    envelope && typeof envelope === 'object' && !Array.isArray(envelope)
      ? {
          ...(envelope as Record<string, unknown>),
          contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION,
        }
      : envelope
  return NextResponse.json(versionedEnvelope, { ...init, headers })
}

export function jsonError(error: string, status: number, code?: string) {
  return customerPortalJson(
    canonicalApiError({
      code: code ?? 'request_failed',
      message: error,
      requestId: randomUUID(),
    }),
    { status },
  )
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
  return portalIdentifiersFromRequest(request).externalCustomerId
}

function cleanIdentifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function portalIdentifiersFromPayload(payload: unknown): Partial<CustomerPortalIdentifiers> {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  return {
    externalCustomerId: cleanIdentifier(body.external_customer_id) ?? cleanIdentifier(body.externalCustomerId) ?? cleanIdentifier(body.customer_external_id),
    customerNumber: cleanIdentifier(body.customer_number) ?? cleanIdentifier(body.customerNumber),
    email: normalizeEmail(body.email ?? body.customer_email) || null,
    authUserId: cleanIdentifier(body.auth_user_id) ?? cleanIdentifier(body.authUserId) ?? cleanIdentifier(body.web_auth_user_id) ?? cleanIdentifier(body.webAuthUserId),
    customerPortalUserId: cleanIdentifier(body.customer_portal_user_id) ?? cleanIdentifier(body.customerPortalUserId) ?? cleanIdentifier(body.portal_user_id) ?? cleanIdentifier(body.portalUserId),
  }
}

export async function requireCustomerPortalApiContextForIdentifiers(
  request: NextRequest,
  identifiers: Partial<CustomerPortalIdentifiers>,
  scopes: string[] = ['customer_portal.read']
): Promise<
  | { ok: true; client: IntegrationApiClient; identity: LinkedPortalIdentity; startedAt: number }
  | { ok: false; response: NextResponse; startedAt: number }
> {
  const startedAt = Date.now()
  const auth = await requireIntegrationApiAccess(request, scopes)
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return { ok: false, response: jsonError(auth.error, auth.status, auth.errorCode), startedAt }
  }

  const resolution = await resolvePortalCustomer({ client: auth.client, request, identifiers })
  if (!resolution.ok) {
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: resolution.status,
      startedAt,
      errorCode: resolution.code,
      metadata: { ...resolution.identifiers },
    })
    return { ok: false, response: jsonError(resolution.error, resolution.status, resolution.code), startedAt }
  }

  return { ok: true, client: auth.client, identity: resolution.customer, startedAt }
}

export async function resolveLinkedPortalIdentity(
  request: NextRequest,
  client: IntegrationApiClient
): Promise<{ ok: true; identity: LinkedPortalIdentity } | { ok: false; status: number; error: string; code: string }> {
  const resolution = await resolvePortalCustomer({ request, client })
  if (!resolution.ok) {
    return { ok: false, status: resolution.status, error: resolution.error, code: resolution.code }
  }

  return { ok: true, identity: resolution.customer }
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
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return { ok: false, response: jsonError(auth.error, auth.status, auth.errorCode), startedAt }
  }

  const identity = await resolveLinkedPortalIdentity(request, auth.client)
  if (!identity.ok) {
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: identity.status,
      startedAt,
      errorCode: identity.code,
      metadata: { ...portalIdentifiersFromRequest(request) },
    })
    return { ok: false, response: jsonError(identity.error, identity.status, identity.code), startedAt }
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
  console.error('[customer-portal-api] route failed', { route: input.request.nextUrl.pathname, error: input.error })
  void logIntegrationApiRequest({
    client: input.client ?? null,
    request: input.request,
    statusCode: 500,
    startedAt: input.startedAt,
    errorCode: 'customer_portal_internal_error',
  })
  return jsonError('Kundportal-API kunde inte behandla anropet just nu.', 500, 'customer_portal_internal_error')
}
