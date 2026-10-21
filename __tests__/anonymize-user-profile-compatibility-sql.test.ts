import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const predecessor = readFileSync('supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql', 'utf8')
const predecessorFunction = predecessor.match(/create or replace function public\.anonymize_user_account\(target_user_id uuid\)[\s\S]*?\n\$\$;/)?.[0]
if (!predecessorFunction) throw new Error('Qualified predecessor account-closure function missing')
const predecessorBody = predecessorFunction.match(/as \$\$([\s\S]*)\$\$;/)?.[1]
if (!predecessorBody) throw new Error('Qualified predecessor account-closure body missing')
const predecessorHash = createHash('sha256').update(predecessorBody).digest('hex')
const forward = readFileSync('supabase/migrations/20261020164020_anonymize_user_profile_optional_columns.sql', 'utf8')
const target = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const company = '33333333-3333-4333-8333-333333333333'
type Row = Record<string, unknown>
type Shape = 'canonical16' | 'selectedOps26' | 'phoneOnly' | 'activeCompanyOnly'
const open: PGlite[] = []

// Column names/types only, from the selected OPS catalog collected2026-10-20:
// ops-user-profile-columns.json SHA256 ce144cb4ae346dac319a2be511267099ac1e169e8f376d5d3bc4c0cf929a355c
// This fixture
// qualifies compatibility, not live function-body/deployment equivalence.
const extraColumns = [
  ['last_auth_email_error', 'text'], ['phone', 'text'], ['must_change_password', 'boolean'],
  ['temporary_password_set_at', 'timestamp with time zone'], ['temporary_password_expires_at', 'timestamp with time zone'],
  ['password_changed_at', 'timestamp with time zone'], ['active_company_id', 'uuid'],
  ['temporary_password_set_by', 'uuid'], ['temporary_password_company_id', 'uuid'], ['temporary_password_company_name', 'text'],
] as const
const legacyTables = ['user_preferences', 'agency_members', 'team_members', 'bankid_enrichment']

function source(pattern: RegExp) {
  const sql = schema.match(pattern)?.[0]
  if (!sql) throw new Error('Required actual account-closure source missing')
  return sql
}
function ddl(table: string) {
  return source(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))
}
async function contract(db: PGlite) {
  return (await db.query<Row>(`select oid,proowner,proacl::text,prosecdef,proconfig,prorettype::regtype::text as return_type,
    proargnames from pg_catalog.pg_proc where oid='public.anonymize_user_account(uuid)'::regprocedure`)).rows[0]
}
async function installImage(db: PGlite) {
  return (await db.query<{ image: Row }>(`select pg_catalog.to_jsonb(p) as image from pg_catalog.pg_proc p
    where oid=pg_catalog.to_regprocedure('public.anonymize_user_account(uuid)')`)).rows[0]?.image ?? null
}
async function profile(db: PGlite, id = target) {
  return (await db.query<{ row: Row }>('select to_jsonb(p) as row from public.user_profiles p where id=$1', [id])).rows[0].row
}
async function state(db: PGlite) {
  return (await db.query<{ state: Row }>(`select jsonb_build_object(
    'profile',(select to_jsonb(p) from public.user_profiles p where id=$1),
    'memberships',(select jsonb_agg(to_jsonb(m) order by user_id) from public.company_memberships m),
    'roles',(select jsonb_agg(to_jsonb(r) order by user_id) from public.user_roles r),
    'overrides',(select jsonb_agg(to_jsonb(o) order by user_id) from public.user_permission_overrides o),
    'sessions',(select jsonb_agg(to_jsonb(s) order by user_id) from auth.sessions s),
    'refresh',(select jsonb_agg(to_jsonb(r) order by user_id) from auth.refresh_tokens r)
    ) as state`, [target])).rows[0].state
}
async function invoke(db: PGlite, options: { role?: 'authenticated' | 'service_role' | 'anon'; uid?: string | null; user?: string } = {}) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [options.uid === undefined ? target : options.uid ?? ''])
  await db.exec(`set role ${options.role ?? 'authenticated'}`)
  try {
    return await db.query('select public.anonymize_user_account($1)', [options.user ?? target])
  } finally {
    await db.exec('reset role')
  }
}

