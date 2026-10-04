import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const extract = (source: string, start: string, end: string) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  if (first < 0 || last < 0) throw new Error(`Missing SQL fixture declaration: ${start}`)
  return source.slice(first, last + end.length)
}
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const b = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const access = { company_id: a, actor_user_id: actor, user_id: target, action: 'upsert', staff_operation: 'change_role', role_key: 'operations_agent', membership_role: 'operations', channel: 'staff_api', api_client_id: client, idempotency_key: 'staff-client-access', reason: 'Synthetic guard test' }
const invite = { company_id: a, actor_user_id: actor, staff_operation: 'invite', role_key: 'customer_service_agent', membership_role: 'support', channel: 'staff_api', api_client_id: client, idempotency_key: 'staff-client-invite', email: 'staff-client-invite@example.invalid', full_name: 'Synthetic guard invite' }
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256($1)$$;
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'utf8'))$$;
    CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text,is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,aud text,role text,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,created_at timestamptz,updated_at timestamptz,is_anonymous boolean);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,email text,user_status text);
    CREATE TABLE company_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz,invited_by uuid,suspended_at timestamptz,disabled_at timestamptz,removed_at timestamptz,metadata jsonb,disabled_by uuid,status_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz,UNIQUE(company_id,user_id));
    CREATE TABLE permissions(id uuid,key text,name text,is_active boolean);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,name text,key_prefix text,secret_hash text,scopes text[],status text,deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    ${extract(file('01_db1_schema_repair_core_helpers_and_canonical_tables.sql'), 'create table if not exists public.roles (', '\n);')}
    CREATE TABLE user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role text,role_id uuid,status text,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz);
    CREATE UNIQUE INDEX user_roles_company_user_role_active_uidx ON user_roles(company_id,user_id,role_id) WHERE company_id IS NOT NULL AND user_id IS NOT NULL AND role_id IS NOT NULL AND coalesce(status,'active')='active' AND coalesce(is_active,true);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb,actor_type text,request_id text,correlation_id text,resource_type text,resource_id text);
    CREATE TABLE company_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,email text,full_name text,membership_role text,role_key text,status text,token uuid,invited_by uuid,expires_at timestamptz,accept_token_hash text,idempotency_key text,metadata jsonb,invited_user_id uuid,revoked_at timestamptz);
    CREATE TABLE company_provisioning_jobs(id uuid DEFAULT gen_random_uuid(),company_id uuid,job_key text,idempotency_key text,UNIQUE(company_id,job_key,idempotency_key));
    CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION canonical_actor_is_authorized(uuid,uuid,text,boolean) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION canonical_change_tenant_user_access_v1_unchecked(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    CREATE FUNCTION canonical_change_tenant_user_access_v2_unmapped(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
    CREATE FUNCTION canonical_create_tenant_invitation(jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
  `)
  const operationPolicy = file('20260802010000_canonical_tenant_operation_policy_lifecycle.sql')
  const security = file('20260802170000_canonical_security_convergence.sql')
  const consistency = file('20260802203000_canonical_runtime_consistency_hardening.sql')
  await db.exec(extract(operationPolicy, 'create table if not exists public.canonical_command_results', 'create index if not exists canonical_event_outbox_claim_idx').replace(/create index if not exists canonical_event_outbox_claim_idx$/, ''))
  await db.exec('ALTER TABLE canonical_command_results ADD COLUMN request_hash text NOT NULL')
  await db.exec(extract(security, 'create or replace function public.canonical_json_sha256', '$$;'))
  await db.exec(extract(security, 'create or replace function public.canonical_command_request_hash_guard', '$$;'))
  await db.exec('CREATE TRIGGER canonical_command_results_request_hash_guard BEFORE INSERT OR UPDATE OF request_payload,request_hash ON canonical_command_results FOR EACH ROW EXECUTE FUNCTION canonical_command_request_hash_guard()')
  await db.exec(extract(consistency, 'create table if not exists public.canonical_tenant_access_role_mapping', '-- The historical UNIQUE'))
  await db.exec(extract(consistency, 'create function public.canonical_change_tenant_user_access(p_command jsonb)', '$function$;'))
  await db.exec("INSERT INTO roles(key,name) VALUES('company_admin','company_admin'),('customer_service_agent','customer_service_agent'),('operations_agent','operations_agent')")
  // Actual mapped/v2/unchecked command chain and hash trigger; no business stub
  // remains on the staff paths exercised below.
  await db.exec(file('20261004083640_staff_user_commands.sql'))
  await db.exec(file('20261004094344_staff_user_client_guard.sql'))
  await db.exec(file('20261004095500_staff_user_actor_guard.sql'))
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,name,status) VALUES('${a}','Synthetic A','active'),('${b}','Synthetic B','active');
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','actor@example.invalid',now()),('${target}','target@example.invalid',now());
    INSERT INTO user_profiles VALUES('${actor}','actor@example.invalid','active'),('${target}','target@example.invalid','active');
    INSERT INTO company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
    VALUES('${a}','${actor}','company_admin','company_admin','active',true,now()),('${a}','${target}','customer_service_agent','support','active',true,now());
    INSERT INTO user_roles(company_id,user_id,role,role_id,status,is_active)
    SELECT '${a}','${target}',key,id,'active',true FROM roles WHERE key='customer_service_agent';
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${a}','active',ARRAY['staff_users.write']);`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function invoke(name: string, command: Record<string, unknown>) {
  await db.exec('SAVEPOINT staff_client_assertion')
  try {
    const result = await db.query<{ result: unknown }>(`SELECT public.${name}($1::jsonb) AS result`, [JSON.stringify(command)])
    await db.exec('RELEASE SAVEPOINT staff_client_assertion')
    return result.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT staff_client_assertion; RELEASE SAVEPOINT staff_client_assertion')
    throw error
  }
}

describe('staff account writes hold actor eligibility locks before mutations and cache replays', () => {
  it.each([
    ["UPDATE company_memberships SET accepted_at=NULL WHERE user_id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE company_memberships SET status='disabled',is_active=false WHERE user_id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE company_memberships SET role_key='unknown_role' WHERE user_id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE company_memberships SET role_key='white_label_platform_admin' WHERE user_id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE user_profiles SET user_status='disabled' WHERE id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 hour' WHERE id='" + actor + "'", '42501', 'staff_permission_denied'],
    ["UPDATE companies SET is_active=false WHERE id='" + a + "'", '23514', 'staff_company_not_operational'],
    ["UPDATE companies SET status='paused' WHERE id='" + a + "'", '23514', 'staff_company_not_operational'],
  ])('denies first writes and both cached command types after %s', async (patch, code, message) => {
    await invoke('canonical_change_tenant_user_access', access)
    await invoke('canonical_create_tenant_invitation', invite)
    await db.exec(patch)
    for (const [name, command] of [
      ['canonical_change_tenant_user_access', access],
      ['canonical_create_tenant_invitation', invite],
      ['canonical_change_tenant_user_access', { ...access, idempotency_key: 'new-access', role_key: 'customer_service_agent', membership_role: 'support' }],
      ['canonical_create_tenant_invitation', { ...invite, idempotency_key: 'new-invite', email: 'new@example.invalid' }],
    ] as const) {
      await expect(invoke(name, command)).rejects.toMatchObject({ code, message })
    }
    const counts = await db.query<{ audits: number, receipts: number, invitations: number, target_role: string }>(`SELECT
      (SELECT count(*)::integer FROM audit_logs) AS audits,
      (SELECT count(*)::integer FROM canonical_command_results) AS receipts,
      (SELECT count(*)::integer FROM company_invitations) AS invitations,
      (SELECT role_key FROM company_memberships WHERE company_id='${a}' AND user_id='${target}') AS target_role`)
    expect(counts.rows[0]).toEqual({ audits: 2, receipts: 2, invitations: 1, target_role: 'operations_agent' })
  })

  it.each([
    ['canonical_change_tenant_user_access', access],
    ['canonical_create_tenant_invitation', invite],
  ])('retains eligibility lock relations through completion of %s', async (name, command) => {
    await invoke(name, command)
    const locks = await db.query<{ relation: string }>(`SELECT DISTINCT relation::regclass::text AS relation FROM pg_locks
      WHERE (pid=pg_backend_pid() OR pid IS NULL) AND granted AND mode='RowShareLock'
      AND relation IN('public.company_memberships'::regclass,'public.user_profiles'::regclass,'auth.users'::regclass,'public.integration_api_clients'::regclass)
      ORDER BY relation`)
    expect(locks.rows.map(row => row.relation)).toEqual(['auth.users', 'company_memberships', 'integration_api_clients', 'user_profiles'])
  })

  // PGlite exposes NULL backend PIDs; authentic native regression filters its own PID.
  it('keeps exact replay and accepts a past Auth ban for active staff', async () => {
    await db.exec("UPDATE auth.users SET banned_until=clock_timestamp()-interval '1 second'")
    const first = await invoke('canonical_change_tenant_user_access', access)
    expect(await invoke('canonical_change_tenant_user_access', access)).toEqual(first)
    await db.exec(`UPDATE user_permissions SET status='inactive'`)
    expect(await invoke('canonical_change_tenant_user_access', access)).toEqual(first)
  })

  it('keeps the guard private, canonical entrypoints service-only and Auth tables ungranted', async () => {
    const result = await db.query<{ role: string, guard: boolean, access: boolean, invite: boolean, auth_select: boolean }>(`SELECT role,
      has_function_privilege(role,'public.gridex_assert_staff_command_v1(jsonb,boolean)','EXECUTE') AS guard,
      has_function_privilege(role,'public.canonical_change_tenant_user_access(jsonb)','EXECUTE') AS access,
      has_function_privilege(role,'public.canonical_create_tenant_invitation(jsonb)','EXECUTE') AS invite,
      has_table_privilege(role,'auth.users','SELECT') AS auth_select
      FROM unnest(ARRAY['anon','authenticated','service_role']) role`)
    expect(result.rows).toEqual([
      { role: 'anon', guard: false, access: false, invite: false, auth_select: false },
      { role: 'authenticated', guard: false, access: false, invite: false, auth_select: false },
      { role: 'service_role', guard: false, access: true, invite: true, auth_select: false },
    ])
    const first = await invoke('canonical_change_tenant_user_access', access)
    await db.exec('SET LOCAL ROLE service_role')
    expect(await invoke('canonical_change_tenant_user_access', access)).toEqual(first)
  })

  it('runs the rollback native regression with the actual canonical command chain', async () => {
    await db.exec('ROLLBACK')
    const script = readFileSync('scripts/staff-user-actor-guard-regression.sql', 'utf8')
      .replace(/^\\set ON_ERROR_STOP on\s*$/m, '')
      .replace(/^\\ir sql\/staff-native-role-catalog-fixture\.sql$/m, () => readFileSync('scripts/sql/staff-native-role-catalog-fixture.sql', 'utf8'))
      // Embedded PG uses NULL backend PIDs; native SQL retains its exact PID check.
      .replace('lock.pid=pg_backend_pid()', '(lock.pid=pg_backend_pid() OR lock.pid IS NULL)')
    await expect(db.exec(script)).resolves.toBeDefined()
    await db.exec('BEGIN')
  })

})
