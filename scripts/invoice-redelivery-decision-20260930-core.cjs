// PostgreSQL-core fixture. It executes production command/authority bodies;
// full native history, PostgREST and storage bytes are separate evidence gates.
const {readFileSync}=require('node:fs')
const {resolve}=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const id=n=>'ed170000-0000-4000-8000-'+String(n).padStart(12,'0')
async function createRedeliveryFixture(){
  const db=new PGlite()
  await db.exec(`create role service_role bypassrls; create role anon; create role authenticated;
    create schema private; create schema auth; create schema extensions;
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$ select sha256($1) $$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.companies(id uuid primary key,is_active boolean default true,status text default 'active',billing_settings jsonb default '{}');
    create table public.customers(id uuid primary key,company_id uuid,status text default 'active',archived_at timestamptz,billing_profile jsonb,billing_profile_revision bigint default 0);
    create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,billing_profile_override jsonb default '{}',billing_profile_override_revision bigint default 0);
    create table public.user_profiles(id uuid primary key,user_status text default 'active');
    create table public.company_memberships(id uuid primary key default gen_random_uuid(),company_id uuid,user_id uuid,is_active boolean default true,status text default 'active');
    create table public.admin_users(id uuid primary key,user_id uuid,is_active boolean,role text);
    create table public.roles(id uuid primary key,key text,name text,is_active boolean);
    create table public.permissions(id uuid primary key,key text,name text);
    create table public.user_roles(id uuid primary key,user_id uuid,company_id uuid,role_id uuid,role text,is_active boolean,status text);
    create table public.user_permissions(id uuid primary key,user_id uuid,company_id uuid,permission_id uuid,status text,is_active boolean,effect text);
    create table public.role_permissions(id uuid primary key,role_id uuid,permission_id uuid,effect text);
    create table public.customer_portal_accounts(id uuid primary key,company_id uuid,customer_id uuid,user_id uuid,portal_user_id uuid,role text,status text,is_active boolean);
    create table public.customer_portal_identities(id uuid primary key,company_id uuid,customer_id uuid,auth_user_id uuid,customer_portal_user_id uuid,external_account_id text,status text);
    create table public.invoice_export_items(id uuid primary key,company_id uuid,customer_id uuid,customer_contract_id uuid,provider text,environment text,status text,provider_invoice_guid text,request_payload jsonb);
    create table public.customer_invoices(id uuid primary key,company_id uuid,customer_id uuid,customer_contract_id uuid,contract_id uuid,invoice_export_item_id uuid,status text,issued_at timestamptz,paid_at timestamptz,updated_at timestamptz,partner_invoice_reference text,amount_inc_vat numeric,calculation_snapshot jsonb,unique(company_id,id));
    create table public.customer_invoice_lines(id uuid primary key,company_id uuid,customer_id uuid,invoice_id uuid,description text,amount_inc_vat numeric);
    create table public.customer_invoice_documents(id uuid primary key,company_id uuid,customer_id uuid,invoice_id uuid,file_path text,metadata jsonb);
    create table public.domain_events(id uuid primary key default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id text,subject_customer_id uuid,actor_user_id uuid,source text,payload jsonb,idempotency_key text unique);
    create table public.event_outbox(id uuid primary key default gen_random_uuid(),company_id uuid,domain_event_id uuid,destination_type text,destination_key text,status text,attempts integer,max_attempts integer,available_at timestamptz,payload jsonb,unique(domain_event_id,destination_type,destination_key));`)
  const schema=readFileSync(resolve(__dirname,'../supabase/schema.sql'),'utf8')
  for(const name of ['canonical_json_sha256','gridex_normalize_platform_role','gridex_get_user_permissions_in_company','gridex_actor_has_company_permission']){
    const start=schema.indexOf('CREATE FUNCTION public.'+name+'(')
    if(start<0) throw new Error('fixture_function_missing:'+name)
    await db.exec(schema.slice(start,schema.indexOf('$$;',start)+3))
  }
  for(const [file,name,tag] of [['20260928164025_contact_actor_lock_privilege.sql','gridex_contact_actor_active_v1','helper'],['20260930160000_support_case_atomic_commands.sql','gridex_support_session_active_v1','function'],['20260930144853_customer_profile_facility_atomic_commands.sql','gridex_profile_authority_lock_v1','function']]){
    const source=readFileSync(resolve(__dirname,'../supabase/migrations',file),'utf8')
    const start=source.indexOf('create '+(source.includes('create or replace function private.'+name)?'or replace ':'')+'function private.'+name+'(')
    await db.exec(source.slice(start,source.indexOf('$'+tag+'$;',start)+tag.length+4))
  }
  await db.exec(`insert into companies(id) values('${id(1)}'),('${id(2)}');
    insert into auth.users(id,email,email_confirmed_at) values('${id(3)}','staff@example.invalid',now()),('${id(4)}','new@example.invalid','2026-09-30T00:00:00Z');
    insert into auth.sessions values('${id(5)}','${id(3)}',null);
    insert into user_profiles(id) values('${id(3)}');
    insert into company_memberships(company_id,user_id) values('${id(1)}','${id(3)}');
    insert into permissions values('${id(6)}','billing_underlay.export','Export');
    insert into user_permissions values('${id(7)}','${id(3)}','${id(1)}','${id(6)}','active',true,'allow');
    insert into customers(id,company_id,billing_profile) values('${id(8)}','${id(1)}','{"recipient":"Synthetic Customer","distributionMethod":"email","email":"new@example.invalid"}');
    insert into customer_contracts(id,company_id,customer_id) values('${id(9)}','${id(1)}','${id(8)}');
    insert into customer_portal_accounts values('${id(10)}','${id(1)}','${id(8)}','${id(4)}','${id(4)}','owner','active',true);
    insert into invoice_export_items values('${id(11)}','${id(1)}','${id(8)}','${id(9)}','capway_aptic','test','sent','synthetic-provider-guid','{"customer":{"email":"original@example.invalid"},"amount":125}');
    insert into customer_invoices values('${id(12)}','${id(1)}','${id(8)}','${id(9)}','${id(9)}','${id(11)}','sent','2026-09-01T00:00:00Z',null,null,'synthetic-provider-guid',125,'{"financial":"original"}');
    insert into customer_invoice_lines values('${id(13)}','${id(1)}','${id(8)}','${id(12)}','Synthetic energy',125);
    insert into customer_invoice_documents values('${id(14)}','${id(1)}','${id(8)}','${id(12)}','synthetic/original.pdf','{"fixture_bytes":"synthetic-original-PDF"}');`)
  await db.exec('grant usage on schema public,private,extensions to service_role; grant all on all tables in schema public to service_role; grant execute on all functions in schema private to service_role;')
  const migration=readFileSync(resolve(__dirname,'../supabase/migrations/20260930222346_invoice_verified_redelivery_decision.sql'),'utf8')
  if(migration.trim()) await db.exec(migration)
  await db.exec('set role service_role;')
  const input={companyId:id(1),customerId:id(8),invoiceId:id(12),accountId:id(10),actorUserId:id(3),sessionId:id(5),expectedRevision:0,expectedOverrideRevision:0,idempotencyKey:'redelivery-test-0001',reason:'Explicit invoice copy decision'}
  const decide=(changes={})=>db.query('select public.gridex_record_invoice_redelivery_decision_v1($1::jsonb) as result',[JSON.stringify({...input,...changes})]).then(r=>r.rows[0].result)
  const snapshot=async()=>Object.fromEntries(await Promise.all(['customers','customer_contracts','invoice_export_items','customer_invoices','customer_invoice_lines','customer_invoice_documents'].map(async table=>[table,(await db.query('select to_jsonb(t) as value from '+table+' t order by id')).rows.map(r=>r.value)])))
  return {db,id,input,decide,snapshot}
}
module.exports={createRedeliveryFixture}
