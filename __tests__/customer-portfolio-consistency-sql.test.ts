import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const migrations = [
  '20261003130000_customer_portfolio_analytics_whitelabel.sql',
  '20261003131000_customer_portfolio_phase2.sql',
  '20261003150000_portfolio_analytics_rollups_performance.sql',
]
const repair = readdirSync('supabase/migrations').find((name) => name.endsWith('_customer_portfolio_consistency_repair.sql'))
const companyA = '00000000-0000-0000-0000-00000000000a'
const companyB = '00000000-0000-0000-0000-00000000000b'
const customer = '00000000-0000-0000-0000-0000000000c1'
const point = '00000000-0000-0000-0000-0000000000d1'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // The live PoA columns are timestamps, unlike the original date-only SQL stub.
  const stub = readFileSync('scripts/sql/customer-portfolio/00_stub.sql', 'utf8')
    .replace('create extension if not exists pgcrypto;', '')
    .replace('valid_from date, valid_to date, created_at', 'valid_from timestamptz, valid_to timestamptz, created_at')
  await db.exec(stub)
  for (const file of migrations) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  // Running without the forward migration reproduces the old behavior during RED.
  if (repair) await db.exec(readFileSync(`supabase/migrations/${repair}`, 'utf8'))
  await db.exec(`
    INSERT INTO companies(id,name) VALUES ('${companyA}','A'),('${companyB}','B');
    INSERT INTO company_memberships(user_id,company_id) VALUES ('00000000-0000-0000-0000-000000000001','${companyA}');
    INSERT INTO customers(id,company_id,full_name) VALUES ('${customer}','${companyA}','Synthetic customer');
    INSERT INTO metering_points(id,company_id,customer_id,bidding_zone_code) VALUES ('${point}','${companyA}','${customer}','SE3');
    SET test.uid='00000000-0000-0000-0000-000000000001'; SET test.role='authenticated';
  `)
}, 30_000)

afterAll(async () => { await db?.close() })

