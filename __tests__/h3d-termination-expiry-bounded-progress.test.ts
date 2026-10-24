// reality-defects: H3d termination expiry must reach all eligible bounded pages.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const migration = (name: string) => readFileSync(`${root}/supabase/migrations/${name}`, 'utf8')
const source = migration('20261023205000_h3d_move_out_notice_and_termination.sql')
const start = source.indexOf('create function public.gridex_termination_notice_expiry_tasks_v1(')
if (start < 0) throw new Error('termination_expiry_source_missing')
const original = source.slice(start, source.indexOf('\n$$;', start) + 4)
const forward = migration('20261024012016_termination_expiry_tasks_bounded_progress.sql').replace(/^begin;$/m, '').replace(/^commit;$/m, '')
const company = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
const contract = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema auth;create role service_role;
create function auth.role() returns text language sql as $$select coalesce(current_setting('fixture.role',true),'service_role')$$;
create table customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,status text,termination_notice_date date,ended_at timestamptz);
create table customer_supply_periods(id uuid,company_id uuid,customer_contract_id uuid,contract_id uuid,status text,actual_end_date date,end_date date,start_date date,metering_point_id uuid);
create table customer_operation_tasks(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,metering_point_id uuid,task_type text,status text,priority text,title text,description text,metadata jsonb);`)
}, 60000)
afterAll(async () => { await db?.close() })
const seed = async (count: number, tenant = company, offset = 0) => {
  await db.query(`insert into customer_contracts select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,
'55555555-5555-4555-8555-555555555555','active','2026-09-01','2026-10-01T00:00:00Z' from generate_series($2::int,$3::int) n`, [tenant, offset+1, offset+count])
  await db.query(`insert into customer_supply_periods select id,company_id,id,id,'active',null,null,'2026-09-01',
'66666666-6666-4666-8666-666666666666' from customer_contracts where company_id=$1 and id not in (select id from customer_supply_periods)`, [tenant])
}
const run = async (tenant: string|null = null) => (await db.query<{r:{tasks_created:number;contract_ids:string[]}}>(`select public.gridex_termination_notice_expiry_tasks_v1($1,'2026-10-24') r`,[tenant])).rows[0].r
const scenario = async (fn: () => Promise<void>) => {
  await db.exec(`begin;set local fixture.role='service_role';`+original)
  try { await fn() } finally { await db.exec('rollback') }
}
it('preserves OID, owner, ACL, configuration and all non-body metadata', () => scenario(async () => {
  const sql=`select to_jsonb(p)-'prosrc' m from pg_proc p where oid='public.gridex_termination_notice_expiry_tasks_v1(uuid,date)'::regprocedure`
  await db.exec('revoke all on function public.gridex_termination_notice_expiry_tasks_v1(uuid,date) from public;grant execute on function public.gridex_termination_notice_expiry_tasks_v1(uuid,date) to service_role;')
  const before=await db.query(sql);await db.exec(forward);expect(await db.query(sql)).toEqual(before)
}))
it('reaches contract 501 after 500 existing tasks and stays idempotent', () => scenario(async () => {
  await seed(501);expect((await run()).tasks_created).toBe(500)
  await db.exec(forward);expect(await run()).toMatchObject({tasks_created:1,contract_ids:[contract(501)]})
  expect((await run()).tasks_created).toBe(0)
  expect((await db.query('select count(*)::int n from customer_operation_tasks')).rows[0].n).toBe(501)
}))
it('retains a 500-row action cap and advances on the next invocation', () => scenario(async () => {
  await db.exec(forward);await seed(501);expect((await run()).tasks_created).toBe(500)
  expect(await run()).toMatchObject({tasks_created:1,contract_ids:[contract(501)]})
}))
it('does not let 500 ineligible contracts hide a later eligible period', () => scenario(async () => {
  await db.exec(forward);await seed(501);await db.query('delete from customer_supply_periods where id<>$1',[contract(501)])
  expect(await run()).toMatchObject({tasks_created:1,contract_ids:[contract(501)]})
}))
it('preserves explicit tenant isolation', () => scenario(async () => {
  await db.exec(forward);await seed(1);await seed(1,other,1000)
  expect(await run(company)).toMatchObject({tasks_created:1,contract_ids:[contract(1)]})
  expect((await db.query('select count(*)::int n from customer_operation_tasks where company_id=$1',[other])).rows[0].n).toBe(0)
  expect(await run(other)).toMatchObject({tasks_created:1,contract_ids:[contract(1001)]})
}))
it('keeps not-yet-due, terminated and no-longer-supplied contracts ineligible', () => scenario(async () => {
  await db.exec(forward);await seed(5)
  await db.query(`update customer_contracts set ended_at='2026-12-01' where id=$1`,[contract(1)])
  await db.query(`update customer_contracts set status='terminated' where id=$1`,[contract(2)])
  await db.query(`update customer_supply_periods set status='ended' where id=$1`,[contract(3)])
  await db.query(`update customer_supply_periods set end_date='2026-10-01' where id=$1`,[contract(4)])
  expect(await run()).toMatchObject({tasks_created:1,contract_ids:[contract(5)]})
}))
it('creates only an operator task and refuses a non-service caller', () => scenario(async () => {
  await db.exec(forward);await seed(1);await run()
  expect((await db.query(`select task_type,status,metadata->>'sent_automatically' automatic from customer_operation_tasks`)).rows[0])
    .toEqual({task_type:'termination_end_of_supply_pending',status:'open',automatic:'false'})
  await db.exec(`set local fixture.role='authenticated';savepoint refusal`)
  await expect(run()).rejects.toThrow(/customer_termination_service_role_required/);await db.exec('rollback to savepoint refusal')
}))
it('refuses an unknown predecessor without changing its body or metadata', () => scenario(async () => {
  await db.exec(original.replace('create function ','create or replace function ').replace('limit 500','limit 499'))
  const sql=`select to_jsonb(p) m from pg_proc p where oid='public.gridex_termination_notice_expiry_tasks_v1(uuid,date)'::regprocedure`
  const before=await db.query(sql);await db.exec('savepoint refusal')
  await expect(db.exec(forward)).rejects.toThrow(/termination_expiry_bounded_progress_source_unqualified/)
  await db.exec('rollback to savepoint refusal');expect(await db.query(sql)).toEqual(before)
}))