async function fixture(shape: Shape = 'canonical16', invitation: 'nullable' | 'required' | 'noColumn' = 'nullable', applyForward = true) {
  const db = new PGlite()
  open.push(db)
  // Actual source profile/authorization/invitation DDL and actual function
  // execute. Auth context, legacy optional tables and unrelated company/history
  // relations are finite ports; this is no native/full-JWT/full-replay claim.
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,history_marker text);
    create table auth.sessions(user_id uuid);
    create table auth.refresh_tokens(user_id text);
    create table public.companies(id uuid primary key,archived_at timestamptz);
    create table public.account_closure_test_history(user_id uuid,marker text);
    create table public.account_closure_test_profile_updates(user_id uuid);
    create function public.account_closure_test_update_count() returns trigger language plpgsql as $$
      begin insert into public.account_closure_test_profile_updates values(new.id);return new;end$$;`)
  for (const table of ['user_profiles', 'company_memberships', 'user_roles', 'user_permission_overrides', 'company_invitations']) await db.exec(ddl(table))
  const extras = extraColumns.filter(([name]) => shape === 'selectedOps26' || shape === 'phoneOnly' && name === 'phone' || shape === 'activeCompanyOnly' && name === 'active_company_id')
  for (const [name, type] of extras) await db.exec(`alter table public.user_profiles add column ${name} ${type}`)
  if (invitation === 'required') await db.exec('alter table public.company_invitations alter column invited_user_id set not null')
  if (invitation === 'noColumn') await db.exec('alter table public.company_invitations drop column invited_user_id')
  for (const table of legacyTables) await db.exec(`create table public.${table}(user_id uuid,marker text)`)
  await db.exec('create table public.extension_data(user_id uuid,key text,marker text)')
  // The immutable, qualified predecessor remains the install input even after
  // a separately qualified producer later updates canonical schema.sql.
  await db.exec(predecessorFunction!)
  await db.exec(source(/REVOKE ALL ON FUNCTION public\.anonymize_user_account\(target_user_id uuid\) FROM PUBLIC;\nGRANT ALL[^\n]+\nGRANT ALL[^\n]+/))
  expect((await db.query<{ hash: string }>(`select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') as hash
    from pg_catalog.pg_proc where oid='public.anonymize_user_account(uuid)'::regprocedure`)).rows[0].hash).toBe(predecessorHash)
  const beforeContract = await contract(db)
  const beforeImage = await installImage(db)
  const beforeColumns = (await db.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='user_profiles' order by ordinal_position")).rows
  if (applyForward) await db.exec(forward)
  await db.exec(`create trigger account_closure_test_update_count after update on public.user_profiles
    for each row execute function public.account_closure_test_update_count()`)
  await db.query('insert into public.companies(id) values($1)', [company])
  for (const id of [target, other]) {
    await db.query("insert into auth.users values($1,'synthetic@example.invalid','retained auth identity')", [id])
    await db.query(`insert into public.user_profiles(id,email,full_name,updated_at,last_auth_email_action,last_auth_email_message,last_auth_email_action_by)
      values($1,'synthetic@example.invalid','Synthetic fixture','2000-01-01','password_updated','Retained history',$1)`, [id])
    if (shape === 'selectedOps26' || shape === 'phoneOnly') await db.query("update public.user_profiles set phone='synthetic phone' where id=$1", [id])
    if (shape === 'selectedOps26' || shape === 'activeCompanyOnly') await db.query('update public.user_profiles set active_company_id=$2 where id=$1', [id, company])
    if (shape === 'selectedOps26') await db.query(`update public.user_profiles set must_change_password=true,
      temporary_password_set_by=$1,temporary_password_company_id=$2,temporary_password_company_name='Retained fixture metadata',
      last_auth_email_error='Retained fixture status',temporary_password_set_at='2001-01-01',temporary_password_expires_at='2001-01-02',password_changed_at='2001-01-03' where id=$1`, [id, company])
    await db.query("insert into public.company_memberships(company_id,user_id,membership_role) values($1,$2,'member')", [company, id])
    await db.query("insert into public.user_roles(user_id,company_id,role) values($1,$2,'member')", [id, company])
    await db.query("insert into public.user_permission_overrides(user_id,company_id,permission_key) values($1,$2,'fixture.read')", [id, company])
    for (const table of legacyTables) await db.query(`insert into public.${table} values($1,'Retained other user')`, [id])
    await db.query("insert into public.extension_data values($1,'bankid_enrichment','remove target'),($1,'unrelated','retain')", [id])
    await db.query('insert into auth.sessions values($1)', [id])
    await db.query('insert into auth.refresh_tokens values($1)', [id])
    await db.query("insert into public.account_closure_test_history values($1,'Retained history')", [id])
    if (invitation === 'noColumn') await db.query("insert into public.company_invitations(company_id,email) values($1,'synthetic@example.invalid')", [company])
    else await db.query("insert into public.company_invitations(company_id,email,invited_user_id) values($1,'synthetic@example.invalid',$2)", [company, id])
  }
  await db.exec('delete from public.account_closure_test_profile_updates')
  return { db, beforeContract, beforeColumns, beforeImage }
}
afterEach(async () => { for (const db of open.splice(0)) await db.close() })

const migrationOwner = 'account_closure_fixture_migration_owner'
async function ordinaryFunctionOwner(db: PGlite) {
  await db.exec(`create role ${migrationOwner} nosuperuser nocreatedb nocreaterole noinherit;
    grant usage,create on schema public to ${migrationOwner};
    alter function public.anonymize_user_account(uuid) owner to ${migrationOwner}`)
  expect((await db.query(`select rolsuper,rolcreatedb,rolcreaterole,
    has_table_privilege(oid,'pg_catalog.pg_proc','UPDATE') as catalog_update
    from pg_catalog.pg_roles where rolname=$1`, [migrationOwner])).rows).toEqual([
    { rolsuper: false, rolcreatedb: false, rolcreaterole: false, catalog_update: false },
  ])
}
async function asOrdinaryOwner(db: PGlite, sql: string) {
  await db.exec(`set role ${migrationOwner}`)
  try { return await db.exec(sql) } finally { await db.exec('reset role') }
}

describe('actual account closure across profile generations', () => {
  it.each(['canonical16', 'selectedOps26', 'phoneOnly', 'activeCompanyOnly'] as const)('anonymizes %s once, with atomic authorization cleanup and retained history', async shape => {
    const { db } = await fixture(shape)
    const before = await profile(db)
    const otherBefore = await profile(db, other)
    await invoke(db)
    const after = await profile(db)
    expect(after).toMatchObject({ email: null, full_name: null, user_status: 'disabled' })
    expect(after.updated_at).not.toBe(before.updated_at)
    for (const field of ['phone', 'active_company_id']) if (field in before) expect(after[field]).toBeNull()
    for (const [key, value] of Object.entries(before)) {
      if (!['email', 'full_name', 'user_status', 'updated_at', 'phone', 'active_company_id'].includes(key)) expect(after[key], key).toEqual(value)
    }
    expect(await profile(db, other)).toEqual(otherBefore)
    for (const table of ['company_memberships', 'user_roles', 'user_permission_overrides', ...legacyTables]) {
      expect((await db.query(`select user_id from public.${table}`)).rows).toEqual([{ user_id: other }])
    }
    expect((await db.query('select user_id from auth.sessions')).rows).toEqual([{ user_id: other }])
    expect((await db.query('select user_id from auth.refresh_tokens')).rows).toEqual([{ user_id: other }])
    expect((await db.query('select id as user_id from auth.users order by id')).rows).toEqual([{ user_id: target }, { user_id: other }])
    expect((await db.query('select marker from public.account_closure_test_history')).rows).toHaveLength(2)
    expect((await db.query('select key from public.extension_data where user_id=$1', [target])).rows).toEqual([{ key: 'unrelated' }])
    expect((await db.query('select user_id from public.account_closure_test_profile_updates')).rows).toEqual([{ user_id: target }])
    expect((await db.query('select invited_user_id from public.company_invitations order by invited_user_id nulls first')).rows).toEqual([{ invited_user_id: null }, { invited_user_id: other }])
  })

  it.each(['canonical16', 'selectedOps26'] as const)('preserves function OID/owner/ACL/path/void and all %s columns', async shape => {
    const { db, beforeContract, beforeColumns, beforeImage } = await fixture(shape)
    expect(await contract(db)).toEqual(beforeContract)
    const afterImage = await installImage(db)
    const { prosrc: beforeBody, ...beforeMetadata } = beforeImage!
    const { prosrc: afterBody, ...afterMetadata } = afterImage!
    expect(afterBody).not.toBe(beforeBody)
    expect(afterMetadata).toEqual(beforeMetadata)
    expect(beforeContract).toMatchObject({ prosecdef: true, return_type: 'void', proargnames: ['target_user_id'], proconfig: ['search_path=public, auth, pg_catalog, pg_temp'] })
    expect((await db.query("select has_function_privilege('anon','public.anonymize_user_account(uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.anonymize_user_account(uuid)','EXECUTE') authenticated,has_function_privilege('service_role','public.anonymize_user_account(uuid)','EXECUTE') service")).rows[0]).toEqual({ anon: false, authenticated: true, service: true })
    expect((await db.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='user_profiles' order by ordinal_position")).rows).toEqual(beforeColumns)
    expect(beforeColumns).toHaveLength(shape === 'canonical16' ? 16 : 26)
  })

  it.each([
    { role: 'authenticated', uid: target, user: other },
    { role: 'authenticated', uid: null },
    { role: 'service_role', uid: null },
    { role: 'anon', uid: target },
  ] as const)('denies $role with uid=$uid and preserves every row', async options => {
    const { db } = await fixture('selectedOps26')
    const before = await state(db)
    await expect(invoke(db, options)).rejects.toMatchObject({ code: '42501' })
    expect(await state(db)).toEqual(before)
  })

  it('keeps service-role execution subject to the same self guard', async () => {
    const { db } = await fixture()
    await invoke(db, { role: 'service_role', uid: target })
    expect((await profile(db)).user_status).toBe('disabled')
  })

  it.each(['membership_role', 'role', 'role_key'] as const)('keeps the active owner blocker through %s', async field => {
    const { db } = await fixture('selectedOps26')
    await db.query('update public.company_memberships set membership_role=null,role=null,role_key=null where user_id=$1', [target])
    await db.query(`update public.company_memberships set ${field}='owner' where user_id=$1`, [target])
    const before = await state(db)
    await expect(invoke(db)).rejects.toMatchObject({ code: 'P0001', message: 'Active companies must be transferred or archived first' })
    expect(await state(db)).toEqual(before)
  })

  it('retains the historical null-status owner guard', async () => {
    const { db } = await fixture('selectedOps26')
    await db.exec('alter table public.company_memberships alter column status drop not null')
    await db.query("update public.company_memberships set membership_role='owner',status=null where user_id=$1", [target])
    await expect(invoke(db)).rejects.toMatchObject({ code: 'P0001' })
    expect((await profile(db)).user_status).toBe('active')
  })

  it.each(['archived', 'inactiveMembership'] as const)('allows the established owner closure after %s', async variant => {
    const { db } = await fixture()
    await db.query("update public.company_memberships set membership_role='owner' where user_id=$1", [target])
    if (variant === 'archived') await db.query('update public.companies set archived_at=now() where id=$1', [company])
    else await db.query("update public.company_memberships set status='disabled' where user_id=$1", [target])
    await invoke(db)
    expect((await profile(db)).user_status).toBe('disabled')
  })

  it('preserves deletion of a legacy nonnullable invitation link', async () => {
    const { db } = await fixture('canonical16', 'required')
    await invoke(db)
    expect((await db.query('select invited_user_id from public.company_invitations')).rows).toEqual([{ invited_user_id: other }])
  })

  it('skips historical invitations without an invited_user_id column', async () => {
    const { db } = await fixture('canonical16', 'noColumn')
    await invoke(db)
    expect((await db.query('select id from public.company_invitations')).rows).toHaveLength(2)
  })

  it('continues to tolerate absent optional legacy cleanup tables', async () => {
    const { db } = await fixture()
    for (const table of [...legacyTables, 'extension_data']) await db.exec(`drop table public.${table}`)
    await invoke(db)
    expect((await profile(db)).user_status).toBe('disabled')
  })

  it('rolls all earlier authorization/session cleanup back when the profile update fails', async () => {
    const { db } = await fixture('selectedOps26')
    await db.exec(`create function public.account_closure_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_profile_write_failure';end$$;
      create trigger account_closure_test_fail before update on public.user_profiles for each row execute function public.account_closure_test_fail()`)
    const before = await state(db)
    await expect(invoke(db)).rejects.toMatchObject({ code: 'P0001', message: 'synthetic_profile_write_failure' })
    expect(await state(db)).toEqual(before)
    for (const table of legacyTables) expect((await db.query(`select user_id from public.${table}`)).rows).toHaveLength(2)
    expect((await db.query('select id from public.company_invitations where invited_user_id=$1', [target])).rows).toHaveLength(1)
    expect((await db.query('select key from public.extension_data where user_id=$1', [target])).rows).toHaveLength(2)
  })

  it('does not mask a missing required profile column and rolls back cleanup', async () => {
    const { db } = await fixture('selectedOps26')
    await db.exec('alter table public.user_profiles drop column full_name')
    const before = await state(db)
    await expect(invoke(db)).rejects.toMatchObject({ code: '42703' })
    expect(await state(db)).toEqual(before)
  })

  it('fails closed when the existing signature is absent instead of creating a default-PUBLIC RPC', async () => {
    const { db } = await fixture()
    await db.exec('drop function public.anonymize_user_account(uuid)')
    const before = await state(db)
    await expect(db.exec(forward)).rejects.toMatchObject({ code: '42883' })
    expect((await db.query("select to_regprocedure('public.anonymize_user_account(uuid)')::text as fn")).rows).toEqual([{ fn: null }])
    expect(await state(db)).toEqual(before)
  })

  it('refuses an unqualified existing function body without changing function metadata or account data', async () => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await db.exec(predecessorFunction!.replace('Can only anonymize your own account', 'Synthetic unqualified closure implementation'))
    const before = await installImage(db)
    const beforeData = await state(db)
    await expect(db.exec(forward)).rejects.toMatchObject({ code: '55000' })
    expect(await installImage(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeData)
  })

  it.each([
    'security invoker', 'set search_path to pg_catalog', 'cost 123', 'strict', 'parallel safe',
  ])('refuses unexpected existing header %s with zero install effect', async alteration => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await db.exec(`alter function public.anonymize_user_account(uuid) ${alteration}`)
    const before = await installImage(db)
    const beforeData = await state(db)
    await expect(db.exec(forward)).rejects.toMatchObject({ code: '55000' })
    expect(await installImage(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeData)
  })

  it('preserves an existing owner and additional ACL rather than imposing a new ownership or grant policy', async () => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await db.exec(`create role account_closure_fixture_owner; create role account_closure_fixture_executor;
      alter function public.anonymize_user_account(uuid) owner to account_closure_fixture_owner;
      grant execute on function public.anonymize_user_account(uuid) to account_closure_fixture_executor`)
    const before = await installImage(db)
    await db.exec(forward)
    const after = await installImage(db)
    expect(after?.prosrc).not.toBe(before?.prosrc)
    expect({ ...after, prosrc: undefined }).toEqual({ ...before, prosrc: undefined })
  })

  it('installs as the ordinary function owner with schema CREATE and no system-catalog UPDATE privilege', async () => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await ordinaryFunctionOwner(db)
    const before = await installImage(db)
    const beforeData = await state(db)
    await asOrdinaryOwner(db, forward)
    const after = await installImage(db)
    expect(after?.prosrc).not.toBe(before?.prosrc)
    expect({ ...after, prosrc: undefined }).toEqual({ ...before, prosrc: undefined })
    expect(await state(db)).toEqual(beforeData)
  })

  it('refuses an unknown body as the ordinary function owner without install or data effects', async () => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await ordinaryFunctionOwner(db)
    await asOrdinaryOwner(db, predecessorFunction!.replace('Can only anonymize your own account', 'Synthetic unknown owner implementation'))
    const before = await installImage(db)
    const beforeData = await state(db)
    await expect(asOrdinaryOwner(db, forward)).rejects.toMatchObject({ code: '55000' })
    expect(await installImage(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeData)
  })

  it.each([
    'security invoker', 'set search_path to pg_catalog', 'cost 123', 'strict', 'parallel safe',
  ])('refuses header drift %s as the ordinary function owner without install or data effects', async alteration => {
    const { db } = await fixture('canonical16', 'nullable', false)
    await ordinaryFunctionOwner(db)
    await asOrdinaryOwner(db, `alter function public.anonymize_user_account(uuid) ${alteration}`)
    const before = await installImage(db)
    const beforeData = await state(db)
    await expect(asOrdinaryOwner(db, forward)).rejects.toMatchObject({ code: '55000' })
    expect(await installImage(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeData)
  })
})
