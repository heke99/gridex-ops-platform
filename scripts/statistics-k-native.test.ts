// reality-defects: K-01 K-02 K-03 K-04 K-06 K-07 K-08 K-09 (scenario K: statistics are computed and shown correctly)
//
// Native proof on the owned local stack: one isolated fixture tenant (K) and a control tenant, both synthetic and
// 'paused' so no scheduled analytics run touches them. The platform's own readers and builders are called; every
// expectation is the independent value. K-01..K-08 are red until 20261022210000, 20261022211000 and 20261023150000 (K-06 month end) are applied;
// K-09 is fixed in lib/analytics/db.ts.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json npx vitest run -c scripts/statistics-k-native.config.ts
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { countMissingMeteringPoints, getLatestForecastByBiddingZone, getReportRows } from '@/lib/analytics/db'
import { buildCompanyMonthlyMetrics } from '@/lib/analytics/monthlyMetricsBuilder'
import { literal, sql } from './helpers/live-chain-fixture'

type Row = Record<string, unknown>
const k = randomUUID(), control = randomUUID()
const ids = <T extends string>(...names: T[]) => Object.fromEntries(names.map(name => [name, randomUUID()])) as Record<T, string>
// Customers: A and F supplied from 1 September; B's switch starts 1 November (sent, awaiting the grid owner);
// C left on 1 October (received end: first day not supplied + market_end_at); D is a test-portal customer;
// E is archived; G's switch is pending (no supply period yet). X is the control tenant's customer.
const c = ids('A', 'F', 'B', 'C', 'D', 'E', 'G', 'X')
const p = ids('A', 'F', 'B', 'C', 'G', 'X')
const s = ids('A', 'F', 'B', 'C', 'G', 'X')
const quarters = (startIso: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(startIso) + i * 900_000).toISOString())
const FORECAST_ITEMS = 1001

beforeAll(() => {
  const company = (id: string, name: string) => `INSERT INTO public.companies(id,name,status,slug) VALUES(${literal(id)},${literal(name)},'paused',${literal(`e2e-k-${id.slice(0, 8)}`)});`
  const customer = (id: string, companyId: string, status: string, source: string) =>
    `INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,status,source,is_test_data)
     VALUES(${literal(id)},${literal(companyId)},'E2E','K-statistik',${literal(`e2e-k-${id.slice(0, 8)}@example.invalid`)},'private',${literal(status)},${literal(source)},true);`
  const facility = (customerId: string, siteId: string, pointId: string, companyId: string) =>
    `INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,price_area_code,is_test_data)
     VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},'E2E K','consumption','active','SE','SE3',true);
     INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,bidding_zone_code,price_area_code,status,is_test_data)
     VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},'SE3','SE3','active',true);`
  const supply = (customerId: string, pointId: string, companyId: string, start: string, end: string | null, marketEnd: string | null, status: string) =>
    `INSERT INTO public.customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date,market_end_at,status,source)
     VALUES(${literal(companyId)},${literal(customerId)},${literal(pointId)},${literal(start)},${literal(end)},${literal(marketEnd)},${literal(status)},'migration');`
  const values = [
    ...quarters('2026-09-15T10:00:00Z', 4).map(at => [p.A, at]),
    ...quarters('2026-09-30T22:00:00Z', 8).map(at => [p.A, at]), // 1 October 00:00-02:00 in Stockholm
    ...quarters('2026-10-01T00:00:00Z', 4).map(at => [p.A, at]),
    ...quarters('2026-09-30T22:00:00Z', 4).map(at => [p.F, at]), // F: only the first Swedish hour of October
  ]
  const run = randomUUID()
  sql(`BEGIN;
    ${company(k, 'E2E K Statistik AB')}
    ${company(control, 'E2E K Kontroll AB')}
    ${customer(c.A, k, 'active', 'external_website')}${customer(c.F, k, 'active', 'external_website')}${customer(c.B, k, 'active', 'external_website')}
    ${customer(c.C, k, 'active', 'external_website')}${customer(c.D, k, 'active', 'ediel_portal_test')}${customer(c.E, k, 'archived', 'external_website')}
    ${customer(c.G, k, 'active', 'external_website')}${customer(c.X, control, 'active', 'external_website')}
    ${facility(c.A, s.A, p.A, k)}${facility(c.F, s.F, p.F, k)}${facility(c.B, s.B, p.B, k)}${facility(c.C, s.C, p.C, k)}${facility(c.G, s.G, p.G, k)}${facility(c.X, s.X, p.X, control)}
    ${supply(c.A, p.A, k, '2026-09-01', null, null, 'active')}${supply(c.F, p.F, k, '2026-09-01', null, null, 'active')}
    ${supply(c.B, p.B, k, '2026-11-01', null, null, 'confirmed_by_grid_owner')}
    ${supply(c.C, p.C, k, '2026-08-01', '2026-10-01', '2026-09-30T22:00:00Z', 'ended')}
    ${supply(c.X, p.X, control, '2026-09-01', null, null, 'active')}
    INSERT INTO public.metering_values(company_id,customer_id,metering_point_id,reading_type,value_kwh,quantity_kwh,period_start,period_end,source_system,source_transaction_id,is_current,value_status)
    VALUES ${values.map(([point, at]) => `(${literal(k)},${literal(point === p.A ? c.A : c.F)},${literal(point)},'consumption',1,1,${literal(at)},${literal(new Date(Date.parse(at) + 900_000).toISOString())},'e2e_k','e2e-k-v2',true,'current')`).join(',')},
      (${literal(k)},${literal(c.A)},${literal(p.A)},'consumption',9,9,'2026-10-01T00:00:00Z','2026-10-01T00:15:00Z','e2e_k','e2e-k-v1',false,'replaced'),
      (${literal(control)},${literal(c.X)},${literal(p.X)},'consumption',5,5,'2026-10-10T10:00:00Z','2026-10-10T10:15:00Z','e2e_k','e2e-k-v2',true,'current');
    -- B's switch has been sent (Z03 built, 'prepared'); F has a second, queued-for-build draft for another start.
    INSERT INTO public.supplier_switch_requests(company_id,customer_id,site_id,customer_site_id,metering_point_id,request_type,status,requested_start_date)
    VALUES(${literal(k)},${literal(c.B)},${literal(s.B)},${literal(s.B)},${literal(p.B)},'switch','prepared','2026-11-01'),
          (${literal(k)},${literal(c.F)},${literal(s.F)},${literal(s.F)},${literal(p.F)},'switch','prepared','2026-12-01');
    INSERT INTO public.forecast_runs(id,company_id,forecast_type,status,period_start,period_end) VALUES(${literal(run)},${literal(k)},'consumption','completed','2026-10-01','2026-11-01');
    INSERT INTO public.forecast_run_items(company_id,forecast_run_id,customer_id,metering_point_id,bidding_zone_code,period_start,period_end,forecast_kwh,method)
    SELECT ${literal(k)},${literal(run)},${literal(c.A)},${literal(p.A)},'SE3','2026-10-01','2026-11-01',1,'historical' FROM generate_series(1,${FORECAST_ITEMS});
    COMMIT;`)
}, 120_000)

