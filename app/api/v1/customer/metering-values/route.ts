import { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
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
  portalPageLimit,
} from '@/lib/customer-portal/keysetPagination'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function optionalParam(request: NextRequest, key: string): string | null {
  const value = request.nextUrl.searchParams.get(key)?.trim()
  return value || null
}

function optionalTimeFilter(request: NextRequest, key: 'from' | 'to'): string | null {
  const value = optionalParam(request, key)
  if (!value) return null
  const date = value.slice(0, 10)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)
  const parsedDay = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null
  if (
    (!dateOnly && !timestamp) ||
    !parsedDay ||
    Number.isNaN(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== date ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ApiInputError(`${key} must be an ISO date or timestamp.`, 'invalid_time_filter', 400, key)
  }
  return dateOnly ? `${value}T00:00:00Z` : value
}

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_metering.read'])
  if (!context.ok) return context.response

  try {
    const from = optionalTimeFilter(request, 'from')
    const to = optionalTimeFilter(request, 'to')
    const facilityId = optionalParam(request, 'facility_id')
    const normalizedFacilityId = facilityId ? normalizeFacility(facilityId) : null
    if (facilityId && !normalizedFacilityId) {
      throw new ApiInputError('facility_id must contain digits.', 'invalid_facility_id', 400, 'facility_id')
    }
    const pageInput = publicPageInput(request.nextUrl.searchParams)
    const limit = portalPageLimit(pageInput.limit)
    const resource = `metering-values:${from ?? ''}:${to ?? ''}:${normalizedFacilityId ?? ''}`
    const cursor = decodePortalCursor({
      cursor: pageInput.cursor,
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      resource,
    })

    let query = supabaseService
      .from('normalized_metering_values')
      .select('id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,period_start,period_end,resolution,quantity_kwh,quality_status,source_type,status,created_at')
      .eq('company_id', context.client.company_id)
      .eq('customer_id', context.identity.customer_id)
      .order('period_start', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (from) query = query.gte('period_start', from)
    if (to) query = query.lte('period_end', to)
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

    await logCustomerPortalSuccess({
      request,
      client: context.client,
      startedAt: context.startedAt,
      resultCount: data?.length ?? 0,
      metadata: {
        source_table: 'normalized_metering_values',
        external_customer_id: context.identity.external_customer_id,
        customer_id: context.identity.customer_id,
        from,
        to,
        facility_id: normalizedFacilityId,
      },
    })

    const page = buildPortalDatabasePage((data ?? []) as unknown as Array<Record<string, unknown>>, {
      limit,
      companyId: context.client.company_id,
      customerId: context.identity.customer_id,
      resource,
      orderColumn: 'period_start',
    })
    return customerPortalJson({
      data: page.items.map((row) => publicPortalMeteringValue(context.client.company_id, row)),
      page: page.page,
    })
  } catch (error) {
    return handleCustomerPortalRouteError({ request, client: context.client, startedAt: context.startedAt, error })
  }
}
