import { randomUUID } from 'node:crypto'
import { CUSTOMER_ASSERTION_HEADER, gateCustomerAssertion } from '@/lib/customer-portal/customerAssertion'
import { NextRequest, NextResponse } from 'next/server'
import {
  currentIntegrationApiResponseContext,
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
  type IntegrationApiClient,
  type IntegrationScopeRequirement,
} from '@/lib/integrations/apiAuth'
import { portalIdentifiersFromRequest, resolvePortalCustomer, type CustomerPortalIdentifiers, type PortalCustomerBinding, type PortalResolveMode } from '@/lib/customer-portal/customerResolver'
import { portalIdentityEnforcement, reportPortalIdentityWouldReject } from '@/lib/customer-portal/identityEnforcement'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { canonicalApiError, normalizeApiBlockers } from '@/lib/api/apiError'
import { ApiInputError } from '@/lib/api/strictRequest'
import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'

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
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store')
  headers.set('X-Gridex-Contract-Version', WEBSITE_INTEGRATION_CONTRACT_VERSION)
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  const rawError = record?.error
  if (record && rawError === undefined) assertPublicResponsePayload(record)
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

  headers.set('X-Request-ID', requestId)
  const responseContext = currentIntegrationApiResponseContext()
  const rateLimit = responseContext?.rateLimit
  if (rateLimit) {
    headers.set('X-RateLimit-Limit', String(rateLimit.limit))
    headers.set('X-RateLimit-Remaining', String(rateLimit.remaining))
    if (rateLimit.resetAt) headers.set('X-RateLimit-Reset', rateLimit.resetAt)
  }
  if (responseContext?.retryAfterSeconds) {
    headers.set('Retry-After', String(responseContext.retryAfterSeconds))
  }
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

export type CustomerPortalContextOptions = {
  /** Explicit link operation; reads and ordinary writes never link. */
  mode?: PortalResolveMode
  /**
   * Allow a mutating request that is bound only by tenant-supplied identifiers. Reserved for tenant
   * machine flows (e.g. master-data sync) that are logged as the API client, never as the end customer.
   */
  allowIdentifierBoundWrite?: boolean
  /** Always enforce the binding rule, independent of the rollout flag (new endpoints). */
  enforceBinding?: boolean
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Mutations on behalf of an end customer require an actively linked portal account. */
export function customerPortalBindingAllowsRequest(
  method: string,
  binding: PortalCustomerBinding,
  options: CustomerPortalContextOptions = {},
): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true
  if (binding === 'portal_account') return true
  return options.allowIdentifierBoundWrite === true
}

/** Applies the rollout flag: in `report` mode a rejected binding is logged and allowed. */
function bindingGate(method: string, binding: PortalCustomerBinding, options: CustomerPortalContextOptions, client: IntegrationApiClient): boolean {
  if (customerPortalBindingAllowsRequest(method, binding, options)) return true
  if (options.enforceBinding || portalIdentityEnforcement() === 'enforce') return false
  reportPortalIdentityWouldReject({ code: 'customer_identity_binding_required', companyId: client.company_id, apiClientId: client.id, method })
  return true
}

function bindingRequiredError() {
  return jsonError(
    'Ändringar för slutkund kräver en aktivt kopplad portalanvändare. Kundnummer eller e-post räcker inte som verifiering.',
    403,
    'customer_identity_binding_required',
  )
}

/** Tenantservice P1c: the tenant's own setting decides whether a signed customer assertion is required. */
async function customerAssertionGate(
  request: NextRequest,
  client: IntegrationApiClient,
  identity: LinkedPortalIdentity,
): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  const gate = await gateCustomerAssertion({
    companyId: client.company_id,
    clientId: client.id,
    token: request.headers.get(CUSTOMER_ASSERTION_HEADER),
    expectedSubject: identity.customer_portal_user_id ?? identity.auth_user_id,
  })
  if (gate.allowed) return { ok: true }
  return {
    ok: false,
    status: 403,
    error: 'Kundens inloggning kunde inte verifieras. Skicka en giltig, signerad kundintygelse i x-gridex-customer-assertion.',
    code: gate.reason === 'missing' ? 'customer_assertion_required' : 'customer_assertion_invalid',
  }
}

export async function requireCustomerPortalApiContextForIdentifiers(
  request: NextRequest,
  identifiers: Partial<CustomerPortalIdentifiers>,
  scopes: IntegrationScopeRequirement = ['customer_portal.read'],
  options: CustomerPortalContextOptions = {},
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

  const resolution = await resolvePortalCustomer({ client: auth.client, request, identifiers, mode: options.mode, strict: options.enforceBinding })
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

  if (!bindingGate(request.method, resolution.binding, options, auth.client)) {
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 403, startedAt, errorCode: 'customer_identity_binding_required' })
    return { ok: false, response: bindingRequiredError(), startedAt }
  }

  const assertion = await customerAssertionGate(request, auth.client, resolution.customer)
  if (!assertion.ok) {
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: assertion.status, startedAt, errorCode: assertion.code })
    return { ok: false, response: jsonError(assertion.error, assertion.status, assertion.code), startedAt }
  }

  return { ok: true, client: auth.client, identity: resolution.customer, startedAt }
}

