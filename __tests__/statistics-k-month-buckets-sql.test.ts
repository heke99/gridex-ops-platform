// reality-defects: K-03 K-04 K-05 K-06 K-07 K-08 (scenario K: statistics are computed and shown correctly)
//
// Runs the installed analytics SQL (the predecessor migrations, in PGlite) on one known tenant, shows each defect,
// then applies 20261022210000 and 20261023150000 (K-06) and checks the independent values. Every timestamp below is chosen at a Swedish
// month boundary: 2026-09-30T22:00Z is 1 October 00:00 in Stockholm (CEST).
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const read = (path: string) => fs.readFileSync(path, 'utf8')
const fix = 'supabase/migrations/20261022210000_statistics_stockholm_months_and_supply_counts.sql'

const k = '00000000-0000-4000-8000-0000000000a1'
const control = '00000000-0000-4000-8000-0000000000b2'
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// Customers: A and F supplied from 1 September; B's switch starts 1 November; C left on 1 October (Z05: exclusive
// end with market_end_at); D is a test-portal customer; E is archived; G's switch is still pending (no supply period).
const [cA, cF, cB, cC, cD, cE, cG] = [1, 2, 3, 4, 5, 6, 8].map(id)
const [pA, pF, pB, pC, pG] = [11, 12, 13, 14, 16].map(id)
const [sA, sF, sB, sC, sG] = [21, 22, 23, 24, 26].map(id)
const quarters = (startIso: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(startIso) + i * 900_000).toISOString())

