// Targeted embedded PostgreSQL binding checks; assessment/parser/source helpers
// are declared fixtures here, never production or native evidence.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
async function service(sql){await db.exec('SET ROLE service_role');try{return await db.query(sql)}finally{await db.exec('RESET ROLE')}}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);
 CREATE TABLE companies(id uuid primary key);CREATE TABLE customers(id uuid primary key,company_id uuid,org_number text,personal_number text);
 CREATE TABLE company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);CREATE TABLE user_profiles(id uuid,user_status text);
 CREATE FUNCTION gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS 'SELECT true';
 CREATE TABLE ediel_service_assignments(id uuid primary key,company_id uuid,beneficiary_company_id uuid,provider_actor_id uuid,customer_id uuid,dso_actor_id uuid,environment text,mode text,status text,version bigint,product_ids text[],data_start timestamptz,data_end timestamptz);
 CREATE TABLE ediel_service_evidence(id uuid primary key default gen_random_uuid(),company_id uuid,assignment_id uuid,kind text,status text,approved_assignment_version bigint,approved_at timestamptz,valid_from timestamptz,valid_to timestamptz,source_reference text,source_sha256 text,source_version text);
 CREATE TABLE metering_permissions(id uuid primary key,company_id uuid,customer_id uuid,status text,source_z13_message_id uuid,outbound_z13_message_id uuid,outbound_z18_message_id uuid,inbound_z14_message_id uuid,source_z14_message_id uuid,rff_li_reference text,grid_owner_ediel_id text,metadata jsonb,updated_by uuid,updated_at timestamptz,market_state_version bigint default 0);
 CREATE TABLE metering_permission_sites(id uuid,company_id uuid,metering_permission_id uuid,facility_id text,status text,metadata jsonb,grid_area_code text);
 CREATE TABLE ediel_assignment_permission_links(company_id uuid,assignment_id uuid,permission_id uuid);
 CREATE TABLE tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,is_verified bool,valid_from date,valid_to date);
 CREATE TABLE ediel_message_intents(id uuid primary key,company_id uuid,environment text,business_process text,message_family text,message_code text,customer_id uuid,payload jsonb,transaction_reference text);
 CREATE TABLE ediel_messages(id uuid primary key,intent_id uuid,company_id uuid,direction text,message_family text,message_code text,environment text,customer_id uuid,raw_payload text);
 CREATE FUNCTION ediel_service_assignment_assessment_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''status'',''authorized'')';
 CREATE FUNCTION ediel_permission_source_is_current_v1(uuid,uuid,uuid) RETURNS bool LANGUAGE sql AS 'SELECT true';
 CREATE FUNCTION ediel_reserve_wire_reference_namespace_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN;END';
 CREATE SCHEMA gridex_received_sources;CREATE FUNCTION gridex_received_sources.permission_wire_v1(text) RETURNS jsonb LANGUAGE sql AS 'SELECT $1::jsonb';
 CREATE FUNCTION gridex_received_sources.permission_time_v1(text) RETURNS timestamptz LANGUAGE sql AS 'SELECT $1::timestamptz';
 CREATE SCHEMA gridex_ediel_transport;CREATE FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT jsonb_build_object(''proceed'',true)';`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930162005_ediel_service_permission_origination_v1.sql',import.meta.url),'utf8'));checks++
 await db.exec(`INSERT INTO companies VALUES('${uid(1)}');INSERT INTO auth.users VALUES('${uid(2)}');INSERT INTO user_profiles VALUES('${uid(2)}','active');INSERT INTO company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());INSERT INTO customers VALUES('${uid(3)}','${uid(1)}','SYNTHETIC-CUSTOMER',null);
 INSERT INTO ediel_service_assignments VALUES('${uid(4)}','${uid(1)}','${uid(9)}','${uid(5)}','${uid(3)}','${uid(6)}','test','V','active',1,ARRAY['8716867000030'],'2026-01-01','2027-01-01');
 INSERT INTO metering_permissions(id,company_id,customer_id,status,metadata) VALUES('${uid(7)}','${uid(1)}','${uid(3)}','draft','{}');INSERT INTO ediel_assignment_permission_links VALUES('${uid(1)}','${uid(4)}','${uid(7)}');
 INSERT INTO tenant_actor_identifiers VALUES('${uid(15)}','${uid(1)}','test','${uid(5)}','EdielId','21660','2000-01-01',null);INSERT INTO platform_actor_identifiers VALUES('${uid(16)}','${uid(6)}','EdielId','54321',true,'2000-01-01',null);`)
 const read=(version=1,actor=uid(2))=>service(`SELECT public.ediel_service_permission_origin_v1('${uid(1)}','${uid(4)}','${actor}',${version??'null'},'Z13','${uid(7)}') AS result`)
 assert.equal((await read()).rows[0].result.status,'held');checks++
 await assert.rejects(read(null),/scope_required/);checks++
 await assert.rejects(read(1,uid(99)),/actor_forbidden/);checks++
 await db.exec(`INSERT INTO ediel_service_evidence(id,company_id,assignment_id,kind,status,approved_assignment_version,approved_at,valid_from,source_reference,source_sha256,source_version,permission_purpose_code,permission_reporting_frequency,permission_reporting_term_kind,permission_customer_classification,permission_request_grid_area) VALUES('${uid(8)}','${uid(1)}','${uid(4)}','end_user_contract','verified',1,'2000-01-01','2000-01-01','SYNTHETIC NOT LEGAL APPROVAL',repeat('a',64),'fixture','B72','D','bounded','nonprivate','TES')`)
 const basis=(await read()).rows[0].result;assert.equal(basis.status,'authorized');assert.equal(basis.purposeCode,'B72');checks++
 await db.exec(`INSERT INTO tenant_actor_identifiers VALUES('${uid(17)}','${uid(1)}','test','${uid(5)}','EdielId','OTHER-LEGAL','2000-01-01',null)`)
 assert.equal((await read()).rows[0].result.status,'held');checks++
 await db.exec(`DELETE FROM tenant_actor_identifiers WHERE id='${uid(17)}'`)
 await assert.rejects(db.exec(`UPDATE ediel_service_evidence SET status='pending'`),/cannot_be_unapproved/);checks++
 await assert.rejects(db.exec(`UPDATE ediel_service_evidence SET permission_purpose_code='B71'`),/new_source_record/);checks++
 await assert.rejects(db.exec(`DELETE FROM ediel_service_evidence`),/source_removal_forbidden/);checks++
 await db.exec(`INSERT INTO ediel_message_intents VALUES('${uid(10)}','${uid(1)}','test','metering_permission','PRODAT','Z13','${uid(3)}','${JSON.stringify({sourcePermissionBasis:basis})}','LI-FIXTURE')`)
 const reserve=()=>service(`SELECT public.ediel_reserve_service_permission_origin_v1('${uid(1)}','${uid(4)}','${uid(2)}',1,'Z13','${uid(7)}','${uid(10)}') AS result`)
 assert.equal((await reserve()).rows[0].result.status,'reserved');checks++
 const wire={code:'Z13',sender:'21660',receiver:'54321',objects:[{reason:'S17',li:'LI-FIXTURE',gridArea:'TES',customerIdentity:'SYNTHETIC-CUSTOMER',purpose:'B72',frequency:'D',product:'8716867000030',reportStart:basis.objects[0].reportStart,reportEnd:basis.objects[0].reportEnd}]}
 const insert=(id,body)=>db.exec(`INSERT INTO ediel_messages VALUES('${id}','${uid(10)}','${uid(1)}','outbound','PRODAT','Z13','test','${uid(3)}','${JSON.stringify(body)}')`)
 await assert.rejects(insert(uid(11),{...wire,receiver:'WRONG'}),/wire_scope_mismatch/);checks++
 await insert(uid(11),wire);assert.equal((await reserve()).rows[0].result.messageId,uid(11));checks++
 await assert.rejects(db.exec(`UPDATE gridex_service_permission.origins SET basis='{}'`),/origin_immutable/);checks++
 await assert.rejects(db.exec(`DELETE FROM gridex_service_permission.origins`),/origin_immutable/);checks++
 await assert.rejects(insert(uid(12),wire),/already_bound/);checks++
 assert.equal((await db.query(`SELECT source_z13_message_id,rff_li_reference,status FROM metering_permissions`)).rows[0].source_z13_message_id,uid(11));checks++
 await db.exec(`UPDATE ediel_service_evidence SET status='revoked'`);await assert.rejects(db.exec(`SELECT ediel_require_service_permission_origin_current_v1('${uid(1)}','${uid(11)}')`),/basis_stale/);checks++
 const acl=(await db.query(`SELECT has_function_privilege('authenticated','public.ediel_service_permission_origin_v1(uuid,uuid,uuid,bigint,text,uuid)','execute') AS allowed`)).rows[0];assert.equal(acl.allowed,false);checks++
 console.log(`PASS ${checks} targeted source-origin PostgreSQL checks; declared helper fixtures, not grammar/native/legal evidence`)
} finally {await db.close()}
