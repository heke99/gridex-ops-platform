import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const db = new PGlite()
const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003'
const customer = '10000000-0000-4000-8000-000000000001'
const repairPath = 'supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql'
const read = (path: string) => fs.readFileSync(path, 'utf8')

beforeAll(async () => {
  await db.exec(read('scripts/sql/customer-portfolio/00_stub.sql')
    .replace('create extension if not exists pgcrypto;', '')
    .replace('valid_from date, valid_to date, created_at', 'valid_from timestamptz, valid_to timestamptz, created_at'))
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
    insert into companies(id,name) values('${a}','A'),('${b}','B'),('${c}','C');
    set test.role='service_role';
  `)
  // Execute the authoritative physical-source helpers, not copies of their logic.
  const quality = read('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql')
  for (const name of ['gridex_data_quality_active_status_v1', 'gridex_missing_metering_points_v1']) {
    const start = quality.indexOf(`create or replace function public.${name}(`)
    if (start < 0) throw new Error(`Missing source helper: ${name}`)
    await db.exec(quality.slice(start, quality.indexOf('$$;', start) + 3))
  }
  await db.exec(read(repairPath))
}, 30_000)

afterAll(async () => { await db.close() })

it('does not recreate empty statistics and preserves the mature result fields', async () => {
  const result = await db.query<{ result: Record<string, unknown> }>(`select gridex_rebuild_company_analytics_month('${a}',date '2026-10-18') result`)
  expect(result.rows[0].result).toEqual({
    month: '2026-10-01', forecast_run_id: null, customers: 0,
    bidding_zones: 0, grid_owners: 0, skipped: 'no_customer_data',
  })
  await db.exec(`select gridex_snapshot_customer_portfolio_month('${a}',date '2026-10-01')`)
  for (const table of ['company_monthly_metrics', 'customer_monthly_metrics', 'bidding_zone_monthly_metrics', 'grid_owner_monthly_metrics', 'customer_portfolio_forecast_snapshots']) {
    expect(Number((await db.query<{ count: number }>(`select count(*) from ${table}`)).rows[0].count)).toBe(0)
  }
})

it('rejects dangling and cross-company aliases and retains intake history after deletion', async () => {
  await db.exec(`insert into customers(id,company_id,status) values('${customer}','${a}','active')`)
  await expect(db.exec(`insert into external_contract_intakes(id,company_id,created_customer_id) values('20000000-0000-4000-8000-000000000001','${b}','${customer}')`)).rejects.toMatchObject({ code: '23503' })
  await expect(db.exec(`insert into external_contract_intakes(id,company_id,created_customer_id) values('20000000-0000-4000-8000-000000000002','${a}','10000000-0000-4000-8000-000000000099')`)).rejects.toMatchObject({ code: '23503' })
  await db.exec(`insert into external_contract_intakes(id,company_id,created_customer_id) values('20000000-0000-4000-8000-000000000003','${a}','${customer}');delete from customers where id='${customer}'`)
  expect((await db.query('select company_id,created_customer_id from external_contract_intakes')).rows).toEqual([{ company_id: a, created_customer_id: null }])
})

it('builds real mature statistics after customers arrive and rejects malformed periods', async () => {
  await db.exec(`insert into customers(id,company_id,status) values('${customer}','${a}','active');select gridex_rebuild_company_analytics_month('${a}',date '2026-10-01')`)
  expect(Number((await db.query<{ count: number }>('select count(*) from company_monthly_metrics')).rows[0].count)).toBe(1)
  await expect(db.exec(`select gridex_rebuild_company_analytics_month('${b}',null)`)).rejects.toMatchObject({ code: '22023' })
})

it('uses selected-month physical sources for company and owner missing counts despite stale issues', async () => {
  const owner1 = '30000000-0000-4000-8000-000000000001'
  const owner2 = '30000000-0000-4000-8000-000000000002'
  const point1 = '40000000-0000-4000-8000-000000000001'
  const point2 = '40000000-0000-4000-8000-000000000002'
  const archived = '40000000-0000-4000-8000-000000000003'
  const unscanned = '40000000-0000-4000-8000-000000000004'
  await db.exec(`
    insert into customers(id,company_id,status) values('10000000-0000-4000-8000-000000000003','${c}','active');
    insert into grid_owners(id,company_id) values('${owner1}','${c}'),('${owner2}','${c}');
    insert into metering_points(id,company_id,grid_owner_id,status) values
      ('${point1}','${c}','${owner1}','active'),('${point2}','${c}','${owner2}','live'),
      ('${archived}','${c}','${owner2}','archived'),('${unscanned}','${c}','${owner1}','ongoing'),
      ('40000000-0000-4000-8000-000000000005','${b}',null,'active');
    insert into metering_values(company_id,metering_point_id,value_kwh,period_start) values
      ('${c}','${point1}',10,'2026-10-01'),('${c}','${point2}',10,'2026-09-01'),
      ('${c}','${unscanned}',10,'2026-08-01'),('${b}','${unscanned}',10,'2026-09-01');
    insert into data_quality_issues(company_id,entity_type,entity_id,issue_type,status,period_month) values
      ('${c}','metering_point','${point1}','missing_metering_values','open','2026-08-01'),
      ('${c}','metering_point','${point1}','missing_metering_values','open',null),
      ('${c}','metering_point','${point2}','missing_metering_values','open','2026-09-01'),
      ('${c}','metering_point','${archived}','missing_metering_values','open','2026-09-01'),
      ('${c}','metering_point','40000000-0000-4000-8000-000000000099','missing_metering_values','open','2026-09-01');
    select gridex_rebuild_company_analytics_month('${c}',date '2026-09-18');
  `)
  const company = await db.query<{ metering_values_missing: number }>(`select metering_values_missing from company_monthly_metrics where company_id='${c}' and month='2026-09-01'`)
  expect(company.rows).toEqual([{ metering_values_missing: 2 }])
  const owners = await db.query<{ grid_owner_id: string; metering_values_missing: number }>(`select grid_owner_id,metering_values_missing from grid_owner_monthly_metrics where company_id='${c}' and month='2026-09-01' order by grid_owner_id`)
  expect(owners.rows).toEqual([
    { grid_owner_id: owner1, metering_values_missing: 2 },
    { grid_owner_id: owner2, metering_values_missing: 0 },
  ])
})

it('keeps the repair safe when rerun and preserves mature builder service-only grants', async () => {
  await db.exec(read(repairPath))
  const result = await db.query<{ service: boolean; member: boolean; anonymous: boolean }>(`select
    has_function_privilege('service_role','gridex_rebuild_company_analytics_month(uuid,date)','EXECUTE') service,
    has_function_privilege('authenticated','gridex_rebuild_company_analytics_month(uuid,date)','EXECUTE') member,
    has_function_privilege('anon','gridex_rebuild_company_analytics_month(uuid,date)','EXECUTE') anonymous`)
  expect(result.rows).toEqual([{ service: true, member: false, anonymous: false }])
})
