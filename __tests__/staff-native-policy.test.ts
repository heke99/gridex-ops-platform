import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { normalizeRoleKey } from '@/lib/rbac/roleKeys'
import { getRoleProfilePermissions, ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

const migration = readFileSync('supabase/migrations/20261004083640_staff_user_commands.sql', 'utf8')
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherCompany = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE TABLE companies(id uuid primary key,status text); CREATE TABLE company_memberships(id uuid,company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz,disabled_by uuid,status_reason text,updated_at timestamptz);
CREATE TABLE user_profiles(id uuid,user_status text); CREATE TABLE auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz); CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text); CREATE TABLE permissions(id uuid,key text,name text,is_active boolean);
CREATE TABLE integration_api_clients(id uuid,company_id uuid,status text,scopes text[]); CREATE TABLE canonical_tenant_access_role_mapping(role_key text,membership_role text,is_assignable boolean);
CREATE TABLE user_roles(id uuid,company_id uuid,user_id uuid,role text,role_id uuid,status text,is_active boolean); CREATE TABLE roles(id uuid,key text,name text);
CREATE TABLE canonical_command_results(company_id uuid,command_type text,idempotency_key text,request_hash text,request_payload jsonb,result_payload jsonb,actor_user_id uuid);
CREATE TABLE audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb,actor_type text,request_id text,correlation_id text,resource_type text,resource_id text);
CREATE TABLE company_invitations(company_id uuid,invited_user_id uuid,status text,revoked_at timestamptz);
CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION canonical_change_tenant_user_access(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION canonical_change_tenant_user_access_v1_unchecked(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION canonical_change_tenant_user_access_v2_unmapped(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION canonical_create_tenant_invitation(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
INSERT INTO canonical_tenant_access_role_mapping VALUES('company_admin','company_admin',true),('customer_service_agent','support',true),('finance_readonly','viewer',true);
INSERT INTO companies VALUES('${company}','active'),('${otherCompany}','active');
INSERT INTO auth.users(id) VALUES('${actor}'),('${target}');
INSERT INTO user_profiles VALUES('${actor}','active'),('${target}','active');
INSERT INTO company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at) VALUES('${company}','${actor}','company_admin','company_admin','active',true,now()),('${company}','${target}','customer_service_agent','support','active',true,now());
INSERT INTO integration_api_clients VALUES('${client}','${company}','active',ARRAY['staff_users.write']);
-- Legacy backfill fixtures: unique, ambiguous and explicit role.
INSERT INTO company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at) VALUES('${company}','11111111-1111-4111-8111-111111111111',null,'support','active',true,now()),('${company}','22222222-2222-4222-8222-222222222222',null,'support','active',true,now()),('${company}','33333333-3333-4333-8333-333333333333','finance_readonly','viewer','active',true,now());
INSERT INTO user_roles(company_id,user_id,role,status,is_active) VALUES('${company}','11111111-1111-4111-8111-111111111111','customer_service_agent','active',true),('${company}','22222222-2222-4222-8222-222222222222','customer_service_agent','active',true),('${company}','22222222-2222-4222-8222-222222222222','finance_readonly','active',true),('${company}','33333333-3333-4333-8333-333333333333','customer_service_agent','active',true);
`)
  await db.exec(migration)
}, 20_000)
afterAll(async () => { await db?.close() })

async function guard(patch: Record<string, unknown> = {}) {
  return db.query('SELECT public.gridex_assert_staff_command_v1($1::jsonb)', [JSON.stringify({ company_id: company, actor_user_id: actor, user_id: target, channel: 'staff_api', api_client_id: client, staff_operation: 'change_role', role_key: 'customer_service_agent', ...patch })])
}

describe('native staff policy on embedded PostgreSQL', () => {
  it('materializes exact role permission profiles used by the JS authorization model', async () => {
    for (const role of Object.keys(ROLE_PERMISSION_PROFILES)) {
      const result = await db.query<{ permissions: string[] }>('SELECT public.gridex_staff_role_profile_v1($1) AS permissions', [role])
      expect(result.rows[0].permissions).toEqual(getRoleProfilePermissions(role).sort())
    }
  })
  it('normalizes native roles exactly like the TS actor model', async () => {
    for (const role of [null, '', '  Company Admin ', 'companyadmin', 'company_owner', 'tenant_admin', 'bolagsansvarig', 'kundservice', 'support', 'Ekonomi', 'compliance_officer', 'platformsuperadmin', 'åäÖ']) {
      const result = await db.query<{ role: string | null }>('SELECT public.gridex_staff_normalize_role_v1($1) AS role', [role])
      expect(result.rows[0].role).toEqual(normalizeRoleKey(role))
    }
  })
  it('holds writes after the locked company has left an operational state', async () => {
    for (const status of ['paused', 'suspended', 'closed', 'archived']) {
      await db.exec(`UPDATE companies SET status='${status}' WHERE id='${company}'`)
      await expect(guard()).rejects.toMatchObject({ message: 'staff_company_not_operational' })
      await expect(guard({ staff_operation: 'invite' })).rejects.toMatchObject({ message: 'staff_company_not_operational' })
    }
    await db.exec(`UPDATE companies SET status='active' WHERE id='${company}'`)
  })
  it('backfills only the unique same-company mapped legacy role', async () => {
    const result = await db.query<{ user_id: string; role_key: string | null }>('SELECT user_id,role_key FROM company_memberships WHERE user_id IN ($1,$2,$3) ORDER BY user_id', ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'])
    expect(result.rows.map(row => row.role_key)).toEqual(['customer_service_agent', null, 'finance_readonly'])
  })
  it('does not elevate staff API identity through platform status or a foreign membership', async () => {
    await expect(guard({ company_id: otherCompany })).rejects.toMatchObject({ message: 'staff_permission_denied' })
    const result = await db.query<{ permissions: string[] }>('SELECT public.gridex_staff_actor_permissions_v1($1,$2,false) AS permissions', [otherCompany, actor])
    expect(result.rows[0].permissions).toEqual([])
  })
  it('denies self disable even when a global platform identity exists', async () => {
    await expect(guard({ staff_operation: 'disable', user_id: actor })).rejects.toMatchObject({ message: 'staff_self_disable_forbidden' })
  })
  it('holds the last company administrator on native role change', async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
    // A distinct users.write override actor can manage staff but cannot demote the only admin.
    await db.exec(`INSERT INTO user_permissions VALUES('${company}','${target}','users.write',null,'active',true,'allow');`)
    await expect(guard({ actor_user_id: target, user_id: actor, role_key: 'customer_service_agent' })).rejects.toMatchObject({ message: 'staff_last_admin_required' })
    await db.exec(`DELETE FROM user_permissions;`)
  })
  it('rejects roles above the same-company permission ceiling', async () => {
    await db.exec(`INSERT INTO user_permissions VALUES('${company}','${target}','users.write',null,'active',true,'allow');`)
    await expect(guard({ actor_user_id: target, role_key: 'company_admin', staff_operation: 'invite' })).rejects.toMatchObject({ message: 'staff_role_ceiling_exceeded' })
    await db.exec(`DELETE FROM user_permissions;`)
  })
  it('resolves role permissions plus company allow and deny overrides without global grants', async () => {
    await db.exec(`INSERT INTO user_permissions VALUES(null,'${target}','users.write',null,'active',true,'allow'),('${otherCompany}','${target}','users.write',null,'active',true,'allow'),('${company}','${target}','customers.read',null,'active',true,'deny');`)
    const result = await db.query<{ permissions: string[] }>('SELECT public.gridex_staff_actor_permissions_v1($1,$2,false) AS permissions', [company, target])
    expect(result.rows[0].permissions).not.toContain('users.write')
    expect(result.rows[0].permissions).not.toContain('customers.read')
    expect(result.rows[0].permissions).toContain('cases.write')
    await db.exec(`DELETE FROM user_permissions;`)
  })
  it('rejects a client that belongs to another company', async () => {
    await db.exec(`UPDATE integration_api_clients SET company_id='${otherCompany}' WHERE id='${client}'`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_permission_denied' })
    await db.exec(`UPDATE integration_api_clients SET company_id='${company}' WHERE id='${client}'`)
  })
  it('refuses unknown or platform membership keys before applying allow overrides', async () => {
    await db.exec(`INSERT INTO user_permissions VALUES('${company}','${actor}','users.write',null,'active',true,'allow');`)
    for (const role of ['unknown_role', 'customer', 'super_admin', 'platform_admin', 'white_label_platform_admin']) {
      await db.exec(`UPDATE company_memberships SET role_key='${role}' WHERE company_id='${company}' AND user_id='${actor}'`)
      await expect(guard()).rejects.toMatchObject({ message: 'staff_permission_denied' })
    }
    await db.exec(`UPDATE company_memberships SET role_key='company_admin' WHERE company_id='${company}' AND user_id='${actor}'; DELETE FROM user_permissions;`)
  })
  it('denies globally suspended profiles even when their membership remains active', async () => {
    await db.exec(`UPDATE user_profiles SET user_status='suspended' WHERE id='${actor}'`)
    await expect(guard()).rejects.toMatchObject({ message: 'staff_permission_denied' })
    await db.exec(`UPDATE user_profiles SET user_status='active' WHERE id='${actor}'`)
  })
})
