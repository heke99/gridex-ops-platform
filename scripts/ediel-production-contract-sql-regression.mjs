// Focused embedded PostgreSQL guards with synthetic contract/event fixtures.
// No authentic source approval, native migration replay or market send evidence.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`, q = v => `'${String(v).replaceAll("'", "''")}'`
let checks = 0
function fn(path,name){const s=readFileSync(new URL(path,import.meta.url),'utf8'),start=s.indexOf(`CREATE FUNCTION ${name}`),end=s.indexOf('$$;',start);if(start<0||end<0)throw Error(name);return s.slice(start,end+3)}
async function service(sql){await db.exec('set role service_role');try{return await db.query(sql)}finally{await db.exec('reset role')}}
const read=event=>service(`select ediel_production_contract_source_v1('${uid(1)}','${event}','${uid(2)}') b`)
const reserve=(event,intent)=>service(`select ediel_reserve_production_contract_origin_v1('${uid(1)}','${event}','${uid(2)}','${intent}','${intent}') b`)
const wire=(kind='signed',minute='202610011300')=>`UNB+UNOC:3+12345:ZZ+54321:ZZ+260930:1200+I++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E5SE2A'BGM+Z09+DOC+9'DTM+137:202609301300:203'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++A:::89'CCI++Z13'CAV+Z70'RFF+LI:LI'RFF+Z05:TES'DTM+${kind==='signed'?'92':'93'}:${minute}:203'UNT+12+1'UNZ+1+I'`
const insert=(id,intent,event,raw)=>db.exec(`insert into ediel_messages values('${id}','${intent}','${uid(1)}','test','outbound','PRODAT','Z09','${event}','${intent}','${uid(3)}','${uid(5)}',${q(raw)},'${uid(30)}',now(),encode(sha256(convert_to(${q(raw)},'UTF8')),'hex'))`)
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create schema gridex_received_sources;create table companies(id uuid primary key);create table customers(id uuid primary key,company_id uuid);
 create table user_profiles(id uuid primary key,user_status text);create table company_memberships(id uuid primary key,company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
 create function gridex_actor_has_company_permission(uuid,uuid,text) returns bool language sql as $$select true$$;
 create table customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,contract_version text,signed_version text,signed_at timestamptz,version_snapshot jsonb);
 create table metering_points(id uuid primary key,company_id uuid,customer_id uuid,product_direction text,ediel_metering_point_id text,grid_owner_ediel_id text,grid_area_code text,site_id uuid);
 create table customer_sites(id uuid primary key,company_id uuid,customer_id uuid);
 create table tenant_ediel_profiles(id uuid primary key,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 create table tenant_actor_identifiers(id uuid primary key,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table tenant_actor_roles(id uuid primary key,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table platform_market_actors(id uuid primary key,status text,match_status text);create table platform_actor_roles(id uuid primary key,actor_id uuid,actor_role text,is_active bool);
 create table platform_actor_identifiers(id uuid primary key,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 create table ediel_message_intents(id uuid primary key,company_id uuid,environment text,message_family text,message_code text,customer_id uuid,metering_point_id text,operation_id uuid,ediel_message_id uuid,outbound_request_id uuid,validation_status text);
 create table outbound_requests(id uuid primary key,company_id uuid,customer_id uuid,source_type text,source_id uuid,request_type text,payload jsonb,operation_id uuid,site_id uuid,metering_point_id uuid);
 create table ediel_messages(id uuid primary key,intent_id uuid,company_id uuid,environment text,direction text,message_family text,message_code text,source_operation_id text,outbound_request_id uuid,customer_id uuid,metering_point_id uuid,raw_payload text,site_id uuid,immutable_rendered_at timestamptz,immutable_payload_hash text);`)
await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.wire_tokens_bounded_v1'))
await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.closure_wire_tokens_v2'))
await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql','gridex_received_sources.permission_transition_immutable_v1'))
await db.exec(fn('../supabase/migrations/20260930164804_ediel_prodat_retry_correction_authority.sql','gridex_received_sources.prodat_recovery_wire_v1'))
await db.exec(readFileSync(new URL('../supabase/migrations/20260930174333_ediel_production_contract_source_commands.sql',import.meta.url),'utf8'));checks++
 await db.exec(`CREATE TABLE gridex_received_sources.prodat_recovery_operations(id uuid PRIMARY KEY,company_id uuid,original_message_id uuid,corrected_raw_payload text,corrected_payload_hash text,kind text);CREATE TABLE gridex_received_sources.prodat_recovery_messages(operation_id uuid,message_id uuid)`)
 const repair=readFileSync(new URL('../supabase/migrations/20260930221158_ediel_source_qualified_switch_correction_binding.sql',import.meta.url),'utf8')
 for(const name of ['gridex_received_sources.production_contract_source_for_execution_v1','public.ediel_production_contract_source_v1','public.ediel_reserve_production_contract_origin_v1','public.ediel_production_contract_message_basis_v1','gridex_received_sources.require_production_contract_source_current_v1']){const marker=`${name.startsWith('gridex_')?'CREATE FUNCTION':'CREATE OR REPLACE FUNCTION'} ${name}`,a=repair.indexOf(marker),b=repair.indexOf('$$;',a);await db.exec(repair.slice(a,b+3))};checks++
 await db.exec(`CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.require_message_intent_v1(public.ediel_messages) RETURNS void LANGUAGE plpgsql AS $$BEGIN NULL;END$$;
 CREATE TABLE native_effects(x integer);CREATE FUNCTION gridex_ediel_transport.mutate_before_production_contract_source_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF input->>'frozen'='true' THEN RETURN '{"proceed":false,"providerReceipt":{"frozen":true}}'::jsonb;END IF;INSERT INTO public.native_effects VALUES(1);RETURN '{"proceed":true}'::jsonb;END$$;
 CREATE SCHEMA gridex_negative_fixtures;CREATE TABLE gridex_negative_fixtures.positive_consumptions(company_id uuid,message_id uuid);CREATE TABLE gridex_negative_fixtures.negative_prepared_consumptions(company_id uuid,message_id uuid);
 CREATE TABLE execution_permission_fixture(write_enabled bool,send_enabled bool,ediel_send_enabled bool);INSERT INTO execution_permission_fixture VALUES(true,true,false);CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS $$SELECT CASE $3 WHEN 'communication.write' THEN (SELECT write_enabled FROM public.execution_permission_fixture) WHEN 'communication.send' THEN (SELECT send_enabled FROM public.execution_permission_fixture) WHEN 'ediel.send' THEN (SELECT ediel_send_enabled FROM public.execution_permission_fixture) ELSE false END$$;`)
const top=repair.indexOf('CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb)'),topEnd=repair.indexOf('$$;',top);await db.exec(repair.slice(top,topEnd+3));checks++;
await db.exec(readFileSync(new URL('../supabase/migrations/20260930232155_ediel_production_contract_source_owned_site.sql',import.meta.url),'utf8'));checks++
await db.exec(`insert into companies values('${uid(1)}');insert into auth.users values('${uid(2)}');insert into user_profiles values('${uid(2)}','active');insert into company_memberships values('${uid(20)}','${uid(1)}','${uid(2)}','active',true,now());insert into customers values('${uid(3)}','${uid(1)}');
 insert into customer_contracts values('${uid(4)}','${uid(1)}','${uid(3)}','${uid(5)}','1','1','2026-09-30T10:01:23Z','{}');
 insert into metering_points values('${uid(5)}','${uid(1)}','${uid(3)}','production','A','54321','TES','${uid(30)}');
 insert into customer_sites values('${uid(30)}','${uid(1)}','${uid(3)}');
 insert into tenant_ediel_profiles values('${uid(21)}','${uid(1)}','test','electricity',true,'2000-01-01',null);
 insert into tenant_actor_identifiers values('${uid(22)}','${uid(1)}','test','${uid(6)}','EdielId','12345','2000-01-01',null);
 insert into tenant_actor_roles values('${uid(23)}','${uid(1)}','test','${uid(6)}','electricity_supplier','2000-01-01',null);
 insert into platform_market_actors values('${uid(7)}','active','verified');insert into platform_actor_roles values('${uid(25)}','${uid(7)}','grid_owner',true);
 insert into platform_actor_identifiers values('${uid(24)}','${uid(7)}','EdielId','54321',true,'2000-01-01',null);`)
assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec(`insert into gridex_received_sources.production_contract_events(id,company_id,environment,contract_id,customer_id,metering_point_id,legal_actor_id,dso_actor_id,dso_registry_version,dso_registry_sha256,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,event_kind,boundary_at,contract_reference,contract_revision,protected_contract_hash,source_reference,source_sha256,source_version,approved_by,approved_at)
 select '${uid(8)}','${uid(1)}','test',id,customer_id,metering_point_id,'${uid(6)}','${uid(7)}','SYNTHETIC-REGISTRY',repeat('d',64),'12345','54321','A','89','TES','signed','2026-10-01T12:00Z','SYNTHETIC','1',gridex_received_sources.production_contract_hash_v1(c),'SYNTHETIC NOT AUTHENTIC EVIDENCE',repeat('a',64),'1','${uid(2)}',now() from customer_contracts c;
 insert into outbound_requests values('${uid(9)}','${uid(1)}','${uid(3)}','manual','${uid(9)}','customer_masterdata','{"environment":"test"}','${uid(8)}','${uid(30)}','${uid(5)}');
 insert into ediel_message_intents values('${uid(9)}','${uid(1)}','test','PRODAT','Z09','${uid(3)}','A','${uid(8)}',NULL,'${uid(9)}','validated');`)
assert.equal((await read(uid(8))).rows[0].b.status,'authorized');checks++
assert.equal((await read(uid(8))).rows[0].b.siteId,uid(30));checks++
await db.exec(`update customer_sites set customer_id='${uid(99)}'`);assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++;await db.exec(`update customer_sites set customer_id='${uid(3)}'`)
await db.exec(`insert into tenant_actor_identifiers values('${uid(26)}','${uid(1)}','test','${uid(27)}','EdielId','OTHER','2000-01-01',null)`);assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec(`delete from tenant_actor_identifiers where id='${uid(26)}';update platform_actor_roles set is_active=false`);assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec(`update platform_actor_roles set is_active=true`)
await db.exec(`update metering_points set product_direction='consumption'`);assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec(`update metering_points set product_direction='production';update customer_contracts set signed_version='2'`);assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec(`update customer_contracts set signed_version='1'`)
assert.equal((await reserve(uid(8),uid(9))).rows[0].b.status,'reserved');checks++
await assert.rejects(insert(uid(10),uid(9),uid(8),wire('signed','202610011301')),/boundary_mismatch/);checks++
await assert.rejects(insert(uid(10),uid(9),uid(8),wire().replace('BGM+Z09','BGM+Z10')),/scope_mismatch/);checks++
await assert.rejects(insert(uid(10),uid(9),uid(8),wire().replace('12345:160:SVK','12345:BAD:SVK')),/qualifier_mismatch/);checks++
await insert(uid(10),uid(9),uid(8),wire());assert.equal((await reserve(uid(8),uid(9))).rows[0].b.messageId,uid(10));checks++
await assert.rejects(insert(uid(11),uid(9),uid(8),wire()),/already_bound/);checks++
await db.exec(`UPDATE ediel_message_intents SET ediel_message_id='${uid(10)}' WHERE id='${uid(9)}'`)
const native=()=>db.query(`SELECT gridex_received_sources.require_production_contract_source_current_v1('${uid(1)}','${uid(10)}','${uid(2)}')`)
await native();checks++
await db.exec('UPDATE execution_permission_fixture SET write_enabled=false');await native();assert.equal((await read(uid(8))).rows[0].b.status,'held');checks++
await db.exec('UPDATE execution_permission_fixture SET send_enabled=false');await assert.rejects(native(),/current_source_required/);checks++;
 const enter=()=>db.query('SELECT gridex_ediel_transport.mutate_v1($1) result',[{action:'enter',companyId:uid(1),messageId:uid(10),actorUserId:uid(2)}]);await assert.rejects(enter(),/current_source_required/);assert.equal((await db.query('SELECT count(*) n FROM native_effects')).rows[0].n,0);checks++;
 assert.deepEqual((await db.query('SELECT gridex_ediel_transport.mutate_v1($1) result',[{action:'enter',companyId:uid(1),messageId:uid(10),actorUserId:uid(2),frozen:true}])).rows[0].result,{proceed:false,providerReceipt:{frozen:true}});checks++;await db.exec('UPDATE execution_permission_fixture SET ediel_send_enabled=true');await native();checks++;await db.exec('UPDATE execution_permission_fixture SET write_enabled=true,send_enabled=true,ediel_send_enabled=false')
await db.exec(`UPDATE outbound_requests SET payload='{"environment":"production"}' WHERE id='${uid(9)}'`);await assert.rejects(native(),/current_origin_required/);checks++;await db.exec(`UPDATE outbound_requests SET payload='{"environment":"test"}' WHERE id='${uid(9)}'`)
await db.exec(`UPDATE outbound_requests SET operation_id='${uid(99)}' WHERE id='${uid(9)}'`);await assert.rejects(native(),/current_origin_required/);checks++;await db.exec(`UPDATE outbound_requests SET operation_id='${uid(8)}' WHERE id='${uid(9)}'`)

await db.exec(`insert into gridex_received_sources.production_contract_events(id,company_id,environment,contract_id,customer_id,metering_point_id,legal_actor_id,dso_actor_id,dso_registry_version,dso_registry_sha256,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,event_kind,boundary_at,start_event_id,contract_reference,contract_revision,protected_contract_hash,source_reference,source_sha256,source_version,approved_by,approved_at)
 select '${uid(12)}',company_id,environment,contract_id,customer_id,metering_point_id,legal_actor_id,dso_actor_id,dso_registry_version,dso_registry_sha256,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,'ceased','2026-11-01T12:00Z',id,contract_reference,contract_revision,protected_contract_hash,'SYNTHETIC CESSATION',repeat('b',64),'2',approved_by,approved_at from gridex_received_sources.production_contract_events where id='${uid(8)}';
 insert into outbound_requests values('${uid(13)}','${uid(1)}','${uid(3)}','manual','${uid(13)}','customer_masterdata','{"environment":"test"}','${uid(12)}','${uid(30)}','${uid(5)}');
 insert into ediel_message_intents values('${uid(13)}','${uid(1)}','test','PRODAT','Z09','${uid(3)}','A','${uid(12)}',NULL,'${uid(13)}','validated');`)
assert.equal((await reserve(uid(12),uid(13))).rows[0].b.status,'reserved');checks++
await insert(uid(14),uid(13),uid(12),wire('ceased','202611011300'));checks++
const period=(await db.query(`select end_event_id,end_at from gridex_received_sources.production_contract_periods where start_event_id='${uid(8)}'`)).rows[0];assert.equal(period.end_event_id,uid(12));assert.ok(period.end_at);checks++
assert.equal((await reserve(uid(12),uid(13))).rows[0].b.messageId,uid(14));checks++
await assert.rejects(db.exec(`update gridex_received_sources.production_contract_origins set payload_hash='changed' where message_id='${uid(10)}'`),/immutable/);checks++
await assert.rejects(db.exec(`update gridex_received_sources.production_contract_events set boundary_at=boundary_at+interval '1 minute'`),/immutable/);checks++
await assert.rejects(service(`update gridex_received_sources.production_contract_origins set payload_hash='forged'`),/permission denied/);checks++
const acl=(await db.query(`select has_function_privilege('authenticated','public.ediel_production_contract_source_v1(uuid,uuid,uuid)','execute') allowed`)).rows[0];assert.equal(acl.allowed,false);checks++
console.log(`PASS ${checks} focused production-contract PostgreSQL source/scope/idempotency/ACL checks; synthetic fixtures, not authentic/native evidence`)
} finally { await db.close() }