export async function resolveLinkedPortalIdentity(
  request: NextRequest,
  client: IntegrationApiClient,
  options: CustomerPortalContextOptions = {},
): Promise<{ ok: true; identity: LinkedPortalIdentity } | { ok: false; status: number; error: string; code: string }> {
  const resolution = await resolvePortalCustomer({ request, client, mode: options.mode, strict: options.enforceBinding })
  if (!resolution.ok) {
    return { ok: false, status: resolution.status, error: resolution.error, code: resolution.code }
  }
  if (!bindingGate(request.method, resolution.binding, options, client)) {
    return {
      ok: false,
      status: 403,
      error: 'Ändringar för slutkund kräver en aktivt kopplad portalanvändare. Kundnummer eller e-post räcker inte som verifiering.',
      code: 'customer_identity_binding_required',
    }
  }

  return { ok: true, identity: resolution.customer }
}

export async function requireCustomerPortalApiContext(
  request: NextRequest,
  scopes: IntegrationScopeRequirement = ['customer_portal.read'],
  options: CustomerPortalContextOptions = {},
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

  const identity = await resolveLinkedPortalIdentity(request, auth.client, options)
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

  const assertion = await customerAssertionGate(request, auth.client, identity.identity)
  if (!assertion.ok) {
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: assertion.status, startedAt, errorCode: assertion.code })
    return { ok: false, response: jsonError(assertion.error, assertion.status, assertion.code), startedAt }
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
  if (input.error instanceof ApiInputError) {
    void logIntegrationApiRequest({
      client: input.client ?? null,
      request: input.request,
      statusCode: input.error.status,
      startedAt: input.startedAt,
      errorCode: input.error.code,
      metadata: { field: input.error.field },
    })
    return customerPortalJson(
      canonicalApiError({
        code: input.error.code,
        message: input.error.message,
        requestId: randomUUID(),
        field: input.error.field,
      }),
      { status: input.error.status },
    )
  }
  const databaseError = input.error as {
    code?: string
    message?: string
  } | null
  const databaseMessage = databaseError?.message ?? ''
  const mappedDatabaseError = [
    {
      pattern: /^customer_merged_write_conflict$/,
      status: 409,
      code: 'portal_identity_customer_conflict',
      message: 'Kundkopplingen har ändrats. Hämta aktuella kunduppgifter och försök igen.',
    },
    {
      pattern: /LEGAL_BUNDLE_NOT_RESOLVED/i,
      status: 409,
      code: 'LEGAL_BUNDLE_NOT_READY',
      message: 'Kundens aktiva legala dokumentpaket kunde inte fastställas.',
    },
    {
      pattern: /LEGAL_DOCUMENT_REFERENCE_INVALID|LEGAL_DOCUMENT_NOT_ACCEPTABLE/i,
      status: 422,
      code: 'LEGAL_DOCUMENT_INVALID',
      message: 'Dokumentreferensen ingår inte i kundens aktiva legala dokumentpaket.',
    },
    {
      pattern: /LEGAL_DOCUMENT_EVIDENCE_MISMATCH/i,
      status: 409,
      code: 'LEGAL_EVIDENCE_MISMATCH',
      message: 'Dokumentets kod, version eller hash stämmer inte med publicerad version.',
    },
    {
      pattern: /POWER_OF_ATTORNEY_DOCUMENT_REQUIRED/i,
      status: 422,
      code: 'POWER_OF_ATTORNEY_DOCUMENT_REQUIRED',
      message: 'Fullmakten måste hänvisa till ett publicerat fullmaktsdokument.',
    },
    {
      pattern: /FACILITY_REFERENCE_NOT_FOUND/i,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Anläggningsreferensen hittades inte för kunden.',
    },
    {
      pattern: /customer_move_out_customer_not_found/i,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Kunden hittades inte för aktuell tenant.',
    },
    {
      pattern: /customer_move_out_facility_not_found/i,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Anläggningen hittades inte för kunden.',
    },
    {
      pattern: /customer_move_out_contract_not_found/i,
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'Avtalet hittades inte för kunden.',
    },
    {
      pattern: /customer_move_out_contract_status_invalid/i,
      status: 409,
      code: 'MOVE_OUT_NOT_ALLOWED',
      message: 'Avtalets status tillåter inte flyttanmälan.',
    },
    {
      pattern: /customer_move_out_date_invalid/i,
      status: 422,
      code: 'MOVE_OUT_DATE_INVALID',
      message: 'Utflyttningsdatumet följer inte affärsreglerna.',
    },
    {
      pattern: /customer_move_out_idempotency_conflict/i,
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency-Key har redan använts med ett annat innehåll.',
    },
  ].find((candidate) => candidate.pattern.test(databaseMessage))
  if (mappedDatabaseError) {
    void logIntegrationApiRequest({
      client: input.client ?? null,
      request: input.request,
      statusCode: mappedDatabaseError.status,
      startedAt: input.startedAt,
      errorCode: mappedDatabaseError.code,
    })
    return customerPortalJson(
      canonicalApiError({
        code: mappedDatabaseError.code,
        message: mappedDatabaseError.message,
        requestId: randomUUID(),
      }),
      { status: mappedDatabaseError.status },
    )
  }
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
