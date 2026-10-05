// Bounded embedded PostgreSQL regression of the actual command/options/manual
// functions. Assignment/Z14/original/context authority ports below are declared
// synthetic fixtures; this proves no native replay or authentic legal approval.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,q=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb"
let checks=0,firstPermission
async function check(name,run){await run();checks++;console.log(`PASS ${name}`)}
async function service(sql){await db.exec('SET ROLE service_role');try{return(await db.query(sql)).rows[0]?.result}finally{await db.exec('RESET ROLE')}}
const actual=readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8')
function definition(name){const start=actual.indexOf(`CREATE FUNCTION ${name}(`),replace=actual.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`),at=start>=0?start:replace;if(at<0)throw Error(name);return actual.slice(at,actual.indexOf('$$;',actual.indexOf('$$',at))+3)}
const coordinate=(assignment=uid(4),version=1)=>service(`SELECT ediel_coordinate_service_permission_v1('${uid(1)}','${assignment}','${uid(2)}',${version??'NULL'},'request_access') result`)
const resolve=(permission,assignment=uid(4),version=1)=>service(`SELECT ediel_resolve_service_permission_command_v1('${uid(1)}','${assignment}','${uid(2)}',${version??'NULL'},'${permission}') result`)
const manual=selection=>service(`SELECT ediel_service_permission_manual_context_v1('${uid(1)}','${uid(2)}','${uid(3)}',${q(selection)}) result`)
const options=(ids,actor=uid(2))=>service(`SELECT ediel_service_permission_manual_options_v1('${uid(1)}','${actor}',ARRAY[${ids.map(id=>id===null?'NULL::uuid':`'${id}'::uuid`).join(',')}]::uuid[]) result`)
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE companies(id uuid PRIMARY KEY,name text);CREATE TABLE customers(id uuid PRIMARY KEY,company_id uuid NOT NULL,UNIQUE(company_id,id));
 CREATE TABLE user_profiles(id uuid PRIMARY KEY,user_status text);CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 CREATE TABLE permission_fixture(permission text PRIMARY KEY,allowed bool);INSERT INTO permission_fixture VALUES('metering.write',true),('metering.read',false);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE SQL AS 'SELECT allowed FROM public.permission_fixture WHERE permission=$3';
 CREATE TABLE ediel_service_assignments(id uuid PRIMARY KEY,company_id uuid NOT NULL,beneficiary_company_id uuid,provider_actor_id uuid,actor_profile_id uuid,customer_id uuid,dso_actor_id uuid,environment text,mode text,status text,version bigint,scope_basis_version bigint,purpose text,object_ids text[],product_ids text[],field_sets text[],data_start timestamptz,data_end timestamptz,valid_from timestamptz,valid_to timestamptz,UNIQUE(company_id,id));
 CREATE TABLE assignment_authority_fixture(assignment_id uuid PRIMARY KEY,allowed bool);
 CREATE FUNCTION ediel_service_assignment_assessment_v1(uuid,uuid) RETURNS jsonb LANGUAGE SQL AS 'SELECT CASE WHEN coalesce((SELECT allowed FROM public.assignment_authority_fixture WHERE assignment_id=$2),false) THEN jsonb_build_object(''status'',''authorized'') ELSE jsonb_build_object(''status'',''held'',''missing'',ARRAY[''synthetic_missing_approval'']) END';
 CREATE TABLE metering_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,customer_id uuid,status text,purpose_code text,permission_scope text,requested_start_date date,requested_end_date date,metadata jsonb,source_z13_message_id uuid,outbound_z13_message_id uuid,inbound_z14_message_id uuid,source_z14_message_id uuid,grid_owner_ediel_id text,UNIQUE(company_id,id));
 CREATE TABLE metering_permission_sites(id uuid PRIMARY KEY,company_id uuid,metering_permission_id uuid,customer_id uuid,facility_id text,status text,metadata jsonb,start_at timestamptz,end_at timestamptz,permission_end_at timestamptz);
 CREATE TABLE ediel_assignment_permission_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,assignment_id uuid,permission_id uuid,created_at timestamptz DEFAULT now(),UNIQUE(company_id,assignment_id,permission_id));
 CREATE TABLE tenant_actor_identifiers(id uuid PRIMARY KEY,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE platform_actor_identifiers(id uuid PRIMARY KEY,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 CREATE TABLE source_authority_fixture(allowed bool);INSERT INTO source_authority_fixture VALUES(true);
 CREATE FUNCTION ediel_permission_source_is_current_v1(uuid,uuid,uuid) RETURNS bool LANGUAGE SQL AS 'SELECT allowed FROM public.source_authority_fixture';
 CREATE TABLE ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,customer_id uuid,intent_id uuid,raw_payload text,status text,outbound_request_id uuid);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,source_type text,source_id uuid,request_type text,operation_id uuid,payload jsonb);
 CREATE SCHEMA gridex_service_permission;CREATE TABLE gridex_service_permission.origins(company_id uuid,permission_id uuid,assignment_id uuid,intent_id uuid,message_code text,basis jsonb,message_id uuid);
 CREATE TABLE context_authority_fixture(allowed bool);INSERT INTO context_authority_fixture VALUES(true);
 CREATE FUNCTION gridex_service_permission.context_v1(uuid,uuid,uuid,bigint,text,uuid) RETURNS jsonb LANGUAGE SQL AS 'SELECT CASE WHEN allowed THEN jsonb_build_object(''status'',''authorized'') ELSE jsonb_build_object(''status'',''held'',''missing'',ARRAY[''synthetic_missing_current_context'']) END FROM public.context_authority_fixture';
 CREATE SCHEMA gridex_ediel_outbound_owner;CREATE TABLE gridex_ediel_outbound_owner.fixture(company_id uuid,message_id uuid,sha text);
 CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM gridex_ediel_outbound_owner.fixture f JOIN public.ediel_messages e ON e.company_id=f.company_id AND e.id=f.message_id WHERE f.company_id=c AND f.message_id=m AND f.sha=encode(sha256(convert_to(e.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'synthetic_original_byte_witness_unavailable';END IF;RETURN '{}'::jsonb;END$$;
 CREATE TABLE customer_operation_tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,customer_id uuid,task_type text,status text,priority text,title text,description text,assigned_to uuid,metadata jsonb,created_by uuid,updated_by uuid);
 CREATE TABLE ediel_data_access_grants(company_id uuid,assignment_id uuid,status text,revoked_at timestamptz);
 CREATE SCHEMA gridex_service_administration;CREATE FUNCTION gridex_service_administration.immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 await db.exec(definition('gridex_service_administration.scope_v1'))
 await db.exec(definition('gridex_service_administration.permission_matches_assignment_v1'))
 await db.exec(definition('public.ediel_coordinate_service_permission_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001020640_ediel_service_permission_manual_source_commands.sql',import.meta.url),'utf8'))
 await db.exec(`INSERT INTO companies(id) VALUES('${uid(1)}'),('${uid(90)}');INSERT INTO customers VALUES('${uid(3)}','${uid(1)}'),('${uid(91)}','${uid(90)}');INSERT INTO auth.users VALUES('${uid(2)}');INSERT INTO user_profiles VALUES('${uid(2)}','active');INSERT INTO company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());
 INSERT INTO ediel_service_assignments VALUES('${uid(4)}','${uid(1)}','${uid(90)}','${uid(5)}','${uid(20)}','${uid(3)}','${uid(6)}','test','V','active',1,1,'analysis',ARRAY['point-a'],ARRAY['8716867000030'],ARRAY['quantity'],'2026-01-01','2030-01-01','2000-01-01',null);INSERT INTO assignment_authority_fixture VALUES('${uid(4)}',true);
 INSERT INTO tenant_actor_identifiers VALUES('${uid(8)}','${uid(1)}','test','${uid(5)}','EdielId','21660','2000-01-01',null);INSERT INTO platform_actor_identifiers VALUES('${uid(9)}','${uid(6)}','EdielId','54321',true,'2000-01-01',null);`)
 await check('own unfinished first request is resumable from the prospective owner',async()=>{
  const first=await coordinate();assert.equal(first.status,'permission_required');firstPermission=first.permissionId
  assert.equal((await coordinate()).status,'permission_required');assert.equal((await db.query('SELECT count(*) n FROM metering_permissions')).rows[0].n,1)
  assert.equal((await db.query('SELECT count(*) n FROM gridex_service_administration.permission_request_owners')).rows[0].n,1)
 })
 const first=firstPermission
 await check('null and stale versions fail closed before reuse',async()=>{await assert.rejects(resolve(first,uid(4),null),/scope_required/);await assert.rejects(resolve(first,uid(4),2),/version_stale/)})
 await check('pending-only manual original request reaches the same context selectors',async()=>{const r=await manual({permissionId:first,assignmentId:uid(4),expectedVersion:1,code:'Z13'});assert.equal(r.status,'authorized');assert.equal(r.permissionId,first);assert.equal(r.assignmentId,uid(4))})
 await check('missing mandate context is durable held without permission mutation',async()=>{
  await db.exec('UPDATE context_authority_fixture SET allowed=false');const before=(await db.query(`SELECT to_jsonb(p) row FROM metering_permissions p WHERE id='${first}'`)).rows[0].row
  const a=await manual({permissionId:first,code:'Z13'}),b=await manual({permissionId:first,code:'Z13'});assert.equal(a.status,'held');assert.equal(a.requestId,b.requestId)
  assert.deepEqual((await db.query(`SELECT to_jsonb(p) row FROM metering_permissions p WHERE id='${first}'`)).rows[0].row,before);await db.exec('UPDATE context_authority_fixture SET allowed=true')
 })
 await check('old checkbox/metadata-only draft is held without historical owner backfill',async()=>{
  await db.exec(`INSERT INTO metering_permissions(id,company_id,customer_id,status,metadata) VALUES('${uid(30)}','${uid(1)}','${uid(3)}','draft','{"service_assignment_id":"${uid(4)}","covers_metering_data":true}');INSERT INTO ediel_assignment_permission_links(company_id,assignment_id,permission_id) VALUES('${uid(1)}','${uid(4)}','${uid(30)}')`)
  assert.equal((await manual({permissionId:uid(30),code:'Z13'})).status,'held');assert.equal((await db.query(`SELECT count(*) n FROM gridex_service_administration.permission_request_owners WHERE permission_id='${uid(30)}'`)).rows[0].n,0)
 })
 await check('compatible second assignment waits on one source owner, no second request',async()=>{
  await db.exec(`INSERT INTO ediel_service_assignments SELECT '${uid(14)}',company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,status,version,scope_basis_version,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to FROM ediel_service_assignments WHERE id='${uid(4)}';INSERT INTO assignment_authority_fixture VALUES('${uid(14)}',true)`)
  const r=await coordinate(uid(14));assert.equal(r.status,'reuse_permission');assert.equal(r.marketPermissionState,'pending');assert.equal(r.permissionId,first);assert.equal(r.accessGranted,false);assert.equal((await db.query('SELECT count(*) n FROM metering_permissions')).rows[0].n,2)
 })
 await check('multiple actual links require explicit selection rather than latest',async()=>{assert.equal((await manual({permissionId:first,code:'Z13'})).status,'held');assert.equal((await manual({permissionId:first,assignmentId:uid(14),expectedVersion:1,code:'Z13'})).status,'reuse_permission')})
 await check('current source-approved compatible permission is reused without wire/grant/status changes',async()=>{
  await db.exec(`UPDATE metering_permissions SET status='active',source_z14_message_id='${uid(40)}',grid_owner_ediel_id='54321',metadata='{"marketPermission":{"legalActor":"21660","dsoActor":"54321","mode":"V"}}' WHERE id='${first}';INSERT INTO metering_permission_sites VALUES('${uid(41)}','${uid(1)}','${first}','${uid(3)}','point-a','approved','{"source":"inbound_prodat_z14","edielMessageId":"${uid(40)}","mode":"S17","product":"8716867000030"}','2026-01-01','2030-01-01',null)`)
  const before=(await db.query(`SELECT to_jsonb(p) row FROM metering_permissions p WHERE id='${first}'`)).rows[0].row,r=await resolve(first);assert.equal(r.status,'reuse_permission');assert.equal(r.marketPermissionState,'approved');assert.equal(r.accessGranted,false)
  assert.deepEqual((await db.query(`SELECT to_jsonb(p) row FROM metering_permissions p WHERE id='${first}'`)).rows[0].row,before);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_permission.origins')).rows[0].n,0);assert.equal((await db.query('SELECT count(*) n FROM ediel_data_access_grants')).rows[0].n,0)
 })
 for(const [name,mutate,restore] of [
  ['wrong product',`UPDATE metering_permission_sites SET metadata=metadata||'{"product":"other"}'`,`UPDATE metering_permission_sites SET metadata=metadata||'{"product":"8716867000030"}'`],
  ['reporting period narrowed',`UPDATE metering_permission_sites SET end_at='2029-01-01'`,`UPDATE metering_permission_sites SET end_at='2030-01-01'`],
  ['permission ended',`UPDATE metering_permission_sites SET permission_end_at='2000-01-01'`,`UPDATE metering_permission_sites SET permission_end_at=NULL`],
  ['wrong source mode',`UPDATE metering_permission_sites SET metadata=metadata||'{"mode":"S18"}'`,`UPDATE metering_permission_sites SET metadata=metadata||'{"mode":"S17"}'`],
  ['source attestation unavailable',`UPDATE source_authority_fixture SET allowed=false`,`UPDATE source_authority_fixture SET allowed=true`],
  ['current assignment approval revoked',`UPDATE assignment_authority_fixture SET allowed=false WHERE assignment_id='${uid(4)}'`,`UPDATE assignment_authority_fixture SET allowed=true WHERE assignment_id='${uid(4)}'`],
 ])await check(`${name} blocks approved reuse`,async()=>{await db.exec(mutate);assert.equal((await resolve(first)).status,'held');await db.exec(restore)})
 await check('declined permission never reactivated by request command',async()=>{await db.exec(`UPDATE metering_permissions SET status='rejected' WHERE id='${first}'`);assert.equal((await resolve(first)).status,'held');await db.exec(`UPDATE metering_permissions SET status='active' WHERE id='${first}'`)})
 await check('foreign/customer-mismatched permission is rejected before command',async()=>{await db.exec(`INSERT INTO metering_permissions(id,company_id,customer_id,status) VALUES('${uid(92)}','${uid(90)}','${uid(91)}','active')`);await assert.rejects(manual({permissionId:uid(92),code:'Z13'}),/not_owned/);await assert.rejects(options([first,uid(92)]),/not_owned/)})
 await check('page options expose every actual link and current version without authority',async()=>{const r=await options([first]);assert.equal(r.companyId,uid(1));assert.deepEqual(r.options.map(o=>o.assignmentId),[uid(4),uid(14)]);assert.equal(r.options[0].assignmentVersion,1);assert.equal(r.options[0].purpose,'analysis')})
 await check('page selectors reject duplicate, null, unbounded and inactive actors',async()=>{await assert.rejects(options([first,first]),/selection_invalid/);await assert.rejects(options([null]),/selection_invalid/);await assert.rejects(options(Array(101).fill(first)),/selection_invalid/);await assert.rejects(options([first],uid(99)),/forbidden/)})
 await check('read-only permission may see selectors but cannot originate',async()=>{await db.exec("UPDATE permission_fixture SET allowed=(permission='metering.read')");assert.equal((await options([first])).options.length,2);await assert.rejects(resolve(first),/actor_forbidden/);await db.exec("UPDATE permission_fixture SET allowed=(permission='metering.write')")})
 await check('manual date/mode selection cannot replace actual assignment source',async()=>{const r=await manual({permissionId:first,assignmentId:uid(4),expectedVersion:1,code:'Z13',mode:'VH',fromDate:'2025-01-01'});assert.equal(r.status,'held');assert.ok(r.missing.includes('selected_request_scope_differs_from_source_assignment'))})
 await check('unknown selection fields and missing explicit assignment version fail closed',async()=>{await assert.rejects(manual({code:'Z13',covers_metering_data:true}),/selection_invalid/);assert.equal((await manual({code:'Z13',assignmentId:uid(4)})).status,'held')})
 await check('unlinked manual operation is durable held, no arbitrary assignment chooser',async()=>{const r=await manual({code:'Z13'});assert.equal(r.status,'held');assert.ok(r.missing.includes('explicit_source_assignment_required'))})
 await check('termination context requires explicit permission and same current source port',async()=>{assert.equal((await manual({code:'Z18',assignmentId:uid(4),expectedVersion:1})).status,'held');assert.equal((await manual({code:'Z18',assignmentId:uid(4),expectedVersion:1,permissionId:first})).status,'authorized')})
 await check('prospective draft dates use actual fixed UTC+1 source instants across summer DST',async()=>{
  await db.exec(`INSERT INTO ediel_service_assignments SELECT '${uid(24)}',company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,status,version,scope_basis_version,'different-purpose',object_ids,product_ids,field_sets,'2026-07-01T22:00:00Z'::timestamptz,data_end,valid_from,valid_to FROM ediel_service_assignments WHERE id='${uid(4)}';INSERT INTO assignment_authority_fixture VALUES('${uid(24)}',true)`)
  const r=await coordinate(uid(24));assert.equal(r.status,'permission_required');const d=(await db.query(`SELECT requested_start_date::text source_day FROM metering_permissions WHERE id='${r.permissionId}'`)).rows[0];assert.equal(d.source_day,'2026-07-01')
 })
 await check('bound pending original compares exact private source/intent and retained bytes',async()=>{
  await db.exec(`UPDATE metering_permissions SET status='z13_ready',source_z13_message_id='${uid(50)}',outbound_z13_message_id='${uid(50)}' WHERE id='${first}';INSERT INTO ediel_messages VALUES('${uid(50)}','${uid(1)}','test','outbound','PRODAT','Z13','${uid(3)}','${uid(51)}','SYNTHETIC-IMMUTABLE-ORIGINAL','queued','${uid(53)}');INSERT INTO gridex_service_permission.origins VALUES('${uid(1)}','${first}','${uid(4)}','${uid(51)}','Z13','{"scopeBasisVersion":1}','${uid(50)}');INSERT INTO gridex_ediel_outbound_owner.fixture SELECT company_id,id,encode(sha256(convert_to(raw_payload,'UTF8')),'hex') FROM ediel_messages WHERE id='${uid(50)}'`)
  const r=await resolve(first);assert.equal(r.status,'reuse_permission');assert.equal(r.messageId,uid(50));assert.equal(r.marketPermissionState,'pending')
  await db.exec(`UPDATE ediel_messages SET raw_payload='CHANGED' WHERE id='${uid(50)}'`);await assert.rejects(resolve(first),/byte_witness_unavailable/);await db.exec(`UPDATE ediel_messages SET raw_payload='SYNTHETIC-IMMUTABLE-ORIGINAL',intent_id='${uid(52)}' WHERE id='${uid(50)}'`);assert.equal((await resolve(first)).status,'held')
 })
 await check('own bound first draft resumes only its exact retained intent/request',async()=>{
  await db.exec(`UPDATE ediel_messages SET intent_id='${uid(51)}',status='draft' WHERE id='${uid(50)}';INSERT INTO outbound_requests VALUES('${uid(53)}','${uid(1)}','${uid(3)}','manual','${uid(51)}','metering_access','${first}','{"servicePermissionCommandKey":"${uid(51)}","environment":"test"}')`)
  const r=await resolve(first);assert.equal(r.status,'permission_required');assert.equal(r.intentId,uid(51));assert.equal(r.outboundRequestId,uid(53));assert.equal(r.messageId,uid(50));assert.equal((await resolve(first,uid(14))).status,'reuse_permission')
  await db.exec(`UPDATE outbound_requests SET source_id='${uid(52)}'`);assert.equal((await resolve(first)).status,'held');await db.exec(`UPDATE outbound_requests SET source_id='${uid(51)}';UPDATE ediel_messages SET status='sent'`);assert.equal((await resolve(first)).status,'reuse_permission')
 })
 await check('private prospective/manual receipts remain immutable',async()=>{for(const table of ['permission_request_owners','manual_permission_requests']){await assert.rejects(db.exec(`UPDATE gridex_service_administration.${table} SET company_id='${uid(90)}'`),/immutable/);await assert.rejects(db.exec(`DELETE FROM gridex_service_administration.${table}`),/immutable/);await assert.rejects(db.exec(`TRUNCATE gridex_service_administration.${table}`),/immutable/)}})
 await check('service RPC ACLs and private tables have no session access',async()=>{
  const r=(await db.query(`SELECT has_function_privilege('authenticated','public.ediel_service_permission_manual_context_v1(uuid,uuid,uuid,jsonb)','execute') allowed,has_function_privilege('authenticated','public.ediel_service_permission_manual_options_v1(uuid,uuid,uuid[])','execute') options,has_table_privilege('service_role','gridex_service_administration.manual_permission_requests','select') table_allowed`)).rows[0];assert.deepEqual(r,{allowed:false,options:false,table_allowed:false})
 })
 await check('held request/task write is atomic under task failure',async()=>{await db.exec("CREATE FUNCTION reject_manual_task_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_task_failure';END$$;CREATE TRIGGER reject_manual_task BEFORE INSERT ON customer_operation_tasks FOR EACH ROW EXECUTE FUNCTION reject_manual_task_fixture()");const count=(await db.query('SELECT count(*) n FROM gridex_service_administration.manual_permission_requests')).rows[0].n;await assert.rejects(manual({code:'Z18'}),/task_failure/);assert.equal((await db.query('SELECT count(*) n FROM gridex_service_administration.manual_permission_requests')).rows[0].n,count)})
 console.log(`PASS ${checks} service/manual command checks; declared authority fixtures, native/authentic approval NOT RUN`)
}finally{await db.close()}
