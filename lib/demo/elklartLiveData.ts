import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { stockholmLocalToUtc, strictIsoDate } from '@/lib/time/stockholm'
import { demoDayBounds, demoProfiles, type DemoBinding, type DemoReading, type DemoSupply } from './elklartLivePortfolio'

type PageResult<T> = { data: T[] | null; error: unknown; count?: number | null }
export async function readDemoRows<T>(query: () => { range: (from: number, to: number) => PromiseLike<PageResult<T>> }): Promise<T[]> {
  const rows: T[] = []
  let expected: number | null = null
  for (let page = 0; page < 100; page++) {
    const { data, error, count } = await query().range(rows.length, rows.length + 999)
    if (error || !data || count === null || count === undefined || !Number.isSafeInteger(count) || count < 0) throw new Error('demo_data_unavailable')
    if (count > 10_000) throw new Error('demo_data_limit')
    if (expected !== null && expected !== count) throw new Error('demo_data_changed')
    expected = count
    rows.push(...data)
    if (rows.length === count) return rows
    if (rows.length > count || data.length === 0) throw new Error('demo_data_incomplete')
  }
  throw new Error('demo_data_limit')
}
function midnight(value: string): string {
  const [year, month, day] = strictIsoDate(value).split('-').map(Number)
  return stockholmLocalToUtc({ year, month, day }).toISOString()
}
export async function loadLiveDemoData(companyId: string, bindings: DemoBinding[], day: string) {
  const client = await createSupabaseServerClient()
  const ids = bindings.map(row => row.meteringPointId)
  const customerIds = [...new Set(bindings.map(row => row.customerId))]
  const bounds = demoDayBounds(day)
  // The request's authenticated client enforces RLS in addition to every explicit
  // company filter. No service-role fallback, name search, or foreign-ID lookup.
  const [points, periods, values] = await Promise.all([
    readDemoRows(() => client.from('metering_points').select('id,company_id,customer_id,bidding_zone_code', { count: 'exact' })
      .eq('company_id', companyId).in('id', ids).order('id')),
    readDemoRows(() => client.from('customer_supply_periods')
      .select('id,company_id,customer_id,metering_point_id,start_date,end_date,actual_start_date,actual_end_date,market_start_at,market_end_at,status,updated_at', { count: 'exact' })
      .eq('company_id', companyId).in('metering_point_id', ids).in('customer_id', customerIds).order('id')),
    readDemoRows(() => client.from('metering_values')
      .select('id,company_id,customer_id,metering_point_id,period_start,period_end,value_kwh,quantity_kwh,quantity,is_current', { count: 'exact' })
      .eq('company_id', companyId).in('metering_point_id', ids).in('customer_id', customerIds).eq('is_current', true).eq('reading_type', 'consumption')
      .lt('period_start', bounds.end).gt('period_end', bounds.start).order('id')),
  ])
  for (const binding of bindings) {
    const point = points.find(row => row.id === binding.meteringPointId)
    if (!point || point.company_id !== companyId || point.customer_id !== binding.customerId
      || point.bidding_zone_code !== demoProfiles[binding.profile].zone) throw new Error('demo_binding_scope_mismatch')
  }
  const supplies: DemoSupply[] = periods.map(row => ({
    companyId: row.company_id, customerId: row.customer_id, meteringPointId: row.metering_point_id,
    startAt: row.market_start_at ?? midnight(row.actual_start_date ?? row.start_date),
    endAt: row.market_end_at ?? (row.actual_end_date || row.end_date ? midnight(row.actual_end_date ?? row.end_date) : null),
    confirmed: Boolean(row.market_start_at || row.actual_start_date), cancelled: row.status === 'cancelled', updatedAt: row.updated_at,
  }))
  const readings: DemoReading[] = values.map(row => {
    const quantity = row.value_kwh ?? row.quantity_kwh ?? row.quantity
    if (quantity === null || quantity === undefined || quantity === '') throw new Error('demo_reading_invalid')
    return { companyId: row.company_id, customerId: row.customer_id, meteringPointId: row.metering_point_id,
      startAt: row.period_start, endAt: row.period_end, kwh: Number(quantity), current: row.is_current }
  })
  return { supplies, readings, readAt: new Date().toISOString() }
}
