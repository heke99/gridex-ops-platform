import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { getRoleProfilePermissions, ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

const policy = readFileSync('supabase/migrations/20261004083640_staff_user_commands.sql', 'utf8')
const oldGuard = readFileSync('supabase/migrations/20261004084204_staff_customer_write_attribution.sql', 'utf8')
const repair = readFileSync('supabase/migrations/20261004093111_staff_write_actor_guard.sql', 'utf8')
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text,is_active boolean);
    CREATE TABLE company_memberships(company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,email text,user_status text);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,is_anonymous boolean,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE permissions(id uuid PRIMARY KEY,key text,name text,is_active boolean);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,name text,key_prefix text,secret_hash text,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    -- The legacy policy permits a platform/global grant. The new guard must use
    -- the real S2 exact-company helper loaded below instead of either fallback.
    CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
    CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
  `)
  await db.exec(policy.slice(0, policy.indexOf('CREATE FUNCTION public.gridex_assert_staff_command_v1')) + 'COMMIT;')
  await db.exec(oldGuard.slice(0, oldGuard.indexOf('CREATE FUNCTION public.gridex_staff_customer_search_v1')) + 'COMMIT;')
  await db.exec(repair)
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,status,is_active) VALUES('${company}','active',true),('${foreignCompany}','active',true);
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO user_profiles(id,user_status) VALUES('${actor}','active');
    INSERT INTO company_memberships VALUES('${company}','${actor}','company_admin','company_admin','active',true,now());
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_customers.write','staff_cases.write']);`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function guard(permission = 'customers.write', companyId = company) {
  await db.exec('SAVEPOINT assertion')
  try {
    const result = await db.query('SELECT public.gridex_staff_assert_write_actor_v1($1,$2,$3,$4)', [companyId, actor, client, permission])
    await db.exec('RELEASE SAVEPOINT assertion')
    return result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT assertion; RELEASE SAVEPOINT assertion')
    throw error
  }
}

