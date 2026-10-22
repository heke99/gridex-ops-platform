import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'

// Actual immutable routines; no generated schema, private files or runtime Git.
const donor = readFileSync('supabase/migrations/20261019180400_db05_qualified_audit19_cleanup.sql', 'utf8')
const foundation = readFileSync('supabase/migrations/20260522_db1_schema_repair_backfill_foundation.sql', 'utf8')
const contextDonor = readFileSync('supabase/migrations/20260727040000_contract_security_energy_direction_api_completion.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261020190908_audit19_schema_named_column_compatibility.sql', 'utf8')
const target = 'gridex_ediel_retention.audit19_schema_v1()'
const oldHash = '3921810b5bcf315193fec96cd2cf94a34a52e71a9c33889efec09472b593d07a'
type Row = Record<string, unknown>
type Order = 'canonical' | 'production' | 'permuted'
const opened: PGlite[] = []

function actualFunction(name: string) {
  const escaped = name.replaceAll('.', '\\.')
  const sql = donor.match(new RegExp(`CREATE FUNCTION ${escaped}\\([\\s\\S]*?END\\$\\$;`))?.[0]
  if (!sql) throw new Error(`Immutable audit19 routine missing: ${name}`)
  return sql
}
const originalGuard = actualFunction('gridex_ediel_retention.audit19_schema_v1')
const actualHashFunction = actualFunction('gridex_ediel_retention.audit19_hash_v1')

// Ten original columns come from immutable foundation SQL, eight context
// fields from its immutable normalizer migration. updated_at is the existing
// nullable timestamp/default in the declared canonical/selected-PROD19 profile.
// Only physical order differs. These are disposable SQL schema ports, not data.
const baseColumns = foundation.match(/create table if not exists public\.audit_logs \(([\s\S]*?)\n\);/)?.[1]
if (!baseColumns) throw new Error('Immutable audit foundation missing')
const columns = new Map(baseColumns.trim().split(',\n').map(line => {
  const definition = line.trim()
  return [definition.split(' ')[0], definition]
}))
columns.set('updated_at', 'updated_at timestamptz default now()')
const contextColumns = contextDonor.match(/alter table public\.audit_logs\n([\s\S]*?);/)?.[1]
if (!contextColumns) throw new Error('Immutable audit context columns missing')
for (const match of contextColumns.matchAll(/add column if not exists (\w+) (\w+)/g)) {
  const required = ['actor_type', 'request_id', 'correlation_id', 'resource_type', 'resource_id'].includes(match[1])
  columns.set(match[1], `${match[1]} ${match[2]}${required ? ' not null' : ''}`)
}
const canonicalOrder = ['id', 'company_id', 'actor_user_id', 'entity_type', 'entity_id', 'action', 'old_values', 'new_values', 'metadata', 'created_at', 'updated_at', 'actor_type', 'system_actor', 'request_id', 'correlation_id', 'resource_type', 'resource_id', 'previous_status', 'new_status']
// Selected-PROD catalog DSF02, collected2026-10-20, company_id attnum10.
const productionOrder = ['id', 'actor_user_id', 'entity_type', 'entity_id', 'action', 'old_values', 'new_values', 'metadata', 'created_at', 'company_id', 'updated_at', 'actor_type', 'system_actor', 'request_id', 'correlation_id', 'resource_type', 'resource_id', 'previous_status', 'new_status']

