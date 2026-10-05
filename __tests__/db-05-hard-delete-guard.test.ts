// masterplan: DB-05, AT-DB-05
// DB-05 (F-DB-05-01 prohibited effect): a raw hard delete of a company or customer must not
// cascade away audit/journal history. Real schema snapshot (supabase/schema.sql) loaded object by object into PGlite,
// then the guard migration applied on top. User triggers on the seeded tables are disabled only to seed a minimal
// row; FK/RI triggers (the cascades under test) are untouched. Not native PostgreSQL.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const CUSTOMER = '33333333-3333-3333-3333-333333333333'
const C = '66666666-6666-6666-6666-666666666666'
const C_CUSTOMER = '77777777-7777-7777-7777-777777777777'
let db: PGlite

const count = async (table: string, where = 'true') =>
  Number(((await db.query(`select count(*)::int n from public.${table} where ${where}`)).rows[0] as { n: number }).n)
const asRole = async (role: string, sql: string) => {
  await db.exec(`set role ${role}`)
  try { await db.exec(sql) } finally { await db.exec('reset role') }
}
const code = async (role: string, sql: string) => {
  try { await asRole(role, sql); return null } catch (e) { return (e as { code?: string; message: string }) }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin; create role authenticator;
    create schema if not exists auth; create table auth.users(id uuid primary key); create schema if not exists extensions; create schema if not exists storage;`)
  for (const e of ['pgcrypto', 'btree_gist', 'citext', 'pg_trgm', 'uuid-ossp']) { try { await db.exec(`create extension if not exists "${e}"`) } catch { /* not bundled */ } }
  await db.exec(`create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';
    create or replace function extensions.digest(bytea,text) returns bytea language sql immutable as 'select pg_catalog.sha256($1)';
    create or replace function extensions.digest(text,text) returns bytea language sql immutable as 'select pg_catalog.sha256(convert_to($1,''UTF8''))';`)
  const src = readFileSync('supabase/schema.sql', 'utf8').replace(/^\\(un)?restrict.*$/gm, '').replace(/^CREATE SCHEMA public;$/m, '').replace(/extensions\.geometry\([^)]*\)/g, 'bytea')
  for (const chunk of src.split(/\n(?=--\n-- Name: )/)) { try { await db.exec(chunk) } catch { /* PostGIS/extension objects */ } }
  await db.exec(`alter table public.companies disable trigger user; alter table public.customers disable trigger user;
    alter table public.canonical_audit_events disable trigger user; alter table public.customer_events disable trigger user;
    alter table public.customers disable trigger user;
    grant all on all tables in schema public to service_role, authenticated, anon;`)
  await db.exec(`insert into public.companies(id,name,status) values ('${A}','Synthetic A','active'),('${B}','Synthetic B','deleted_test_only');
    insert into public.customers(id,company_id) values ('${CUSTOMER}','${A}');
    insert into public.companies(id,name,status) values ('${C}','Synthetic C (disposable, real history)','deleted_test_only');
    insert into public.customers(id,company_id,is_test_data) values ('${C_CUSTOMER}','${C}',false);
    insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,idempotency_key) values ('${A}','x','y','${A}','a1'),('${B}','x','y','${B}','b1');
    insert into public.customer_events(company_id,customer_id,event_type) values ('${A}','${CUSTOMER}','customer.created');`)
  // Guard installed last so the seeding step above cannot disable it.
  await db.exec(readFileSync('supabase/migrations/20261005130000_hard_delete_guard_companies_customers.sql', 'utf8'))
}, 280_000)

describe('DB-05 hard-delete guard (F-DB-05-01)', () => {
  it.each([
    ['service_role', '23001'],
    ['authenticated', '42501'], // stopped earlier by RLS; the guard is the backstop for BYPASSRLS roles
    ['anon', '42501'],
  ])('refuses %s deleting a live company and keeps its history', async (role, expectedCode) => {
    const error = await code(role, `delete from public.companies where id='${A}'`)
    expect(error?.code).toBe(expectedCode)
    if (expectedCode === '23001') expect(error?.message).toContain('company_hard_delete_blocked')
    expect(await count('companies', `id='${A}'`)).toBe(1)
    expect(await count('canonical_audit_events', `company_id='${A}'`)).toBe(1)
    expect(await count('customer_events', `company_id='${A}'`)).toBe(1)
  })

  it('refuses a direct customer delete by service_role and keeps customer history', async () => {
    const error = await code('service_role', `delete from public.customers where id='${CUSTOMER}'`)
    expect(error?.code).toBe('23001')
    expect(error?.message).toContain('customer_hard_delete_blocked')
    expect(await count('customers', `id='${CUSTOMER}'`)).toBe(1)
    expect(await count('customer_events', `customer_id='${CUSTOMER}'`)).toBe(1)
  })

  it('refuses the status shortcut: service_role cannot mark a live company disposable and then delete it', async () => {
    const error = await code('service_role', `update public.companies set status='deleted_test_only' where id='${A}'`)
    expect(error?.code).toBe('23001')
    expect(error?.message).toContain('company_disposable_status_blocked')
    expect(((await db.query(`select status from public.companies where id='${A}'`)).rows[0] as { status: string }).status).toBe('active')
    expect((await code('service_role', `delete from public.companies where id='${A}'`))?.code).toBe('23001')
    expect(await count('canonical_audit_events', `company_id='${A}'`)).toBe(1)
  })

  // Direct TRUNCATE of a history table reaches the statement guard (23001). A CASCADE from companies/customers is
  // refused either by that guard or earlier by missing privilege on a cascaded private table (42501); both keep rows.
  it.each([
    ['truncate public.companies cascade', ['23001', '42501']],
    ['truncate public.customers cascade', ['23001', '42501']],
    ['truncate public.canonical_audit_events', ['23001']],
    ['truncate public.customer_events', ['23001']],
  ])('refuses service_role %s and keeps every row', async (sql, codes) => {
    const error = await code('service_role', sql)
    expect(codes).toContain(error?.code)
    if (error?.code === '23001') expect(error?.message).toContain('history_truncate_blocked')
    expect(await count('companies', `id in ('${A}','${B}','${C}')`)).toBe(3)
    expect(await count('customer_events', `company_id='${A}'`)).toBe(1)
    expect(await count('canonical_audit_events')).toBe(2)
  })

  it('refuses marking a tenant with real history disposable even for the owner role the canonical lifecycle runs as', async () => {
    let error: { code?: string; message: string } | null = null
    try { await db.exec(`update public.companies set status='deleted_test_only' where id='${A}'`) } catch (e) { error = e as { code?: string; message: string } }
    expect(error?.code).toBe('23001')
    expect(error?.message).toContain('company_disposable_retained_history')
    expect(((await db.query(`select status from public.companies where id='${A}'`)).rows[0] as { status: string }).status).toBe('active')
  })

  it('refuses hard-deleting a disposable-marked tenant that still holds a real customer', async () => {
    const error = await code('service_role', `delete from public.companies where id='${C}'`)
    expect(error?.code).toBe('23001')
    expect(error?.message).toContain('company_hard_delete_blocked')
    expect(await count('companies', `id='${C}'`)).toBe(1)
    expect(await count('customers', `id='${C_CUSTOMER}'`)).toBe(1)
  })

  it('does not let one tenant status or another tenant disposable status authorise the delete', async () => {
    expect((await code('service_role', `delete from public.companies where id in ('${A}','${B}')`))?.code).toBe('23001')
    expect(await count('companies', `id in ('${A}','${B}')`)).toBe(2)
    expect(await count('canonical_audit_events', `company_id='${B}'`)).toBe(1)
  })

  it('still lets the owner role run the sanctioned customer path (what the SECURITY DEFINER command runs as)', async () => {
    await db.exec(`insert into public.customers(id,company_id) values ('44444444-4444-4444-4444-444444444444','${A}')`)
    await db.exec(`delete from public.customers where id='44444444-4444-4444-4444-444444444444'`)
    expect(await count('customers', `id='44444444-4444-4444-4444-444444444444'`)).toBe(0)
    expect(await count('customers', `id='${CUSTOMER}'`)).toBe(1)
  })

  it('allows a disposable deleted_test_only tenant to be removed together with its journal rows', async () => {
    await asRole('service_role', `delete from public.companies where id='${B}'`)
    expect(await count('companies', `id='${B}'`)).toBe(0)
    expect(await count('canonical_audit_events', `company_id='${B}'`)).toBe(0)
    expect(await count('companies', `id='${A}'`)).toBe(1)
  })
})
