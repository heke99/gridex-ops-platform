// reality-defects: (reality scenario G: end of daylight saving time 2026-10-25; DST-N1..N4 checks)
// Stored quarter-hours of whole Stockholm months that contain a DST change, read through the real SQL
// functions and readers the customer channels and billing use: Mina sidor month cards
// (gridex_portal_monthly_consumption_v1 via listPortalMonthlyConsumption), the customer/partner API value
// reader (gridex_customer_normalized_metering_values_v1 via customerNormalizedMeteringValues, with the
// partner API's own Stockholm day bounds) and the billing completeness check (evaluateMeteringCompletenessForMonth).
// October 2026 has 2 980 quarter-hours (31 × 96 + 4), March 2027 has 2 972 (31 × 96 − 4).
// Real disposable replay, synthetic rows only (example.invalid).
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { customerNormalizedMeteringValues } from '@/lib/metering/customerMeteringAccess'
import { listPortalMonthlyConsumption } from '@/lib/customer-portal/db'
import { evaluateMeteringCompletenessForMonth } from '@/lib/metering/validation'
import { stockholmDayStartUtc, stockholmNextDayStartUtc } from '@/lib/partner-api/partnerTime'
import { stockholmMonthBounds } from '@/lib/time/stockholm'
import { literal, nativeSql as sql } from './helpers/ediel-normal-switch-native-fixture'
import { monthDays, stockholmQuarterCount, stockholmQuarterStarts } from './helpers/reality/dst'

const company = randomUUID()
// FULL: every quarter of October 2026. NAIVE: a grid owner that skips the repeated hour (02:00–03:00 CET,
// 01:00Z–02:00Z) on 25 October, i.e. sends 96 wall-clock quarters. SPRING: every quarter of March 2027.
const FULL = { customer: randomUUID(), point: randomUUID(), month: '2026-10' }
const NAIVE = { customer: randomUUID(), point: randomUUID(), month: '2026-10' }
const SPRING = { customer: randomUUID(), point: randomUUID(), month: '2027-03' }
const REPEATED_HOUR = ['2026-10-25T01:00:00.000Z', '2026-10-25T02:00:00.000Z']
/** Deterministic value per UTC quarter: different in both passes of the repeated hour. */
const valueAt = (iso: string) => Math.round((0.05 + ((Date.parse(iso) / 900_000) % 13) / 1000) * 1000) / 1000
const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 1000) / 1000
const monthStarts = (month: string) => monthDays(month).flatMap(stockholmQuarterStarts)
const naiveStarts = () => monthStarts('2026-10').filter(iso => !(iso >= REPEATED_HOUR[0] && iso < REPEATED_HOUR[1]))

