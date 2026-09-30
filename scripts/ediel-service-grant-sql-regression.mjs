// Targeted embedded PostgreSQL exercise, not native/replay/type/schema evidence.
// Run with EDIEL_PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const modulePath=process.env.EDIEL_PGLITE_MODULE
if(!modulePath) throw new Error('EDIEL_PGLITE_MODULE required; install pinned @electric-sql/pglite@0.3.14 in a temporary toolchain')
const {PGlite}=await import(pathToFileURL(modulePath).href)
const db=new PGlite()
const migration=readFileSync(new URL('../supabase/migrations/20260930143025_ediel_service_assignment_grants_v1.sql',import.meta.url),'utf8')
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
async function rejected(sql,match){await assert.rejects(db.exec(sql),match);checks++}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create table public.companies(id uuid primary key);
 create table public.customers(id uuid primary key,company_id uuid not null);
 create table public.platform_market_actors(id uuid primary key);
 create table public.tenant_ediel_profiles(id uuid primary key,company_id uuid not null,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_roles(company_id uuid,actor_id uuid,environment text,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_identifiers(company_id uuid,actor_id uuid,environment text,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table public.metering_permissions(id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid not null,status text,purpose_code text,permission_scope text,requested_start_date date,requested_end_date date,source_z14_message_id uuid,inbound_z14_message_id uuid,product_code text,metadata jsonb);
 create table public.metering_permission_sites(company_id uuid,metering_permission_id uuid,customer_id uuid,facility_id text,status text,start_date date,end_date date);
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean);
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 create table public.ediel_messages(id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,execution_context_snapshot jsonb);
 create table public.meter_reading_series(source_ediel_message_id uuid,id uuid primary key,company_id uuid,message_code text,series_kind text,external_metering_point_id text,product_id text,period_start timestamptz,period_end timestamptz,registration_date timestamptz,resolution text);
 create table public.meter_reading_values(id uuid primary key,company_id uuid,series_id uuid,reading_at timestamptz,quantity numeric,unit text,quality text,qualifier text);
 create table public.platform_table_classification(table_name text primary key,kind text,rationale text);`)
 await db.exec(migration);checks++
 // No new table, RPC or trigger function can be read/executed by PUBLIC/anon/authenticated.
 const acl=await db.query(`select has_function_privilege('anon','public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)','execute') as rpc,has_table_privilege('authenticated','public.ediel_data_access_grants','select') as tbl`)
 assert.deepEqual(acl.rows,[{rpc:false,tbl:false}]);checks++
 await db.exec(`insert into companies values('${uid(1)}'),('${uid(2)}'),('${uid(3)}');insert into customers values('${uid(10)}','${uid(1)}');insert into auth.users values('${uid(20)}');insert into platform_market_actors values('${uid(30)}'),('${uid(31)}');
 insert into tenant_ediel_profiles values('${uid(40)}','${uid(1)}','test','electricity',true,'2000-01-01',null);
 insert into tenant_actor_roles values('${uid(1)}','${uid(30)}','test','energy_service_company','2000-01-01',null);
 insert into tenant_actor_identifiers values('${uid(1)}','${uid(30)}','test','EdielId','21660','2000-01-01',null);
 insert into company_memberships values('${uid(1)}','${uid(20)}','active',true),('${uid(2)}','${uid(20)}','active',true);
 insert into ediel_service_assignments(id,company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,status) values('${uid(50)}','${uid(1)}','${uid(2)}','${uid(30)}','${uid(40)}','${uid(10)}','${uid(31)}','test','V','analysis',array['point-a'],array['8716867000030'],array['quantity','reading_at'],'2026-01-01','2027-01-01','2000-01-01','active');`)
 let result=await db.query(`select ediel_service_assignment_assessment_v1('${uid(1)}','${uid(50)}') as assessment`)
 assert.equal(result.rows[0].assessment.status,'held');assert.equal(result.rows[0].assessment.missing.length,5);checks++
 await rejected(`select ediel_coordinate_service_permission_v1('${uid(3)}','${uid(50)}','${uid(20)}',1,'request_access')`,/ediel_service_command_forbidden/)
 await db.exec(`insert into ediel_service_evidence(company_id,assignment_id,kind,source_reference,source_sha256,source_version,valid_from,status,approved_by,approved_at) select '${uid(1)}','${uid(50)}',kind,'SYNTHETIC FIXTURE ONLY',repeat('a',64),'test','2000-01-01','verified','${uid(20)}','2000-01-01' from unnest(array['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']) kind`)
 result=await db.query(`select ediel_coordinate_service_permission_v1('${uid(1)}','${uid(50)}','${uid(20)}',1,'request_access') as command`)
 assert.equal(result.rows[0].command.status,'permission_required');const permission=result.rows[0].command.permissionId;checks++
 result=await db.query(`select ediel_coordinate_service_permission_v1('${uid(1)}','${uid(50)}','${uid(20)}',1,'request_access') as command`)
 assert.equal(result.rows[0].command.status,'reuse_permission');assert.equal(result.rows[0].command.permissionId,permission);checks++
 await db.exec(`update metering_permissions set status='active',source_z14_message_id='${uid(60)}',product_code='8716867000030' where id='${permission}';insert into metering_permission_sites values('${uid(1)}','${permission}','${uid(10)}','point-a','approved','2026-01-01','2026-12-31');
 insert into ediel_data_access_grants(id,company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,status) select '${uid(70)}','${uid(1)}','${uid(2)}','${uid(50)}',id,array['point-a'],array['8716867000030'],array['quantity','reading_at'],'analysis','2026-01-01','2027-01-01','2000-01-01','active' from ediel_assignment_permission_links where assignment_id='${uid(50)}';
 insert into ediel_messages values('${uid(60)}','${uid(1)}','test','inbound','PRODAT','Z14','{}'),('${uid(61)}','${uid(1)}','test','inbound','UTILTS','E66','{"receiverActorId":"${uid(30)}","senderActorId":"${uid(31)}","receiverRole":"esco"}');insert into meter_reading_series values('${uid(61)}','${uid(80)}','${uid(1)}','E66','actual','point-a','8716867000030','2026-01-01','2027-01-01','2026-01-03','PT15M');insert into meter_reading_values values('${uid(90)}','${uid(1)}','${uid(80)}','2026-01-02',1.234,'KWH','actual','136');`)
 const project=(fields="array['quantity']",version=1)=>`select ediel_beneficiary_series_page_v1('${uid(2)}','${uid(20)}','${uid(70)}',${version},'analysis','${uid(80)}',${fields},'2026-01-01','2026-01-03') as projection`
 result=await db.query(project());assert.deepEqual(result.rows[0].projection.rows,[{quantity:1.234}]);checks++
 await rejected(project("array['raw_transaction']"),/ediel_projection_outside_grant/)
 await rejected(project('null'),/ediel_projection_request_invalid/)
 await db.exec(`update meter_reading_series set product_id=null where id='${uid(80)}'`)
 await rejected(project(),/ediel_series_outside_grant/)
 await db.exec(`update meter_reading_series set product_id='8716867000030' where id='${uid(80)}';update ediel_data_access_grants set status='revoked',revoked_at=now() where id='${uid(70)}'`)
 await rejected(project("array['quantity']",2),/ediel_grant_not_current/)
 await db.exec(`update metering_permissions set status='ended' where id='${permission}';update metering_permissions set status='active' where id='${permission}'`)
 await rejected(`update ediel_data_access_grants set status='active' where id='${uid(70)}'`,/ediel_revoked_grant_requires_new_basis/)
 console.log(`PASS ${checks} targeted PostgreSQL service/grant checks; synthetic fixture; not native/replay evidence`)
}finally{await db.close()}
