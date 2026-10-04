import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const file = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8')
const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const foreignCompany = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const client = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const customer = '11111111-1111-4111-8111-111111111111'
const caseId = '22222222-2222-4222-8222-222222222222'
const normalizedContext = `ARRAY['actor_type','system_actor','request_id','correlation_id','resource_type','resource_id','previous_status','new_status']::text[]`
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
    CREATE TABLE user_roles(user_id uuid);
    CREATE TABLE integration_api_clients(id uuid PRIMARY KEY,company_id uuid,name text,key_prefix text,secret_hash text,status text,scopes text[],deleted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE customer_cases(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,case_type text,source text,metadata jsonb,
      billing_blocked boolean,billing_manual_review boolean,cancellation_required boolean,updated_by uuid,updated_at timestamptz,resolved_at timestamptz,closed_at timestamptz);
    CREATE TABLE customer_case_events(company_id uuid,customer_case_id uuid,customer_id uuid,event_type text,event_status text,message text,payload jsonb,created_by uuid);
    CREATE TABLE audit_logs(company_id uuid,actor_user_id uuid,entity_type text,entity_id text,action text,old_values jsonb,new_values jsonb,metadata jsonb,
      actor_type text,system_actor text,request_id text,correlation_id text,resource_type text,resource_id text,previous_status text,new_status text);
    -- Controlled legacy dependencies: the actual shared core and actual staff
    -- profile/actor/client policy run below. A missing legacy grant must never
    -- affect staff authorization, while OPS still depends on this resolver.
    CREATE TABLE legacy_authority(allowed boolean,platform boolean);
    INSERT INTO legacy_authority VALUES(true,false);
    CREATE FUNCTION canonical_actor_is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT platform FROM public.legacy_authority$$;
    CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT allowed FROM public.legacy_authority$$;
  `)
  const audit = file('20260727040000_contract_security_energy_direction_api_completion.sql')
  await db.exec(audit.slice(audit.indexOf('create or replace function public.gridex_normalize_audit_context_v1()'), audit.indexOf('alter table public.audit_logs\n  alter column actor_type')))
  const policy = file('20261004083640_staff_user_commands.sql')
  await db.exec(policy.slice(0, policy.indexOf('CREATE FUNCTION public.gridex_assert_staff_command_v1')) + 'COMMIT;')
  await db.exec(file('20261004093111_staff_write_actor_guard.sql'))
  const restored = file('20260923180557_restore_customer_case_events_atomic_status.sql')
  await db.exec(restored.slice(restored.indexOf('CREATE OR REPLACE FUNCTION public.gridex_update_customer_case_status(')))
  const cases = file('20261004084206_staff_case_write_attribution.sql')
  await db.exec(cases.slice(cases.indexOf('CREATE FUNCTION public.gridex_update_customer_case_status_with_actor_v1('), cases.indexOf('CREATE FUNCTION public.gridex_audit_staff_support_attachment_v1()')))
  // Explicit opt-in diagnostic runs the SAME assertions against frozen old
  // source; CI/default always tests the forward. No production oracle changes.
  if (process.env.GRIDEX_STAFF_STATUS_TEST_SOURCE !== 'old') {
    await db.exec(file('20261004115007_staff_case_status_actor_compatibility.sql'))
  }
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies VALUES('${company}','Synthetic company','active',true),('${foreignCompany}','Foreign company','active',true);
    INSERT INTO auth.users(id) VALUES('${actor}');
    INSERT INTO user_profiles(id,user_status) VALUES('${actor}','active');
    INSERT INTO company_memberships VALUES('${company}','${actor}','company_admin','company_admin','active',true,now());
    INSERT INTO integration_api_clients(id,company_id,status,scopes) VALUES('${client}','${company}','active',ARRAY['staff_cases.write']);
    INSERT INTO customer_cases(id,company_id,customer_id,status,case_type,source,metadata,billing_blocked,billing_manual_review,cancellation_required)
      VALUES('${caseId}','${company}','${customer}','open','other','tenant_support_staff_api','{"support_case":true}',false,false,false);`)
})
afterEach(async () => { await db.exec('ROLLBACK') })

