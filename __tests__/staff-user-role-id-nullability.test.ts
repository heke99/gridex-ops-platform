import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const migration = file('20261004165620_staff_user_role_id_nullability.sql')
const forward = process.env.GRIDEX_STAFF_ROLE_ID_SOURCE === 'old' ? '' : migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const extract = (source: string, start: string, end: string) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  if (first < 0 || last < 0) throw new Error(`Missing actual SQL declaration: ${start}`)
  return source.slice(first, last + end.length)
}
const actualFunction = (name: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (start < 0) throw new Error(`Missing captured function: ${name}`)
  const delimiter = /\bAS (\$[A-Za-z_0-9]*\$)/.exec(schema.slice(start))
  if (!delimiter || delimiter.index === undefined) throw new Error(`Missing captured body: ${name}`)
  const end = schema.indexOf(`${delimiter[1]};`, start + delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error(`Unterminated captured function: ${name}`)
  return schema.slice(start, end + delimiter[1].length + 1)
}
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const target = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const command = { company_id: company, actor_user_id: actor, user_id: target, action: 'upsert', staff_operation: 'change_role',
  role_key: 'operations_agent', membership_role: 'operations', channel: 'staff_api', api_client_id: client,
  idempotency_key: 'role-nullability-change', reason: 'Synthetic legacy schema regression' }
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Supporting tables are finite. All command/permission/scope/hash/last-admin
  // function bodies below are copied from the qualified capture without edits.
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256($1)$$;
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'utf8'))$$;
    CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text,is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,email text,user_status text);
    CREATE TABLE admin_users(user_id uuid,role text,is_active boolean);
    CREATE TABLE company_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz,invited_by uuid,suspended_at timestamptz,disabled_at timestamptz,removed_at timestamptz,metadata jsonb,disabled_by uuid,status_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz,UNIQUE(company_id,user_id));
    CREATE TABLE permissions(id uuid,key text,name text,is_active boolean);
    CREATE TABLE role_permissions(role_id uuid,permission_id uuid);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb,actor_type text,request_id text,correlation_id text,resource_type text,resource_id text);
    CREATE TABLE company_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,invited_user_id uuid,status text,revoked_at timestamptz);`)
  await db.exec(extract(file('01_db1_schema_repair_core_helpers_and_canonical_tables.sql'), 'create table if not exists public.roles (', ');'))
  // The sole legacy drift is the production-proven NOT NULL role reference.
  await db.exec(extract(schema, 'CREATE TABLE public.user_roles (', ');').replace('role_id uuid,', 'role_id uuid NOT NULL,'))
  await db.exec(`ALTER TABLE user_roles ADD PRIMARY KEY(id);
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE;
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_company_id_fkey FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE SET NULL;
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_user_id_auth_users_fk FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON user_roles TO authenticated;
    GRANT ALL ON user_roles TO service_role;
    CREATE POLICY preserved_read_policy ON user_roles FOR SELECT TO authenticated USING(company_id IS NOT NULL);`)
  for (const index of ['user_roles_company_user_role_active_uidx', 'user_roles_company_user_single_active_uidx', 'user_roles_global_user_role_uidx']) {
    await db.exec(extract(schema, `CREATE UNIQUE INDEX ${index}`, ';'))
  }
  const policy = file('20260802010000_canonical_tenant_operation_policy_lifecycle.sql')
  await db.exec(extract(policy, 'create table if not exists public.canonical_command_results', 'create index if not exists canonical_event_outbox_claim_idx').replace(/create index if not exists canonical_event_outbox_claim_idx$/, ''))
  await db.exec('ALTER TABLE canonical_command_results ADD COLUMN request_hash text NOT NULL')
  await db.exec(extract(file('20260802203000_canonical_runtime_consistency_hardening.sql'), 'create table if not exists public.canonical_tenant_access_role_mapping', '-- The historical UNIQUE'))
  const functions = [
    'gridex_normalize_platform_role', 'canonical_json_sha256', 'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized',
    'canonical_command_request_hash_guard', 'gridex_staff_role_profile_v1', 'gridex_staff_normalize_role_v1',
    'gridex_staff_actor_permissions_v1', 'gridex_assert_staff_command_v1', 'canonical_change_tenant_user_access_v1_unchecked',
    'canonical_change_tenant_user_access_v2_unmapped', 'canonical_change_tenant_user_access_pre_staff_v1',
    'canonical_change_tenant_user_access', 'canonical_guard_global_platform_role_scope', 'gridex_assert_role_scope_is_consistent',
    'guard_last_functioning_tenant_admin',
  ]
  for (const name of functions) {
    await db.exec(actualFunction(name))
    const acl = schema.match(new RegExp(`^(?:REVOKE|GRANT) [^\\n;]* ON FUNCTION public\\.${name}\\([^\\n;]*\\)[^\\n;]*;`, 'gm')) ?? []
    if (acl.length) await db.exec(acl.join('\n'))
  }
  await db.exec(`CREATE TRIGGER canonical_command_results_request_hash_guard BEFORE INSERT OR UPDATE OF request_payload,request_hash ON canonical_command_results FOR EACH ROW EXECUTE FUNCTION canonical_command_request_hash_guard();
    CREATE TRIGGER gridex_user_roles_scope_consistent BEFORE INSERT OR UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION gridex_assert_role_scope_is_consistent();
    CREATE TRIGGER user_roles_global_platform_scope_guard BEFORE INSERT OR UPDATE OF company_id,role,role_id ON user_roles FOR EACH ROW EXECUTE FUNCTION canonical_guard_global_platform_role_scope();
    CREATE TRIGGER guard_last_functioning_tenant_admin AFTER UPDATE OR DELETE ON company_memberships FOR EACH ROW EXECUTE FUNCTION guard_last_functioning_tenant_admin();`)
  await db.exec(readFileSync('scripts/sql/staff-native-role-catalog-fixture.sql', 'utf8'))
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,name,status) VALUES('${company}','Synthetic company','active'),('${foreignCompany}','Synthetic foreign company','active');
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','actor@example.invalid',now()),('${target}','target@example.invalid',now());
    INSERT INTO user_profiles VALUES('${actor}','actor@example.invalid','active'),('${target}','target@example.invalid','active');
    INSERT INTO company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
    VALUES('${company}','${actor}','company_admin','company_admin','active',true,now()),('${company}','${target}','customer_service_agent','support','active',true,now());
    INSERT INTO user_roles(company_id,user_id,role,role_id) SELECT '${company}','${actor}',key,id FROM roles WHERE key='company_admin';
    INSERT INTO user_roles(company_id,user_id,role,role_id) SELECT '${company}','${target}',key,id FROM roles WHERE key='customer_service_agent';
    WITH users AS (INSERT INTO auth.users(id,email) SELECT gen_random_uuid(),'legacy-'||n||'@example.invalid' FROM generate_series(1,6) n RETURNING id)
    INSERT INTO user_roles(company_id,user_id,role,role_id) SELECT '${foreignCompany}',users.id,roles.key,roles.id FROM users CROSS JOIN roles WHERE roles.key='customer_service_agent';
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_users.write']);`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function statement(sql: string, values: unknown[] = []) {
  await db.exec('SAVEPOINT role_assertion')
  try {
    const result = await db.query<Record<string, unknown>>(sql, values)
    await db.exec('RELEASE SAVEPOINT role_assertion')
    return result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT role_assertion; RELEASE SAVEPOINT role_assertion')
    throw error
  }
}
const invoke = async (value: Record<string, unknown>) => (await statement('SELECT canonical_change_tenant_user_access($1::jsonb) AS result', [JSON.stringify(value)])).rows[0].result
const rows = async () => (await db.query('SELECT to_jsonb(roles) AS value FROM user_roles roles ORDER BY id')).rows
const catalog = async () => (await db.query(`SELECT relation.relrowsecurity,relation.relforcerowsecurity,relation.relacl::text,
  (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid),'validated',convalidated) ORDER BY conname) FROM pg_constraint WHERE conrelid=relation.oid) AS constraints,
  (SELECT jsonb_agg(jsonb_build_object('name',polname,'roles',polroles,'qual',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid=relation.oid) AS policies,
  (SELECT jsonb_agg(jsonb_build_object('name',indexrelid::regclass::text,'definition',pg_get_indexdef(indexrelid)) ORDER BY indexrelid) FROM pg_index WHERE indrelid=relation.oid) AS indexes,
  (SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=relation.oid) AS triggers
  FROM pg_class relation WHERE relation.oid='user_roles'::regclass`)).rows[0]
