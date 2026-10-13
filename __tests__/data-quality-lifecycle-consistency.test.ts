import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DATA_QUALITY_RULES } from '@/lib/analytics/dataQualityRules'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const customer = '33333333-3333-4333-8333-333333333333'
const point = '44444444-4444-4444-8444-444444444444'
const gridOwner = '55555555-5555-4555-8555-555555555555'
const currentMonth = new Date().toISOString().slice(0, 7) + '-01'
const previousMonthDate = new Date(currentMonth + 'T00:00:00Z')
previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1)
const previousMonth = previousMonthDate.toISOString().slice(0, 10)
let db: PGlite

async function scan(id = company, month = currentMonth) {
  return (await db.query<{ result: { issues: number } }>(
    'select public.gridex_scan_data_quality_v1($1::uuid,$2::date,null) as result', [id, month],
  )).rows[0].result
}

async function issue(kind = 'forecast_basis_missing', id = point, owner = company) {
  return (await db.query<{ id: string }>(
    "select public.gridex_upsert_data_quality_issue_v1($1::uuid,$2::uuid,$3,'warning','Fixture issue',null) as id",
    [owner, id, kind],
  )).rows[0].id
}

async function count(table: 'data_quality_issues' | 'dashboard_alerts', status = 'open') {
  return (await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where company_id=$1 and status=$2`, [company, status],
  )).rows[0].n
}

async function forecast(diff: number | null, createdAt: string, status = 'completed', runCompany = company) {
  const run = (await db.query<{ id: string }>(`insert into public.forecast_runs
    (company_id,forecast_type,period_start,period_end,status,created_at,completed_at)
    values($1,'consumption',$2::date,($2::date+interval '1 month')::date,$3,$4::timestamptz,
      case when $3='completed' then $4::timestamptz end) returning id`, [runCompany, currentMonth, status, createdAt])).rows[0].id
  await db.query(`insert into public.forecast_run_items
    (company_id,forecast_run_id,metering_point_id,diff_percent,period_start,period_end)
    values($1,$2,$3,$4,$5::date,($5::date+interval '1 month')::date)`, [company, run, point, diff, currentMonth])
}

describe('central data-quality and aggregate-alert lifecycle', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql stable as
        $$ select coalesce(current_setting('request.jwt.claim.role',true),'service_role') $$;
      create table public.companies(id uuid primary key,status text);
      create table public.customers(id uuid primary key,company_id uuid not null references public.companies(id),
        status text,email text,onboarding_status text,unique(company_id,id));
      create table public.metering_points(id uuid primary key default gen_random_uuid(),
        company_id uuid not null references public.companies(id),customer_id uuid,site_id uuid,
        status text,bidding_zone_code text,grid_owner_id uuid,estimated_annual_consumption_kwh numeric,start_date date,
        unique(company_id,id),foreign key(company_id,customer_id) references public.customers(company_id,id));
      create table public.metering_values(id uuid primary key default gen_random_uuid(),company_id uuid not null,
        metering_point_id uuid,quantity_kwh numeric,value_kwh numeric,period_start timestamptz);
      create table public.ediel_messages(id uuid primary key default gen_random_uuid(),company_id uuid not null,
        status text,message_family text,failure_reason text);
      create table public.grid_owner_data_requests(id uuid primary key default gen_random_uuid(),
        company_id uuid not null,status text,created_at timestamptz);
    `)
    // Use the existing production-shaped issue/alert table DDL and legacy keys.
    const schema = readFileSync(resolve('supabase/schema.sql'), 'utf8')
    for (const table of ['forecast_runs', 'forecast_run_items']) {
      const tableSql = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      if (!tableSql) throw new Error(`Missing fixture DDL for ${table}`)
      await db.exec(tableSql)
    }
    for (const table of ['data_quality_issues', 'dashboard_alerts']) {
      const tableSql = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      const keySql = schema.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n\\s+ADD CONSTRAINT [^\\n]+ UNIQUE [^\\n]+;`))?.[0]
      if (!tableSql || !keySql) throw new Error(`Missing fixture DDL for ${table}`)
      await db.exec(`${tableSql}\n${keySql}`)
    }
    const migration = readFileSync(resolve('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql'), 'utf8')
    // Production cutover first expands RPCs/columns while the old app's keys
    // remain. Full migration is then applied after app deployment, and replayed.
    const expansion = migration.replace(/^alter table public\.(data_quality_issues|dashboard_alerts) drop constraint[^\n]+;$/gm, '-- Legacy key retained until application cutover.')
    await db.exec(expansion)
    expect((await db.query<{ n: number }>("select count(*)::int n from pg_constraint where conname in('data_quality_issues_company_id_entity_type_entity_id_issue__key','dashboard_alerts_company_id_alert_type_entity_type_entity_i_key')")).rows[0].n).toBe(2)
    await db.exec(migration)
    await db.exec(migration)
  }, 30_000)

  beforeEach(async () => {
    await db.exec(`begin; set local request.jwt.claim.role='service_role';
      insert into public.companies values('${company}','active'),('${otherCompany}','active');
      insert into public.customers values('${customer}','${company}','active','fixture@example.invalid','completed');
      insert into public.metering_points(id,company_id,customer_id,status,bidding_zone_code,grid_owner_id,
        estimated_annual_consumption_kwh,start_date)
      values('${point}','${company}','${customer}','active','SE1','${gridOwner}',100,'2026-01-01');
    `)
  })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('keeps the application contract aligned with the authoritative rule catalog', async () => {
    const rows = (await db.query<{ issue_type: string; entity_type: string; scanner: boolean }>(
      'select issue_type,entity_type,scanner from public.gridex_data_quality_rule_catalog_v',
    )).rows
    expect(Object.fromEntries(rows.map(row => [row.issue_type, { entityType: row.entity_type, scanner: row.scanner }]))).toEqual(DATA_QUALITY_RULES)
  })

  it('repeated scans update one NULL-entity aggregate, then close it when the source is repaired', async () => {
    expect((await scan()).issues).toBe(1)
    await Promise.all([scan(), scan(), scan()])
    expect(await count('data_quality_issues')).toBe(1)
    expect(await count('dashboard_alerts')).toBe(2) // typed missing-meter alert + total data-quality alert
    await db.query("insert into public.metering_values(company_id,metering_point_id,quantity_kwh,period_start) values($1,$2,10,$3::timestamptz)", [company, point, currentMonth])
    expect((await scan()).issues).toBe(0)
    expect(await count('data_quality_issues')).toBe(0)
    expect(await count('dashboard_alerts')).toBe(0)
    expect(await count('dashboard_alerts', 'resolved')).toBe(2)
  })

  it('retains history across multiple open/resolve cycles without a status-key collision', async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await issue()
      await db.query('select public.gridex_resolve_data_quality_issue_v1($1,$2)', [company, id])
    }
    expect(await count('data_quality_issues', 'resolved')).toBe(3)
    await issue()
    expect(await count('data_quality_issues')).toBe(1)
  })

  it('retains aggregate history when repaired findings recur and close a second time', async () => {
    await scan()
    await db.query("insert into public.metering_values(company_id,metering_point_id,quantity_kwh,period_start) values($1,$2,10,$3::timestamptz)", [company, point, currentMonth])
    await scan()
    await db.query('delete from public.metering_values where company_id=$1', [company])
    await scan()
    expect(await count('dashboard_alerts')).toBe(2)
    await db.query("insert into public.metering_values(company_id,metering_point_id,quantity_kwh,period_start) values($1,$2,10,$3::timestamptz)", [company, point, currentMonth])
    await scan()
    expect(await count('dashboard_alerts')).toBe(0)
    expect(await count('dashboard_alerts', 'resolved')).toBe(4)
    expect(await count('data_quality_issues', 'resolved')).toBe(2)
  })

  it('closes managed aggregates for source deletion by SQL-owner maintenance without a service JWT', async () => {
    await scan()
    await db.exec("set local request.jwt.claim.role='postgres'")
    await db.query('delete from public.metering_points where id=$1', [point])
    expect(await count('dashboard_alerts')).toBe(0)
    expect(await count('data_quality_issues')).toBe(0)
  })

  it('preserves a point-scoped forecast deviation until that rule is positively repaired', async () => {
    await forecast(20, currentMonth + 'T01:00:00Z')
    await scan()
    await db.query('select public.gridex_scan_data_quality_v1($1::uuid,$2::date,$3::uuid)', [company, currentMonth, point])
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='open'")).rows[0].n).toBe(1)
    await db.query('update public.forecast_run_items set diff_percent=0 where company_id=$1', [company])
    await db.query('select public.gridex_scan_data_quality_v1($1::uuid,$2::date,$3::uuid)', [company, currentMonth, point])
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='open'")).rows[0].n).toBe(0)
  })

  it('detects canonical negative values, keeps quantity fallback and respects canonical precedence', async () => {
    await db.query(`insert into public.metering_values(company_id,metering_point_id,value_kwh,quantity_kwh,period_start)
      values($1,$2,-5,null,$3::timestamptz),($1,$2,null,-7,$3::timestamptz),($1,$2,8,-9,$3::timestamptz)`, [company, point, currentMonth])
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='invalid_metering_value' and status='open'")).rows[0].n).toBe(2)
    expect((await db.query<{ canonical: string | null; fallback: string | null }>(`select v.value_kwh::text as canonical,v.quantity_kwh::text as fallback
      from public.data_quality_issues q join public.metering_values v on v.id=q.entity_id
      where q.issue_type='invalid_metering_value' and q.status='open' order by v.value_kwh nulls last`)).rows)
      .toEqual([{ canonical: '-5', fallback: null }, { canonical: null, fallback: '-7' }])
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='invalid_metering_value' and status='open'")).rows[0].n).toBe(2)
    await db.query('update public.metering_values set value_kwh=5 where company_id=$1', [company])
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='invalid_metering_value' and status='resolved'")).rows[0].n).toBe(2)
  })

  it('replaces historical forecast deviations with the latest completed same-company point/month evidence', async () => {
    await forecast(20, currentMonth + 'T01:00:00Z')
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='open'")).rows[0].n).toBe(1)
    await forecast(0, currentMonth + 'T02:00:00Z')
    await forecast(30, currentMonth + 'T03:00:00Z', 'running')
    await forecast(40, currentMonth + 'T04:00:00Z', 'completed', otherCompany)
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='open'")).rows[0].n).toBe(0)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.forecast_run_items where diff_percent>10')).rows[0].n).toBe(3)
    await forecast(-15, currentMonth + 'T05:00:00Z')
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='open'")).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where issue_type='forecast_deviation' and status='resolved'")).rows[0].n).toBe(1)
  })

  it('retains findings when current numerical evidence is incomplete', async () => {
    await forecast(20, currentMonth + 'T01:00:00Z')
    await db.query(`insert into public.metering_values(company_id,metering_point_id,value_kwh,period_start)
      values($1,$2,-5,$3::timestamptz)`, [company, point, currentMonth])
    await scan()
    await forecast(null, currentMonth + 'T02:00:00Z')
    await db.query('update public.metering_values set value_kwh=null where company_id=$1', [company])
    await scan()
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.data_quality_issues
      where issue_type in('forecast_deviation','invalid_metering_value') and status='open'`)).rows[0].n).toBe(2)
  })

  it('shares selected UTC-month missing-meter facts by company, active source and grid owner', async () => {
    const secondPoint = '66666666-6666-4666-8666-666666666666'
    const secondOwner = '77777777-7777-4777-8777-777777777777'
    await db.query(`insert into public.metering_points(id,company_id,status,grid_owner_id)
      values($1,$2,'ongoing',$3),(gen_random_uuid(),$4,'active',$3),
      (gen_random_uuid(),$2,'closed',$3)`, [secondPoint, company, secondOwner, otherCompany])
    await db.query(`insert into public.metering_values(company_id,metering_point_id,value_kwh,period_start)
      values($1,$2,5,$3::timestamptz)`, [company, point, currentMonth])
    const missing = (await db.query<{ metering_point_id: string; grid_owner_id: string }>(
      'select * from public.gridex_missing_metering_points_v1($1,$2::date)', [company, currentMonth])).rows
    expect(missing).toEqual([{ metering_point_id: secondPoint, grid_owner_id: secondOwner }])
    await scan()
    expect((await db.query<{ entity_id: string }>(`select entity_id from public.data_quality_issues
      where company_id=$1 and issue_type='missing_metering_values' and status='open'`, [company])).rows)
      .toEqual([{ entity_id: secondPoint }])
    expect((await db.query<{ n: number }>('select count(*)::int n from public.gridex_missing_metering_points_v1($1,$2::date)', [company, previousMonth])).rows[0].n).toBe(2)
  })

  it('resolves only the healthy producer window and retains a different forecast month', async () => {
    await db.query("select public.gridex_upsert_data_quality_issue_v1($1,$2,'forecast_basis_missing','warning','Missing basis',$3::date)", [company, point, currentMonth])
    await db.query("select public.gridex_upsert_data_quality_issue_v1($1,$2,'forecast_basis_missing','warning','Missing basis',$3::date)", [company, point, previousMonth])
    await db.query("select public.gridex_resolve_managed_quality_rule_v1($1,$2,'forecast_basis_missing',$3::date)", [company, point, currentMonth])
    expect((await db.query<{ period_value: string }>("select period_month::text as period_value from public.data_quality_issues where status='open'")).rows).toEqual([{ period_value: previousMonth }])
    expect(await count('dashboard_alerts')).toBe(0)
  })

  it('resolves deleted-source managed issues and closes aggregates while preserving unknown/manual history', async () => {
    await scan()
    await db.query("insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,message,status) values($1,'metering_point',$2,'manual_review','Retained manual note','open')", [company, point])
    await db.query('delete from public.metering_points where id=$1', [point])
    expect(await count('data_quality_issues')).toBe(1)
    expect(await count('dashboard_alerts')).toBe(0)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.gridex_actionable_data_quality_issues_v')).rows[0].n).toBe(0)
    expect((await db.query<{ reason: string }>("select resolution_reason reason from public.data_quality_issues where source='gridex_data_quality'")).rows[0].reason).toBe('source_deleted')
  })

  it('does not resolve another company or a manual alert during reconciliation', async () => {
    await db.query("insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,message,status,source) values($1,'metering_point',gen_random_uuid(),'missing_metering_values','Other tenant','open','gridex_data_quality')", [otherCompany])
    await db.query("insert into public.dashboard_alerts(company_id,alert_type,title,status,source) values($1,'manual_attention','Manual','open','manual')", [company])
    await scan()
    expect((await db.query<{ n: number }>("select count(*)::int n from public.data_quality_issues where company_id=$1 and status='open'", [otherCompany])).rows[0].n).toBe(1)
    expect((await db.query<{ n: number }>("select count(*)::int n from public.dashboard_alerts where source='manual' and status='open'")).rows[0].n).toBe(1)
  })

  it('keeps period-dependent issues separate when an older month is scanned', async () => {
    await scan(company, currentMonth)
    await db.query("insert into public.metering_values(company_id,metering_point_id,quantity_kwh,period_start) values($1,$2,10,$3::timestamptz)", [company, point, previousMonth])
    await scan(company, previousMonth)
    expect((await db.query<{ period_value: string }>("select period_month::text as period_value from public.data_quality_issues where status='open' and issue_type='missing_metering_values'")).rows).toEqual([{ period_value: currentMonth }])
  })

  it('scans beyond the former 5000-point cap without resolving omitted entities', async () => {
    await db.query(`insert into public.metering_points(company_id,customer_id,status,bidding_zone_code,grid_owner_id,estimated_annual_consumption_kwh,start_date)
      select $1::uuid,$2::uuid,'active','SE1',$3::uuid,100,'2026-01-01'::date from generate_series(1,5000)`, [company, customer, gridOwner])
    expect((await scan()).issues).toBe(5001)
    expect(await count('data_quality_issues')).toBe(5001)
    expect(await count('dashboard_alerts')).toBe(2)
  }, 30_000)

  it('rolls back reconciliation when writing a detected issue fails', async () => {
    await scan()
    await db.exec(`create function fail_quality_write() returns trigger language plpgsql as $$begin raise exception 'fixture_write_failure';end$$;
      create trigger fail_quality_write before insert or update on public.data_quality_issues for each row execute function fail_quality_write();
      savepoint scan_failure;`)
    await expect(scan()).rejects.toThrow('fixture_write_failure')
    await db.exec('rollback to savepoint scan_failure')
    expect(await count('data_quality_issues')).toBe(1)
    expect(await count('dashboard_alerts')).toBe(2)
  })

  it('denies non-service writes and rejects a source belonging to another company', async () => {
    await db.exec("savepoint role_failure; set local request.jwt.claim.role='authenticated'")
    await expect(scan()).rejects.toMatchObject({ code: '42501' })
    await db.exec("rollback to savepoint role_failure; set local request.jwt.claim.role='service_role'; savepoint tenant_failure")
    await expect(issue('forecast_basis_missing', point, otherCompany)).rejects.toMatchObject({ code: '23503' })
    await db.exec('rollback to savepoint tenant_failure')
    expect(await count('data_quality_issues')).toBe(0)
  })

  it('keeps historical inactive-source findings out of operational alerts', async () => {
    await db.query("update public.metering_points set status='closed' where id=$1", [point])
    await issue()
    expect(await count('data_quality_issues')).toBe(1)
    expect(await count('dashboard_alerts')).toBe(0)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.gridex_actionable_data_quality_issues_v')).rows[0].n).toBe(0)
    await db.query('select public.gridex_reconcile_data_quality_v1($1)', [company])
    expect(await count('data_quality_issues', 'resolved')).toBe(1)
  })

  it('denies authenticated execution of the private maintenance primitive', async () => {
    await db.exec('savepoint acl_failure; set local role authenticated')
    await expect(db.query('select public.gridex_reconcile_dashboard_alerts_internal_v1($1)', [company])).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint acl_failure; reset role')
  })
})
