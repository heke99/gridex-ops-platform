// Real PostgreSQL function bodies on a deliberately small synthetic schema.
// Full migration replay, PostgREST, auth cookies and concurrent connections
// are separate native gates; no authority function is replaced by a stub.
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const migration = '20260930223609_support_sensitive_contact_one_time_proof.sql'
const id = n => 'ed310000-0000-4000-8000-' + String(n).padStart(12, '0')
const digest = value => createHash('sha256').update(value).digest('hex')
async function createSensitiveContactFixture() {
  const db = new PGlite()
  await db.exec(`create role service_role bypassrls; create role anon; create role authenticated;
    create schema private; create schema auth; create schema extensions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
    create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table companies(id uuid primary key,is_active boolean default true,status text default 'active');
    create table customers(id uuid primary key,company_id uuid,status text default 'active',archived_at timestamptz,
      contact_revision bigint default 0,customer_type text default 'private',first_name text,last_name text,email text,phone text,
      updated_at timestamptz,updated_by uuid,unique(id,company_id));
    create table customer_contacts(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,type text,
      is_primary boolean,name text,title text,email text,phone text,created_by uuid,updated_by uuid,updated_at timestamptz);
    create table user_profiles(id uuid primary key,user_status text default 'active');
    create table company_memberships(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,is_active boolean default true,status text default 'active');
    create table admin_users(id uuid primary key,user_id uuid,is_active boolean,role text);
    create table roles(id uuid primary key,key text,name text,is_active boolean);
    create table permissions(id uuid primary key,key text,name text);
    create table user_roles(id uuid primary key,user_id uuid,company_id uuid,role_id uuid,role text,is_active boolean,status text);
    create table user_permissions(id uuid primary key,user_id uuid,company_id uuid,permission_id uuid,status text,is_active boolean,effect text);
    create table role_permissions(id uuid primary key,role_id uuid,permission_id uuid,effect text);
    create table integration_api_clients(id uuid primary key,company_id uuid,status text,revoked_at timestamptz,deleted_at timestamptz,expires_at timestamptz,scopes text[]);
    create table customer_portal_accounts(id uuid primary key,company_id uuid,customer_id uuid,user_id uuid,portal_user_id uuid,external_account_id text,role text,status text,is_active boolean);
    create table customer_portal_identities(id uuid primary key,company_id uuid,customer_id uuid,auth_user_id uuid,customer_portal_user_id uuid,external_account_id text,status text);
    create table customer_portal_completions(id uuid primary key,company_id uuid,customer_id uuid,api_client_id uuid,completion_type text,
      status text,submitted_payload jsonb,result_payload jsonb,idempotency_key text,request_hash text,completion_reference text,created_at timestamptz);
    create table customer_portal_write_idempotency(id uuid primary key,company_id uuid,api_client_id uuid,customer_id uuid,route text,
      idempotency_key text,request_hash text,status text,response_body jsonb,response_status int,completed_at timestamptz,updated_at timestamptz);
    create table customer_cases(id uuid primary key,company_id uuid,customer_id uuid,status text default 'open',source text default 'tenant_support_ops',
      metadata jsonb default '{"support_case":true}',support_revision bigint default 1,updated_at timestamptz,updated_by uuid,unique(id,company_id,customer_id));
    create table customer_case_events(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,customer_case_id uuid,
      event_type text,event_status text,message text,payload jsonb,created_by uuid);
    create table canonical_audit_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,
      state_version bigint,actor_user_id uuid,reason text,idempotency_key text,before_state jsonb,after_state jsonb,metadata jsonb,
      unique(company_id,event_type,idempotency_key));
    create table canonical_domain_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,
      aggregate_version bigint,idempotency_key text,payload jsonb,created_by uuid);
    create table canonical_event_outbox(id uuid primary key default gen_random_uuid(),company_id uuid,domain_event_id uuid,topic text,idempotency_key text,payload jsonb);
    create table canonical_command_results(id uuid primary key default gen_random_uuid(),company_id uuid,command_type text,idempotency_key text,
      request_payload jsonb,result_payload jsonb,actor_user_id uuid,request_hash text,unique(company_id,command_type,idempotency_key));`)
  const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
  for (const name of ['canonical_json_sha256','gridex_normalize_platform_role','gridex_get_user_permissions_in_company','gridex_actor_has_company_permission','canonical_command_request_hash_guard']) {
    const start = schema.indexOf('CREATE FUNCTION public.' + name + '(')
    if (start < 0) throw new Error('sensitive_fixture_missing_function:' + name)
    await db.exec(schema.slice(start, schema.indexOf('$$;', start) + 3))
  }
  await db.exec('create trigger canonical_request before insert on canonical_command_results for each row execute function canonical_command_request_hash_guard();')
  for (const [file, name, tag] of [
    ['20260928164025_contact_actor_lock_privilege.sql','gridex_contact_actor_active_v1','helper'],
    ['20260930144853_customer_profile_facility_atomic_commands.sql','gridex_profile_session_active_v1','function'],
    ['20260930144853_customer_profile_facility_atomic_commands.sql','gridex_profile_current_clock_v1','function'],
    ['20260930144853_customer_profile_facility_atomic_commands.sql','gridex_profile_authority_lock_v1','function'],
    ['20260930144853_customer_profile_facility_atomic_commands.sql','gridex_profile_command_authorize_v1','function'],
    ['20260930160000_support_case_atomic_commands.sql','gridex_support_session_active_v1','function'],
    ['20260930160000_support_case_atomic_commands.sql','gridex_support_actor_v1','function'],
  ]) {
    const source = readFileSync(resolve(__dirname, '../supabase/migrations', file), 'utf8')
    const start = source.indexOf('create ' + (source.includes('create or replace function private.' + name) ? 'or replace ' : '') + 'function private.' + name + '(')
    if (start < 0) throw new Error('sensitive_fixture_missing_helper:' + name)
    await db.exec(source.slice(start, source.indexOf('$' + tag + '$;', start) + tag.length + 4))
  }
  const source = readFileSync(resolve(__dirname, '../supabase/migrations/20260928164025_contact_actor_lock_privilege.sql'), 'utf8')
  const start = source.indexOf('create or replace function public.gridex_change_customer_contact_v1(')
  await db.exec(source.slice(start, source.indexOf('$function$;', start) + 12))
  await db.exec(readFileSync(resolve(__dirname, '../supabase/migrations/20260930152349_customer_contact_current_authority_command.sql'), 'utf8'))
  const forward = readFileSync(resolve(__dirname, '../supabase/migrations', migration), 'utf8')
  if (forward.trim()) await db.exec(forward)
  await db.exec(`insert into companies(id) values('${id(1)}'),('${id(2)}');
    insert into auth.users(id) values('${id(3)}'); insert into auth.sessions values('${id(4)}','${id(3)}',null);
    insert into user_profiles(id) values('${id(3)}'); insert into company_memberships(company_id,user_id) values('${id(1)}','${id(3)}');
    insert into permissions values('${id(5)}','cases.write','Support'),('${id(6)}','masterdata.write','Contact');
    insert into user_permissions values('${id(7)}','${id(3)}','${id(1)}','${id(5)}','active',true,'allow'),
      ('${id(8)}','${id(3)}','${id(1)}','${id(6)}','active',true,'allow');
    insert into customers(id,company_id,email,phone) values('${id(9)}','${id(1)}','old@example.invalid','+4600000'),
      ('${id(10)}','${id(1)}','other@example.invalid','+4600001');
    insert into customer_cases(id,company_id,customer_id) values('${id(11)}','${id(1)}','${id(9)}');
    grant usage on schema public,private,extensions to service_role; grant all on all tables in schema public to service_role;
    grant execute on all functions in schema private to service_role; set role service_role;`)
  const command = {companyId:id(1),customerId:id(9),caseId:id(11),actorUserId:id(3),sessionId:id(4),
    expectedCaseRevision:1,expectedContactRevision:0,idempotencyKey:'sensitive-contact-native-0001',reason:'Verified phone contact correction',changes:{phone:'+4600999'}}
  const bind = (changes = {}, proofChanges = {}) => {
    const request = {...command,...changes}
    const bindingJson = JSON.stringify({...request,action:'customer.support.contact.change.v1',channel:'phone'})
    const now = Math.floor(Date.now()/1000)
    return {command:{...request,bindingJson},proof:{action:'customer.support.contact.change.v1',issuerHash:digest('https://isolated.example.test'),
      subjectHash:digest('isolated-subject'),nonceHash:digest('unique-nonce'),issuedAt:now,expiresAt:now+120,requestHash:digest(bindingJson),...proofChanges}}
  }
  const execute = ({command: request,proof}) => db.query('select public.gridex_support_sensitive_contact_v1($1::jsonb,$2::jsonb) as result',
    [JSON.stringify(request),JSON.stringify(proof)]).then(r=>r.rows[0].result)
  const snapshot = async () => Object.fromEntries(await Promise.all(['customers','customer_contacts','customer_cases','customer_case_events','canonical_audit_events',
    'canonical_domain_events','canonical_event_outbox','canonical_command_results'].map(async table=>[table,(await db.query('select to_jsonb(t) as value from '+table+' t order by id')).rows.map(r=>r.value)])))
  return {db,id,command,bind,execute,snapshot}
}
module.exports = {createSensitiveContactFixture,migration}