const snapshot = async (companyId: string, month: string) => {
  const { data, error } = await supabaseService.from('company_monthly_metrics')
    .select('total_customers,active_sites,active_metering_points,metering_values_received,metering_values_missing')
    .eq('company_id', companyId).eq('month', month).maybeSingle()
  if (error) throw error
  return data as Row | null
}
const dashboard = async (companyId: string) => {
  const { data, error } = await supabaseService.from('company_dashboard_summary_v')
    .select('customers_total,metering_points_total,ongoing_supplier_switches,open_switches,metering_values_total').eq('company_id', companyId).single()
  if (error) throw error
  return data as Row
}

describe.sequential('scenario K native: tenant statistics against independent counts', () => {
  it('K-09 forecast totals and CSV exports read every row past the 1 000-row API cap', async () => {
    const zones = await getLatestForecastByBiddingZone(k, { month: '2026-10-01' })
    expect(zones.map(z => ({ zone: z.biddingZoneCode, kwh: z.forecastKwh }))).toEqual([{ zone: 'SE3', kwh: FORECAST_ITEMS }])
    expect(await getReportRows(k, 'forecast_run_items', '2026-10-01')).toHaveLength(FORECAST_ITEMS)
    // The point/customer filter path reads its allow-lists completely too.
    const filtered = await getLatestForecastByBiddingZone(k, { month: '2026-10-01', status: 'active' })
    expect(filtered[0]?.forecastKwh).toBe(FORECAST_ITEMS)
  })

  it('K-03/K-07/K-08 the monthly snapshot counts Swedish months, real customers and supplied facilities', async () => {
    await buildCompanyMonthlyMetrics(k, '2026-09-01')
    await buildCompanyMonthlyMetrics(k, '2026-10-01')
    // Independent: customers A, F, B, C, G (D test portal, E archived). Supplied at the month end (the last day and
    // the next 1st, FINDINGS K-06): 31 Oct|1 Nov A, F; 30 Sep|1 Oct A, F (C's last supply day is 30 September).
    // Values (current, Stockholm months): October A 8+4 and F 4 = 16, September A 4.
    expect(await snapshot(k, '2026-10-01')).toMatchObject({ total_customers: 5, active_sites: 2, active_metering_points: 2, metering_values_received: 16 })
    expect(await snapshot(k, '2026-09-01')).toMatchObject({ total_customers: 5, active_sites: 2, active_metering_points: 2, metering_values_received: 4 })
  })

  it('K-04 "Saknade mätvärden" expects values only where the tenant supplies the facility in that Swedish month', async () => {
    // October: A and F have values, B starts 1 November, C left 1 October, G is not supplied. September: F (no
    // Swedish-September value) and C (supplied all September, no value).
    expect(await countMissingMeteringPoints(k, '2026-10-01')).toBe(0)
    expect(await countMissingMeteringPoints(k, '2026-09-01')).toBe(2)
    expect((await snapshot(k, '2026-10-01'))?.metering_values_missing).toBe(0)
  })

  it('K-01/K-02 the dashboard counts switches waiting at the grid owner and every stored value once', async () => {
    // Independent: two switches sent and awaiting the grid owner's answer; 20 current values (one replaced revision).
    expect(await dashboard(k)).toMatchObject({ customers_total: 5, metering_points_total: 5, ongoing_supplier_switches: 2, open_switches: 2, metering_values_total: 20 })
  })

  it('isolation: the control tenant shows only its own records and K never includes them', async () => {
    expect(await dashboard(control)).toMatchObject({ customers_total: 1, metering_points_total: 1, ongoing_supplier_switches: 0, metering_values_total: 1 })
    expect(await snapshot(control, '2026-10-01')).toBeNull()
    expect(await countMissingMeteringPoints(control, '2026-10-01')).toBe(0)
    const foreign = sql<number>(`SELECT to_jsonb(count(*)) FROM public.metering_point_monthly_consumption WHERE company_id=${literal(k)} AND metering_point_id=${literal(p.X)}`)
    expect(foreign).toBe(0)
  })
})