async function image(db: PGlite) {
  return (await db.query<{ image: Row }>(`select to_jsonb(p) as image from pg_catalog.pg_proc p
    where oid=to_regprocedure('${target}')`)).rows[0]?.image ?? null
}
async function state(db: PGlite) {
  return (await db.query<{ state: Row }>(`select jsonb_build_object(
    'memberships',(select jsonb_agg(to_jsonb(m) order by oid) from pg_catalog.pg_auth_members m),
    'roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by oid) from pg_catalog.pg_roles r),
    'namespaces',(select jsonb_agg(to_jsonb(n) order by oid) from pg_catalog.pg_namespace n where nspname in('public','gridex_ediel_retention')),
    'relation',(select to_jsonb(c) from pg_catalog.pg_class c where oid='public.audit_logs'::regclass),
    'columns',(select jsonb_agg(to_jsonb(a) order by attnum) from pg_catalog.pg_attribute a where attrelid='public.audit_logs'::regclass),
    'constraints',(select jsonb_agg(to_jsonb(c) order by oid) from pg_catalog.pg_constraint c where conrelid='public.audit_logs'::regclass),
    'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_catalog.pg_policy p where polrelid='public.audit_logs'::regclass),
    'triggers',(select jsonb_agg(to_jsonb(t) order by oid) from pg_catalog.pg_trigger t where tgrelid='public.audit_logs'::regclass),
    'data',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a)) as state`)).rows[0].state
}
async function superFixture(db: PGlite, sql: string) {
  await db.exec('set session authorization fixture_super')
  try { await db.exec(sql) } finally { await db.exec('set session authorization postgres') }
}
async function install(db: PGlite) {
  try { await db.exec(forward) } catch (error) {
    // Handles both a single atomic DO and explicit BEGIN wrappers. No replay.
    await db.exec('rollback')
    throw error
  }
}

async function fixture(order: Order = 'production') {
  const db = new PGlite()
  opened.push(db)
  await db.exec(`create role fixture_super superuser login;
    set session authorization fixture_super;
    alter role postgres rename to supabase_admin;
    create role postgres login nosuperuser inherit createrole bypassrls;
    create role anon; create role authenticated; create role service_role;
    create role gridex_ediel_retention_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication bypassrls;
    create schema gridex_ediel_retention authorization gridex_ediel_retention_owner;
    grant usage on schema gridex_ediel_retention to postgres;
    grant gridex_ediel_retention_owner to postgres with admin true,inherit false,set false granted by supabase_admin;
    set session authorization postgres;
    grant gridex_ediel_retention_owner to postgres with admin false,inherit false,set true granted by postgres;
    set session authorization fixture_super;
    create table public.companies(id uuid primary key)`)
  const names = order === 'canonical' ? canonicalOrder : order === 'production' ? productionOrder : [...canonicalOrder].reverse()
  await db.exec(`create table public.audit_logs(${names.map(name => {
    const definition = columns.get(name)
    if (!definition) throw new Error(`Missing declared audit column: ${name}`)
    return definition
  }).join(',')},constraint audit_logs_actor_type_check check(actor_type in('user','system')),
    constraint audit_logs_system_actor_check check(actor_user_id is not null or nullif(system_actor,'') is not null));
    alter table public.audit_logs enable row level security;
    alter table public.audit_logs owner to postgres;
    create policy fixture_read on public.audit_logs for select to authenticated using(false);
    grant select on public.audit_logs to authenticated;
    ${originalGuard}
    ${actualHashFunction}
    alter function ${target} owner to gridex_ediel_retention_owner;
    revoke all on function ${target} from public,anon,authenticated,service_role;
    alter function gridex_ediel_retention.audit19_hash_v1(public.audit_logs) owner to gridex_ediel_retention_owner;
    revoke all on function gridex_ediel_retention.audit19_hash_v1(public.audit_logs) from public,anon,authenticated,service_role;
    insert into public.companies values('22222222-2222-4222-8222-222222222222');
    insert into public.audit_logs(id,company_id,actor_user_id,entity_type,entity_id,action,metadata,created_at,updated_at,actor_type,request_id,correlation_id,resource_type,resource_id)
    values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
      'retention_decision_original','44444444-4444-4444-8444-444444444444','ediel.retention.decision_original_submitted','{"fixture":true}',
      '2020-01-02T03:04:05.123456Z','2020-02-03T04:05:06.654321Z','user','request','correlation','retention_decision_original','44444444-4444-4444-8444-444444444444');
    set session authorization postgres`)
  expect((await db.query(`select current_user,session_user,rolsuper,rolcreaterole,
    pg_has_role('postgres','gridex_ediel_retention_owner','USAGE') as inherits
    from pg_catalog.pg_roles where rolname=current_user`)).rows).toEqual([
    { current_user: 'postgres', session_user: 'postgres', rolsuper: false, rolcreaterole: true, inherits: false },
  ])
  expect(createHash('sha256').update(String((await image(db))?.prosrc)).digest('hex')).toBe(oldHash)
  return db
}
afterEach(async () => { for (const db of opened.splice(0)) await db.close() })