async function core(channel: string | null = 'staff_api', clientId: string | null = client) {
  await db.exec('SAVEPOINT status_assertion')
  try {
    const result = await db.query<{ result: { status: string } }>('SELECT public.gridex_update_customer_case_status_with_actor_v1($1,$2,$3,$4,$5,$6,$7,$8) AS result', [caseId, company, 'resolved', actor, null, 'Support resolved.', channel, clientId])
    await db.exec('RELEASE SAVEPOINT status_assertion')
    return result.rows[0].result
  } catch (error) {
    await db.exec('ROLLBACK TO SAVEPOINT status_assertion; RELEASE SAVEPOINT status_assertion')
    throw error
  }
}

async function writes() {
  const state = await db.query<{ status: string, events: number, audits: number }>(`SELECT status,
    (SELECT count(*)::integer FROM customer_case_events) AS events,(SELECT count(*)::integer FROM audit_logs) AS audits FROM customer_cases WHERE id='${caseId}'`)
  return state.rows[0]
}

it.each(['ops', 'customer_portal', null])('preserves legacy nonstaff event/audit JSON and actor columns for channel %s', async (channel) => {
  expect(await core(channel, null)).toMatchObject({ status: 'resolved' })
  const event = await db.query<{ payload: unknown, created_by: string, message: string, event_status: string }>('SELECT payload,created_by,message,event_status FROM customer_case_events')
  expect(event.rows[0]).toEqual({ payload: { status: 'resolved' }, created_by: actor, message: 'Support resolved.', event_status: 'success' })
  const audit = await db.query(`SELECT metadata-${normalizedContext} AS metadata,actor_user_id,old_values,new_values,
    actor_type,system_actor,resource_type,resource_id,previous_status,new_status,
    request_id<>'' AND correlation_id<>'' AS context_present FROM audit_logs`)
  expect(audit.rows[0]).toEqual({ metadata: { customer_id: customer }, actor_user_id: actor,
    old_values: { status: 'open' }, new_values: { status: 'resolved', message: 'Support resolved.' },
    actor_type: 'user', system_actor: null, resource_type: 'customer_case', resource_id: caseId,
    previous_status: 'open', new_status: 'resolved', context_present: true })
})

it('preserves the original six-argument OPS wrapper and its exact status-only event', async () => {
  await db.query('SELECT public.gridex_update_customer_case_status($1,$2,$3,$4,$5,$6)', [caseId, company, 'resolved', actor, null, 'Support resolved.'])
  const event = await db.query<{ payload: unknown }>('SELECT payload FROM customer_case_events')
  expect(event.rows[0].payload).toEqual({ status: 'resolved' })
})

it('authorizes recognized staff directly from the strict profile even without legacy grants and keeps attribution', async () => {
  await db.exec('UPDATE legacy_authority SET allowed=false')
  await expect(core()).resolves.toMatchObject({ status: 'resolved' })
  const event = await db.query<{ payload: unknown, created_by: string }>('SELECT payload,created_by FROM customer_case_events')
  expect(event.rows[0]).toEqual({ payload: { status: 'resolved', channel: 'staff_api', actor_user_id: actor, api_client_id: client }, created_by: actor })
  const audit = await db.query(`SELECT metadata-${normalizedContext} AS metadata,actor_user_id,
    actor_type,system_actor,resource_type,resource_id,previous_status,new_status,
    request_id<>'' AND correlation_id<>'' AS context_present FROM audit_logs`)
  expect(audit.rows[0]).toEqual({ metadata: { customer_id: customer, channel: 'staff_api', api_client_id: client }, actor_user_id: actor,
    actor_type: 'user', system_actor: null, resource_type: 'customer_case', resource_id: caseId,
    previous_status: 'open', new_status: 'resolved', context_present: true })
})

