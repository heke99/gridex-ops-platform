import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const company = '11111111-1111-4111-8111-111111111111'
const customer = '33333333-3333-4333-8333-333333333333'
const point = '44444444-4444-4444-8444-444444444444'
const month = new Date().toISOString().slice(0, 7) + '-01'

async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
      create table companies(id uuid primary key);
      create table customers(id uuid primary key,company_id uuid,status text,email text,onboarding_status text);
      create table metering_points(id uuid primary key,company_id uuid,customer_id uuid,status text,
        bidding_zone_code text,grid_owner_id uuid,estimated_annual_consumption_kwh numeric,start_date date);
      create table metering_values(id uuid primary key default gen_random_uuid(),company_id uuid,metering_point_id uuid,
        quantity_kwh numeric,value_kwh numeric,quantity numeric,period_start timestamptz,
        is_current boolean default true,revision_status text default 'current',value_status text default 'current');
      create table ediel_messages(id uuid primary key,company_id uuid,status text);
      create table grid_owner_data_requests(id uuid primary key,company_id uuid,status text,created_at timestamptz);
      create table forecast_runs(id uuid primary key,company_id uuid,status text,forecast_type text default 'consumption',
        period_start date,period_end date,created_at timestamptz,completed_at timestamptz);
      create table forecast_run_items(id uuid primary key default gen_random_uuid(),company_id uuid,
        forecast_run_id uuid,metering_point_id uuid,diff_percent numeric,period_start date,period_end date,
        created_at timestamptz default now());
    `)
    const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
    for (const table of ['data_quality_issues', 'dashboard_alerts']) {
      const tableDDL = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      const keyDDL = schema.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n\\s+ADD CONSTRAINT [^\\n]+ UNIQUE [^\\n]+;`))?.[0]
      if (!tableDDL || !keyDDL) throw new Error(`Missing production fixture DDL: ${table}`)
      await db.exec(tableDDL + '\n' + keyDDL)
    }
    await db.exec(fs.readFileSync('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql', 'utf8'))
    await db.exec(`
      insert into companies values('${company}');
      insert into customers values('${customer}','${company}','active','proof@example.invalid','completed');
      insert into metering_points values('${point}','${company}','${customer}','active','SE1',gen_random_uuid(),1200,'2026-01-01');
    `)

    await db.exec('begin')
    const negative = (await db.query(
      'insert into metering_values(company_id,metering_point_id,value_kwh,period_start) values($1,$2,-5,$3::timestamptz) returning id',
      [company, point, month],
    )).rows[0].id
    await db.query("select gridex_upsert_data_quality_issue_v1($1,$2,'invalid_metering_value','critical','Negative canonical value',null)", [company, negative])
    await db.query('select gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
    const negativeResult = (await db.query("select status,resolution_reason from data_quality_issues where issue_type='invalid_metering_value'")).rows
    await db.exec('rollback')

    await db.exec('begin')
    await db.query('insert into metering_values(company_id,metering_point_id,value_kwh,quantity_kwh,period_start) values($1,$2,10,10,$3::timestamptz)', [company, point, month])
    const oldRun = '66666666-6666-4666-8666-666666666666'
    const newRun = '77777777-7777-4777-8777-777777777777'
    await db.query("insert into forecast_runs(id,company_id,status,period_start,period_end,created_at,completed_at) values($1,$2,'completed',$3::date,($3::date+interval '1 month')::date,'2026-10-01T00:00:00Z','2026-10-01T01:00:00Z')", [oldRun, company, month])
    await db.query("insert into forecast_run_items(company_id,forecast_run_id,metering_point_id,diff_percent,period_start,period_end,created_at) values($1,$2,$3,20,$4::date,($4::date+interval '1 month')::date,'2026-10-01T01:00:00Z')", [company, oldRun, point, month])
    await db.query('select gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
    const initialForecastResult = (await db.query("select status from data_quality_issues where issue_type='forecast_deviation'")).rows
    await db.query("insert into forecast_runs(id,company_id,status,period_start,period_end,created_at,completed_at) values($1,$2,'completed',$3::date,($3::date+interval '1 month')::date,'2026-10-02T00:00:00Z','2026-10-02T01:00:00Z')", [newRun, company, month])
    await db.query("insert into forecast_run_items(company_id,forecast_run_id,metering_point_id,diff_percent,period_start,period_end,created_at) values($1,$2,$3,0,$4::date,($4::date+interval '1 month')::date,'2026-10-02T01:00:00Z')", [company, newRun, point, month])
    await db.query('select gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
    const forecastResult = (await db.query("select status,message from data_quality_issues where issue_type='forecast_deviation'")).rows
    await db.exec('rollback')
    const proof = {
      migration: '20261013094514_data_quality_lifecycle_consistency.sql',
      negativeCanonicalValue: { value_kwh: -5, quantity_kwh: null, issues: negativeResult, safe: negativeResult[0]?.status === 'open' },
      newestHealthyForecast: { previousDiff: 20, newestDiff: 0, initialIssues: initialForecastResult, issues: forecastResult, safe: initialForecastResult[0]?.status === 'open' && forecastResult[0]?.status === 'resolved' },
    }
    process.stdout.write(JSON.stringify(proof, null, 2) + '\n')
    if (!proof.negativeCanonicalValue.safe || !proof.newestHealthyForecast.safe) process.exitCode = 1
  } finally { await db.close() }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 })
