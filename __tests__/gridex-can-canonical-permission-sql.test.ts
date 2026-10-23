import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// gridex_can must answer through gridex_has_permission (account status +
// canonical permission source) and never through the legacy override tables.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = id(1)
let db: PGlite

function schemaFunction(name: string) {
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  const match = schema.match(new RegExp(`^CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`, 'm'))
  if (!match) throw new Error(`${name} not found in schema.sql`)
  return match[0]
}

async function can(permission: string | null) {
  const { rows } = await db.query<{ ok: boolean }>('select public.gridex_can($1) as ok', [permission])
  return rows[0]?.ok
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('fixture.uid',true),'')::uuid $$;
    create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz);
    create table public.user_profiles(id uuid primary key, user_status text);
    create table public.fixture_permissions(user_id uuid, permission text);
    create table public.fixture_platform_admins(user_id uuid);
    create table public.user_permission_overrides(user_id uuid, permission_key text, is_active boolean, effect text, valid_from timestamptz, valid_to timestamptz);
    create function public.gridex_get_user_permissions(p_user_id uuid) returns text[] language sql stable as
      $$ select coalesce(array_agg(permission),'{}') from public.fixture_permissions where user_id=p_user_id $$;
    create function public.gridex_user_is_platform_admin() returns boolean language sql stable as
      $$ select exists(select 1 from public.fixture_platform_admins where user_id=auth.uid()) $$;`)
  await db.exec(schemaFunction('gridex_has_permission'))
  await db.exec(readFileSync('supabase/migrations/20261023130000_gridex_can_canonical_permission_source.sql', 'utf8'))
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`truncate auth.users, public.user_profiles, public.fixture_permissions, public.fixture_platform_admins, public.user_permission_overrides;
    select set_config('fixture.uid','${user}',false);`)
  await db.query('insert into auth.users values($1,null,null,now())', [user])
  await db.query("insert into public.user_profiles values($1,'active')", [user])
})

describe('gridex_can uses the canonical permission source', () => {
  it('grants a permission the active user holds', async () => {
    await db.query("insert into public.fixture_permissions values($1,'customers.read')", [user])
    expect(await can('customers.read')).toBe(true)
    expect(await can('customers.write')).toBe(false)
  })

  it('denies a held permission to a banned, deleted, unconfirmed or inactive account', async () => {
    await db.query("insert into public.fixture_permissions values($1,'customers.read')", [user])
    for (const change of [
      "update auth.users set banned_until=now()+interval '1 day'",
      'update auth.users set deleted_at=now()',
      'update auth.users set email_confirmed_at=null',
    ]) {
      await db.exec(change)
      expect(await can('customers.read')).toBe(false)
      await db.exec('update auth.users set banned_until=null, deleted_at=null, email_confirmed_at=now()')
    }
    await db.exec("update public.user_profiles set user_status='disabled'")
    expect(await can('customers.read')).toBe(false)
  })

  it('ignores a legacy allow override that the canonical source does not grant', async () => {
    await db.query("insert into public.user_permission_overrides values($1,'admin.access',true,'allow',null,null)", [user])
    expect(await can('admin.access')).toBe(false)
  })

  it('answers false without a caller or permission, and true for a platform admin', async () => {
    expect(await can(null)).toBe(false)
    await db.exec("select set_config('fixture.uid','',false)")
    expect(await can('customers.read')).toBe(false)
    await db.exec(`select set_config('fixture.uid','${user}',false)`)
    await db.query('insert into public.fixture_platform_admins values($1)', [user])
    expect(await can('anything.at.all')).toBe(true)
  })

  it('keeps the production body byte-identical', async () => {
    const { rows } = await db.query<{ sha: string }>(
      "select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as sha from pg_proc where oid='public.gridex_can(text)'::regprocedure")
    expect(rows[0]?.sha).toBe('e77c677e4f30a51f62f0eef7072d99a09ff673304a36cacc31d92b1d589c3adb')
  })
})
