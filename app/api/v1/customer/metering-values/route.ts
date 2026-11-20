import { randomUUID } from 'node:crypto'
import { withApiContractRepresentation } from '@/lib/integrations/apiResponseProfile'
import { NextRequest } from 'next/server'
import { canonicalApiError } from '@/lib/api/apiError'
import { ApiInputError } from '@/lib/api/strictRequest'
import { logIntegrationApiRequest } from '@/lib/integrations/apiAuth'
import publicApiErrors from '@/lib/integrations/public-api-error-registry.json'
import { supabaseService } from '@/lib/supabase/service'
import {
  customerPortalJson,
  handleCustomerPortalRouteError,
  logCustomerPortalSuccess,
  normalizeFacility,
  requireCustomerPortalApiContext,
} from '@/lib/customer-portal/externalApi'
import { isMissingSchemaError, portalQueryErrorMetadata } from '@/lib/customer-portal/apiData'
import {
  publicPageInput,
  publicPortalMeteringValue,
} from '@/lib/customer-portal/publicDto'
import {
  buildPortalDatabasePage,
  decodePortalCursor,
  PortalCursorError,
  portalPageLimit,
} from '@/lib/customer-portal/keysetPagination'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const METERING_DATE_BOUND = /^(\d{4}-\d{2}-\d{2})(?:[T ]([01]\d|2[0-4]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?(Z|[+-](?:0\d|1[0-5])(?::?[0-5]\d)?)?)?$/i
const METERING_PROJECTION = 'id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,period_start,period_end,resolution,quantity_kwh,quality_status,source_type,status,created_at'
const METERING_REQUIRED_COLUMNS = new Set([...METERING_PROJECTION.split(','), 'company_id', 'revision_status'])

function isMissingMeteringProjection(error: PlatformSchemaNotReadyError) {
  const details = error.details as { code?: unknown; message?: unknown } | null
  const message = details?.message
  if (details?.code === 'PGRST205') {
    return message === "Could not find the table 'public.normalized_metering_values' in the schema cache"
  }
  if (details?.code === '42P01') return message === 'relation "public.normalized_metering_values" does not exist'
  if (details?.code !== '42703' || typeof message !== 'string') return false
  const column = /^column normalized_metering_values\.([a-z_]+) does not exist$/.exec(message)?.[1]
  return column !== undefined && METERING_REQUIRED_COLUMNS.has(column)
}

function meteringDateBound(params: URLSearchParams, field: 'from' | 'to') {
  const value = params.get(field)?.trim()
  if (!value) return null

  const invalid = () => new ApiInputError('Ange ett giltigt ISO-datum eller en ISO-tidsstämpel.', 'invalid_date', 422, field)
  const match = METERING_DATE_BOUND.exec(value)
  if (!match) throw invalid()
  const [, date, hours, minutes, seconds = '00', fraction = '', offset] = match
  const midnight = new Date(`${date}T00:00:00Z`)
  if (date.startsWith('0000') || !Number.isFinite(midnight.getTime()) || !midnight.toISOString().startsWith(date + 'T')) {
    throw invalid()
  }
  if (hours === '24' && (minutes !== '00' || seconds !== '00' || /[1-9]/.test(fraction))) throw invalid()

  // PostgreSQL interprets offset-free values in its session time zone, including DST.
  if (!offset) return { value, microseconds: null }

  const isoOffset = offset.length === 3 ? `${offset}:00` : offset
  const wholeSecond = Date.parse(`${date}T${hours}:${minutes}:${seconds}${isoOffset}`)
  // Compare at database precision while keeping the original cursor scope.
  const microseconds = BigInt(wholeSecond) * BigInt(1000) + BigInt(fraction.padEnd(6, '0'))
  return { value, microseconds }
}

function meteringFacility(params: URLSearchParams): string | null {
  const value = params.get('facility_id')?.trim()
  if (value === undefined) return null
  const facility = normalizeFacility(value)
  if (!/^[0-9][0-9 -]*[0-9]$/.test(value) || facility.length !== 18) {
    throw new ApiInputError('Anläggnings-ID måste bestå av 18 siffror.', 'invalid_facility_id', 422, 'facility_id')
  }
  return facility
}

async function profiledGET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_metering.read'])
  if (!context.ok) return context.response

  try {
    const params = request.nextUrl.searchParams
    const from = meteringDateBound(params, 'from')
    const to = meteringDateBound(params, 'to')
    const normalizedFacilityId = meteringFacility(params)
    if (from?.microseconds != null && to?.microseconds != null && from.microseconds > to.microseconds) {
      throw new ApiInputError('Sluttiden måste vara samma som eller senare än starttiden.', 'invalid_date_range', 422, 'to')
    }
    const pageInput = publicPageInput(params)
    const limit = portalPageLimit(pageInput.limit)
    const resource = `metering-values:${from?.value ?? ''}:${to?.value ?? ''}:${normalizedFacilityId ?? ''}`
    const cursor = decodePortalCursor({
      cursor: pageInput.cursor,
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      resource,
    })

    let query = supabaseService
      .from('normalized_metering_values')
      .select(METERING_PROJECTION)
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .eq('revision_status', 'current')
      .order('period_start', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (from) query = query.gte('period_start', from.value)
    if (to) query = query.lte('period_end', to.value)
    if (normalizedFacilityId) query = query.eq('facility_id', normalizedFacilityId)
    if (cursor) {
      query = query.or(`period_start.lt.${cursor.orderValue},and(period_start.eq.${cursor.orderValue},id.lt.${cursor.id})`)
    }

    const { data, error } = await query
    if (error) {
      if (isMissingSchemaError(error)) {
        throw new PlatformSchemaNotReadyError('Canonical metering pagination is unavailable.', portalQueryErrorMetadata(error))
      }
      throw error
    }

    const page = buildPortalDatabasePage((data ?? []) as unknown as Array<Record<string, unknown>>, {
      limit,
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      resource,
      orderColumn: 'period_start',
    })
    const items = page.items.map((row) => publicPortalMeteringValue(context.client.company_id, row))

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: items.length,
      metadata: {
        source_table: 'normalized_metering_values',
        external_customer_id: context.identity.external_customer_id,
        customer_id: context.identity.customer_id,
        from: from?.value ?? null,
        to: to?.value ?? null,
        facility_id: normalizedFacilityId,
      },
    })

    return customerPortalJson({ data: items, page: page.page })
  } catch (error) {
    if (error instanceof PlatformSchemaNotReadyError && isMissingMeteringProjection(error)) {
      const requestId = randomUUID()
      const definition = publicApiErrors.platform_schema_not_ready
      void logIntegrationApiRequest({
        request, client: context.client, startedAt: context.startedAt,
        statusCode: error.status, errorCode: error.code, requestId,
      })
      return customerPortalJson(canonicalApiError({
        code: error.code, message: definition.public_message, requestId, retryable: definition.retryable,
      }), { status: error.status })
    }
    const routeError = error instanceof PortalCursorError
      ? new ApiInputError(error.message, error.code, error.status, error.field)
      : error
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error: routeError })
  }
}

export const GET = withApiContractRepresentation('customer', profiledGET)
