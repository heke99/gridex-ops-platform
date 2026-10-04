import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { ROLE_PERMISSION_PROFILES } from '@/lib/admin/accessModel'

const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const foreignStaff = '99999999-9999-4999-8999-999999999999'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const customer = '11111111-1111-4111-8111-111111111111'
const caseId = '22222222-2222-4222-8222-222222222222'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text,is_active boolean);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,is_anonymous boolean,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,email text,user_status text);
    CREATE TABLE company_memberships(company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz);
    CREATE TABLE permissions(id uuid,key text,name text,is_active boolean);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,name text,key_prefix text,secret_hash text,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid,full_name text,status text);
    CREATE TABLE customer_cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,title text,case_type text DEFAULT 'other',source text,metadata jsonb,billing_blocked boolean DEFAULT false,billing_manual_review boolean DEFAULT false,cancellation_required boolean DEFAULT false,assigned_to uuid,updated_by uuid,updated_at timestamptz,status text DEFAULT 'open');
    CREATE TABLE customer_case_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_case_id uuid,customer_id uuid,event_type text,event_status text,message text,payload jsonb,created_by uuid);
    CREATE TABLE audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb);
    CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
  `)
  const policy = file('20261004083640_staff_user_commands.sql')
  await db.exec(policy.slice(0, policy.indexOf('CREATE FUNCTION public.gridex_assert_staff_command_v1')) + 'COMMIT;')
  await db.exec(file('20261004093111_staff_write_actor_guard.sql'))
  const cases = file('20261004084206_staff_case_write_attribution.sql')
  const start = cases.indexOf('CREATE FUNCTION public.gridex_assign_customer_case')
  const end = cases.indexOf('CREATE FUNCTION public.gridex_update_customer_case_status_with_actor_v1', start)
  await db.exec(cases.slice(start, end))
  await db.exec(file('20261004100849_staff_case_assignee_eligibility.sql'))
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,status,is_active) VALUES('${company}','active',true),('${foreignCompany}','active',true);
    INSERT INTO auth.users(id) VALUES('${actor}'),('${target}'),('${foreignStaff}');
    INSERT INTO user_profiles(id,user_status) VALUES('${actor}','active'),('${target}','active'),('${foreignStaff}','active');
    INSERT INTO company_memberships VALUES('${company}','${actor}','company_admin','company_admin','active',true,now()),
      ('${company}','${target}','customer_service_agent','support','active',true,now()),
      ('${foreignCompany}','${foreignStaff}','customer_service_agent','support','active',true,now());
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_cases.write']);
    INSERT INTO customers(id,company_id) VALUES('${customer}','${company}');
    INSERT INTO customer_cases(id,company_id,customer_id,title,source,metadata) VALUES('${caseId}','${company}','${customer}','Synthetic support','tenant_support_staff_api','{"support_case":true}');`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function assign(assignee: string | null = target) {
  await db.exec('SAVEPOINT assignee_assertion')
  try {
    const result = await db.query<{ result: { assigned_to: string | null } }>('SELECT public.gridex_assign_customer_case($1,$2,$3,$4,$5,$6) AS result', [company, caseId, actor, assignee, client, 'tenant_support_staff_api'])
    await db.exec('RELEASE SAVEPOINT assignee_assertion')
    return result.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT assignee_assertion; RELEASE SAVEPOINT assignee_assertion')
    throw error
  }
}

