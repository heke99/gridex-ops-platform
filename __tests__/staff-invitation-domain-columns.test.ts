import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const baseline = readFileSync('__tests__/fixtures/staff-invitation-pre-closure.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261004132630_staff_invitation_domain_columns.sql', 'utf8')
const forward = process.env.GRIDEX_STAFF_INVITATION_SCHEMA_SOURCE === 'old' ? '' : migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const extract = (source: string, start: string, end: string) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  if (first < 0 || last < 0) throw new Error(`Missing authentic SQL declaration: ${start}`)
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
const invited = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const legacyId = '99999999-9999-4999-8999-999999999999'
const columns = {
  full_name: 'text', membership_role: 'text', role_key: 'text', token: 'uuid', invited_by: 'uuid',
  accept_token_hash: 'text', invited_user_id: 'uuid', revoked_at: 'timestamp with time zone', invited_email: 'text',
}
const inviteCommand = {
  company_id: company, actor_user_id: actor, staff_operation: 'invite', role_key: 'customer_service_agent',
  membership_role: 'support', channel: 'staff_api', api_client_id: client, idempotency_key: 'schema-invite',
  email: 'invited@example.invalid', full_name: 'Synthetic invited staff',
}
const disableCommand = {
  company_id: company, actor_user_id: actor, user_id: target, action: 'disable', staff_operation: 'disable',
  channel: 'staff_api', api_client_id: client, idempotency_key: 'schema-disable', reason: 'Synthetic schema regression',
}
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Finite supporting tables contain the columns read by the real captured
  // functions. The invitation declaration/constraints are copied verbatim;
  // no authorization, invitation, mutation, hash-guard or delivery RPC is mocked.
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
    CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256($1)$$;
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$SELECT sha256(convert_to($1,'utf8'))$$;
    CREATE TABLE companies(id uuid PRIMARY KEY,name text,status text,is_active boolean NOT NULL DEFAULT true);
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE user_profiles(id uuid PRIMARY KEY,email text,user_status text);
    CREATE TABLE admin_users(user_id uuid,role text,is_active boolean);
    CREATE TABLE company_memberships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role_key text,membership_role text,status text,is_active boolean,accepted_at timestamptz,invited_by uuid,invited_email text,invited_at timestamptz,suspended_at timestamptz,disabled_at timestamptz,removed_at timestamptz,metadata jsonb,disabled_by uuid,status_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz,UNIQUE(company_id,user_id));
    CREATE TABLE permissions(id uuid,key text,name text,is_active boolean);
    CREATE TABLE user_permissions(company_id uuid,user_id uuid,permission_key text,permission_id uuid,status text,is_active boolean,effect text);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,name text,key_prefix text,secret_hash text,scopes text[],status text,deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key text UNIQUE,name text,description text,scope text,is_active boolean DEFAULT true,created_at timestamptz DEFAULT now());
    CREATE TABLE role_permissions(role_id uuid,permission_id uuid);
    CREATE TABLE user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,role text,role_id uuid,status text,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz);
    CREATE UNIQUE INDEX user_roles_company_user_role_active_uidx ON user_roles(company_id,user_id,role_id) WHERE company_id IS NOT NULL AND user_id IS NOT NULL AND role_id IS NOT NULL AND coalesce(status,'active')='active' AND coalesce(is_active,true);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,new_values jsonb,metadata jsonb,actor_type text,request_id text,correlation_id text,resource_type text,resource_id text);
    CREATE TABLE company_provisioning_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,job_key text,idempotency_key text,UNIQUE(company_id,job_key,idempotency_key));`)
  await db.exec(baseline)
  const policy = file('20260802010000_canonical_tenant_operation_policy_lifecycle.sql')
  await db.exec(extract(policy, 'create table if not exists public.canonical_command_results', 'create index if not exists canonical_event_outbox_claim_idx').replace(/create index if not exists canonical_event_outbox_claim_idx$/, ''))
  await db.exec('ALTER TABLE canonical_command_results ADD COLUMN request_hash text NOT NULL')
  const consistency = file('20260802203000_canonical_runtime_consistency_hardening.sql')
  await db.exec(extract(consistency, 'create table if not exists public.canonical_tenant_access_role_mapping', '-- The historical UNIQUE'))
  const functions = [
    'gridex_normalize_platform_role', 'canonical_json_sha256', 'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized',
    'canonical_command_request_hash_guard', 'gridex_staff_role_profile_v1', 'gridex_staff_normalize_role_v1',
    'gridex_staff_actor_permissions_v1', 'gridex_assert_staff_command_v1', 'canonical_change_tenant_user_access_v1_unchecked',
    'canonical_change_tenant_user_access_v2_unmapped', 'canonical_change_tenant_user_access_pre_staff_v1',
    'canonical_change_tenant_user_access', 'canonical_create_tenant_invitation_pre_staff_v1', 'canonical_create_tenant_invitation',
    'canonical_accept_tenant_invitation', 'canonical_enqueue_invitation_delivery_job', 'guard_tenant_invitation_acceptance',
    'guard_last_functioning_tenant_admin',
  ]
  for (const name of functions) await db.exec(actualFunction(name))
  for (const name of functions) {
    const acl = schema.match(new RegExp(`^(?:REVOKE|GRANT) [^\\n;]* ON FUNCTION public\\.${name}\\([^\\n;]*\\)[^\\n;]*;`, 'gm')) ?? []
    if (acl.length) await db.exec(acl.join('\n'))
  }
  await db.exec(`CREATE TRIGGER canonical_command_results_request_hash_guard BEFORE INSERT OR UPDATE OF request_payload,request_hash ON canonical_command_results FOR EACH ROW EXECUTE FUNCTION canonical_command_request_hash_guard();
    CREATE TRIGGER canonical_enqueue_invitation_delivery_job AFTER INSERT ON company_invitations FOR EACH ROW EXECUTE FUNCTION canonical_enqueue_invitation_delivery_job();
    CREATE TRIGGER company_invitations_tenant_accept_guard BEFORE INSERT OR UPDATE ON company_invitations FOR EACH ROW EXECUTE FUNCTION guard_tenant_invitation_acceptance();
    CREATE TRIGGER guard_last_functioning_tenant_admin AFTER UPDATE OR DELETE ON company_memberships FOR EACH ROW EXECUTE FUNCTION guard_last_functioning_tenant_admin();
    GRANT SELECT,INSERT,UPDATE ON company_invitations TO service_role;
    CREATE POLICY fixture_preserved_policy ON company_invitations FOR SELECT TO authenticated USING(status='pending');`)
  await db.exec("INSERT INTO roles(key,name) VALUES('company_admin','company_admin'),('customer_service_agent','customer_service_agent')")
}, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,name,status) VALUES('${company}','Synthetic company','active'),('${foreignCompany}','Synthetic foreign company','active');
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','actor@example.invalid',now()),('${target}','target@example.invalid',now()),('${invited}','invited@example.invalid',now());
    INSERT INTO user_profiles VALUES('${actor}','actor@example.invalid','active'),('${target}','target@example.invalid','active'),('${invited}','invited@example.invalid','active');
    INSERT INTO company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at)
    VALUES('${company}','${actor}','company_admin','company_admin','active',true,now()),('${company}','${target}','customer_service_agent','support','active',true,now());
    INSERT INTO user_roles(company_id,user_id,role,role_id,status,is_active)
    SELECT '${company}','${target}',key,id,'active',true FROM roles WHERE key='customer_service_agent';
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_users.write']);
    INSERT INTO company_invitations(id,company_id,email,role,status,invitation_token,metadata)
    VALUES('${legacyId}','${company}','legacy@example.invalid','viewer','pending','legacy-token',jsonb_build_object('legacy_preserved',true));`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function invoke(name: string, command: Record<string, unknown>) {
  await db.exec('SAVEPOINT domain_command')
  try {
    const result = await db.query<{ result: Record<string, unknown> }>(`SELECT public.${name}($1::jsonb) AS result`, [JSON.stringify(command)])
    await db.exec('RELEASE SAVEPOINT domain_command')
    return result.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT domain_command; RELEASE SAVEPOINT domain_command')
    throw error
  }
}
const apply = () => db.exec(forward)
const row = async (id: string) => (await db.query<{ value: Record<string, unknown> }>('SELECT to_jsonb(invitation) AS value FROM company_invitations invitation WHERE id=$1', [id])).rows[0].value
type InvitationCatalog = { relrowsecurity: boolean, relacl: string | null, constraints: unknown[], policies: unknown, triggers: unknown }
const catalog = async () => (await db.query<InvitationCatalog>(`SELECT relation.relrowsecurity,relation.relacl::text,
    (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=relation.oid) AS constraints,
    (SELECT jsonb_agg(jsonb_build_object('name',polname,'qual',pg_get_expr(polqual,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid=relation.oid) AS policies,
    (SELECT jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=relation.oid AND NOT tgisinternal) AS triggers
    FROM pg_class relation WHERE relation.oid='company_invitations'::regclass`)).rows[0]