const column = async () => (await db.query<Record<string, unknown>>(`SELECT attname,atttypid::regtype::text,attnotnull,attgenerated,attidentity,attacl::text,
  pg_get_expr(defaults.adbin,defaults.adrelid) AS default_value FROM pg_attribute attribute
  LEFT JOIN pg_attrdef defaults ON defaults.adrelid=attribute.attrelid AND defaults.adnum=attribute.attnum
  WHERE attribute.attrelid='user_roles'::regclass AND attribute.attname='role_id' AND NOT attribute.attisdropped`)).rows[0]

describe('legacy user_roles role reference normalization', () => {
  it.each(['change_role', 'enable'])('reproduces 23502 in the real guarded %s chain without partial writes', async operation => {
    if (operation === 'enable') {
      await invoke({ ...command, action: 'disable', staff_operation: 'disable', idempotency_key: 'legacy-disable' })
    }
    const before = await rows()
    const beforeResults = (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM canonical_command_results')).rows[0].count
    const beforeAudits = (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count
    expect(before).toHaveLength(8)
    expect(await column()).toMatchObject({ attnotnull: true, default_value: null })
    await expect(invoke({ ...command, staff_operation: operation })).rejects.toMatchObject({ code: '23502', table: 'user_roles', column: 'role_id' })
    expect(await rows()).toEqual(before)
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM canonical_command_results')).rows[0].count).toBe(beforeResults)
    expect((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs')).rows[0].count).toBe(beforeAudits)
  })

  it('normalizes only nullability and preserves eight legacy rows, FK, indexes, RLS, policies, triggers and ACLs across repeated application', async () => {
    const beforeRows = await rows()
    const beforeCatalog = await catalog()
    const beforeColumn = await column()
    await db.exec(forward)
    expect(await column()).toEqual({ ...beforeColumn, attnotnull: false })
    expect(await catalog()).toEqual(beforeCatalog)
    expect(await rows()).toEqual(beforeRows)
    await db.exec(forward)
    expect(await catalog()).toEqual(beforeCatalog)
    expect(await rows()).toEqual(beforeRows)
    await db.exec('ROLLBACK; BEGIN')
    expect(await column()).toEqual(beforeColumn)
  })

  it('executes the real role-change command, mapped non-null role reference, audit and exact replay', async () => {
    await db.exec(forward)
    const result = await invoke(command)
    expect(result).toMatchObject({ user_id: target, role_key: 'operations_agent', status: 'active' })
    expect((await db.query(`SELECT role,role_id=roles.id AS mapped FROM user_roles JOIN roles ON roles.key='operations_agent' WHERE user_id='${target}' AND user_roles.is_active`)).rows)
      .toEqual([{ role: 'operations_agent', mapped: true }])
    expect(await invoke(command)).toEqual(result)
    expect((await db.query("SELECT action,metadata->>'channel' AS channel,metadata->>'api_client_id' AS client FROM audit_logs")).rows)
      .toEqual([{ action: 'STAFF_CHANGE_ROLE', channel: 'staff_api', client }])
  })

  it('executes disable then enable with the same mapped role, current authorization and exact replay', async () => {
    const disable = { ...command, action: 'disable', staff_operation: 'disable', idempotency_key: 'role-disable' }
    expect(await invoke(disable)).toMatchObject({ status: 'disabled', role_key: 'customer_service_agent' })
    await db.exec(forward)
    const restored = { ...command, role_key: undefined, membership_role: undefined, staff_operation: 'enable', idempotency_key: 'role-enable' }
    expect(await invoke(restored)).toMatchObject({ status: 'active', role_key: 'customer_service_agent' })
    expect((await db.query(`SELECT role,role_id=roles.id AS mapped FROM user_roles JOIN roles ON roles.key='customer_service_agent' WHERE user_id='${target}' AND user_roles.is_active`)).rows)
      .toEqual([{ role: 'customer_service_agent', mapped: true }])
    await invoke(restored)
    await db.exec('UPDATE integration_api_clients SET revoked_at=now()')
    await expect(invoke(restored)).rejects.toMatchObject({ code: '42501', message: 'staff_permission_denied' })
  })

  it.each(['super_admin', 'platform_admin'])('retains the real tenant platform-role guard with null role_id: %s', async role => {
    await db.exec(forward)
    await expect(statement('INSERT INTO user_roles(user_id,company_id,role) VALUES($1::uuid,$2::uuid,$3)', [target, foreignCompany, role]))
      .rejects.toMatchObject({ code: '23514', message: 'tenant_bound_global_platform_role_forbidden' })
  })

  it('retains invalid non-null FK rejection and authenticated direct-write denial', async () => {
    await db.exec(forward)
    await expect(statement('INSERT INTO user_roles(user_id,company_id,role,role_id) VALUES($1::uuid,$2::uuid,$3,$4::uuid)', [target, foreignCompany, 'viewer', '99999999-9999-4999-8999-999999999999']))
      .rejects.toMatchObject({ code: '23503', constraint: 'user_roles_role_id_fkey' })
    await db.exec('SET LOCAL ROLE authenticated')
    await expect(statement('INSERT INTO user_roles(user_id,company_id,role) VALUES($1::uuid,$2::uuid,$3)', [target, foreignCompany, 'viewer']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(statement('UPDATE user_roles SET role_id=NULL WHERE user_id=$1::uuid', [target])).rejects.toMatchObject({ code: '42501' })
    await db.exec('RESET ROLE')
  })

  it('retains staff scope and last-administrator guards after normalization', async () => {
    await db.exec(forward)
    await db.exec("UPDATE integration_api_clients SET scopes=ARRAY['staff_users.read']")
    await expect(invoke(command)).rejects.toMatchObject({ code: '42501', message: 'staff_permission_denied' })
    await db.exec("UPDATE integration_api_clients SET scopes=ARRAY['staff_users.write']")
    await db.exec(`INSERT INTO user_permissions(company_id,user_id,permission_key,status,is_active,effect) VALUES('${company}','${target}','users.write','active',true,'allow')`)
    await expect(invoke({ ...command, actor_user_id: target, user_id: actor, role_key: 'customer_service_agent', membership_role: 'support' }))
      .rejects.toMatchObject({ code: '23514', message: 'staff_last_admin_required' })
  })

  it.each(['missing', 'wrong_type'])('rejects incompatible role_id schema before altering it: %s', async drift => {
    await db.exec('ALTER TABLE user_roles RENAME COLUMN role_id TO legacy_role_id')
    if (drift === 'wrong_type') await db.exec("ALTER TABLE user_roles ADD COLUMN role_id text NOT NULL DEFAULT 'legacy'")
    const beforeCatalog = await catalog()
    const beforeColumn = await column()
    const beforeRows = await rows()
    await db.exec('SAVEPOINT schema_assertion')
    try {
      await expect(db.exec(forward)).rejects.toMatchObject({ message: 'staff_user_roles_role_id_schema_mismatch' })
    } finally {
      await db.exec('ROLLBACK TO SAVEPOINT schema_assertion; RELEASE SAVEPOINT schema_assertion')
    }
    expect(await catalog()).toEqual(beforeCatalog)
    expect(await column()).toEqual(beforeColumn)
    expect(await rows()).toEqual(beforeRows)
  })
})