it.each([
  ["UPDATE company_memberships SET role_key='finance_readonly'", 'staff_api_actor_not_authorized'],
  ['UPDATE integration_api_clients SET revoked_at=clock_timestamp()', 'staff_api_client_not_in_scope'],
  ["UPDATE integration_api_clients SET company_id='" + foreignCompany + "'", 'staff_api_client_not_in_scope'],
  ["UPDATE integration_api_clients SET scopes=ARRAY['*']", 'staff_api_client_not_in_scope'],
])('rejects fresh direct-core staff eligibility %s without case/event/audit changes', async (patch, message) => {
  await db.exec(patch)
  await expect(core()).rejects.toMatchObject({ code: '42501', message })
  expect(await writes()).toEqual({ status: 'open', events: 0, audits: 0 })
})

it('rejects direct staff-core mutations of operational cases despite an attached support marker', async () => {
  await db.exec("UPDATE customer_cases SET source='ediel_inbound_state_machine',case_type='technical_blocker',billing_blocked=true")
  await expect(core()).rejects.toMatchObject({ code: 'P0002', message: 'customer_case_not_found_in_scope' })
  expect(await writes()).toEqual({ status: 'open', events: 0, audits: 0 })
})

it('keeps legacy OPS permission denial and Ediel platform denial unchanged', async () => {
  await db.exec('UPDATE legacy_authority SET allowed=false')
  await expect(core('ops', null)).rejects.toMatchObject({ code: '42501', message: 'customer_case_status_actor_not_authorized' })
  await db.exec("UPDATE legacy_authority SET platform=true; UPDATE customer_cases SET source='ediel_inbound_state_machine'")
  await expect(core('ops', null)).rejects.toMatchObject({ code: '42501', message: 'ediel_case_status_requires_tenant_actor' })
  expect(await writes()).toEqual({ status: 'open', events: 0, audits: 0 })
})

it('rolls back status and event if a staff audit fails', async () => {
  await db.exec(`CREATE FUNCTION pg_temp.reject_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_status_audit_failure'; END$$;
    CREATE TRIGGER status_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_status_audit()`)
  await expect(core()).rejects.toMatchObject({ message: 'synthetic_status_audit_failure' })
  expect(await writes()).toEqual({ status: 'open', events: 0, audits: 0 })
})

it('preserves the core and wrapper service-only ACLs and empty search paths', async () => {
  for (const signature of ['gridex_update_customer_case_status_with_actor_v1(uuid,uuid,text,uuid,text,text,text,uuid)', 'gridex_update_customer_case_status(uuid,uuid,text,uuid,text,text)', 'gridex_staff_update_customer_case_status(uuid,uuid,uuid,uuid,text,text,text)']) {
    const grants = await db.query<{ anon: boolean, authenticated: boolean, service: boolean, invoker: boolean, empty_path: boolean }>(`SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,has_function_privilege('service_role',$1,'EXECUTE') AS service,
      NOT prosecdef AS invoker,proconfig @> ARRAY['search_path=""'] AS empty_path FROM pg_proc WHERE oid=$1::regprocedure`, ['public.' + signature])
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service: true, invoker: true, empty_path: true })
  }
})

it.each([
  'native OPS status wrapper preserves status-only event payload and legacy audit metadata',
  'native shared staff status core uses fresh staff profile/client authority without legacy catalogue grants',
])('executes new native SQL against the actual status and audit source: %s', async (name) => {
  const source = readFileSync('scripts/staff-case-write-native.test.ts', 'utf8')
  const section = source.slice(source.indexOf(`it('${name}'`))
  const template = section.match(/f\.run\(`([\s\S]*?)`\)\)\.not\.toThrow\(\)/)?.[1]
  expect(template).toBeDefined()
  const values: Record<string, string> = { companyId: company, actorId: actor, clientId: client,
    customerId: customer, caseId, foreignClientId: '99999999-9999-4999-8999-999999999999' }
  const sql = template!.replace(/\$\{f\.([a-zA-Z]+)\}/g, (_, key: string) => {
    if (!values[key]) throw Error(`native_fixture_value_missing:${key}`)
    return values[key]
  })
  if (name.includes('without legacy')) {
    await db.exec(`UPDATE legacy_authority SET allowed=false;
      INSERT INTO integration_api_clients(id,company_id,status,scopes)
      VALUES('${values.foreignClientId}','${foreignCompany}','active',ARRAY['staff_cases.write'])`)
  }
  await expect(db.exec(sql)).resolves.toBeDefined()
})
