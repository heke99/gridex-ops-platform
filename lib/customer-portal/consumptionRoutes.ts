import type { NextRequest } from 'next/server'
import { ApiInputError } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { customerPortalJson, handleCustomerPortalRouteError, logCustomerPortalSuccess, requireCustomerPortalApiContext } from '@/lib/customer-portal/externalApi'
import { publicPageInput, publicPortalMeteringPoint, publicPortalMeteringValue, publicPortalSite } from '@/lib/customer-portal/publicDto'
import { buildPortalDatabasePage, decodePortalCursor, portalPageLimit, PortalCursorError } from '@/lib/customer-portal/keysetPagination'
import { PlatformSchemaNotReadyError } from '@/lib/platform/schemaReadiness'
import { strictIsoDate } from '@/lib/time/stockholm'
import { CONSUMPTION_VERSION, consumptionWindows, meterValueWithinSupply, type ConsumptionRow, type ConsumptionScope } from './consumptionAccess'

const POINT_SELECT = 'id,company_id,customer_id,site_id,customer_site_id,metering_point_id,site_facility_id,status'
const PERIOD_SELECT = 'id,company_id,customer_id,metering_point_id,status,actual_start_date,actual_end_date,end_date,market_start_at,market_end_at'
function validateQuery(request: NextRequest, allowed: string[]) {
  for (const key of request.nextUrl.searchParams.keys()) if (!allowed.includes(key) || request.nextUrl.searchParams.getAll(key).length !== 1) throw new ApiInputError('Ogiltig frågeparameter.', 'invalid_query_parameter', 400, key)
  const limit = request.nextUrl.searchParams.get('limit')
  if (limit !== null && (!/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100)) throw new ApiInputError('limit ska vara 1–100.', 'invalid_limit', 400)
  const cursor = request.nextUrl.searchParams.get('cursor')
  if (cursor !== null && (!cursor || cursor.length > 2048)) throw new ApiInputError('Ogiltig sidmarkör.', 'invalid_cursor', 400)
}
function rows(result: { data: unknown; error: unknown; count: number | null }): ConsumptionRow[] {
  if (result.error || !Array.isArray(result.data) || result.count === null || result.count > 1000 || result.count !== result.data.length) throw new PlatformSchemaNotReadyError('Consumption authority is unavailable or incomplete.')
  return result.data as ConsumptionRow[]
}
async function authority(scope: ConsumptionScope, sites: ConsumptionRow[]) {
  if (!sites.length) return { points: [], windows: [] }
  const ids = sites.map(site => String(site.id))
  const points = rows(await supabaseService.from('metering_points').select(POINT_SELECT, { count: 'exact' }).eq('company_id', scope.companyId).or(`site_id.in.(${ids.join(',')}),customer_site_id.in.(${ids.join(',')})`).limit(1001))
  if (!points.length) return { points, windows: [] }
  const periods = rows(await supabaseService.from('customer_supply_periods').select(PERIOD_SELECT, { count: 'exact' }).eq('company_id', scope.companyId).eq('customer_id', scope.customerId).in('metering_point_id', points.map(point => String(point.id))).limit(1001))
  return { points, windows: consumptionWindows(scope, sites, points, periods) }
}
function respond(body: Record<string, unknown>) {
  return customerPortalJson(body, { headers: { 'Cache-Control': 'private, no-store', 'X-Gridex-Consumption-Version': CONSUMPTION_VERSION } })
}
async function sitesHandler(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_sites.read', 'customer_metering.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    validateQuery(request, ['limit', 'cursor'])
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const pageInput = publicPageInput(request.nextUrl.searchParams), limit = portalPageLimit(pageInput.limit)
    const resource = 'consumption-sites-v1'
    const cursor = decodePortalCursor({ ...scope, resource, cursor: pageInput.cursor })
    let query = supabaseService.from('customer_sites').select('id,company_id,customer_id,facility_reference,facility_id,status,site_name,site_type,street,postal_code,city,country,price_area_code,grid_area_code,created_at').eq('company_id', scope.companyId).eq('customer_id', scope.customerId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
    if (cursor) query = query.or(`created_at.lt.${cursor.orderValue},and(created_at.eq.${cursor.orderValue},id.lt.${cursor.id})`)
    const result = await query
    if (result.error || !Array.isArray(result.data)) throw new PlatformSchemaNotReadyError('Consumption sites are unavailable.')
    const sites = buildPortalDatabasePage(result.data as ConsumptionRow[], { ...scope, resource, limit, orderColumn: 'created_at' })
    const access = await authority(scope, sites.items)
    const publicSites = sites.items.map(site => publicPortalSite(scope.companyId, site))
    const publicPoints = access.points.filter(point => access.windows.some(window => window.metering_point_reference === publicPortalMeteringPoint(scope.companyId, point).metering_point_reference)).map(point => {
      const dto = publicPortalMeteringPoint(scope.companyId, point)
      const site = sites.items.find(site => site.id === (point.customer_site_id ?? point.site_id))!
      return { ...dto, facility_reference: publicPortalSite(scope.companyId, site).facility_reference }
    })
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: sites.items.length })
    return respond({ data: { sites: publicSites, metering_points: publicPoints, delivery_access: { version: 'customer-supply-periods-v1', complete: true, windows: access.windows } }, page: { sites: sites.page } })
  } catch (error) { return consumptionError(request, context.client, context.startedAt, error) }
}
function instant(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApiInputError('Ogiltig tidsperiod.', 'invalid_period', 400)
  try { strictIsoDate(value.slice(0, 10)); const time = value.slice(11, 19).split(':').map(Number); if (time[0] > 23 || time[1] > 59 || time[2] > 59) throw new Error('Invalid time') } catch { throw new ApiInputError('Ogiltig tidsperiod.', 'invalid_period', 400) }
  return new Date(value).toISOString()
}
async function valuesHandler(request: NextRequest) {
  const context = await requireCustomerPortalApiContext(request, ['customer_sites.read', 'customer_metering.read'], { enforceBinding: true })
  if (!context.ok) return context.response
  try {
    validateQuery(request, ['limit', 'cursor', 'from', 'to', 'facility_id'])
    const from = instant(request.nextUrl.searchParams.get('from')), to = instant(request.nextUrl.searchParams.get('to'))
    if (from >= to || Date.parse(to) - Date.parse(from) > 32 * 86400000) throw new ApiInputError('Tidsperioden får vara högst 32 dygn.', 'invalid_period', 400)
    const facility = request.nextUrl.searchParams.get('facility_id')
    if (!facility || !/^[A-Za-z0-9_-]{1,64}$/.test(facility)) throw new ApiInputError('Ogiltigt anläggnings-ID.', 'invalid_facility', 400)
    const scope = { companyId: context.client.company_id, customerId: context.identity.customer_id }
    const siteResult = await supabaseService.from('customer_sites').select('id,company_id,customer_id,facility_id,facility_reference', { count: 'exact' }).eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('facility_id', facility).limit(2)
    if (siteResult.error) throw new PlatformSchemaNotReadyError('Consumption facility is unavailable.')
    if (siteResult.count !== 1 || !siteResult.data || siteResult.data.length !== 1) throw new ApiInputError('Anläggningen saknas.', 'facility_not_found', 404)
    const access = await authority(scope, siteResult.data as ConsumptionRow[])
    const pageInput = publicPageInput(request.nextUrl.searchParams), limit = portalPageLimit(pageInput.limit)
    const resource = `consumption-v1:${facility}:${from}:${to}`
    const cursor = decodePortalCursor({ ...scope, resource, cursor: pageInput.cursor })
    let query = supabaseService.from('normalized_metering_values').select('id,company_id,customer_id,metering_point_id,period_start,period_end,resolution,quantity_kwh,quality_status,status,created_at,revision_status,direction,unit').eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('facility_id', facility).eq('direction', 'consumption').eq('unit', 'kWh').gte('period_start', from).lte('period_end', to).order('period_start', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
    if (cursor) query = query.or(`period_start.lt.${cursor.orderValue},and(period_start.eq.${cursor.orderValue},id.lt.${cursor.id})`)
    const result = await query
    if (result.error || !Array.isArray(result.data)) throw new PlatformSchemaNotReadyError('Consumption values are unavailable.')
    const page = buildPortalDatabasePage(result.data as ConsumptionRow[], { ...scope, resource, limit, orderColumn: 'period_start' })
    // Keep the cursor of the scanned page, even when every row is outside actual supply.
    const data = page.items.filter(row => meterValueWithinSupply(scope, row, access.windows)).map(row => ({ ...publicPortalMeteringValue(scope.companyId, row), revision_status: row.revision_status, direction: row.direction, unit: row.unit }))
    await logCustomerPortalSuccess({ request, client: context.client, startedAt: context.startedAt, resultCount: data.length })
    return respond({ data, page: page.page })
  } catch (error) { return consumptionError(request, context.client, context.startedAt, error) }
}

function consumptionError(request: NextRequest, client: Parameters<typeof handleCustomerPortalRouteError>[0]['client'], startedAt: number, error: unknown) {
  const safe = error instanceof ApiInputError ? error : error instanceof PortalCursorError
    ? new ApiInputError('Ogiltig sidmarkör.', 'invalid_cursor', 400)
    : new ApiInputError('Förbrukningsuppgifter är tillfälligt otillgängliga.', 'consumption_unavailable', 503)
  return handleCustomerPortalRouteError({ request, client, startedAt, error: safe })
}
function privateHandler(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest) => {
    let response: Response
    try { response = await handler(request) } catch (error) { response = consumptionError(request, null, Date.now(), error) }
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('X-Gridex-Consumption-Version', CONSUMPTION_VERSION)
    return response
  }
}
export const customerConsumptionSites = privateHandler(sitesHandler)
export const customerConsumptionMeteringValues = privateHandler(valuesHandler)
