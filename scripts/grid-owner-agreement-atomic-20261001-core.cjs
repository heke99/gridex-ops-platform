const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const migration = '20261001020409_grid_owner_access_agreement_atomic_provisioning.sql'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function actualFunction(source, name, tag = '') {
  const pattern = new RegExp(`create(?: or replace)? function ${name.replaceAll('.', '\\.')}\\(`, 'i')
  const start = source.search(pattern)
  if (start < 0) throw new Error('agreement_fixture_missing_function:' + name)
  const end = source.indexOf(`$${tag}$;`, start)
  if (end < 0) throw new Error('agreement_fixture_missing_function_end:' + name)
  return source.slice(start, end + tag.length + 4)
}
function actualTable(schema, name) {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`)
  if (start < 0) throw new Error('agreement_fixture_missing_table:' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
async function fixture(options = {}) {
  const db = new PGlite()
  await db.exec(`create schema auth; create schema private; create schema storage;
    create role anon; create role authenticated; create role service_role;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table user_profiles(id uuid primary key,user_status text not null default 'active');
    create table companies(id uuid primary key,is_active boolean default true,status text default 'active',lifecycle_status text default 'active',archived_at timestamptz);
    create table roles(id uuid primary key,key text,name text);
    create table admin_users(id uuid primary key default gen_random_uuid(),user_id uuid,role text,is_active boolean default true);
    create table user_roles(id uuid primary key default gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,role text,status text default 'active',is_active boolean default true);
    create table communication_routes(id uuid primary key,company_id uuid,grid_owner_id uuid);
    create table platform_table_classification(table_name text primary key,kind text,rationale text,null_company_meaning text,classified_by text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.buckets enable row level security; alter table storage.objects enable row level security;
    create policy inherited_storage_bucket_read on storage.buckets for select to anon,authenticated using(true);
    create policy inherited_storage_object_read on storage.objects for select to anon,authenticated using(true);
    grant usage on schema storage to anon,authenticated; grant select on storage.buckets,storage.objects to anon,authenticated;
    grant usage on schema public,private to service_role;
    grant usage on schema public to anon,authenticated;`)
  const schema = readFileSync(resolve(__dirname, '../supabase/schema.sql'), 'utf8')
  for (const name of ['grid_owners','audit_logs']) {
    await db.exec(actualTable(schema, name))
    await db.exec(`alter table ${name} add primary key(id)`)
  }
  for (const name of ['public.gridex_normalize_platform_role','public.canonical_actor_is_platform_admin']) {
    await db.exec(actualFunction(schema, name))
  }
  for (const [file,name,tag] of [
    ['20260928164025_contact_actor_lock_privilege.sql','private.gridex_contact_actor_active_v1','helper'],
    ['20260930144853_customer_profile_facility_atomic_commands.sql','private.gridex_profile_session_active_v1','function'],
  ]) await db.exec(actualFunction(readFileSync(resolve(__dirname, '../supabase/migrations', file),'utf8'), name, tag))
  let historical
  if(options.legacy){
    const old=readFileSync(resolve(__dirname,'../supabase/migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql'),'utf8')
    const start=old.indexOf('create table if not exists public.grid_owner_access_agreements (')
    await db.exec(old.slice(start,old.indexOf('\n);',start)+3))
    await db.exec("insert into grid_owner_access_agreements(id,agreement_reference,metadata,created_at,updated_at) values('"+id(17)+"','Historical preserved agreement','{\"historical\":true}','2026-05-01','2026-05-02')")
    historical=(await db.query("select to_jsonb(t) as value from grid_owner_access_agreements t where id='"+id(17)+"'")).rows[0].value
    if(options.incompatible)await db.exec("alter table grid_owner_access_agreements alter column metadata drop default; alter table grid_owner_access_agreements alter column metadata type text using metadata::text")
    if(options.missingPrimaryKey)await db.exec('alter table grid_owner_access_agreements drop constraint grid_owner_access_agreements_pkey')
    if(options.nullableMetadata)await db.exec('alter table grid_owner_access_agreements alter column metadata drop not null')
    if(options.forcedRls)await db.exec('alter table grid_owner_access_agreements force row level security')
    if(options.incompatibleRevision)await db.exec('alter table grid_owner_access_agreements add column revision text')
  }
  const forward = readFileSync(resolve(__dirname, '../supabase/migrations', migration), 'utf8')
  try{if (forward.trim()) await db.exec(forward)}catch(error){await db.close();throw error}
  await db.exec(`insert into companies(id) values('${id(1)}'),('${id(2)}');
    insert into auth.users(id,email_confirmed_at) values('${id(3)}',now()),('${id(5)}',now());
    insert into auth.sessions(id,user_id) values('${id(4)}','${id(3)}'),('${id(6)}','${id(5)}');
    insert into user_profiles(id) values('${id(3)}'),('${id(5)}');
    insert into admin_users(user_id,role) values('${id(3)}','platform_admin');
    insert into user_roles(user_id,company_id,role) values('${id(5)}','${id(1)}','platform_admin');
    insert into grid_owners(id,company_id,name) values('${id(7)}','${id(1)}','Owned grid owner'),('${id(8)}','${id(2)}','Foreign grid owner');
    set role service_role;`)
  const command = { operation:'save',actorUserId:id(3),sessionId:id(4),companyId:id(1),idempotencyKey:'agreement-native-create-0001',expectedRevision:0,
    payload:{gridOwnerId:id(7),agreementType:'metering_access',agreementScope:'metering_access',status:'draft',agreementReference:'Owned agreement',metadata:{},referenceRequirements:{}} }
  const execute = changes => db.query('select public.gridex_grid_owner_agreement_command_v1($1::jsonb) as result', [JSON.stringify({...command,...changes})]).then(r => r.rows[0].result)
  const root = async sql => { await db.exec('reset role'); try { return await db.query(sql) } finally { await db.exec('set role service_role') } }
  const snapshot = () => root(`select jsonb_build_object('agreements',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from grid_owner_access_agreements t),
    'owners',(select jsonb_agg(to_jsonb(t) order by id) from grid_owners t),'auditLogs',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from audit_logs t),'audits',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.gridex_agreement_audit_v1 t),
    'results',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from private.gridex_agreement_results_v1 t)) as value`).then(r => r.rows[0].value)
  return { db, id, command, execute, root, snapshot, historical }
}
module.exports = { fixture, migration, actualFunction, actualTable }
