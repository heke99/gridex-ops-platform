import { supabaseService } from '@/lib/supabase/service'
import { isMissingRelationError } from '@/lib/tenant/scope'

export async function safeListRows(
  table: string,
  companyId: string | null,
  select = '*',
  limit = 50,
  equals: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  try {
    let query = supabaseService.from(table).select(select).limit(limit)
    if (companyId) query = query.eq('company_id', companyId)
    for (const [column, value] of Object.entries(equals)) query = query.eq(column, value)
    const { data, error } = await query
    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }
    return (data ?? []) as unknown as Record<string, unknown>[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

/** Explicit paged billing read. An absent exact count never proves completeness. */
export async function readBillingPage(
  table: string,
  companyId: string | null,
  options: {
    select?: string
    equals?: Record<string, string | string[]>
    order?: Array<{ column: string; ascending?: boolean }>
    page?: number
    pageSize?: number
  } = {},
): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  if (!companyId) throw new Error('Välj ett bolag för att läsa faktureringsuppgifter.')
  const pageSize = Math.max(1, Math.min(1000, Math.trunc(options.pageSize ?? 80)))
  let page = Number.isSafeInteger(options.page) && Number(options.page) > 0 ? Number(options.page) : 1
  let total: number | null = null
  const rows: Record<string, unknown>[] = []
  while (true) {
    const offset = (page - 1) * pageSize + rows.length
    let query = supabaseService.from(table).select(options.select ?? '*', { count: 'exact' }).eq('company_id', companyId)
    for (const [key, value] of Object.entries(options.equals ?? {})) query = Array.isArray(value) ? query.in(key, value) : query.eq(key, value)
    for (const order of options.order ?? []) query = query.order(order.column, { ascending: order.ascending !== false })
    const result = await query.range(offset, page * pageSize - 1)
    if (result.error) throw result.error
    if (!Number.isSafeInteger(result.count) || Number(result.count) < 0 || !Array.isArray(result.data)) throw new Error('Faktureringsuppgifterna kunde inte läsas fullständigt.')
    if (total !== null && total !== result.count) throw new Error('Faktureringsuppgifterna ändrades under läsningen. Försök igen.')
    total = Number(result.count)
    const lastPage = Math.max(1, Math.ceil(total / pageSize))
    if (page > lastPage) { page = lastPage; continue }
    rows.push(...result.data as unknown as Record<string, unknown>[])
    if (rows.length > pageSize) throw new Error('Ogiltigt antal faktureringsuppgifter.')
    if (rows.length >= Math.min(pageSize, total - (page - 1) * pageSize)) return { rows, total, page, pageSize }
    if (result.data.length === 0) throw new Error('Faktureringsuppgifterna kunde inte läsas fullständigt.')
  }
}

/** Complete selected detail dataset, never a partial history presented as a total. */
export async function readBillingRows(table: string, companyId: string | null, equals: Record<string, string | string[]> = {}, order = 'id'): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let expectedTotal: number | null = null
  for (let page = 1; ; page += 1) {
    const result = await readBillingPage(table, companyId, { equals, order: [{ column: order }, ...(order === 'id' ? [] : [{ column: 'id' }])], page, pageSize: 1000 })
    if (expectedTotal !== null && expectedTotal !== result.total) throw new Error('Faktureringsuppgifterna ändrades under läsningen. Försök igen.')
    expectedTotal = result.total
    if (result.total > 10000) throw new Error('Urvalet är för stort för att visas fullständigt. Begränsa urvalet.')
    rows.push(...result.rows)
    if (rows.length >= result.total) {
      if (rows.length !== result.total || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Faktureringsuppgifterna kunde inte läsas fullständigt.')
      return rows
    }
  }
}

export async function billingMeterLabels(companyId: string | null, records: Record<string, unknown>[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  const meterIds = [...new Set(records.map(row => row.metering_point_id).filter((id): id is string => typeof id === 'string' && Boolean(id)))]
  if (meterIds.length === 0) return labels
  const meters = await readBillingRows('metering_points', companyId, { id: meterIds })
  const siteIds = [...new Set(meters.map(row => row.site_id).filter((id): id is string => typeof id === 'string' && Boolean(id)))]
  const sites = siteIds.length ? await readBillingRows('customer_sites', companyId, { id: siteIds }) : []
  for (const row of records) {
    const meter = meters.find(item => item.id === row.metering_point_id)
    const site = sites.find(item => item.id === meter?.site_id && item.customer_id === row.customer_id && (!row.site_id || row.site_id === item.id))
    if (site && meter && (!meter.customer_id || meter.customer_id === row.customer_id) && typeof meter.meter_point_id === 'string') labels.set(String(row.id), meter.meter_point_id)
  }
  return labels
}

export function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 }).format(value)
  return String(value)
}

export function statusBadge(status: unknown): string {
  const text = typeof status === 'string' ? status : 'okänd'
  if (['price_preview_ready', 'ready_for_pricing', 'ready', 'complete', 'confirmed', 'locked', 'success'].includes(text)) return 'bg-emerald-100 text-emerald-800'
  if (['needs_review', 'incomplete', 'draft', 'reprice_required'].includes(text)) return 'bg-amber-100 text-amber-900'
  if (['pricing_failed', 'failed', 'blocked'].includes(text)) return 'bg-red-100 text-red-800'
  return 'bg-slate-100 text-slate-700'
}