// Hand-declared JSONB text for the complete synthetic named row, with explicit
// UTC microseconds. Expected value does not call the production hash builder.
const canonicalJson = '{"id": "11111111-1111-4111-8111-111111111111", "action": "ediel.retention.decision_original_submitted", "metadata": {"fixture": true}, "entity_id": "44444444-4444-4444-8444-444444444444", "actor_type": "user", "company_id": "22222222-2222-4222-8222-222222222222", "created_at": "2020-01-02T03:04:05.123456Z", "new_status": null, "new_values": null, "old_values": null, "request_id": "request", "updated_at": "2020-02-03T04:05:06.654321Z", "entity_type": "retention_decision_original", "resource_id": "44444444-4444-4444-8444-444444444444", "system_actor": null, "actor_user_id": "33333333-3333-4333-8333-333333333333", "resource_type": "retention_decision_original", "correlation_id": "correlation", "previous_status": null}'
const expectedHash = createHash('sha256').update(`audit19_canonical_utc_v1:${canonicalJson}`).digest('hex')
async function realHash(db: PGlite) {
  await db.exec('set role gridex_ediel_retention_owner')
  try {
    // The fixture grants row SELECT only here; the migration must not add it.
    return (await db.query<{ hash: string }>('select gridex_ediel_retention.audit19_hash_v1(a) as hash from public.audit_logs a')).rows[0].hash
  } finally { await db.exec('reset role') }
}

