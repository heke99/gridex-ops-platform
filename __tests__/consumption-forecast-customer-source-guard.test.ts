import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013131746_consumption_forecast_customer_source_guard.sql', 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
let db: PGlite

async function createRun(owner: string | null = company, type = 'consumption') {
  return db.query(`insert into public.forecast_runs(company_id,forecast_type,period_start,period_end,status)
    values($1,$2,'2026-10-01','2026-11-01','running') returning id`, [owner, type])
}
async function customer(source: string | null = 'manual', status = 'active', owner = company) {
  await db.query('insert into public.customers(id,company_id,source,status) values(gen_random_uuid(),$1,$2,$3)', [owner, source, status])
}
async function rejected(action: () => Promise<unknown>, code = '22023') {
  await db.exec('savepoint blocked_run')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint blocked_run')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema private;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid,source text,status text);
    insert into public.companies values('${company}'),('${otherCompany}');`)
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  const ddl = schema.match(/CREATE TABLE public\.forecast_runs \([\s\S]*?\n\);/)?.[0]
  if (!ddl) throw new Error('Missing production forecast_runs DDL')
  await db.exec(ddl)
  await db.exec('alter table public.forecast_runs add primary key(id);alter table public.forecast_runs add foreign key(company_id) references public.companies(id) on delete restrict;')
  const integrity = readFileSync('supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql', 'utf8')
  await db.exec(integrity.slice(integrity.indexOf('create or replace function public.gridex_company_has_customer_data('), integrity.indexOf('-- Reuse the existing mature builders')))
  await db.exec(`insert into public.forecast_runs(id,company_id,forecast_type,period_start,period_end,status,completed_at)
    values('33333333-3333-4333-8333-333333333333','${company}','consumption','2026-09-01','2026-10-01','completed','2026-09-30T00:00:00Z');`)
  await db.exec(migration)
}, 30_000)
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { await db.close() })

it('blocks the old direct consumption INSERT for an empty company before creating any run', async () => {
  await rejected(() => createRun())
  expect((await db.query("select count(*)::int n from public.forecast_runs where period_start='2026-10-01'")).rows).toEqual([{ n: 0 }])
})

it('blocks active portal-test and deleted sources without borrowing another company customer', async () => {
  await customer('ediel_portal_test', 'active')
  await customer('manual', 'deleted')
  await customer('manual', 'pending_deletion')
  await customer('manual', 'active', otherCompany)
  await rejected(() => createRun())
  expect((await createRun(otherCompany)).rows).toHaveLength(1)
})

it.each(['manual', null])('allows genuine retained customer source %s and preserves the old ID response', async source => {
  await customer(source, 'draft')
  expect((await createRun()).rows).toEqual([{ id: expect.any(String) }])
})

it.each(['purchase', 'revenue'])('preserves empty-company %s producers', async type => {
  expect((await createRun(company, type)).rows).toHaveLength(1)
})

it('fails closed for NULL and unknown company IDs without deleting prior consumption history', async () => {
  const before = (await db.query('select to_jsonb(r) as history from public.forecast_runs r')).rows
  await rejected(() => createRun(null))
  await rejected(() => createRun('44444444-4444-4444-8444-444444444444'))
  await db.exec(migration)
  expect((await db.query('select to_jsonb(r) as history from public.forecast_runs r')).rows).toEqual(before)
})

it('keeps the private invoker trigger inaccessible and retains source-table tenant RLS', async () => {
  await customer('manual', 'active', otherCompany)
  await db.exec(`grant usage on schema public to authenticated;
    grant select on public.customers to authenticated;
    grant select,insert on public.forecast_runs to authenticated;
    alter table public.customers enable row level security;
    create policy customer_owner on public.customers to authenticated using(company_id=current_setting('test.company')::uuid);
    alter table public.forecast_runs enable row level security;
    create policy run_owner on public.forecast_runs to authenticated using(company_id=current_setting('test.company')::uuid) with check(company_id=current_setting('test.company')::uuid);`)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expect((await db.query('select has_function_privilege($1,\'private.gridex_require_consumption_forecast_customer_source()\',\'EXECUTE\') as allowed', [role])).rows).toEqual([{ allowed: false }])
  }
  expect((await db.query("select prosecdef from pg_proc where oid='private.gridex_require_consumption_forecast_customer_source()'::regprocedure")).rows).toEqual([{ prosecdef: false }])
  await db.query("select set_config('test.company',$1,true)", [company])
  await db.exec('set local role authenticated')
  await rejected(() => createRun(otherCompany))
  await rejected(() => createRun(company))
  await db.exec('reset role')
  await customer()
  await db.exec('set local role authenticated')
  expect((await createRun(company)).rows).toHaveLength(1)
})