beforeAll(() => {
  let serial = 0
  const setup = (x: { customer: string; point: string; month: string }, name: string) => {
    const gsrn = `7359990000000${String(20000 + (serial += 1)).slice(1)}`
    const start = stockholmMonthBounds(x.month).start
    return `INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,is_test_data,source)
      VALUES(${literal(x.customer)},${literal(company)},'E2E',${literal(name)},${literal(`e2e-dst-${x.customer.slice(0, 8)}@example.invalid`)},'private',true,'e2e_native');
     INSERT INTO public.metering_points(id,company_id,customer_id,metering_point_id,meter_point_id,status,is_test_data)
      VALUES(${literal(x.point)},${literal(company)},${literal(x.customer)},${literal(gsrn)},${literal(gsrn)},'active',true);
     INSERT INTO public.customer_supply_periods(company_id,customer_id,metering_point_id,start_date,status,source,market_start_at)
      VALUES(${literal(company)},${literal(x.customer)},${literal(x.point)},${literal(`${x.month}-01`)},'active','ediel_qualified_source',${literal(start)});`
  }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'E2E DST Elhandel','active');
   ${setup(FULL, 'Hela oktober')} ${setup(NAIVE, 'Utan extratimme')} ${setup(SPRING, 'Mars 2027')}`)
  // Rows are generated in SQL over UTC instants; the same formula is evaluated in TypeScript for the expectation.
  const rows = (x: { customer: string; point: string; month: string }, skip: string[] | null) => {
    const b = stockholmMonthBounds(x.month)
    const filter = skip ? `WHERE NOT (t >= ${literal(skip[0])}::timestamptz AND t < ${literal(skip[1])}::timestamptz)` : ''
    const value = `round((0.05 + ((extract(epoch from t)::bigint / 900) % 13) / 1000.0)::numeric, 3)`
    return `WITH q AS (SELECT t FROM generate_series(${literal(b.start)}::timestamptz, ${literal(b.end)}::timestamptz - interval '15 minutes', interval '15 minutes') t ${filter}),
      n AS (INSERT INTO public.normalized_metering_values(company_id,customer_id,metering_point_id,period_start,period_end,quantity_kwh,source_type,source_transaction_reference,resolution,revision_status,direction,status)
        SELECT ${literal(company)},${literal(x.customer)},${literal(x.point)},t,t+interval '15 minutes',${value},'e2e_native','dst-'||to_char(t AT TIME ZONE 'UTC','YYYYMMDDHH24MI'),'PT15M','current','consumption','dst' FROM q RETURNING 1)
     INSERT INTO public.metering_values(company_id,customer_id,metering_point_id,period_start,period_end,value_kwh,quantity,reading_type,source_system,source_transaction_id,is_current,revision_status,direction)
       SELECT ${literal(company)},${literal(x.customer)},${literal(x.point)},t,t+interval '15 minutes',${value},${value},'consumption','e2e_native','dst-'||to_char(t AT TIME ZONE 'UTC','YYYYMMDDHH24MI'),true,'current','consumption' FROM q;`
  }
  sql(`${rows(FULL, null)} ${rows(NAIVE, REPEATED_HOUR)} ${rows(SPRING, null)}`)
})

const monthCard = async (customer: string, month: string) => {
  const months = await listPortalMonthlyConsumption({ companyId: company, customerIds: [customer] } as Parameters<typeof listPortalMonthlyConsumption>[0],
    { now: new Date(`${month}-28T12:00:00Z`), months: 2 })
  return months.find(row => row.monthKey === month)
}
const monthRaw = (customer: string, month: string) => sql<Record<string, unknown>>(`SELECT to_jsonb(r) FROM public.gridex_portal_monthly_consumption_v1(${literal(company)},
  ARRAY[${literal(customer)}]::uuid[],${literal(`${month}-01`)}::date,${literal(`${month}-01`)}::date) r`)

describe('DST months in the customer channels and billing completeness (scenario G)', () => {
  it('the stored rows are what the grid owner sent: 2 980 / 2 976 / 2 972 quarter-hours', () => {
    const counts = sql<Record<string, number>>(`SELECT jsonb_object_agg(customer_id,n) FROM (SELECT customer_id,count(*) n FROM public.normalized_metering_values WHERE company_id=${literal(company)} GROUP BY 1) x`)
    expect(counts).toEqual({ [FULL.customer]: 2980, [NAIVE.customer]: 2976, [SPRING.customer]: 2972 })
    expect(stockholmQuarterCount('2026-10-25')).toBe(100)
  })

  it('DST-N1 Mina sidor month card: October holds 2 980 values, the full sum, and is complete', async () => {
    const card = await monthCard(FULL.customer, '2026-10')
    const starts = monthStarts('2026-10')
    expect(starts).toHaveLength(2980)
    expect(card).toMatchObject({ valueCount: 2980, complete: true })
    expect(card!.totalKwh).toBeCloseTo(sum(starts.map(valueAt)), 6)
    // Expected time is the Stockholm month: 31 days and the extra hour.
    expect(monthRaw(FULL.customer, '2026-10')).toMatchObject({ expected_seconds: 31 * 86_400 + 3_600, covered_seconds: 31 * 86_400 + 3_600, is_complete: true })
  })

  it('DST-N2 a month without the repeated hour is shown as incomplete, never as a complete smaller sum', async () => {
    const card = await monthCard(NAIVE.customer, '2026-10')
    expect(card).toMatchObject({ valueCount: 2976, complete: false })
    expect(card!.totalKwh).toBeCloseTo(sum(naiveStarts().map(valueAt)), 6)
    expect(monthRaw(NAIVE.customer, '2026-10')).toMatchObject({ expected_seconds: 31 * 86_400 + 3_600, covered_seconds: 31 * 86_400, is_complete: false })
  })

  it('DST-N3 spring: March 2027 holds 2 972 values and is complete', async () => {
    const card = await monthCard(SPRING.customer, '2027-03')
    expect(card).toMatchObject({ valueCount: 2972, complete: true })
    expect(card!.totalKwh).toBeCloseTo(sum(monthStarts('2027-03').map(valueAt)), 6)
    expect(monthRaw(SPRING.customer, '2027-03')).toMatchObject({ expected_seconds: 31 * 86_400 - 3_600, is_complete: true })
  })

  it('DST-N4 the customer/partner API value reader returns 100 distinct quarter-hours for the Stockholm day 25 October', async () => {
    const from = stockholmDayStartUtc('2026-10-25').toISOString(), before = stockholmNextDayStartUtc('2026-10-25').toISOString()
    expect([from, before]).toEqual(['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])
    const { data, error } = await customerNormalizedMeteringValues({ companyId: company, customerIds: [FULL.customer] }, { periodStartFrom: from, periodStartBefore: before })
      .select('period_start,period_end,quantity_kwh').order('period_start', { ascending: true })
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ period_start: string; period_end: string; quantity_kwh: number }>
    expect(rows).toHaveLength(100)
    const starts = rows.map(row => new Date(row.period_start).toISOString())
    expect(starts).toEqual(stockholmQuarterStarts('2026-10-25'))
    expect(sum(rows.map(row => Number(row.quantity_kwh)))).toBeCloseTo(sum(stockholmQuarterStarts('2026-10-25').map(valueAt)), 6)
    // The neighbouring days keep 96 each.
    for (const day of ['2026-10-24', '2026-10-26']) {
      const window = await customerNormalizedMeteringValues({ companyId: company, customerIds: [FULL.customer] },
        { periodStartFrom: stockholmDayStartUtc(day).toISOString(), periodStartBefore: stockholmNextDayStartUtc(day).toISOString() }).select('id')
      expect(window.data ?? [], day).toHaveLength(96)
    }
  })

  it('DST-N5 billing completeness: a full October is complete; a missing repeated hour is a one-hour gap', async () => {
    const full = await evaluateMeteringCompletenessForMonth({ companyId: company, billingMonth: '2026-10', meteringPoints: [{ meteringPointId: FULL.point, requiredResolution: 'quarter_hour' }] })
    expect(full).toMatchObject({ status: 'complete', valueCount: 2980, issues: [] })
    const naive = await evaluateMeteringCompletenessForMonth({ companyId: company, billingMonth: '2026-10', meteringPoints: [{ meteringPointId: NAIVE.point, requiredResolution: 'quarter_hour' }] })
    expect(naive.status).toBe('incomplete')
    expect(naive.issues).toEqual([expect.objectContaining({ code: 'metering_gap', details: expect.objectContaining({ missing_hours: 1 }) })])
    const spring = await evaluateMeteringCompletenessForMonth({ companyId: company, billingMonth: '2027-03', meteringPoints: [{ meteringPointId: SPRING.point, requiredResolution: 'quarter_hour' }] })
    expect(spring).toMatchObject({ status: 'complete', valueCount: 2972 })
  })
})
