import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { saveMeteringPoint } from '@/lib/masterdata/db'
import { meteringPointInputSchema } from '@/lib/masterdata/validators'

const company = '11111111-1111-4111-8111-111111111111'
const customer = '22222222-2222-4222-8222-222222222222'
const point = '33333333-3333-4333-8333-333333333333'
const site = '44444444-4444-4444-8444-444444444444'
const owner = '55555555-5555-4555-8555-555555555555'
const testValue = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const forward = readFileSync('supabase/migrations/20261013130700_operational_quality_customer_source_consistency.sql', 'utf8')
const db = new PGlite()

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid,status text,source text,email text,onboarding_status text);
    create table public.customer_sites(id uuid primary key,company_id uuid,customer_id uuid references public.customers(id),status text);
    create table public.metering_points(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,
      status text,bidding_zone_code text,estimated_annual_consumption_kwh numeric,grid_owner_id uuid,start_date date,end_date date,
      meter_point_id text,site_facility_id text,ediel_reference text,measurement_type text,reading_frequency text,
      data_quality_status text,verification_status text,price_area_code text,is_settlement_relevant boolean,updated_by uuid);
    create table public.metering_values(id uuid primary key,company_id uuid,metering_point_id uuid,value_kwh numeric,quantity_kwh numeric,period_start timestamptz);
    create table public.ediel_messages(id uuid,company_id uuid,status text);
    create table public.grid_owner_data_requests(id uuid,company_id uuid,status text,created_at timestamptz);
    insert into public.companies values('${company}');
    insert into public.customers values('${customer}','${company}','draft','ediel_portal_test','fixture@example.invalid','completed');
    insert into public.customer_sites values('${site}','${company}','${customer}','draft');
    insert into public.metering_points(id,company_id,customer_id,site_id,status,bidding_zone_code,estimated_annual_consumption_kwh,grid_owner_id,start_date)
      values('${point}','${company}','${customer}','${site}','draft','SE1',100,'${owner}','2026-01-01');`)
  const lifecycle = readFileSync('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql', 'utf8')
  // Current production DDL contains generated open_key columns, so install
  // their real immutable dependency before constructing those tables.
  const openKey = lifecycle.match(/create or replace function public\.gridex_quality_open_key_v1\([\s\S]*?\$\$;/)?.[0]
  if (!openKey) throw new Error('Missing production open-key function')
  await db.exec(openKey)
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  for (const table of ['data_quality_issues', 'dashboard_alerts', 'forecast_runs', 'forecast_run_items']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
    if (!ddl) throw new Error('Missing production DDL: ' + table)
    await db.exec(ddl)
  }
  await db.exec(lifecycle)
  const integrity = readFileSync('supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql', 'utf8')
  const start = integrity.indexOf('create or replace function public.gridex_company_has_customer_data(')
  await db.exec(integrity.slice(start, integrity.indexOf('$$;', start) + 3))
}, 90_000)

afterAll(async () => { await db.close() })

it('proves the authorized masterdata writer can activate an excluded portal-test point that the scanner counts', async () => {
  // This uses the same validator and writer called by saveMeteringPointAction.
  // The action checks company/site ownership; it has no customer-source gate.
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
    from(table: string) {
      expect(table).toBe('metering_points')
      let payload: Record<string, unknown> = {}
      const filters: Array<[string, unknown]> = []
      const query = {
        update(values: Record<string, unknown>) { payload = values; return query },
        eq(key: string, value: unknown) { filters.push([key, value]); return query },
        select() { return query },
        async single() {
          const columns = Object.keys(payload)
          const values = [...Object.values(payload), ...filters.map(([, value]) => value)]
          const assignments = columns.map((key, i) => `${key}=$${i + 1}`).join(',')
          const where = filters.map(([key], i) => `${key}=$${columns.length + i + 1}`).join(' and ')
          const result = await db.query(`update public.metering_points set ${assignments} where ${where} returning *`, values)
          return { data: result.rows[0], error: null }
        },
      }
      return query
    },
  }
  const input = meteringPointInputSchema.parse({ id: point, company_id: company, customer_id: customer,
    site_id: site, meter_point_id: 'fixture-point', status: 'active', measurement_type: 'consumption',
    reading_frequency: 'hourly', grid_owner_id: owner, price_area_code: 'SE1', start_date: '2026-01-01',
    is_settlement_relevant: true })
  await saveMeteringPoint(client as unknown as Parameters<typeof saveMeteringPoint>[0], input)
  const month = new Date().toISOString().slice(0, 7) + '-01'
  expect((await db.query('select public.gridex_company_has_customer_data($1) as present', [company])).rows)
    .toEqual([{ present: false }])
  const scan = (await db.query<{ result: { issues: number } }>('select public.gridex_scan_data_quality_v1($1,$2::date,null) as result', [company, month])).rows[0].result
  expect(scan.issues).toBe(2)
  expect((await db.query('select issue_type from public.gridex_actionable_data_quality_issues_v order by issue_type')).rows)
    .toEqual([{ issue_type: 'active_metering_point_without_active_customer' }, { issue_type: 'missing_metering_values' }])
  expect((await db.query<{ n: number }>('select count(*)::int n from public.gridex_missing_metering_points_v1($1,$2::date)', [company, month])).rows[0].n).toBe(1)
  // Canonical ingestion stores value_kwh. A historic negative value remains
  // physically valid evidence, but this customer is a confirmed portal fixture.
  await db.query(`insert into public.metering_values values($1,$2,$3,-5,null,
    date_trunc('month',current_date)-interval '2 months')`, [testValue, company, point])
  await db.query('select public.gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
  expect((await db.query("select entity_id from public.gridex_actionable_data_quality_issues_v where issue_type='invalid_metering_value'")).rows)
    .toEqual([{ entity_id: testValue }])
}, 30_000)

it('applies the forward source rule while retaining normal, NULL-parent and tenant-isolated physical facts', async () => {
  await db.exec(forward)
  await db.exec(forward)
  const month = new Date().toISOString().slice(0, 7) + '-01'
  await db.query('select public.gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
  expect((await db.query('select issue_type from public.gridex_actionable_data_quality_issues_v')).rows).toEqual([])
  expect((await db.query<{ n: number }>('select count(*)::int n from public.dashboard_alerts where status=\'open\'')).rows[0].n).toBe(0)
  expect((await db.query<{ n: number }>('select count(*)::int n from public.data_quality_issues where status=\'resolved\'')).rows[0].n).toBe(3)
  const normal = '66666666-6666-4666-8666-666666666666'
  const normalPoint = '77777777-7777-4777-8777-777777777777'
  const inactive = '88888888-8888-4888-8888-888888888888'
  const inactivePoint = '99999999-9999-4999-8999-999999999999'
  const unownedPoint = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const otherCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const otherPoint = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  await db.exec(`insert into public.companies values('${otherCompany}');
    insert into public.customers values('${normal}','${company}','active','manual','fixture@example.invalid','completed'),
      ('${inactive}','${company}','draft','manual','fixture@example.invalid','completed');
    insert into public.metering_points(id,company_id,customer_id,status,bidding_zone_code,estimated_annual_consumption_kwh,grid_owner_id,start_date)
    values('${normalPoint}','${company}','${normal}','active','SE1',100,'${owner}','2026-01-01'),
      ('${inactivePoint}','${company}','${inactive}','active','SE1',100,'${owner}','2026-01-01'),
      ('${unownedPoint}','${company}',null,'active','SE1',100,'${owner}','2026-01-01'),
      ('${otherPoint}','${otherCompany}',null,'active','SE1',100,'${owner}','2026-01-01');`)
  await db.query('select public.gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
  expect((await db.query<{ metering_point_id: string }>('select metering_point_id from public.gridex_missing_metering_points_v1($1,$2::date) order by metering_point_id', [company, month])).rows)
    .toEqual([{ metering_point_id: normalPoint }, { metering_point_id: inactivePoint }, { metering_point_id: unownedPoint }])
  expect((await db.query<{ entity_id: string }>("select entity_id from public.gridex_actionable_data_quality_issues_v where issue_type='active_metering_point_without_active_customer'")).rows)
    .toEqual([{ entity_id: inactivePoint }])
  expect((await db.query('select public.gridex_data_quality_source_exists_v1($1,\'metering_point\',$2,true) as operational,public.gridex_data_quality_source_exists_v1($1,\'metering_point\',$2,false) as physical', [company, point])).rows)
    .toEqual([{ operational: false, physical: true }])
  expect((await db.query('select public.gridex_data_quality_source_exists_v1($1,\'metering_point\',$2,true) as exists', [company, otherPoint])).rows)
    .toEqual([{ exists: false }])
  // A resolved portal customer also stays excluded from customer-scoped rules.
  await db.query("update public.customers set status='active',email=null,onboarding_status='draft' where id=$1", [customer])
  await db.query('select public.gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
  expect((await db.query('select id from public.gridex_actionable_data_quality_issues_v where entity_id=$1', [customer])).rows).toEqual([])
  expect((await db.query('select public.gridex_data_quality_source_exists_v1($1,\'customer\',$2,true) as operational,public.gridex_data_quality_source_exists_v1($1,\'customer\',$2,false) as physical', [company, customer])).rows)
    .toEqual([{ operational: false, physical: true }])
  const normalValue = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const inactiveValue = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const orphanValue = 'abababab-abab-4bab-8bab-abababababab'
  await db.exec(`update public.metering_points set status='inactive' where id='${inactivePoint}';
    insert into public.metering_values values('${normalValue}','${company}','${normalPoint}',-5,null,current_date),
      ('${inactiveValue}','${company}','${inactivePoint}',-5,null,current_date),
      ('${orphanValue}','${company}',null,-5,null,current_date);
    insert into public.data_quality_issues(company_id,entity_type,entity_id,issue_type,severity,message,status,source)
      values('${company}','metering_point','${point}','manual_review','warning','Fixture manual review','open','manual');`)
  await db.query('select public.gridex_scan_data_quality_v1($1,$2::date,null)', [company, month])
  expect((await db.query("select entity_id from public.gridex_actionable_data_quality_issues_v where issue_type='invalid_metering_value' order by entity_id")).rows)
    .toEqual([{ entity_id: orphanValue }, { entity_id: normalValue }, { entity_id: inactiveValue }])
  expect((await db.query("select status from public.gridex_actionable_data_quality_issues_v where issue_type='manual_review'")).rows)
    .toEqual([{ status: 'open' }])
  expect((await db.query("select public.gridex_data_quality_source_exists_v1($1,'metering_value',$2,false) as physical", [company, testValue])).rows)
    .toEqual([{ physical: true }])
  // A foreign-company customer reference must not decide this company's source.
  await db.query('update public.metering_points set customer_id=$1 where id=$2', [customer, otherPoint])
  expect((await db.query('select metering_point_id from public.gridex_missing_metering_points_v1($1,$2::date)', [otherCompany, month])).rows)
    .toEqual([{ metering_point_id: otherPoint }])
}, 30_000)

it('keeps the shared eligibility predicate read-only, invoker-scoped and unavailable to anonymous roles', async () => {
  expect((await db.query(`select p.prosecdef as definer,p.provolatile as volatility,
    has_schema_privilege('authenticated','gridex_quality','USAGE') as auth_schema,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute,
    has_schema_privilege('anon','gridex_quality','USAGE') as anon_schema,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p where p.oid='gridex_quality.operational_customer_source_v1(uuid,text,uuid)'::regprocedure`)).rows)
    .toEqual([{ definer: false, volatility: 's', auth_schema: true, auth_execute: true, anon_schema: false, anon_execute: false }])
})
