import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { normalizeApiBlockers, type ApiBlocker } from '@/lib/api/apiError'
import { ApiInputError } from '@/lib/api/strictRequest'
import type { IntegrationApiRateLimit } from '@/lib/integrations/apiAuth'
import { STAFF_API_CONTRACT_VERSION } from '@/lib/staff-api/openApiContract'
import type { StaffApiContext } from '@/lib/staff-api/context'

export class StaffApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryable = false, readonly blockers: ApiBlocker[] = [], readonly retryAfter?: number, readonly rateLimit?: IntegrationApiRateLimit) {
    super(message)
  }
}

export function staffRequestIds(request: Pick<NextRequest, 'headers'>) {
  const safe = (value: string | null) => value && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null
  const requestId = safe(request.headers.get('x-request-id')) ?? randomUUID()
  return { requestId, correlationId: safe(request.headers.get('x-correlation-id')) ?? requestId }
}

export type StaffResponseContext = Pick<StaffApiContext, 'requestId' | 'correlationId'> & { integrationAuth?: { rateLimit: IntegrationApiRateLimit }; rateLimit?: IntegrationApiRateLimit }
export function staffResponseHeaders(context: StaffResponseContext, extras?: HeadersInit) {
  const headers = new Headers(extras)
  headers.set('cache-control', 'private, no-store')
  headers.set('x-gridex-contract-version', STAFF_API_CONTRACT_VERSION)
  headers.set('x-request-id', context.requestId)
  headers.set('x-correlation-id', context.correlationId)
  headers.set('x-content-type-options', 'nosniff')
  const budget = context.integrationAuth?.rateLimit ?? context.rateLimit
  if (budget) {
    headers.set('x-ratelimit-limit', String(budget.limit))
    headers.set('x-ratelimit-remaining', String(budget.remaining))
    if (budget.resetAt) headers.set('x-ratelimit-reset', budget.resetAt)
  }
  return headers
}

export function staffApiJson(request: NextRequest, context: StaffResponseContext | null, data: unknown, status = 200, options?: { page?: unknown; headers?: HeadersInit }) {
  const ids = context ?? staffRequestIds(request)
  return NextResponse.json({ data, ...(options?.page === undefined ? {} : { page: options.page }), request_id: ids.requestId, correlation_id: ids.correlationId, contract_schema_version: STAFF_API_CONTRACT_VERSION }, { status, headers: staffResponseHeaders(ids, options?.headers) })
}

export function staffApiErrorResponse(request: NextRequest, error: unknown, context?: StaffResponseContext | null) {
  const ids = context ?? staffRequestIds(request)
  const candidate = error as { status?: unknown; code?: unknown; retryable?: unknown; blockers?: unknown; field?: unknown }
  const known = error instanceof StaffApiError || error instanceof ApiInputError
  const status = known && typeof candidate.status === 'number' && candidate.status >= 400 && candidate.status <= 599 ? candidate.status : 503
  const headers = staffResponseHeaders({ ...ids, ...(error instanceof StaffApiError && error.rateLimit ? { rateLimit: error.rateLimit } : {}) })
  if (error instanceof StaffApiError && error.retryAfter) headers.set('retry-after', String(error.retryAfter))
  const blockers = known ? normalizeApiBlockers(candidate.blockers).map(({ code, message, field, resource_type, count, recommended_action }) => ({ code, message, field, resource_type, count, recommended_action })) : []
  return NextResponse.json({ error: { code: known ? candidate.code : 'staff_service_unavailable', message: known && error instanceof Error ? error.message : 'Staff service is temporarily unavailable.', retryable: known ? candidate.retryable === true : true, field: known && typeof candidate.field === 'string' ? candidate.field : null, blockers }, request_id: ids.requestId, correlation_id: ids.correlationId, contract_schema_version: STAFF_API_CONTRACT_VERSION }, { status, headers })
}
