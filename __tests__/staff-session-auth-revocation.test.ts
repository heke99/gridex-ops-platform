// ops-api-review: F30 (native session guard; based on evidence/remaining-auth-native-proof.mjs)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const user = '11111111-1111-4111-8111-111111111111'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.user_profiles(id uuid primary key, user_status text, disabled_at timestamptz);
    create table public.companies(id uuid primary key, status text);
    create table public.company_memberships(company_id uuid, user_id uuid, status text, is_active boolean);
    create table public.customers(id serial primary key, company_id uuid);
    grant usage on schema public, auth to authenticated;
    grant select on public.customers to authenticated;
  `)
  await db.exec(fs.readFileSync('supabase/migrations/20261009110000_ops_api_session_guard_auth_revocation.sql', 'utf8'))
  await db.exec(`
    create function public.gridex_user_company_ids() returns setof uuid language sql stable security definer set search_path to 'public','auth','pg_temp' as $$
      select membership.company_id from public.company_memberships membership
      join public.companies company on company.id = membership.company_id
      where public.gridex_is_current_session_allowed() and membership.user_id = (select auth.uid())
        and coalesce(membership.status, 'active') = 'active' and coalesce(membership.is_active, true)
        and company.status in ('active', 'onboarding', 'paused') $$;
    alter table public.customers enable row level security;
    create policy customers_tenant on public.customers for select to authenticated
      using (company_id in (select public.gridex_user_company_ids()));
    insert into companies values ('${tenantA}','active'),('${tenantB}','active');
    insert into auth.users values ('${user}', null, null);
    insert into user_profiles values ('${user}', 'active', null);
    insert into company_memberships values ('${tenantA}', '${user}', 'active', true);
    insert into customers(company_id) values ('${tenantA}'),('${tenantB}');
  `)
})
afterAll(async () => { await db?.close() })

async function visible(setup: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.exec(setup)
    await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);`)
    const r = await tx.query<{ n: number }>('select count(*)::int n from public.customers')
    await tx.rollback()
    return r.rows[0].n
  }).catch((error) => { throw error })
}

describe('F30: Auth revocation removes own-tenant RLS visibility with an old JWT', () => {
  it('active Auth/profile/membership sees exactly its own tenant customer', async () => {
    expect(await visible('select 1')).toBe(1)
  })
  it('Auth-only ban hides the tenant', async () => {
    expect(await visible(`update auth.users set banned_until = now() + interval '1 day' where id = '${user}'`)).toBe(0)
  })
  it('expired ban restores access', async () => {
    expect(await visible(`update auth.users set banned_until = now() - interval '1 day' where id = '${user}'`)).toBe(1)
  })
  it('Auth soft-delete hides the tenant', async () => {
    expect(await visible(`update auth.users set deleted_at = now() where id = '${user}'`)).toBe(0)
  })
  it('hard-deleted Auth user hides the tenant', async () => {
    expect(await visible(`delete from auth.users where id = '${user}'`)).toBe(0)
  })
  it('profile disable and membership revoke still deny', async () => {
    expect(await visible(`update user_profiles set user_status = 'disabled' where id = '${user}'`)).toBe(0)
    expect(await visible(`update company_memberships set status = 'revoked' where user_id = '${user}'`)).toBe(0)
  })
})
