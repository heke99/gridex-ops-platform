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
    create table public.metering_values(id uuid,company_id uuid,metering_point_id uuid,value_kwh numeric,quantity_kwh numeric,period_start timestamptz);
    create table public.ediel_messages(id uuid,company_id uuid,status text);
    create table public.grid_owner_data_requests(id uuid,company_id uuid,status text,created_at timestamptz);
    insert into public.companies values('${company}');
    insert into public.customers values('${customer}','${company}','draft','ediel_portal_test','fixture@example.invalid','completed');
    insert into public.customer_sites values('${site}','${company}','${customer}','draft');
    insert into public.metering_points(id,company_id,customer_id,site_id,status,bidding_zone_code,estimated_annual_consumption_kwh,grid_owner_id,start_date)
      values('${point}','${company}','${customer}','${site}','draft','SE1',100,'${owner}','2026-01-01');`)
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  for (const table of ['data_quality_issues', 'dashboard_alerts', 'forecast_runs', 'forecast_run_items']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
    if (!ddl) throw new Error('Missing production DDL: ' + table)
    await db.exec(ddl)
  }
  await db.exec(readFileSync('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql', 'utf8'))
  const integrity = readFileSync('supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql', 'utf8')
  const start = integrity.indexOf('create or replace function public.gridex_company_has_customer_data(')
  await db.exec(integrity.slice(start, integrity.indexOf('$$;', start) + 3))
}, 30_000)
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
  await saveMeteringPoint(client as Parameters<typeof saveMeteringPoint>[0], input)
  const month = new Date().toISOString().slice(0, 7) + '-01'
  expect((await db.query('select public.gridex_company_has_customer_data($1) as present', [company])).rows)
    .toEqual([{ present: false }])
  const scan = (await db.query<{ result: { issues: number } }>('select public.gridex_scan_data_quality_v1($1,$2::date,null) as result', [company, month])).rows[0].result
  expect(scan.issues).toBe(2)
  expect((await db.query('select issue_type from public.gridex_actionable_data_quality_issues_v order by issue_type')).rows)
    .toEqual([{ issue_type: 'active_metering_point_without_active_customer' }, { issue_type: 'missing_metering_values' }])
  expect((await db.query<{ n: number }>('select count(*)::int n from public.gridex_missing_metering_points_v1($1,$2::date)', [company, month])).rows[0].n).toBe(1)
}, 30_000)