describe('audit19 exact named schema compatibility with complete actual SQL installer', () => {
  it('proves the original guard accepts canonical order and rejects the observed production order', async () => {
    const canonical = await fixture('canonical')
    await superFixture(canonical, 'grant select on public.audit_logs to gridex_ediel_retention_owner')
    expect(await realHash(canonical)).toBe(expectedHash)
    const production = await fixture('production')
    await superFixture(production, 'grant select on public.audit_logs to gridex_ediel_retention_owner')
    await expect(realHash(production)).rejects.toThrow('audit19_exact_schema_required')
  }, 30_000)

  for (const order of ['canonical', 'production', 'permuted'] as const) {
    it(`installs for ${order} order under the actual non-super owner bridge and preserves the complete audit relation`, async () => {
      const db = await fixture(order)
      const before = await state(db)
      const beforeImage = await image(db)
      await install(db)
      const afterImage = await image(db)
      const { prosrc: oldSource, ...oldMetadata } = beforeImage!
      const { prosrc: newSource, ...newMetadata } = afterImage!
      expect(newSource).not.toBe(oldSource)
      expect(newMetadata).toEqual(oldMetadata)
      expect(await state(db)).toEqual(before)
      await superFixture(db, 'grant select on public.audit_logs to gridex_ediel_retention_owner')
      expect(await realHash(db)).toBe(expectedHash)
      await db.exec("set timezone='America/Los_Angeles'")
      expect(await realHash(db)).toBe(expectedHash)
    })
  }

  it('performs a known-new no-op without function DDL or rewriting role memberships', async () => {
    const db = await fixture()
    await install(db)
    await superFixture(db, `create function public.fixture_forbid_function_ddl() returns event_trigger language plpgsql as $$
      begin raise exception 'unexpected_function_ddl';end$$;
      create event trigger fixture_forbid_function_ddl on ddl_command_end when tag in('CREATE FUNCTION','ALTER FUNCTION')
      execute function public.fixture_forbid_function_ddl()`)
    const before = await image(db)
    const physical = async () => (await db.query(`select oid,xmin::text from pg_catalog.pg_auth_members order by oid`)).rows
    const memberships = await physical()
    await install(db)
    expect(await image(db)).toEqual(before)
    expect(await physical()).toEqual(memberships)
  })

  it('validates the complete header even when the replacement body is already present', async () => {
    const db = await fixture()
    await install(db)
    await superFixture(db, `alter function ${target} cost 99`)
    const before = await image(db)
    const beforeState = await state(db)
    await expect(install(db)).rejects.toThrow('audit19_named_schema_exact_function_required')
    expect(await image(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeState)
  })

  for (const [label, drift] of [
    ['unknown body', `create or replace function ${target} returns void language plpgsql set search_path=pg_catalog as $$begin null;end$$`],
    ['security definer', `alter function ${target} security definer`],
    ['search path', `alter function ${target} set search_path=public`],
    ['extra configuration', `alter function ${target} set enable_seqscan=off`],
    ['owner', `alter function ${target} owner to postgres`],
    ['public execution', `grant execute on function ${target} to public`],
    ['grant option', `grant execute on function ${target} to authenticated with grant option`],
    ['cost', `alter function ${target} cost 99`],
    ['strictness', `alter function ${target} strict`],
    ['return type', `drop function ${target};${originalGuard.replace('RETURNS void', 'RETURNS integer')};
      alter function ${target} owner to gridex_ediel_retention_owner;
      revoke all on function ${target} from public,anon,authenticated,service_role`],
    ['missing function', `drop function ${target}`],
  ] as const) {
    it(`rejects ${label} before touching function, roles, namespaces or audit data`, async () => {
      const db = await fixture()
      await superFixture(db, drift)
      const before = await image(db)
      const beforeState = await state(db)
      await expect(install(db)).rejects.toThrow('audit19_named_schema_exact_function_required')
      expect(await image(db)).toEqual(before)
      expect(await state(db)).toEqual(beforeState)
    })
  }

  it('rejects an unqualified role membership profile without persistent side effects', async () => {
    const db = await fixture()
    await superFixture(db, 'create role fixture_foreign;grant gridex_ediel_retention_owner to fixture_foreign')
    const before = await image(db)
    const beforeState = await state(db)
    await expect(install(db)).rejects.toThrow('db05_qualified_non_super_migration_owner_profile_required')
    expect(await image(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeState)
  })

  it('rolls back the replacement and temporary inheritance when a real DDL trigger changes its ACL late', async () => {
    const db = await fixture()
    await superFixture(db, `create function public.fixture_late_acl_drift() returns event_trigger language plpgsql security definer set search_path=pg_catalog as $$
      begin if exists(select from pg_event_trigger_ddl_commands() where objid=to_regprocedure('${target}')::oid) then
        grant execute on function ${target} to authenticated;end if;end$$;
      create event trigger fixture_late_acl_drift on ddl_command_end when tag in('CREATE FUNCTION')
      execute function public.fixture_late_acl_drift()`)
    const before = await image(db)
    const beforeState = await state(db)
    await expect(install(db)).rejects.toThrow('audit19_named_schema_function_metadata_must_restore')
    expect(await image(db)).toEqual(before)
    expect(await state(db)).toEqual(beforeState)
  })

  for (const [label, drift] of [
    ['extra column', 'alter table public.audit_logs add column fixture_extra text'],
    ['missing column', 'alter table public.audit_logs drop column previous_status'],
    ['renamed column', 'alter table public.audit_logs rename previous_status to fixture_previous'],
    ['wrong type', 'alter table public.audit_logs alter previous_status type integer using null::integer'],
    ['domain substitution', 'create domain public.fixture_text as text;alter table public.audit_logs alter previous_status type public.fixture_text'],
  ] as const) {
    it(`retains the real guard rejection for ${label}`, async () => {
      const db = await fixture()
      await install(db)
      await superFixture(db, `${drift};grant select on public.audit_logs to gridex_ediel_retention_owner`)
      await expect(realHash(db)).rejects.toThrow('audit19_exact_schema_required')
    })
  }
})
