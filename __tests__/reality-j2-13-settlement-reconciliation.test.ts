// reality-defects: J2-13
// J2-13 / owner decision 34: two separate reconciliation checks per tenant, settlement grid area, delivery period and
// series type. (1) our own current metering values against the grid owner's aggregate (E31) over its exact period,
// with S03 kept as preliminary and never approved; (2) net invoiced kWh (credits subtracted, replacements counted)
// against the current metering values of the same billing periods. Missing or incomplete data gets its own status
// (never zero, never approved), corrected aggregate versions replace the earlier result, documented tolerances in kWh
// and percent decide, and a deviation opens one traceable staff case. Nothing is corrected and no billing is blocked.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261026130000_j2_13_settlement_reconciliation.sql'), 'utf8')
const T = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const MP1 = '22222222-2222-4222-8222-222222222221', MP2 = '22222222-2222-4222-8222-222222222222', MPX = '22222222-2222-4222-8222-222222222229'
const DAY = { start: '2026-09-09T22:00:00Z', end: '2026-09-10T22:00:00Z' }

let db: PGlite
let role = 'service_role'

beforeEach(async () => {
  role = 'service_role'
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create table public.gx_session(role text); insert into public.gx_session values ('service_role');
    create function auth.role() returns text language sql as $$ select role from public.gx_session $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function public.gridex_can_read_company(c uuid) returns boolean language sql as $$ select true $$;
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select false $$;
    create table public.companies(id uuid primary key);
    create table public.metering_points(id uuid primary key, company_id uuid, grid_area_code text);
    create table public.customer_supply_periods(id serial, company_id uuid, metering_point_id uuid, status text, start_date date, end_date date, actual_start_date date, actual_end_date date);
    create table public.metering_values(id uuid primary key default gen_random_uuid(), company_id uuid, metering_point_id uuid, reading_type text default 'consumption',
      value_kwh numeric, quantity numeric, unit text, period_start timestamptz, period_end timestamptz, is_current boolean default true, value_status text default 'current',
      grid_area_code text, revision_number int default 1);
    create table public.meter_reading_series(id uuid primary key default gen_random_uuid(), company_id uuid, grid_area_id text, period_start timestamptz, period_end timestamptz,
      message_code text, series_kind text, version_no int default 1, is_current boolean default true, source_ediel_message_id uuid, actor_context jsonb default '{}',
      time_series_product jsonb, raw_transaction jsonb default '{}');
    create table public.meter_reading_values(id uuid primary key default gen_random_uuid(), company_id uuid, series_id uuid, reading_at timestamptz, quantity numeric, unit text default 'KWH');
    create table public.billing_underlays(id uuid primary key default gen_random_uuid(), company_id uuid, metering_point_id uuid, billing_period_start date, billing_period_end date,
      energy_direction text default 'consumption', payload jsonb default '{}', status text default 'ready');
    create table public.customer_invoices(id uuid primary key default gen_random_uuid(), company_id uuid, billing_underlay_id uuid, total_kwh numeric, status text default 'issued');
    create table public.billing_adjustment_cases(id uuid primary key default gen_random_uuid(), company_id uuid, original_billing_underlay_id uuid, original_invoice_id uuid, credit_invoice_id uuid);
    create table public.customer_operation_tasks(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, task_type text, status text default 'open',
      priority text, title text, description text, assigned_to uuid, metadata jsonb default '{}', created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
    insert into public.companies values ('${T}'), ('${OTHER}');
    insert into public.metering_points values ('${MP1}','${T}','ALS'), ('${MP2}','${T}','ALS'), ('${MPX}','${OTHER}','ALS');
    insert into public.customer_supply_periods(company_id,metering_point_id,status,start_date) values ('${T}','${MP1}','active','2026-09-01'), ('${T}','${MP2}','active','2026-09-01'), ('${OTHER}','${MPX}','active','2026-09-01');
  `)
  await db.exec(migration)
})

const asRole = async (r: string) => { role = r; await db.query('update public.gx_session set role=$1', [r]) }
/** 24 hourly values for the reconciled day, each `kwh`. */
const hourly = async (company: string, mp: string, kwh: number, opts: { hours?: number; unit?: string } = {}) => {
  for (let h = 0; h < (opts.hours ?? 24); h += 1) {
    const start = new Date(Date.parse(DAY.start) + h * 3_600_000).toISOString(), end = new Date(Date.parse(DAY.start) + (h + 1) * 3_600_000).toISOString()
    await db.query('insert into public.metering_values(company_id,metering_point_id,value_kwh,quantity,unit,period_start,period_end) values ($1,$2,$3,$4,$5,$6,$7)',
      [company, mp, opts.unit ? null : kwh, kwh, opts.unit ?? 'kWh', start, end])
  }
}
const aggregate = async (company: string, code: 'E31' | 'S03', hourlyKwh: number, opts: { unit?: string; version?: number; supersede?: string } = {}) => {
  if (opts.supersede) await db.query('update public.meter_reading_series set is_current=false where id=$1', [opts.supersede])
  const { rows } = await db.query<{ id: string }>(`insert into public.meter_reading_series(company_id,grid_area_id,period_start,period_end,message_code,series_kind,version_no,actor_context)
    values ($1,'ALS',$2,$3,$4,'aggregate',$5,'{"issuer":"16700"}') returning id`, [company, DAY.start, DAY.end, code, opts.version ?? 1])
  for (let h = 0; h < 24; h += 1) await db.query('insert into public.meter_reading_values(company_id,series_id,quantity,unit) values ($1,$2,$3,$4)', [company, rows[0].id, hourlyKwh, opts.unit ?? 'KWH'])
  return rows[0].id
}
type Result = { check: string; area: string; status: string; own_kwh: number | null; reference_kwh: number | null; diff_kwh: number | null; reasons: string[]; task_id: string | null }
const reconcile = async (company = T, trigger = 'monthly', month = '2026-09-01') =>
  (await db.query<{ r: { results: Result[] } }>('select public.gridex_settlement_reconcile_v1($1,$2,$3) r', [company, month, trigger])).rows[0].r.results
const tasks = async (company = T) => (await db.query<{ status: string; title: string; metadata: Record<string, unknown> }>(
  `select status,title,metadata from public.customer_operation_tasks where company_id=$1 and task_type='settlement_reconciliation_deviation' order by created_at`, [company])).rows
/** Only MP1 is supplied on the reconciled day (MP2's supply starts in October). */
const onlyMp1 = () => db.query(`update public.customer_supply_periods set start_date='2026-10-01' where metering_point_id=$1`, [MP2])
const fails = async (sql: string, params: unknown[]) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }

describe('J2-13 check 1: own metering values against the grid owner aggregate', () => {
  it('matches inside tolerance, and a deviation outside it opens one traceable staff case', async () => {
    await hourly(T, MP1, 1); await hourly(T, MP2, 2)
    await aggregate(T, 'E31', 3.01)
    const [ok] = (await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')
    expect(ok).toMatchObject({ status: 'matched', own_kwh: 72, reference_kwh: 72.24, task_id: null })
    const series = await aggregate(T, 'E31', 4, { version: 2, supersede: (await db.query<{ id: string }>(`select id from public.meter_reading_series where version_no=1`)).rows[0].id })
    const [dev] = (await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')
    expect(dev).toMatchObject({ status: 'deviation', own_kwh: 72, reference_kwh: 96, diff_kwh: -24 })
    const open = await tasks()
    expect(open).toHaveLength(1)
    expect(open[0].metadata).toMatchObject({ check_kind: 'aggregate_vs_metered', status: 'deviation', grid_area_code: 'ALS', diff_kwh: -24,
      evidence: { reference_series_id: series, reference_version: 2, grid_owner: { issuer: '16700' } } })
  })

  it('a corrected aggregate version replaces the earlier result; the earlier one is kept, not current', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    const v1 = await aggregate(T, 'E31', 2)
    await reconcile(T, 'new_or_corrected_basis')
    await aggregate(T, 'E31', 1, { version: 2, supersede: v1 })
    await reconcile(T, 'new_or_corrected_basis')
    const { rows } = await db.query<{ status: string; reference_version: number; is_current: boolean }>(
      `select status,reference_version,is_current from public.settlement_reconciliation_results where check_kind='aggregate_vs_metered' order by created_at`)
    expect(rows).toEqual([{ status: 'deviation', reference_version: 1, is_current: false }, { status: 'matched', reference_version: 2, is_current: true }])
  })

  it('S03 is preliminary shares: recorded as preliminary, never matched, never a case', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    await aggregate(T, 'S03', 1)
    const [res] = (await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')
    expect(res.status).toBe('preliminary')
    expect(res.reasons).toContain('s03_preliminary_shares_not_final_consumption')
    expect(await tasks()).toEqual([])
  })

  it('missing own intervals for a supplied facility is incomplete, never counted as zero or approved', async () => {
    await hourly(T, MP1, 1); await hourly(T, MP2, 1, { hours: 20 })
    await aggregate(T, 'E31', 2)
    const [res] = (await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')
    expect(res).toMatchObject({ status: 'incomplete', own_kwh: null })
    expect(res.reasons).toContain('own_values_missing_intervals')
    expect((await tasks())[0].metadata.status).toBe('incomplete')
  })

  it('normalises units (MWh) and treats an unsupported unit as incomplete', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    await aggregate(T, 'E31', 0.001, { unit: 'MWH' })
    expect((await reconcile(T, 'new_or_corrected_basis')).find(r => r.check === 'aggregate_vs_metered')).toMatchObject({ status: 'matched', reference_kwh: 24 })
    const db2 = await aggregate(T, 'E31', 1, { unit: 'BTU', version: 2, supersede: (await db.query<{ id: string }>(`select id from public.meter_reading_series`)).rows[0].id })
    expect(db2).toBeTruthy()
    const res = (await reconcile(T, 'new_or_corrected_basis')).find(r => r.check === 'aggregate_vs_metered')!
    expect(res).toMatchObject({ status: 'incomplete', reference_kwh: null })
    expect(res.reasons).toContain('unit_not_supported')
  })

  it('respects supply start and end: a facility not yet supplied is not required', async () => {
    await db.query(`update public.customer_supply_periods set start_date='2026-09-15' where metering_point_id=$1`, [MP2])
    await hourly(T, MP1, 1)
    await aggregate(T, 'E31', 1)
    expect((await reconcile(T, 'new_or_corrected_basis')).find(r => r.check === 'aggregate_vs_metered')).toMatchObject({ status: 'matched', own_kwh: 24 })
  })

  it('the monthly summary flags a supplied grid area without any final aggregate as missing_reference', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    const res = (await reconcile(T, 'monthly')).find(r => r.check === 'aggregate_vs_metered')!
    expect(res).toMatchObject({ status: 'missing_reference', area: 'ALS' })
    expect((await tasks())[0].metadata.status).toBe('missing_reference')
    // A run triggered by new data does not call data still in flight missing.
    await db.query(`delete from public.settlement_reconciliation_results`)
    expect((await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')).toEqual([])
  })
})

describe('J2-13 check 2: net invoiced kWh against the billing basis', () => {
  const invoice = async (kwh: number | null, opts: { credit?: string } = {}) => {
    const u = (await db.query<{ id: string }>(`insert into public.billing_underlays(company_id,metering_point_id,billing_period_start,billing_period_end) values ($1,$2,'2026-09-10','2026-09-11') returning id`, [T, MP1])).rows[0].id
    const i = (await db.query<{ id: string }>(`insert into public.customer_invoices(company_id,billing_underlay_id,total_kwh) values ($1,$2,$3) returning id`, [T, u, kwh])).rows[0].id
    if (opts.credit) await db.query(`insert into public.billing_adjustment_cases(company_id,original_billing_underlay_id,original_invoice_id,credit_invoice_id) values ($1,$2,$3,$4)`, [T, u, opts.credit, i])
    return i
  }

  it('matches the basis; a correction after billing becomes a deviation; credit plus rebill nets it out', async () => {
    await hourly(T, MP1, 1)
    const original = await invoice(24)
    expect((await reconcile()).find(r => r.check === 'billed_vs_basis')).toMatchObject({ status: 'matched', own_kwh: 24, reference_kwh: 24 })
    await db.query(`update public.metering_values set value_kwh=1.5 where metering_point_id=$1`, [MP1])
    expect((await reconcile()).find(r => r.check === 'billed_vs_basis')).toMatchObject({ status: 'deviation', own_kwh: 24, reference_kwh: 36, diff_kwh: -12 })
    await invoice(-24, { credit: original })
    await invoice(36)
    expect((await reconcile()).find(r => r.check === 'billed_vs_basis')).toMatchObject({ status: 'matched', own_kwh: 36, reference_kwh: 36 })
  })

  it('an invoice without kWh or a missing basis is incomplete, never zero', async () => {
    await invoice(24)
    const res = (await reconcile()).find(r => r.check === 'billed_vs_basis')!
    expect(res).toMatchObject({ status: 'incomplete', reference_kwh: null })
    expect(res.reasons).toContain('billing_basis_values_missing')
  })

  it('a break-fee underlay carries no energy and is left out', async () => {
    await hourly(T, MP1, 1)
    const u = (await db.query<{ id: string }>(`insert into public.billing_underlays(company_id,metering_point_id,billing_period_start,billing_period_end,payload) values ($1,$2,'2026-09-10','2026-09-11','{"charge_kind":"break_fee"}') returning id`, [T, MP1])).rows[0].id
    await db.query(`insert into public.customer_invoices(company_id,billing_underlay_id,total_kwh) values ($1,$2,0)`, [T, u])
    expect((await reconcile()).filter(r => r.check === 'billed_vs_basis')).toEqual([])
  })
})

describe('J2-13 tolerances, queue, isolation and no billing block', () => {
  it('a documented tenant tolerance overrides the platform default (kWh or percent)', async () => {
    await onlyMp1()
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from public.settlement_reconciliation_tolerances where company_id is null and btrim(documentation)<>''`)
    expect(rows[0].n).toBe(2)
    await hourly(T, MP1, 1)
    await aggregate(T, 'E31', 1.1)
    expect((await reconcile(T, 'new_or_corrected_basis')).find(r => r.check === 'aggregate_vs_metered')!.status).toBe('deviation')
    await db.query(`insert into public.settlement_reconciliation_tolerances(company_id,check_kind,abs_kwh,pct,documentation) values ($1,'aggregate_vs_metered',0,10,'Tenantens avtal med nätägaren: 10 %')`, [T])
    expect((await reconcile(T, 'new_or_corrected_basis')).find(r => r.check === 'aggregate_vs_metered')!.status).toBe('matched')
  })

  it('new or corrected basis queues a run that the pending processor executes', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    await aggregate(T, 'E31', 1)
    const { rows } = await db.query<{ reason: string }>(`select reason from public.settlement_reconciliation_requests where processed_at is null order by reason`)
    // One pending request per tenant, grid area and month: the values queued it first, the aggregate joins it.
    expect(rows.map(r => r.reason)).toEqual(['new_metering_value'])
    const done = (await db.query<{ r: { processed: number } }>('select public.gridex_settlement_reconcile_pending_v1($1) r', [T])).rows[0].r
    expect(done.processed).toBeGreaterThan(0)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.settlement_reconciliation_results where is_current and status='matched'`)).rows[0].n).toBe(1)
  })

  it('keeps tenants apart: another tenant\'s values and aggregates are never compared or exposed', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1); await hourly(OTHER, MPX, 50)
    await aggregate(T, 'E31', 1); await aggregate(OTHER, 'E31', 50)
    const mine = (await reconcile(T, 'new_or_corrected_basis')).filter(r => r.check === 'aggregate_vs_metered')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ status: 'matched', own_kwh: 24, reference_kwh: 24 })
    expect(await tasks(OTHER)).toEqual([])
  })

  it('only service_role or a permitted actor may run it; the queue processor is service_role only; no direct writes', async () => {
    await asRole('authenticated')
    expect(await fails('select public.gridex_settlement_reconcile_v1($1,$2)', [T, '2026-09-01'])).toBe('settlement_reconciliation_not_allowed')
    expect(await fails('select public.gridex_settlement_reconcile_pending_v1()', [])).toBe('settlement_reconciliation_not_allowed')
    await asRole('service_role')
    const { rows } = await db.query<{ p: boolean }>(`select bool_or(has_table_privilege(r,'public.settlement_reconciliation_results','insert,update,delete')) p from unnest(array['anon','authenticated','service_role']) r`)
    expect(rows[0].p).toBe(false)
    expect(role).toBe('service_role')
  })

  it('never blocks or changes billing: underlays and invoices are untouched by a deviation', async () => {
    await onlyMp1()
    await hourly(T, MP1, 1)
    await db.query(`insert into public.billing_underlays(company_id,metering_point_id,billing_period_start,billing_period_end) values ($1,$2,'2026-09-10','2026-09-11')`, [T, MP1])
    const before = (await db.query(`select to_jsonb(u) j from public.billing_underlays u`)).rows
    await aggregate(T, 'E31', 9)
    await reconcile(T, 'monthly')
    expect((await db.query(`select to_jsonb(u) j from public.billing_underlays u`)).rows).toEqual(before)
    const fns = (await db.query<{ src: string }>(`select prosrc src from pg_proc where proname like 'gridex_settlement_%'`)).rows.map(r => r.src).join('\n')
    expect(fns).not.toMatch(/update\s+public\.(billing_underlays|customer_invoices|metering_values|meter_reading_series)/i)
  })
})