describe('actual invitation domain schema closure', () => {
  it('retains the exact failed native table declaration and reproduces both real command failures', async () => {
    const declaration = extract(baseline, 'CREATE TABLE public.company_invitations (', '\n);')
    expect(createHash('sha256').update(declaration).digest('hex')).toBe('c457c78774df3cbf624cead526b59ee2f594ac4d7016b4f628e3fa65ce1c82dd')
    await expect(invoke('canonical_create_tenant_invitation', inviteCommand)).rejects.toMatchObject({ code: '42703', message: expect.stringContaining('full_name') })
    await expect(invoke('canonical_change_tenant_user_access', disableCommand)).rejects.toMatchObject({ code: '42703', message: expect.stringContaining('invited_user_id') })
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM canonical_command_results')).rows[0].count).toBe(0)
  })

  it('creates one real invitation, token/hash, worker job, audit and exact replay', async () => {
    await apply()
    const result = await invoke('canonical_create_tenant_invitation', inviteCommand)
    expect(result).toMatchObject({ company_id: company, status: 'pending' })
    const invitation = await row(String(result.invitation_id))
    expect(invitation).toMatchObject({ email: inviteCommand.email, full_name: inviteCommand.full_name, membership_role: 'support', role_key: 'customer_service_agent', invited_by: actor, token: result.token })
    expect(invitation.accept_token_hash).toBe(createHash('sha256').update(String(result.token)).digest('hex'))
    expect(await invoke('canonical_create_tenant_invitation', inviteCommand)).toEqual(result)
    const counts = (await db.query(`SELECT
      (SELECT count(*)::integer FROM company_provisioning_jobs WHERE idempotency_key='schema-invite') AS jobs,
      (SELECT count(*)::integer FROM canonical_command_results WHERE command_type='tenant.invitation.create') AS receipts,
      (SELECT count(*)::integer FROM audit_logs WHERE action='STAFF_INVITED' AND actor_user_id='${actor}' AND metadata->>'api_client_id'='${client}' AND metadata->>'channel'='staff_api') AS audits,
      (SELECT count(*)::integer FROM canonical_audit_events WHERE event_type='TENANT_INVITATION_CREATED') AS canonical_audits,
      (SELECT count(*)::integer FROM canonical_event_outbox WHERE topic='tenant.invitation.created') AS outbox`)).rows[0]
    expect(counts).toEqual({ jobs: 1, receipts: 1, audits: 1, canonical_audits: 1, outbox: 1 })
  })

  it('executes real disable and exact replay against the closed schema', async () => {
    await apply()
    const result = await invoke('canonical_change_tenant_user_access', disableCommand)
    expect(result).toMatchObject({ user_id: target, role_key: 'customer_service_agent', status: 'disabled' })
    expect(await invoke('canonical_change_tenant_user_access', disableCommand)).toEqual(result)
    expect((await db.query('SELECT status,is_active FROM company_memberships WHERE user_id=$1', [target])).rows[0]).toEqual({ status: 'disabled', is_active: false })
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM user_roles WHERE user_id=$1 AND is_active', [target])).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM audit_logs WHERE action='STAFF_DISABLE'")).rows[0].count).toBe(1)
  })

  it('links a genuine worker intent then revokes only the same-company pending invitation on disable', async () => {
    await apply()
    const result = await invoke('canonical_create_tenant_invitation', { ...inviteCommand, email: 'target@example.invalid' })
    await db.query('UPDATE company_invitations SET invited_user_id=$1 WHERE id=$2', [target, result.invitation_id])
    await db.query("INSERT INTO company_invitations(company_id,email,status,invited_user_id) VALUES($1,'foreign@example.invalid','pending',$2)", [foreignCompany, target])
    await invoke('canonical_change_tenant_user_access', disableCommand)
    expect(await row(String(result.invitation_id))).toMatchObject({ invited_user_id: target, status: 'invitation_revoked', revoked_at: expect.any(String) })
    expect((await db.query('SELECT status,revoked_at FROM company_invitations WHERE company_id=$1', [foreignCompany])).rows[0]).toEqual({ status: 'pending', revoked_at: null })
  })

  it('accepts the actual verified-user invitation and persists the mapped membership/role', async () => {
    await apply()
    const result = await invoke('canonical_create_tenant_invitation', inviteCommand)
    await db.query('UPDATE company_invitations SET invited_user_id=$1 WHERE id=$2', [invited, result.invitation_id])
    const command = { actor_user_id: invited, user_id: invited, invitation_id: result.invitation_id, idempotency_key: 'schema-accept' }
    expect(await invoke('canonical_accept_tenant_invitation', command)).toMatchObject({ changed: true, user_id: invited, membership_role: 'support', role_key: 'customer_service_agent' })
    expect(await invoke('canonical_accept_tenant_invitation', command)).toMatchObject({ changed: true, user_id: invited })
    expect((await db.query('SELECT membership_role,role_key,status,is_active FROM company_memberships WHERE user_id=$1', [invited])).rows[0]).toEqual({ membership_role: 'support', role_key: 'customer_service_agent', status: 'active', is_active: true })
    expect(await row(String(result.invitation_id))).toMatchObject({ status: 'accepted', invited_user_id: invited })
  })

  it('closes the ninth field used by the actual OPS invitation projection', async () => {
    await apply()
    const source = readFileSync('lib/tenant/governance.ts', 'utf8')
    const projection = /\.from\('company_invitations'\)\s*\.select\('([a-z_, ]+)'\)/.exec(source)?.[1]
    expect(projection).toContain('invited_email')
    await db.exec('ALTER TABLE company_invitations DROP COLUMN invited_email')
    await db.exec('SAVEPOINT actual_projection')
    await expect(db.query(`SELECT ${projection} FROM company_invitations WHERE company_id=$1`, [company]))
      .rejects.toMatchObject({ code: '42703', message: expect.stringContaining('invited_email') })
    await db.exec('ROLLBACK TO SAVEPOINT actual_projection; RELEASE SAVEPOINT actual_projection')
    await apply()
    const result = await db.query(`SELECT ${projection} FROM company_invitations WHERE company_id=$1`, [company])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ id: legacyId, email: 'legacy@example.invalid', invited_email: null, status: 'pending' })
  })

  it('closes all nine source-proven fields while leaving every old invitation byte and metadata unchanged', async () => {
    const original = await row(legacyId)
    const originalCatalog = await catalog()
    await apply()
    const after = await row(legacyId)
    for (const name of Object.keys(columns)) { expect(after[name]).toBeNull(); delete after[name] }
    expect(after).toEqual(original)
    const fields = await db.query<{ name: keyof typeof columns, type: string, not_null: boolean, default_expression: string | null }>(`SELECT attname AS name,format_type(atttypid,atttypmod) AS type,attnotnull AS not_null,pg_get_expr(default_record.adbin,default_record.adrelid) AS default_expression
      FROM pg_attribute attribute LEFT JOIN pg_attrdef default_record ON default_record.adrelid=attribute.attrelid AND default_record.adnum=attribute.attnum
      WHERE attribute.attrelid='company_invitations'::regclass AND attname=ANY($1::text[]) ORDER BY attname`, [Object.keys(columns)])
    expect(fields.rows).toHaveLength(9)
    for (const field of fields.rows) expect(field).toEqual({ name: field.name, type: columns[field.name], not_null: false, default_expression: null })
    const afterCatalog = await catalog()
    const { constraints: beforeConstraints, ...beforeOther } = originalCatalog
    const { constraints: afterConstraints, ...afterOther } = afterCatalog
    expect(afterOther).toEqual(beforeOther)
    expect(afterConstraints).toEqual(expect.arrayContaining(beforeConstraints))
    expect(afterConstraints.length).toBe(beforeConstraints.length + 2)
  })

  it('preserves production-like existing defaults, not-null flags, FKs, statuses, roles and tokens on reapplication', async () => {
    // Synthetic table state mirrors the source-proven existing production
    // metadata; no production rows or values are copied into this fixture.
    await db.exec(`ALTER TABLE company_invitations DROP CONSTRAINT company_invitations_company_id_fkey;
      ALTER TABLE company_invitations ADD CONSTRAINT company_invitations_company_id_fkey FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE;
      ALTER TABLE company_invitations ALTER COLUMN updated_at DROP NOT NULL;
      ALTER TABLE company_invitations ADD COLUMN temporary_password_issued_at timestamptz,ADD COLUMN temporary_password_expires_at timestamptz;
      ALTER TABLE company_invitations
      ADD COLUMN full_name text,ADD COLUMN membership_role text NOT NULL DEFAULT 'member',ADD COLUMN role_key text,
      ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid(),ADD COLUMN invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN accept_token_hash text,ADD COLUMN invited_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      ADD COLUMN revoked_at timestamptz,ADD COLUMN invited_email text;`)
    const before = await row(legacyId)
    const metadata = await db.query("SELECT attname,attnotnull,pg_get_expr(default_record.adbin,default_record.adrelid) AS definition FROM pg_attribute attribute LEFT JOIN pg_attrdef default_record ON default_record.adrelid=attribute.attrelid AND default_record.adnum=attribute.attnum WHERE attrelid='company_invitations'::regclass AND NOT attisdropped ORDER BY attnum")
    const beforeCatalog = await catalog()
    await apply(); await apply()
    expect(await row(legacyId)).toEqual(before)
    expect(await catalog()).toEqual(beforeCatalog)
    expect((await db.query("SELECT attname,attnotnull,pg_get_expr(default_record.adbin,default_record.adrelid) AS definition FROM pg_attribute attribute LEFT JOIN pg_attrdef default_record ON default_record.adrelid=attribute.attrelid AND default_record.adnum=attribute.attnum WHERE attrelid='company_invitations'::regclass AND NOT attisdropped ORDER BY attnum")).rows).toEqual(metadata.rows)
  })

  it('keeps the original actor/client/ceiling guard authoritative after closure', async () => {
    await apply()
    await db.exec('UPDATE integration_api_clients SET revoked_at=clock_timestamp()')
    await expect(invoke('canonical_create_tenant_invitation', inviteCommand)).rejects.toMatchObject({ code: '42501', message: 'staff_permission_denied' })
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM canonical_command_results')).rows[0].count).toBe(0)
    expect((await db.query<{ count: number }>('SELECT count(*)::integer AS count FROM audit_logs')).rows[0].count).toBe(0)
  })

  it('rejects an incompatible existing column and rolls back every other addition', async () => {
    await db.exec('ALTER TABLE company_invitations ADD COLUMN token text; SAVEPOINT incompatible_schema')
    const before = await row(legacyId)
    await expect(apply()).rejects.toMatchObject({ code: '22023', message: 'staff_invitation_domain_column_type_mismatch:token' })
    await db.exec('ROLLBACK TO SAVEPOINT incompatible_schema; RELEASE SAVEPOINT incompatible_schema')
    expect(await row(legacyId)).toEqual(before)
    expect((await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM pg_attribute WHERE attrelid='company_invitations'::regclass AND attname=ANY($1::text[]) AND NOT attisdropped", [Object.keys(columns)])).rows[0].count).toBe(1)
  })

  it('preserves every actual canonical and staff function body/configuration/ACL', async () => {
    const before = await db.query("SELECT proname,prosrc,prosecdef,proconfig,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'canonical_%' OR proname LIKE 'gridex_staff_%') ORDER BY proname,oid")
    await apply()
    const after = await db.query("SELECT proname,prosrc,prosecdef,proconfig,proacl::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'canonical_%' OR proname LIKE 'gridex_staff_%') ORDER BY proname,oid")
    expect(after.rows).toEqual(before.rows)
  })

  it('executes the entire mandatory native rollback script with its real invitation-link and acceptance assertions', async () => {
    await apply()
    const native = readFileSync('scripts/staff-user-commands-regression.sql', 'utf8')
      .replace(/^\\set .*$/gm, '')
      .replace(/^\\ir sql\/staff-native-role-catalog-fixture\.sql$/m, readFileSync('scripts/sql/staff-native-role-catalog-fixture.sql', 'utf8'))
      .replace(/^BEGIN;$/m, '').replace(/^ROLLBACK;$/m, '')
    await expect(db.exec(native)).resolves.toBeDefined()
  })
})
