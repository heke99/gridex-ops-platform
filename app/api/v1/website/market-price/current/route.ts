import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { EnergyResolutionBindingError } from '@/lib/energy/resolutionBinding'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { CurrentMarketPriceError, loadCurrentMarketPrice } from '@/lib/pricing/spot/currentMarketPrice'
import { WEBSITE_INTEGRATION_CONTRACT_VERSION } from '@/lib/integrations/websiteIntegrationContract'
import { isUuid } from '@/lib/validation/uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function publicResolutionError(error: EnergyResolutionBindingError) {
  if (error.code === 'resolution_tenant_mismatch') {
    return { code: 'resolution_not_found', status: 404, message: 'Elområdesresolutionen hittades inte.' }
  }
  return { code: error.code, status: error.status, message: error.message }
}

function text(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function errorBody(input: {
  code: string
  message: string
  requestId: string
  field?: string | null
  retryable?: boolean
  details?: Record<string, unknown>
}) {
  return {
    error: {
      code: input.code,
      message: input.message,
      field: input.field ?? null,
      request_id: input.requestId,
      correlation_id: input.requestId,
      retryable: input.retryable ?? [
        'current_market_price_unavailable',
        'market_price_stale',
        'market_price_provider_unavailable',
      ].includes(input.code),
      ...(input.details ? { details: input.details } : {}),
    },
    request_id: input.requestId,
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_market_prices.read'])
  if (!auth.ok) {
    await logIntegrationApiRequest({
      client: auth.client ?? null,
      request,
      statusCode: auth.status,
      startedAt,
      errorCode: auth.errorCode,
    })
    return customerPortalJson(
      errorBody({ code: auth.errorCode, message: auth.error, requestId }),
      { status: auth.status },
    )
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      return customerPortalJson(
        errorBody({
          code: parsed.code,
          message: status === 413 ? 'Förfrågans innehåll är för stort.' : 'Ogiltig JSON i förfrågan.',
          requestId,
          retryable: false,
        }),
        { status },
      )
    }
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const allowedFields = new Set(['resolution_id', 'price_area'])
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key))
    if (unknownFields.length > 0) {
      return customerPortalJson(
        errorBody({
          code: 'unknown_field',
          message: 'Förfrågan innehåller fält som inte ingår i API-kontraktet.',
          requestId,
          field: unknownFields[0],
          retryable: false,
          details: { unknown_fields: unknownFields },
        }),
        { status: 400 },
      )
    }
    const resolutionId = text(body, 'resolution_id')
    if (!resolutionId) {
      return customerPortalJson(
        errorBody({
          code: 'invalid_request',
          message: 'resolution_id saknas. Lös först kundens elområde genom OPS.',
          requestId,
          field: 'resolution_id',
          retryable: false,
        }),
        { status: 400 },
      )
    }

    if (!isUuid(resolutionId)) {
      return customerPortalJson(
        errorBody({
          code: 'invalid_request',
          message: 'resolution_id måste vara ett giltigt UUID.',
          requestId,
          field: 'resolution_id',
          retryable: false,
        }),
        { status: 400 },
      )
    }
    const assertedPriceArea = text(body, 'price_area')?.toUpperCase() ?? null
    if (assertedPriceArea && !['SE1', 'SE2', 'SE3', 'SE4'].includes(assertedPriceArea)) {
      return customerPortalJson(
        errorBody({
          code: 'invalid_request',
          message: 'price_area måste vara SE1, SE2, SE3 eller SE4.',
          requestId,
          field: 'price_area',
          retryable: false,
        }),
        { status: 400 },
      )
    }

    const data = await loadCurrentMarketPrice({
      client: auth.client,
      resolutionId,
      assertedPriceArea,
    })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        request_id: requestId,
        resolution_id: data.resolution_id,
        price_area: data.price_area,
        provider: data.provider,
        time_start: data.time_start,
        time_end: data.time_end,
      },
    })
    return customerPortalJson(
      { data, request_id: requestId, contract_schema_version: WEBSITE_INTEGRATION_CONTRACT_VERSION },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof CurrentMarketPriceError || error instanceof EnergyResolutionBindingError) {
      const details = error.details
      const field = error.field
      const publicError = error instanceof EnergyResolutionBindingError
        ? publicResolutionError(error)
        : { code: error.code, status: error.status, message: error.message }
      await logIntegrationApiRequest({
        client: auth.client,
        request,
        statusCode: publicError.status,
        startedAt,
        errorCode: publicError.code,
        metadata: { request_id: requestId, ...details },
      })
      return customerPortalJson(
        errorBody({
          code: publicError.code,
          message: publicError.message,
          requestId,
          field,
          details,
        }),
        { status: publicError.status },
      )
    }

    console.error('[website-current-market-price] failed', { requestId, error })
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 500,
      startedAt,
      errorCode: 'market_price_provider_unavailable',
      metadata: { request_id: requestId },
    })
    return customerPortalJson(
      errorBody({
        code: 'market_price_provider_unavailable',
        message: 'Aktuellt marknadspris kunde inte hämtas just nu.',
        requestId,
      }),
      { status: 500 },
    )
  }
}