describe('staff write actor guard uses the shared exact-company policy', () => {
  it.each(['customers.write', 'masterdata.write', 'cases.write'])('accepts active staff with the explicit mapped scope for %s', async (permission) => {
    await expect(guard(permission)).resolves.toMatchObject({ rows: [{}] })
  })

  it.each([
    ['UPDATE company_memberships SET accepted_at=NULL', 'staff_api_actor_inactive'],
    ["UPDATE company_memberships SET status='disabled',is_active=false", 'staff_api_actor_inactive'],
    ["UPDATE user_profiles SET user_status='disabled'", 'staff_api_actor_inactive'],
    ['UPDATE auth.users SET deleted_at=now()', 'staff_api_actor_inactive'],
    ["UPDATE auth.users SET banned_until=now()+interval '1 hour'", 'staff_api_actor_inactive'],
    ["UPDATE companies SET status='paused'", 'staff_api_actor_inactive'],
    ['UPDATE companies SET is_active=false', 'staff_api_actor_inactive'],
    ['UPDATE integration_api_clients SET revoked_at=now()', 'staff_api_client_not_in_scope'],
    ['UPDATE integration_api_clients SET deleted_at=now()', 'staff_api_client_not_in_scope'],
    ["UPDATE integration_api_clients SET status='revoked'", 'staff_api_client_not_in_scope'],
    ["UPDATE integration_api_clients SET expires_at=now()-interval '1 second'", 'staff_api_client_not_in_scope'],
    ["UPDATE integration_api_clients SET scopes=ARRAY['*','staff_cases.write']", 'staff_api_client_not_in_scope'],
  ])('denies changed eligibility: %s', async (sql, message) => {
    await db.exec(sql)
    await expect(guard()).rejects.toMatchObject({ code: '42501', message })
  })

  it('requires the correct scope independently for every permission and rejects unknown permissions', async () => {
    await db.exec("UPDATE integration_api_clients SET scopes=ARRAY['staff_cases.write']")
    await expect(guard('cases.write')).resolves.toBeDefined()
    for (const permission of ['customers.write', 'masterdata.write']) {
      await expect(guard(permission)).rejects.toMatchObject({ code: '42501', message: 'staff_api_client_not_in_scope' })
    }
    await db.exec("UPDATE integration_api_clients SET scopes=ARRAY['staff_customers.write']")
    await expect(guard('cases.write')).rejects.toMatchObject({ code: '42501', message: 'staff_api_client_not_in_scope' })
    for (const permission of ['', 'users.write', 'cases.read', '*', 'CUSTOMERS.WRITE']) {
      await expect(guard(permission)).rejects.toMatchObject({ code: '42501', message: 'staff_api_actor_not_authorized' })
    }
  })

  it('matches every recognized role profile without platform fallback', async () => {
    for (const role of Object.keys(ROLE_PERMISSION_PROFILES)) {
      await db.query('UPDATE company_memberships SET role_key=$1', [role])
      for (const permission of ['customers.write', 'masterdata.write', 'cases.write']) {
        const allowed = !['super_admin', 'white_label_platform_admin'].includes(role) && getRoleProfilePermissions(role).includes(permission)
        if (allowed) await expect(guard(permission)).resolves.toBeDefined()
        else await expect(guard(permission)).rejects.toMatchObject({ code: '42501', message: 'staff_api_actor_not_authorized' })
      }
    }
  })

  it('ignores global/foreign grants, applies own-company allow and lets deny win', async () => {
    await db.exec(`UPDATE company_memberships SET role_key='finance_readonly';
      INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active) VALUES
      (NULL,'${actor}','customers.write','allow','active',true),
      ('${foreignCompany}','${actor}','customers.write','allow','active',true);`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      VALUES('${company}','${actor}','customers.write','allow','active',true)`)
    await expect(guard()).resolves.toBeDefined()
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      VALUES('${company}','${actor}','customers.write','deny','active',true)`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
  })

  it('cannot turn an unknown or platform role into staff with direct grants', async () => {
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      VALUES('${company}','${actor}','customers.write','allow','active',true)`)
    for (const role of ['unknown_role', 'super_admin', 'platform_admin', 'white_label_platform_admin', 'customer', null]) {
      await db.query('UPDATE company_memberships SET role_key=$1', [role])
      await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    }
  })

  it('uses active permission catalog grants and ignores inactive overrides', async () => {
    await db.exec(`UPDATE company_memberships SET role_key='finance_readonly';
      INSERT INTO permissions VALUES('${client}','customers.write','Customer write',true);
      INSERT INTO user_permissions(company_id,user_id,permission_id,effect,status,is_active)
      VALUES('${company}','${actor}','${client}','allow','inactive',true)`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    await db.exec("UPDATE user_permissions SET status='active',is_active=false")
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
    await db.exec('UPDATE user_permissions SET is_active=true')
    await expect(guard()).resolves.toBeDefined()
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_id,effect,status,is_active)
      VALUES('${company}','${actor}','${client}','deny','active',true)`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_actor_not_authorized' })
  })

  it('requires both membership and client to belong to the explicit company', async () => {
    await expect(guard('customers.write', foreignCompany)).rejects.toMatchObject({ message: 'staff_api_actor_inactive' })
    await db.query('UPDATE integration_api_clients SET company_id=$1', [foreignCompany])
    await expect(guard()).rejects.toMatchObject({ message: 'staff_api_client_not_in_scope' })
  })

  it('keeps the service-only RPC ACL without granting service_role Auth table access', async () => {
    const result = await db.query<{ anon: boolean, authenticated: boolean, service: boolean, auth_select: boolean, definer: boolean }>(`SELECT
      has_function_privilege('anon','public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)','EXECUTE') AS service,
      has_table_privilege('service_role','auth.users','SELECT') AS auth_select,
      (SELECT prosecdef FROM pg_proc WHERE oid='public.gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text)'::regprocedure) AS definer`)
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true, auth_select: false, definer: true })
    await db.exec('SET LOCAL ROLE service_role')
    await expect(guard()).resolves.toBeDefined()
  })

  it('executes the full native regression script on embedded PostgreSQL', async () => {
    await db.exec('ROLLBACK')
    const script = readFileSync('scripts/staff-write-actor-guard-regression.sql', 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/m, '')
    await expect(db.exec(script)).resolves.toBeDefined()
    // The script owns its rollback. Restore the per-test outer transaction.
    await db.exec('BEGIN')
  })
})