describe.sequential('production-shaped customer portfolio SQL', () => {
  it('returns an empty expiry result instead of casting an interval to integer', async () => {
    const result = await db.query(`SELECT * FROM gridex_customer_portfolio_expiring_poa('${companyA}',30)`)
    expect(result.rows).toEqual([])
  })

  it('returns UTC dates and whole days for timestamp expiries regardless of session timezone', async () => {
    await db.exec(`
      INSERT INTO powers_of_attorney(company_id,customer_id,status,valid_to)
      VALUES ('${companyA}','${customer}','signed', ((now() AT TIME ZONE 'UTC')::date+10)::timestamp AT TIME ZONE 'UTC'),
             ('${companyA}','${customer}','signed', ((now() AT TIME ZONE 'UTC')::date+40)::timestamp AT TIME ZONE 'UTC'),
             ('${companyA}','${customer}','signed', NULL);
      SET TIME ZONE 'Pacific/Honolulu';
    `)
    try {
      const result = await db.query<{ days_left: number; valid_to: Date }>(`SELECT * FROM gridex_customer_portfolio_expiring_poa('${companyA}',30)`)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].days_left).toBe(10)
      const expected = await db.query<{ day: Date }>(`SELECT (now() AT TIME ZONE 'UTC')::date+10 AS day`)
      expect(result.rows[0].valid_to).toEqual(expected.rows[0].day)
    } finally { await db.exec(`SET TIME ZONE 'UTC'`) }
  })

  it('counts cohort members once even with four retention horizons and repeated periods', async () => {
    await db.exec(`
      INSERT INTO customer_supply_periods(company_id,customer_id,metering_point_id,start_date)
      VALUES ('${companyA}','${customer}','${point}',(date_trunc('month',current_date)-interval '3 months')::date),
             ('${companyA}','${customer}','${point}',(date_trunc('month',current_date)-interval '2 months')::date);
    `)
    const result = await db.query<{ customers: number; retained_1m: string }>(`SELECT * FROM gridex_customer_portfolio_cohorts('${companyA}',12)`)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].customers).toBe(1)
    expect(Number(result.rows[0].retained_1m)).toBe(1)
  })

  it('evaluates cohort retention at the requested historical date', async () => {
    const result = await db.query<{ customers: number; retained_1m: string | null; retained_3m: string | null }>(`
      SELECT * FROM gridex_customer_portfolio_cohorts_at('${companyA}',
        (date_trunc('month',current_date)-interval '2 months')::date,12)
    `)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].customers).toBe(1)
    expect(result.rows[0].retained_1m).toBeNull()
    expect(result.rows[0].retained_3m).toBeNull()
  })

  it('counts only metering scopes and excludes unrelated failures from the historical/ongoing partition', async () => {
    await db.exec(`
      INSERT INTO grid_owner_data_requests(company_id,request_scope,status,requested_at,requested_period_start)
      VALUES ('${companyA}','meter_values','failed','2026-10-13','2026-09-01'),
             ('${companyA}','billing_underlay','sent','2026-10-13',NULL),
             ('${companyA}','customer_masterdata','failed','2026-10-13',NULL),
             ('${companyB}','meter_values','failed','2026-10-13','2026-09-01');
    `)
    const result = await db.query<Record<string, number>>(`SELECT * FROM gridex_customer_portfolio_summary('${companyA}','2026-10-01','2026-10-01')`)
    expect(result.rows[0].metering_requests_total).toBe(2)
    expect(result.rows[0].metering_requests_historical).toBe(1)
    expect(result.rows[0].metering_requests_ongoing).toBe(1)
    expect(result.rows[0].metering_requests_failed).toBe(1)
  })

  it('includes a mid-month start in forecasts as of that date and honors exclusive supply ends', async () => {
    const point2 = '00000000-0000-0000-0000-0000000000d2'
    const customer2 = '00000000-0000-0000-0000-0000000000c2'
    await db.exec(`
      INSERT INTO customers(id,company_id,full_name) VALUES ('${customer2}','${companyB}','B customer');
      INSERT INTO metering_points(id,company_id,customer_id,bidding_zone_code) VALUES ('${point2}','${companyB}','${customer2}','SE4');
      INSERT INTO customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date)
      VALUES ('${companyB}','${customer2}','${point2}','2026-10-05',NULL);
      INSERT INTO metering_point_monthly_consumption(company_id,metering_point_id,month,kwh,value_count)
      VALUES ('${companyB}','${point2}','2026-09-01',100,1);
      SET test.role='service_role';
    `)
    try {
      const active = await db.query<{ active_metering_points: number }>(`SELECT * FROM gridex_customer_portfolio_active_counts(ARRAY['${companyB}'::uuid],'2026-10-13')`)
      const forecast = await db.query<{ metering_points: number; forecast_kwh: string }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyB}','2026-10-13') WHERE month_index=1`)
      expect(active.rows[0].active_metering_points).toBe(1)
      expect(forecast.rows[0].metering_points).toBe(1)
      expect(Number(forecast.rows[0].forecast_kwh)).toBe(100)
      const notStarted = await db.query<{ metering_points: number }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyB}','2026-10-04') WHERE month_index=1`)
      expect(notStarted.rows[0].metering_points).toBe(0)
      await db.exec(`UPDATE customer_supply_periods SET end_date='2026-10-13' WHERE company_id='${companyB}'`)
      const ended = await db.query<{ metering_points: number }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyB}','2026-10-13') WHERE month_index=1`)
      expect(ended.rows[0].metering_points).toBe(0)
      await db.exec(`UPDATE customer_supply_periods SET end_date='2026-11-01' WHERE company_id='${companyB}'`)
      const ending = await db.query<{ metering_points: number }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyB}','2026-10-13') WHERE month_index <= 2 ORDER BY month_index`)
      expect(ending.rows.map((row) => row.metering_points)).toEqual([1, 0])
    } finally { await db.exec(`SET test.role='authenticated'`) }
  })

  it('refreshes current eligibility while retaining the immutable historical forecast snapshot', async () => {
    const companyC = '00000000-0000-0000-0000-00000000000c'
    const point3 = '00000000-0000-0000-0000-0000000000d3'
    const customer3 = '00000000-0000-0000-0000-0000000000c3'
    await db.exec(`
      INSERT INTO companies(id,name) VALUES ('${companyC}','C');
      INSERT INTO customers(id,company_id,full_name) VALUES ('${customer3}','${companyC}','C customer');
      INSERT INTO metering_points(id,company_id,customer_id,bidding_zone_code) VALUES ('${point3}','${companyC}','${customer3}','SE3');
      INSERT INTO customer_supply_periods(company_id,customer_id,metering_point_id,start_date)
      VALUES ('${companyC}','${customer3}','${point3}',current_date);
      INSERT INTO metering_point_monthly_consumption(company_id,metering_point_id,month,kwh,value_count)
      VALUES ('${companyC}','${point3}',(date_trunc('month',current_date)-interval '1 month')::date,100,1);
      INSERT INTO customer_portfolio_forecast_snapshots(company_id,as_of_month,month,month_index,forecast_kwh,metering_points)
      VALUES ('${companyC}',date_trunc('month',current_date)::date,date_trunc('month',current_date)::date,1,0,0),
             ('${companyC}',(date_trunc('month',current_date)-interval '1 month')::date,(date_trunc('month',current_date)-interval '1 month')::date,1,777,1);
      SET test.role='service_role';
    `)
    try {
      const current = await db.query<{ metering_points: number; forecast_kwh: string }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyC}',current_date) WHERE month_index=1`)
      expect(current.rows[0].metering_points).toBe(1)
      expect(Number(current.rows[0].forecast_kwh)).toBe(100)
      const historical = await db.query<{ forecast_kwh: string }>(`SELECT * FROM gridex_customer_portfolio_forecast('${companyC}',(date_trunc('month',current_date)-interval '1 month')::date) WHERE month_index=1`)
      expect(Number(historical.rows[0].forecast_kwh)).toBe(777)
      const stored = await db.query<{ forecast_kwh: string }>(`SELECT forecast_kwh FROM customer_portfolio_forecast_snapshots WHERE company_id='${companyC}' AND as_of_month=date_trunc('month',current_date)::date`)
      expect(Number(stored.rows[0].forecast_kwh)).toBe(0)
      const platform = '00000000-0000-0000-0000-0000000000a1'
      await db.exec(`INSERT INTO white_label_platforms(id,name) VALUES ('${platform}','Synthetic platform'); UPDATE companies SET white_label_platform_id='${platform}' WHERE id='${companyC}'`)
      const overview = await db.query<{ forecast_month_kwh: string }>(`SELECT * FROM gridex_whitelabel_portfolio_overview('${platform}',current_date)`)
      expect(Number(overview.rows[0].forecast_month_kwh)).toBe(100)
    } finally { await db.exec(`SET test.role='authenticated'`) }
  })

  it('retains tenant denial on every repaired public read path', async () => {
    for (const query of [
      `SELECT * FROM gridex_customer_portfolio_expiring_poa('${companyB}',30)`,
      `SELECT * FROM gridex_customer_portfolio_summary('${companyB}','2026-10-01','2026-10-01')`,
      `SELECT * FROM gridex_customer_portfolio_forecast('${companyB}','2026-10-13')`,
      `SELECT * FROM gridex_customer_portfolio_cohorts('${companyB}',12)`,
      `SELECT * FROM gridex_customer_portfolio_cohorts_at('${companyB}','2026-10-13',12)`,
    ]) await expect(db.query(query)).rejects.toMatchObject({ code: '42501' })
  })

  it('preserves read grants and keeps internal computation inaccessible to clients', async () => {
    const result = await db.query<Record<string, boolean>>(`SELECT
      has_function_privilege('authenticated','public.gridex_customer_portfolio_cohorts_at(uuid,date,integer)','EXECUTE') AS member_read,
      has_function_privilege('service_role','public.gridex_customer_portfolio_cohorts_at(uuid,date,integer)','EXECUTE') AS service_read,
      has_function_privilege('anon','public.gridex_customer_portfolio_cohorts_at(uuid,date,integer)','EXECUTE') AS anon_read,
      has_function_privilege('authenticated','public.gridex_customer_portfolio_point_forecast_internal(uuid,date,integer)','EXECUTE') AS member_internal,
      has_function_privilege('anon','public.gridex_customer_portfolio_expiring_poa(uuid,integer)','EXECUTE') AS anon_expiry
    `)
    expect(result.rows[0]).toEqual({ member_read: true, service_read: true, anon_read: false, member_internal: false, anon_expiry: false })
  })
})
