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
    CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text,name text,created_at timestamptz DEFAULT now());
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

const forward = file('20261004100918_staff_user_lock_order.sql').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const functions = [
  'public.canonical_change_tenant_user_access(jsonb)',
  'public.canonical_create_tenant_invitation(jsonb)',
  'public.gridex_assert_staff_command_v1(jsonb,boolean)',
]

describe('staff company lock-order forward repair', () => {
  it('executes the real canonical access and invitation commands and their exact replays', async () => {
    await db.exec(forward)
    const changed = await invoke('canonical_change_tenant_user_access', access)
    const invited = await invoke('canonical_create_tenant_invitation', invite)
    expect(changed).toMatchObject({ user_id: target, role_key: 'operations_agent', status: 'active' })
    expect(invited).toMatchObject({ status: 'pending' })
    expect(await invoke('canonical_change_tenant_user_access', access)).toEqual(changed)
    expect(await invoke('canonical_create_tenant_invitation', invite)).toEqual(invited)
    await db.exec('UPDATE integration_api_clients SET revoked_at=clock_timestamp()')
    await expect(invoke('canonical_change_tenant_user_access', access)).rejects.toMatchObject({ code: '42501', message: 'staff_permission_denied' })
    await expect(invoke('canonical_create_tenant_invitation', invite)).rejects.toMatchObject({ code: '42501', message: 'staff_permission_denied' })
  })

  it.each(functions)('rejects unexpected immutable source drift in %s and rolls back earlier patches', async (name) => {
    await db.query(`DO $drift$ DECLARE original text; BEGIN
      SELECT pg_get_functiondef($function$${name}$function$::regprocedure) INTO original;
      EXECUTE replace(original,'DECLARE','DECLARE -- intentional harmless fixture drift');
    END $drift$;`)
    const before = await db.query<{ source: string }>('SELECT prosrc AS source FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [functions])
    await db.exec('SAVEPOINT lock_order_patch')
    await expect(db.exec(forward)).rejects.toMatchObject({ message: `staff_user_lock_order_function_drift:${name}` })
    await db.exec('ROLLBACK TO SAVEPOINT lock_order_patch; RELEASE SAVEPOINT lock_order_patch')
    const after = await db.query<{ source: string }>('SELECT prosrc AS source FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [functions])
    expect(after.rows).toEqual(before.rows)
  })

  it('preserves the private guard, canonical service-only ACL and fixed search path', async () => {
    await db.exec(forward)
    const result = await db.query<{ role: string, guard: boolean, access: boolean, invite: boolean }>(`SELECT role,
      has_function_privilege(role,'public.gridex_assert_staff_command_v1(jsonb,boolean)','EXECUTE') AS guard,
      has_function_privilege(role,'public.canonical_change_tenant_user_access(jsonb)','EXECUTE') AS access,
      has_function_privilege(role,'public.canonical_create_tenant_invitation(jsonb)','EXECUTE') AS invite
      FROM unnest(ARRAY['anon','authenticated','service_role']) role`)
    expect(result.rows).toEqual([
      { role: 'anon', guard: false, access: false, invite: false },
      { role: 'authenticated', guard: false, access: false, invite: false },
      { role: 'service_role', guard: false, access: true, invite: true },
    ])
    const metadata = await db.query<{ secure: boolean }>(`SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']) AS secure
      FROM pg_proc WHERE oid=ANY($1::regprocedure[])`, [functions])
    expect(metadata.rows[0].secure).toBe(true)
    await db.exec('SET LOCAL ROLE service_role')
    await expect(invoke('canonical_change_tenant_user_access', access)).resolves.toMatchObject({ user_id: target })
  })
})