describe('actual staff assignment RPC requires an eligible same-company staff account', () => {
  it.each([
    ["UPDATE company_memberships SET role_key='customer' WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET role_key='unknown_role' WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET role_key='super_admin' WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET role_key='white_label_platform_admin' WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET role_key=NULL WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET accepted_at=NULL WHERE user_id='" + target + "'"],
    ["UPDATE company_memberships SET status='disabled',is_active=false WHERE user_id='" + target + "'"],
    ["UPDATE user_profiles SET user_status='disabled' WHERE id='" + target + "'"],
    ["UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='" + target + "'"],
    ["UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='" + target + "'"],
  ])('rejects %s without changing assignment, events or audit', async (patch) => {
    await db.exec(patch)
    await expect(assign()).rejects.toMatchObject({ code: '42501', message: 'support_assignee_not_active_in_company' })
    const result = await db.query<{ assigned_to: string | null, events: number, audits: number }>(`SELECT assigned_to,
      (SELECT count(*)::integer FROM customer_case_events) AS events,
      (SELECT count(*)::integer FROM audit_logs) AS audits FROM customer_cases WHERE id='${caseId}'`)
    expect(result.rows[0]).toEqual({ assigned_to: null, events: 0, audits: 0 })
  })

  it('rejects active staff from another company', async () => {
    await expect(assign(foreignStaff)).rejects.toMatchObject({ code: '42501', message: 'support_assignee_not_active_in_company' })
  })

  it('accepts known staff even when every effective permission is denied', async () => {
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,effect,status,is_active)
      SELECT '${company}','${target}',permission,'deny','active',true
      FROM unnest(public.gridex_staff_role_profile_v1('customer_service_agent')) permission`)
    const permissions = await db.query<{ permissions: string[] }>('SELECT public.gridex_staff_actor_permissions_v1($1,$2,false) AS permissions', [company, target])
    expect(permissions.rows[0].permissions).toEqual([])
    expect(await assign()).toMatchObject({ assigned_to: target })
    const event = await db.query<{ payload: Record<string, unknown>, created_by: string }>('SELECT payload,created_by FROM customer_case_events')
    expect(event.rows[0]).toMatchObject({ created_by: actor, payload: { actor_user_id: actor, api_client_id: client, channel: 'staff_api', visibility: 'internal', to: target } })
    const audit = await db.query<{ actor_user_id: string, metadata: Record<string, unknown> }>('SELECT actor_user_id,metadata FROM audit_logs')
    expect(audit.rows[0]).toMatchObject({ actor_user_id: actor, metadata: { channel: 'staff_api', api_client_id: client } })
  })

  it('uses recognized normalized base profiles rather than effective permissions', async () => {
    for (const role of Object.keys(ROLE_PERMISSION_PROFILES)) {
      await db.query('UPDATE company_memberships SET role_key=$1 WHERE user_id=$2', [role, target])
      if (['super_admin', 'white_label_platform_admin'].includes(role)) {
        await expect(assign()).rejects.toMatchObject({ message: 'support_assignee_not_active_in_company' })
      } else {
        await expect(assign()).resolves.toMatchObject({ assigned_to: target })
      }
    }
    await db.query('UPDATE company_memberships SET role_key=$1 WHERE user_id=$2', ['Kundservice', target])
    await expect(assign()).resolves.toMatchObject({ assigned_to: target })
  })

  it('supports null unassignment and an expired past ban', async () => {
    await db.exec(`UPDATE auth.users SET banned_until=clock_timestamp()-interval '1 second' WHERE id='${target}'`)
    expect(await assign()).toMatchObject({ assigned_to: target })
    expect(await assign(null)).toMatchObject({ assigned_to: null })
  })

  it('rolls back case and event changes when the audit insert fails', async () => {
    await db.exec(`CREATE FUNCTION pg_temp.reject_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_assignment_audit_failure'; END$$;
      CREATE TRIGGER assignment_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_assignment_audit()`)
    await expect(assign()).rejects.toMatchObject({ message: 'synthetic_assignment_audit_failure' })
    const counts = await db.query<{ events: number, assigned_to: string | null }>(`SELECT assigned_to,(SELECT count(*)::integer FROM customer_case_events) AS events FROM customer_cases WHERE id='${caseId}'`)
    expect(counts.rows[0]).toEqual({ assigned_to: null, events: 0 })
  })

  it('preserves the six-argument service-only ACL without adding Auth grants', async () => {
    const result = await db.query<{ anon: boolean, authenticated: boolean, service: boolean, auth_table: boolean, definer: boolean }>(`SELECT
      has_function_privilege('anon','public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE') AS service,
      has_table_privilege('service_role','auth.users','SELECT') AS auth_table,
      (SELECT prosecdef FROM pg_proc WHERE oid='public.gridex_assign_customer_case(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) AS definer`)
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true, auth_table: false, definer: true })
    await db.exec('SET LOCAL ROLE service_role')
    await expect(assign()).resolves.toMatchObject({ assigned_to: target })
  })

  it('executes the full native eligibility matrix and attribution checks with rollback', async () => {
    await db.exec('ROLLBACK')
    const script = readFileSync('scripts/staff-case-assignee-eligibility-regression.sql', 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/m, '')
    await expect(db.exec(script)).resolves.toBeDefined()
    await db.exec('BEGIN')
  })
})
