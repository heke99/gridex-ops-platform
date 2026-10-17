import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20261013140502_manual_inbound_retired_source_consistency.sql', 'utf8')
const mailbox = 'fixture@example.invalid'
const provider = 'Fixture-Provider-ID'
const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
let db: PGlite

const insert = (mail = mailbox, key: string | null = provider, owner = company) => db.query<{ id: string }>(
  'insert into public.manual_inbound_messages(mailbox,provider_message_id,company_id) values($1,$2,$3) returning id', [mail, key, owner])
const retired = async (mail = mailbox, key: string | null = provider) => (await db.query<{ retired: boolean }>(
  'select public.gridex_manual_inbound_source_retired_v1($1,$2) retired', [mail, key])).rows[0].retired
const rejected = async (action: () => Promise<unknown>, code: string) => {
  await db.exec('savepoint rejected_write')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint rejected_write')
}

describe('retired manual inbound source identity', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create function auth.role() returns text language sql stable as
      $$select current_setting('request.jwt.claim.role',true)$$;
      set request.jwt.claim.role='service_role';`)
    const ddl = readFileSync('supabase/schema.sql', 'utf8')
      .match(/CREATE TABLE public\.manual_inbound_messages \([\s\S]*?\n\);/)?.[0]
    if (!ddl) throw new Error('production manual source DDL missing')
    await db.exec(ddl)
    await db.exec('alter table public.manual_inbound_messages add primary key(id)')
    await db.exec(migration)
    await db.exec(migration)
  }, 90_000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('rejects a late raw insert whose prior physical dedup source was deleted', async () => {
    const raw = (await insert()).rows[0].id
    expect((await db.query('select id from public.manual_inbound_messages where id=$1', [raw])).rows).toHaveLength(1)
    await db.query('delete from public.manual_inbound_messages where id=$1', [raw])
    await rejected(() => insert(), '23514')
    expect(await retired()).toBe(true)
    expect((await db.query('select id from public.manual_inbound_messages')).rows).toEqual([])
  })

  it('normalizes mailbox whitespace/case and provider whitespace while preserving provider case', async () => {
    await insert('  FIXTURE@EXAMPLE.INVALID  ', ' Fixture-Provider-ID ')
    await db.exec('delete from public.manual_inbound_messages')
    expect(await retired(mailbox, provider)).toBe(true)
    await rejected(() => insert(mailbox, provider), '23514')
    await insert(mailbox, provider.toLowerCase())
    await insert('fresh@example.invalid', provider)
    await insert(mailbox, 'New-Provider-ID')
    expect((await db.query<{ n: number }>('select count(*)::int n from public.manual_inbound_messages')).rows[0].n).toBe(3)
  })

  it('uses collision-safe tuple encoding and only a 32-byte SHA256 key in the registry', async () => {
    const keys = (await db.query<{ key: string }>(`select encode(gridex_manual_inbound.manual_source_key_v1(mail,provider),'hex') key
      from(values('a|b','c'),('a','b|c'),('é@example.invalid','<"\\message">')) v(mail,provider)`)).rows
    expect(new Set(keys.map(row => row.key)).size).toBe(3)
    expect(keys.every(row => /^[a-f0-9]{64}$/.test(row.key))).toBe(true)
    await insert(); await db.exec('delete from public.manual_inbound_messages')
    expect((await db.query(`select column_name from information_schema.columns
      where table_schema='gridex_manual_inbound' and table_name='retired_source_keys' order by ordinal_position`)).rows)
      .toEqual([{ column_name: 'source_key' }, { column_name: 'retired_at' }])
  })

  it('keeps absent retirement and missing provider IDs compatible with existing ingress handling', async () => {
    expect(await retired()).toBe(false)
    expect(await retired(mailbox, null)).toBe(false)
    await insert(mailbox, null); await db.exec('delete from public.manual_inbound_messages')
    await insert(mailbox, null)
    expect((await db.query<{ n: number }>('select count(*)::int n from gridex_manual_inbound.retired_source_keys')).rows[0].n).toBe(0)
  })

  it('preserves original source grants/RLS and retires only an authorized deleted row', async () => {
    await insert(mailbox, provider, company)
    await insert(mailbox, 'Foreign-Provider', otherCompany)
    await db.exec(`alter table public.manual_inbound_messages enable row level security;
      grant select,delete on public.manual_inbound_messages to authenticated;
      create policy owned_source on public.manual_inbound_messages to authenticated
       using(company_id='${company}'::uuid);
      set local role authenticated;set local request.jwt.claim.role='authenticated';`)
    expect((await db.query('delete from public.manual_inbound_messages where company_id=$1 returning id', [otherCompany])).rows).toEqual([])
    expect((await db.query('delete from public.manual_inbound_messages where company_id=$1 returning id', [company])).rows).toHaveLength(1)
    await rejected(() => db.query('select public.gridex_manual_inbound_source_retired_v1($1,$2)', [mailbox, provider]), '42501')
    await db.exec("reset role;set local request.jwt.claim.role='service_role'")
    expect(await retired()).toBe(true)
    expect(await retired(mailbox, 'Foreign-Provider')).toBe(false)
    expect((await db.query('select company_id from public.manual_inbound_messages')).rows).toEqual([{ company_id: otherCompany }])
  })

  it('exposes only the service lookup and denies registry mutation or direct trigger invocation', async () => {
    expect((await db.query(`select
      has_function_privilege('service_role','public.gridex_manual_inbound_source_retired_v1(text,text)','EXECUTE') as service_lookup,
      has_function_privilege('authenticated','public.gridex_manual_inbound_source_retired_v1(text,text)','EXECUTE') as auth_lookup,
      has_function_privilege('anon','public.gridex_manual_inbound_source_retired_v1(text,text)','EXECUTE') as anon_lookup,
      has_schema_privilege('authenticated','gridex_manual_inbound','USAGE') as auth_schema,
      has_table_privilege('service_role','gridex_manual_inbound.retired_source_keys','INSERT') as service_insert,
      has_table_privilege('service_role','gridex_manual_inbound.retired_source_keys','TRUNCATE') as service_truncate,
      has_function_privilege('service_role','gridex_manual_inbound.retire_deleted_source_v1()','EXECUTE') as direct_trigger`)).rows)
      .toEqual([{ service_lookup: true, auth_lookup: false, anon_lookup: false, auth_schema: false,
        service_insert: false, service_truncate: false, direct_trigger: false }])
    await db.exec("set local request.jwt.claim.role='authenticated'")
    await rejected(() => db.query('select public.gridex_manual_inbound_source_retired_v1($1,$2)', [mailbox, provider]), '42501')
  })

  it('makes retired keys immutable, including owner-level accidental updates or deletes', async () => {
    await insert(); await db.exec('delete from public.manual_inbound_messages')
    await rejected(() => db.exec('delete from gridex_manual_inbound.retired_source_keys'), '55000')
    await rejected(() => db.exec('update gridex_manual_inbound.retired_source_keys set retired_at=now()'), '55000')
  })

  it('fails closed on lookup/registry failures and rolls retirement back with a failed source deletion', async () => {
    await insert()
    await db.exec('savepoint failed_delete;delete from public.manual_inbound_messages;rollback to savepoint failed_delete')
    expect(await retired()).toBe(false)
    await db.exec('alter table gridex_manual_inbound.retired_source_keys rename to unavailable_keys')
    await rejected(() => retired(), '42P01')
    await rejected(() => insert(mailbox, 'Fresh-Provider'), '42P01')
    expect((await db.query<{ n: number }>('select count(*)::int n from public.manual_inbound_messages')).rows[0].n).toBe(1)
  })
})