beforeAll(async () => {
  await db.exec(read('scripts/sql/customer-portfolio/00_stub.sql').replace('create extension if not exists pgcrypto;', ''))
  for (const migration of [
    '20261003130000_customer_portfolio_analytics_whitelabel.sql',
    '20261003131000_customer_portfolio_phase2.sql',
    '20261003150000_portfolio_analytics_rollups_performance.sql',
    '20261013094448_customer_portfolio_consistency_repair.sql',
  ]) await db.exec(read(`supabase/migrations/${migration}`))
  await db.exec(`
    alter table customers add column source text;
    create unique index customers_ci on customers(company_id,id);
    create unique index sites_ci on customer_sites(company_id,id);
    create unique index meters_ci on metering_points(company_id,id);
    create unique index contracts_ci on customer_contracts(company_id,id);
    create table external_contract_intakes(id uuid primary key,company_id uuid not null,created_customer_id uuid,created_site_id uuid,created_metering_point_id uuid,created_contract_id uuid);
    alter table data_quality_issues add column entity_type text,add column entity_id uuid,add column period_month date;
    alter table customer_supply_periods add column actual_end_date date, add column market_end_at timestamptz, add column source_switch_request_id uuid;
    alter table metering_points add column site_id uuid, add column customer_site_id uuid;
    insert into companies(id,name) values('${k}','K'),('${control}','Control');
    set test.role='service_role';
  `)
  const quality = read('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql')
  for (const name of ['gridex_data_quality_active_status_v1', 'gridex_missing_metering_points_v1']) {
    const start = quality.indexOf(`create or replace function public.${name}(`)
    await db.exec(quality.slice(start, quality.indexOf('$$;', start) + 3))
  }
  // The installed source predicate (20261013130700) for an operational, active metering point.
  await db.exec(`create function public.gridex_data_quality_source_exists_v1(p_company uuid,p_entity_type text,p_entity_id uuid,p_requires_active boolean default false)
    returns boolean language sql stable as $$ select exists(select 1 from public.metering_points p where p.company_id=p_company and p.id=p_entity_id
      and (not p_requires_active or public.gridex_data_quality_active_status_v1(p.status))) $$`)
  await db.exec(read('supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql'))

  const values = [
    ...quarters('2026-09-15T10:00:00Z', 4).map(at => [pA, at]),
    ...quarters('2026-09-30T22:00:00Z', 8).map(at => [pA, at]), // 1 Oct 00:00-02:00 CEST
    ...quarters('2026-10-01T00:00:00Z', 4).map(at => [pA, at]),
    ...quarters('2026-09-30T22:00:00Z', 4).map(at => [pF, at]), // F: only the first Swedish hour of October
  ]
  await db.exec(`
    insert into customers(id,company_id,status,source) values
      ('${cA}','${k}','active','external_website'),('${cF}','${k}','active','external_website'),('${cB}','${k}','active','external_website'),
      ('${cC}','${k}','active','external_website'),('${cD}','${k}','active','ediel_portal_test'),('${cE}','${k}','archived','external_website'),
      ('${cG}','${k}','active','external_website'),
      ('${id(7)}','${control}','active','external_website');
    insert into customer_sites(id,company_id,customer_id,status) values('${sA}','${k}','${cA}','active'),('${sF}','${k}','${cF}','active'),('${sB}','${k}','${cB}','active'),('${sC}','${k}','${cC}','active'),('${sG}','${k}','${cG}','active');
    insert into metering_points(id,company_id,customer_id,site_id,customer_site_id,status) values
      ('${pA}','${k}','${cA}','${sA}','${sA}','active'),('${pF}','${k}','${cF}','${sF}','${sF}','active'),
      ('${pB}','${k}','${cB}','${sB}','${sB}','active'),('${pC}','${k}','${cC}','${sC}','${sC}','active'),
      ('${pG}','${k}','${cG}','${sG}','${sG}','active'),
      ('${id(15)}','${control}','${id(7)}',null,null,'active');
    insert into customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date,market_end_at,status) values
      ('${k}','${cA}','${pA}','2026-09-01',null,null,'active'),('${k}','${cF}','${pF}','2026-09-01',null,null,'active'),
      ('${k}','${cB}','${pB}','2026-11-01',null,null,'confirmed_by_grid_owner'),
      ('${k}','${cC}','${pC}','2026-08-01','2026-10-01','2026-09-30T22:00:00Z','ended'),
      ('${control}','${id(7)}','${id(15)}','2026-09-01',null,null,'active');
    insert into metering_values(company_id,metering_point_id,value_kwh,period_start) values
      ${values.map(([point, at]) => `('${k}','${point}',1,'${at}')`).join(',')},
      ('${control}','${id(15)}',5,'2026-10-10T10:00:00Z');
    insert into powers_of_attorney(company_id,customer_id,status,signed_at,valid_from,created_at) values
      ('${k}','${cA}','signed','2026-09-30T22:30:00Z','2026-10-01','2026-09-30T22:30:00Z'),
      ('${k}','${cF}','signed','2026-10-15T10:00:00Z','2026-10-15','2026-10-15T10:00:00Z');
    insert into grid_owner_data_requests(company_id,request_scope,status,requested_period_start,requested_at,created_at) values
      ('${k}','meter_values','pending','2026-10-01','2026-09-30T23:00:00Z','2026-09-30T23:00:00Z');
  `)
}, 60_000)

afterAll(async () => { await db.close() })

type Row = Record<string, unknown>
const one = async (sql: string) => (await db.query<Row>(sql)).rows[0]
const rollup = async () => (await db.query<Row>(`select metering_point_id::text as point, month::text as month, value_count from metering_point_monthly_consumption
  where company_id='${k}' and value_count>0 order by 1,2`)).rows
const missing = async (month: string) => (await db.query<{ id: string }>(`select metering_point_id::text id from gridex_missing_metering_points_v1('${k}','${month}') order by 1`)).rows.map(row => row.id)
const portfolio = (month: string) => one(`select active_customers_start,active_customers,new_customers,churned_customers,poa_requested,poa_signed,metering_requests_total
  from gridex_customer_portfolio_monthly_internal('${k}','${month}','${month}')`)
const snapshot = (month: string) => one(`select total_customers,active_sites,active_metering_points,metering_values_received,metering_values_missing,requested_metering_values
  from company_monthly_metrics where company_id='${k}' and month='${month}'`)
