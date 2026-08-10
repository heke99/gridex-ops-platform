import { NextRequest } from 'next/server'
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

export async function GET(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_metering.read'])
  if (!context.ok) return context.response

  try {
    const from = optionalParam(request, 'from')
    const to = optionalParam(request, 'to')
    const facilityId = optionalParam(request, 'facility_id')
    const normalizedFacilityId = facilityId ? normalizeFacility(facilityId) : null
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