const rebuild = async () => {
  await db.exec(`select gridex_rebuild_company_analytics_month('${k}','2026-09-01'); select gridex_rebuild_company_analytics_month('${k}','2026-10-01');`)
}

describe.sequential('scenario K: month buckets and supply-based counts', () => {
  it('reproduces the defects with the installed functions', async () => {
    await db.exec(`select gridex_rebuild_metering_monthly_consumption('${k}','2026-09-01','2026-10-01')`)
    // K-03: the first two Swedish hours of October land in September (UTC months).
    expect(await rollup()).toEqual([
      { point: pA, month: '2026-09-01', value_count: 12 }, { point: pA, month: '2026-10-01', value_count: 4 },
      { point: pF, month: '2026-09-01', value_count: 4 },
    ])
    // K-04: B (supply from November), C (left 1 October) and G (switch pending) are "missing" in October; F is
    // "missing" in October although it has October values, and not missing in September although it has none there.
    expect(await missing('2026-10-01')).toEqual([pB, pC, pF, pG].sort())
    expect(await missing('2026-09-01')).toEqual([pB, pC, pG].sort())
    // K-05: the power of attorney signed 1 October 00:30 and the request of 1 October 01:00 count in September.
    expect(await portfolio('2026-10-01')).toMatchObject({ poa_requested: 1, poa_signed: 1, metering_requests_total: 0 })
    expect(await portfolio('2026-09-01')).toMatchObject({ poa_requested: 1, poa_signed: 1, metering_requests_total: 1 })
    // K-07/K-08: the test-portal and archived customers count; B's and C's facilities count as active.
    await rebuild()
    expect(await snapshot('2026-10-01')).toMatchObject({ total_customers: 7, active_sites: 5, active_metering_points: 5, metering_values_received: 4, metering_values_missing: 4 })
  })

  it('20261022210000 gives the independent values', async () => {
    await db.exec(read(fix))
    await db.exec(`select gridex_rebuild_metering_monthly_consumption('${k}','2026-09-01','2026-10-01')`)
    // Independent: Stockholm months. September: A's 4 values of 15 September. October: A 8+4, F 4.
    expect(await rollup()).toEqual([
      { point: pA, month: '2026-09-01', value_count: 4 }, { point: pA, month: '2026-10-01', value_count: 12 },
      { point: pF, month: '2026-10-01', value_count: 4 },
    ])
    // Independent: a point is expected only in a month its supply reaches. October: A and F have values; B is
    // not yet supplied, C left on 1 October, G is not supplied. September: F (supplied, no Swedish-September value) and C.
    expect(await missing('2026-10-01')).toEqual([])
    expect(await missing('2026-09-01')).toEqual([pC, pF].sort())
    // Independent: both powers of attorney and the request are October events in Sweden.
    expect(await portfolio('2026-10-01')).toMatchObject({ active_customers_start: 3, active_customers: 2, new_customers: 0, churned_customers: 1,
      poa_requested: 2, poa_signed: 2, metering_requests_total: 1 })
    expect(await portfolio('2026-09-01')).toMatchObject({ poa_requested: 0, poa_signed: 0, metering_requests_total: 0 })
    await rebuild()
    // Independent: customers A, F, B, C, G (D is a test-portal customer, E archived); supplied at 31 October: A and F.
    expect(await snapshot('2026-10-01')).toMatchObject({ total_customers: 5, active_sites: 2, active_metering_points: 2, metering_values_received: 16,
      metering_values_missing: 0, requested_metering_values: 1 })
    // September: supplied at 30 September are A, F and C.
    expect(await snapshot('2026-09-01')).toMatchObject({ total_customers: 5, active_sites: 3, active_metering_points: 3, metering_values_received: 4,
      metering_values_missing: 2, requested_metering_values: 0 })
  })

  // K-06 (owner decision 2026-10-23): end_date has two meanings (a received Z05 end is the first day no longer
  // supplied, a manual end the last supplied day: lib/billing/supplyPeriodEnd.ts). Churn and the active counts now
  // read the LAST SUPPLY DAY (gridex_supply_period_last_day_v1), matching the card hint "Sista leveransdag i månaden",
  // and the month figures reconcile: active at the start/end of a month = supplied on both days around its first
  // day / the next month's first day, so active_end(M) = active_start(M+1) and net = new - churned (re-entries aside).
  it('20261023150000 K-06 churn month = last supply day; month-end counts reconcile', async () => {
    const churn = '00000000-0000-4000-8000-0000000000c3'
    // Customers (supply from 1 June unless stated): 31 Z05 end 1 October 00:00 CEST (exclusive) -> last day
    // 30 September; 32 manual end 30 September (inclusive, end_date = actual_end_date); 33 manual end 1 October;
    // 34 leaves point 44 by Z05 on 1 October and is supplied on point 45 from 1 October (moves, still a customer);
    // 35 Z05 end 1 November 00:00 CET -> last day 31 October; 36 manual end 31 October; 37 re-entry: manual end
    // 31 July, back from 1 October (point 49); 38 new from 1 October (point 50).
    await db.exec(`insert into companies(id,name) values('${churn}','Churn');
      insert into customers(id,company_id,status,source) values
        ${[31, 32, 33, 34, 35, 36, 37, 38].map(n => `('${id(n)}','${churn}','active','external_website')`).join(',')};
      insert into metering_points(id,company_id,customer_id,status) values
        ${[[41, 31], [42, 32], [43, 33], [44, 34], [45, 34], [46, 35], [47, 36], [48, 37], [49, 37], [50, 38]]
          .map(([point, customer]) => `('${id(point)}','${churn}','${id(customer)}','active')`).join(',')};
      insert into customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date,actual_end_date,market_end_at,status) values
        ('${churn}','${id(31)}','${id(41)}','2026-06-01','2026-10-01',null,'2026-09-30T22:00:00Z','ended'),
        ('${churn}','${id(32)}','${id(42)}','2026-06-01','2026-09-30','2026-09-30',null,'ended'),
        ('${churn}','${id(33)}','${id(43)}','2026-06-01','2026-10-01',null,null,'ended'),
        ('${churn}','${id(34)}','${id(44)}','2026-06-01','2026-10-01',null,'2026-09-30T22:00:00Z','ended'),
        ('${churn}','${id(34)}','${id(45)}','2026-10-01',null,null,null,'active'),
        ('${churn}','${id(35)}','${id(46)}','2026-06-01','2026-11-01',null,'2026-10-31T23:00:00Z','ended'),
        ('${churn}','${id(36)}','${id(47)}','2026-06-01','2026-10-31',null,null,'ended'),
        ('${churn}','${id(37)}','${id(48)}','2026-06-01','2026-07-31','2026-07-31',null,'ended'),
        ('${churn}','${id(37)}','${id(49)}','2026-10-01',null,null,null,'active'),
        ('${churn}','${id(38)}','${id(50)}','2026-10-01',null,null,null,'active');`)
    type Month = { month: string; active_customers_start: number; active_customers: number; new_customers: number; churned_customers: number
      net_change: number; active_metering_points: number }
    const months = async () => (await db.query<Month>(`select month::text as month, active_customers_start, active_customers, new_customers, churned_customers,
      net_change, active_metering_points from gridex_customer_portfolio_summary('${churn}','2026-09-01','2026-11-01') order by month`)).rows
    const activeAt = async (at: string) => one(`select active_customers, active_metering_points from gridex_customer_portfolio_active_counts(array['${churn}'::uuid],'${at}')`)
    const zones = async (at: string) => one(`select active_customers, metering_points from gridex_customer_portfolio_bidding_zones('${churn}','${at}')`)
    const cohorts = async () => (await db.query<Row>(`select cohort_month::text as cohort, customers, retained_1m::float8 as r1, retained_3m::float8 as r3, retained_6m::float8 as r6
      from gridex_customer_portfolio_cohorts_at('${churn}','2026-12-15',12) order by 1`)).rows
    const reasons = async () => (await db.query<Row>(`select month::text as month, reason, customers from gridex_customer_portfolio_churn_reasons('${churn}','2026-09-01','2026-11-30')`)).rows
    const snapshotPoints = async () => {
      await db.exec(`select gridex_rebuild_company_analytics_month('${churn}','2026-09-01'); select gridex_rebuild_company_analytics_month('${churn}','2026-10-01');`)
      return (await db.query<Row>(`select month::text as month, active_metering_points from company_monthly_metrics where company_id='${churn}' order by month`)).rows
    }

    // Before: the Z05 end of 1 October churns in October but the manual end of 30 September in September; the Z05
    // end of 1 November churns in November; on 1 October customer 33 (its last day) is not counted; the June
    // cohort's 3-month retention counts 31 and 34's old point as supplied on 30 September|1 October.
    expect((await months()).map(m => m.churned_customers)).toEqual([1, 3, 1])
    expect(await activeAt('2026-10-01')).toEqual({ active_customers: 5, active_metering_points: 5 })
    expect(await zones('2026-10-01')).toEqual({ active_customers: 5, metering_points: 5 })
    expect((await cohorts())[0]).toMatchObject({ cohort: '2026-06-01', customers: 7, r3: 0.7143 })
    expect(await snapshotPoints()).toEqual([{ month: '2026-09-01', active_metering_points: 5 }, { month: '2026-10-01', active_metering_points: 4 }])

    await db.exec(read('supabase/migrations/20261023150500_statistics_churn_last_supply_day.sql'))
    // The canonical expression: received market end at the start of its date (CEST 22:00Z, CET 23:00Z) exclusive,
    // an end during the day or without market instant inclusive, actual_end_date before end_date.
    expect(await one(`select gridex_supply_period_last_day_v1('2026-10-01',null,'2026-09-30T22:00:00Z')::text summer,
      gridex_supply_period_last_day_v1('2026-11-01',null,'2026-10-31T23:00:00Z')::text winter,
      gridex_supply_period_last_day_v1('2026-10-15',null,'2026-10-15T10:00:00Z')::text in_day,
      gridex_supply_period_last_day_v1('2026-10-01',null,null)::text manual,
      gridex_supply_period_last_day_v1('2026-10-20','2026-10-05',null)::text actual,
      gridex_supply_period_last_day_v1(null,null,'2026-10-31T23:00:00Z')::text open`)).toEqual({
      summer: '2026-09-30', winter: '2026-10-31', in_day: '2026-10-15', manual: '2026-10-01', actual: '2026-10-05', open: null })

    // Independent. Churned in the month of the last supply day: September 31 (Z05 1 October) and 32 (manual
    // 30 September); October 33 (manual 1 October), 35 (Z05 1 November), 36 (manual 31 October). 34 (moved without
    // a gap) and 37 (re-entry, has an open period) are never churned. New: 38 in October (37 started in June).
    // Active at a boundary = supplied the day before and the day itself:
    //   31 Aug|1 Sep: 31-36 (6); 30 Sep|1 Oct: 33, 34 (44 then 45), 35, 36 (4: 31 and 32 left in September, 37 and
    //   38 start 1 October); 31 Oct|1 Nov: 34, 37, 38 (3); 30 Nov|1 Dec: 34, 37, 38 (3).
    // Points at the end boundary: 1 October 43, 46, 47; 1 November and 1 December 45, 49, 50.
    // Net = end - start: September -2 = 0 new - 2 churned; October -1 = 1 - 3 + 1 (37 re-entered); November 0.
    expect(await months()).toEqual([
      { month: '2026-09-01', active_customers_start: 6, active_customers: 4, new_customers: 0, churned_customers: 2, net_change: -2, active_metering_points: 3 },
      { month: '2026-10-01', active_customers_start: 4, active_customers: 3, new_customers: 1, churned_customers: 3, net_change: -1, active_metering_points: 3 },
      { month: '2026-11-01', active_customers_start: 3, active_customers: 3, new_customers: 0, churned_customers: 0, net_change: 0, active_metering_points: 3 },
    ])
    const rows = await months()
    for (let i = 0; i + 1 < rows.length; i += 1) expect(rows[i].active_customers).toBe(rows[i + 1].active_customers_start)
    // Supplied on a day (point-in-time readers). 30 September: 31-36 (points 41-44, 46, 47). 1 October: 33 (its last
    // day), 34 (45), 35, 36, 37 (49), 38 (50). 31 October: 34, 35, 36, 37, 38.
    expect(await activeAt('2026-09-30')).toEqual({ active_customers: 6, active_metering_points: 6 })
    expect(await activeAt('2026-10-01')).toEqual({ active_customers: 6, active_metering_points: 6 })
    expect(await activeAt('2026-10-31')).toEqual({ active_customers: 5, active_metering_points: 5 })
    expect(await zones('2026-10-01')).toEqual({ active_customers: 6, metering_points: 6 })
    expect(await reasons()).toEqual([
      { month: '2026-09-01', reason: 'unknown', customers: 2 },
      { month: '2026-10-01', reason: 'unknown', customers: 3 },
    ])
    // Retention at the end of month k (boundary): June cohort 31-37: 1 month (31 Jul|1 Aug) all but 37 = 6/7;
    // 3 months (30 Sep|1 Oct) 33-36 = 4/7; 6 months not yet due. October cohort 38: 1 month (30 Nov|1 Dec) 1.
    expect(await cohorts()).toEqual([
      { cohort: '2026-06-01', customers: 7, r1: 0.8571, r3: 0.5714, r6: null },
      { cohort: '2026-10-01', customers: 1, r1: 1, r3: null, r6: null },
    ])
    // The monthly snapshot's supplied points use the same end boundary as the portfolio.
    expect(await snapshotPoints()).toEqual([{ month: '2026-09-01', active_metering_points: 3 }, { month: '2026-10-01', active_metering_points: 3 }])

    // Scenario K's tenant: C (Z05 end 1 October, last day 30 September) is churned in September and not active at
    // the end of September; A and F (from 1 September) are new in September and not active at its start.
    expect(await portfolio('2026-09-01')).toMatchObject({ active_customers_start: 1, active_customers: 2, new_customers: 2, churned_customers: 1 })
    expect(await portfolio('2026-10-01')).toMatchObject({ active_customers_start: 2, active_customers: 2, new_customers: 0, churned_customers: 0 })
    expect(await missing('2026-10-01')).toEqual([])
    expect(await missing('2026-09-01')).toEqual([pC, pF].sort())
    await rebuild()
    // Supplied at 31 October|1 November: A, F; at 30 September|1 October: A, F (C's last day was 30 September).
    expect(await snapshot('2026-10-01')).toMatchObject({ total_customers: 5, active_sites: 2, active_metering_points: 2, metering_values_missing: 0 })
    expect(await snapshot('2026-09-01')).toMatchObject({ total_customers: 5, active_sites: 2, active_metering_points: 2, metering_values_missing: 2 })
  })

  it('never counts another tenant and keeps the builders service-only', async () => {
    const other = await one(`select count(*)::int n from company_monthly_metrics where company_id='${control}'`)
    expect(other).toEqual({ n: 0 })
    expect(await one(`select coalesce(sum(value_count),0)::int n from metering_point_monthly_consumption where company_id='${k}' and metering_point_id='${id(15)}'`)).toEqual({ n: 0 })
    const grants = await one(`select has_function_privilege('authenticated','gridex_rebuild_company_analytics_month(uuid,date)','EXECUTE') rebuild,
      has_function_privilege('authenticated','gridex_rebuild_metering_monthly_consumption(uuid,date,date)','EXECUTE') rollup,
      has_function_privilege('authenticated','gridex_customer_portfolio_monthly_internal(uuid,date,date)','EXECUTE') portfolio`)
    expect(grants).toEqual({ rebuild: false, rollup: false, portfolio: false })
  })
})
