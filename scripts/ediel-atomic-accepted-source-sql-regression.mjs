// Actual accepted-source authority, expectation registration and atomic owner
// SQL. Receipt fixtures are synthetic; central technical-plan qualification is
// actual SQL against a named synthetic private source-owner port here, never authentic/native/provider evidence.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import {resolve} from 'node:path'
const migration=n=>readFileSync(resolve(process.env.EDIEL_SQL_REPOSITORY||new URL('..',import.meta.url).pathname,'supabase/migrations',n),'utf8')
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const company=uid(1), actor=uid(2)
let checks=0
const literal=v=>`'${String(v).replaceAll("'","''")}'`
const plan=(code)=>({version:1,sourceCode:code,expectedFamily:'PRODAT',expectedCode:code==='Z01'?'Z02':code==='Z13'?'Z14':'Z15',expectedSubtypes:[],anchor:'actual_accepted_smtp_observed_at',remoteReceiptKnown:false,timerKind:code==='Z18'?'untimed_business_response':'internal_sender_watch',offset:code==='Z18'?null:code==='Z01'?30:21,unit:code==='Z18'?null:code==='Z01'?'minutes':'calendar_days',deadlineSource:{document:'Svensk Elmarknadshandbok',edition:'26A'},policy:{guideRevision:'26-A',referenceDate:'2026-09-30',profileKey:'prodat_z01_customer_identity_request',sourceTrace:[{authority:'guide',document:'260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',section:'synthetic-bound-source'},{authority:'acknowledgement',document:'260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',section:'synthetic-bound-source'}]}})
async function seed(code,n=3,observed='2026-10-24T12:00:00Z'){
 const mid=uid(n),aid=uid(n+100),wire=`UNB+UNOC:3+12345:ZZ+54321:ZZ+260930:1200+I'UNH+M+PRODAT:D:97A:UN:E5SE2A'BGM+${code}+D+9+NA'LIN+1++OBJECT:OP:9'UNT+4+M'UNZ+1+I'`
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,message_standard,raw_payload,immutable_rendered_at,immutable_payload_hash) values('${mid}','${company}','test','outbound','edifact',${literal(wire)},now(),encode(sha256(convert_to(${literal(wire)},'UTF8')),'hex'));
 insert into gridex_ediel_transport.attempts(id,message_id,company_id,environment,entered_at,observed_at,classification,binding) select '${aid}',id,company_id,environment,${literal(observed)}::timestamptz-interval '1 second',${literal(observed)},'accepted',jsonb_build_object('originalHash',immutable_payload_hash,'businessExpectationPlan',${literal(JSON.stringify(plan(code)))}::jsonb) from ediel_messages where id='${mid}';`)
 return {mid,aid,wire}
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table companies(id uuid primary key);create table company_memberships(id uuid default gen_random_uuid(),company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);
 create table fixture_permissions(permission text);insert into fixture_permissions values('ediel.send');create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select case when exists(select from public.fixture_permissions where permission=$3) then true else null end';
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,source_operation_id text,operation_id uuid);
 create table ediel_business_expectations(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_operation_id text,expected_family text,expected_code text,expected_subtype text,expected_case_reference text,due_at timestamptz not null,status text default 'pending',fulfilled_by_message_id uuid,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index expectations_identity on ediel_business_expectations(company_id,environment,source_message_id,expected_family,expected_code,coalesce(expected_subtype,''));
 create schema gridex_ediel_transport;create table gridex_ediel_transport.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,entered_at timestamptz,observed_at timestamptz,classification text,binding jsonb);
 create schema gridex_received_sources;create table gridex_received_sources.permission_transitions(source_message_id uuid,company_id uuid,previous_state jsonb,resulting_state jsonb,payload_hash text,qualified_original_message_id uuid,qualified_expected_message_code text,applied_at timestamptz default now());
 create table gridex_received_sources.z02_core_applications(source_message_id uuid,company_id uuid,environment text,source_payload_hash text,originating_z01_message_id uuid,object_id text,identity_agency text,applied_at timestamptz default now());
 insert into companies values('${company}');insert into company_memberships(company_id,user_id,status,is_active,accepted_at) values('${company}','${actor}','active',true,now());insert into user_profiles values('${actor}','active');`)
 const decoder=migration('20260930144205_ediel_permission_source_atomic_transitions.sql')
 await db.exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),decoder.indexOf('-- Keep the existing closure budget')))
 await db.exec(`create function gridex_received_sources.z02_core_wire_v1(raw text) returns jsonb language sql immutable as $wire$select jsonb_build_object('objects',jsonb_agg(jsonb_build_object('objectId',t#>>'{elements,3,0}','identityAgency',t#>>'{elements,3,2}'))) from jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,999999)) t where t->>'tag'='LIN'$wire$;`)
 await db.exec(migration('20260930154712_ediel_source_bound_business_expectations_v1.sql'));
 await db.exec(migration('20260930170258_ediel_business_expectation_applied_scope_v2.sql'));checks++
 await db.exec(`ALTER TABLE ediel_messages ADD COLUMN execution_context_snapshot jsonb DEFAULT '{}',ADD COLUMN message_family text,ADD COLUMN message_code text,ADD COLUMN status text,ADD COLUMN customer_id uuid,ADD COLUMN site_id uuid,ADD COLUMN metering_point_id uuid,ADD COLUMN outbound_request_id uuid,ADD COLUMN grid_owner_data_request_id uuid,ADD COLUMN message_sent_at timestamptz,ADD COLUMN requires_contrl boolean,ADD COLUMN contrl_status text,ADD COLUMN contrl_due_at timestamptz,ADD COLUMN ack_due_at timestamptz,ADD COLUMN business_response_due_at timestamptz,ADD COLUMN updated_by uuid,ADD COLUMN updated_at timestamptz;
 ALTER TABLE gridex_ediel_transport.attempts ADD COLUMN provider_result jsonb;
 CREATE SCHEMA gridex_outbound_dispatch;CREATE TABLE gridex_outbound_dispatch.originals(message_id uuid,company_id uuid,environment text,payload_hash text,raw_payload text);CREATE TABLE gridex_outbound_dispatch.attempts(id uuid,message_id uuid,company_id uuid,environment text,binding jsonb);CREATE TABLE gridex_outbound_dispatch.events(id uuid,attempt_id uuid,message_id uuid,company_id uuid,environment text,kind text,facts jsonb,observed_at timestamptz);
 CREATE TABLE outbound_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,status text,sent_at timestamptz,failure_reason text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE grid_owner_data_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,status text,sent_at timestamptz,failed_at timestamptz,failure_reason text,updated_by uuid,updated_at timestamptz);
 CREATE TABLE customer_info_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,ediel_message_id uuid,outbound_request_id uuid,grid_owner_data_request_id uuid,status text,sent_at timestamptz,blocker_code text,blocker_reason text,blocker_details jsonb NOT NULL DEFAULT '{}',next_required_action text,updated_by uuid,updated_at timestamptz);
 -- Only the protected source-original port is synthetic; the central plan
 -- edition and validator below are the actual generated native functions.
 CREATE SCHEMA gridex_ediel_source_rules;CREATE TABLE fixture_source_rule_basis(company_id uuid,message_id uuid,basis jsonb);
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(c uuid,m uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT basis FROM public.fixture_source_rule_basis WHERE company_id=c AND message_id=m$$;
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;`)
 const centralPath=process.env.EDIEL_TECHNICAL_PLAN_SQL||resolve(process.env.EDIEL_SQL_REPOSITORY||new URL('..',import.meta.url).pathname,'supabase/migrations/20260930225411_ediel_source_generated_technical_expectation_plan.sql')
 await db.exec(readFileSync(centralPath,'utf8'))
 await db.exec(migration('20260930204937_ediel_shared_accepted_source_basis.sql'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930223407_ediel_atomic_accepted_source_projection.sql',import.meta.url),'utf8'));checks++
 await db.exec('ALTER TABLE ediel_messages ADD COLUMN processing_status text')
 const currentRepair=migration('20260930220932_ediel_source_read_send_permission_contract.sql')
 await db.exec(currentRepair.slice(currentRepair.indexOf('CREATE OR REPLACE FUNCTION public.gridex_ediel_accepted_transport_projection_v1'),currentRepair.indexOf('CREATE OR REPLACE FUNCTION public.ediel_brp_change_message_basis_v1')))
 await db.exec(migration('20260930233357_ediel_atomic_accepted_message_and_source_repair.sql'));checks++
 const source=await seed('Z01',3,'2026-09-30T12:00:00Z'),clock='2026-09-30T12:00:00.000Z'
 const technicalPlan={version:1,ruleId:'TM-CONTRL',offset:30,unit:'minutes',anchor:'actual_accepted_smtp_observed_at',timerKind:'internal_sender_watch',remoteReceiptKnown:false,policy:plan('Z01').policy}
 await db.exec(`UPDATE ediel_messages SET message_family='PRODAT',message_code='Z01',status='sent',customer_id='${uid(4)}',site_id='${uid(5)}',metering_point_id='${uid(6)}',outbound_request_id='${uid(7)}',grid_owner_data_request_id='${uid(8)}',requires_contrl=true,contrl_status='pending';
 UPDATE gridex_ediel_transport.attempts SET binding=binding||jsonb_build_object('to','recipient@example.invalid','technicalExpectationPlan',${literal(JSON.stringify(technicalPlan))}::jsonb),provider_result='{"accepted":["recipient@example.invalid"],"rejected":[],"messageId":"SYNTHETIC-provider-ID","response":"SYNTHETIC 250"}';
 INSERT INTO fixture_source_rule_basis VALUES('${company}','${source.mid}','{"version":"opaque-ORIGINAL-26A","snapshot":{"version":"opaque-ORIGINAL-26A","rulePack":{"family":"PRODAT","guide_version":"26.A","guide_revision":"3"}}}');
 INSERT INTO outbound_requests VALUES('${uid(7)}','${company}','${uid(4)}','${uid(5)}','${uid(6)}','queued',NULL,NULL,NULL,NULL);
 INSERT INTO grid_owner_data_requests VALUES('${uid(8)}','${company}','${uid(4)}','${uid(5)}','${uid(6)}','pending',NULL,NULL,NULL,NULL,NULL);
 INSERT INTO customer_info_requests VALUES('${uid(9)}','${company}','${uid(4)}','${uid(5)}','${uid(6)}','${source.mid}','${uid(7)}','${uid(8)}','z01_prepared',NULL,'pre-send-only','pre-send-only','{}','pre-send-only',NULL,NULL);`)
 const hash=(await db.query('SELECT immutable_payload_hash h FROM ediel_messages WHERE id=$1',[source.mid])).rows[0].h
 const project=async(c=company,a=actor,h=hash)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT ediel_project_accepted_source_state_v1($1,$2,$3,$4,$5) r',[c,'test',a,source.mid,h])).rows[0].r}finally{await db.exec('RESET ROLE')}}
 const state=async()=>({m:(await db.query('SELECT * FROM ediel_messages WHERE id=$1',[source.mid])).rows[0],r:(await db.query('SELECT * FROM outbound_requests')).rows[0],g:(await db.query('SELECT * FROM grid_owner_data_requests')).rows[0],c:(await db.query('SELECT * FROM customer_info_requests')).rows[0]})
 let result=await project(),rows=await state();assert.equal(result.status,'source_projection');assert.equal(result.authorizesProviderEntry,false);assert.equal(new Date(result.observedAt).toISOString(),clock);assert.equal(result.technicalDeadlineBasis,'frozen_plan');checks++
 assert.equal(rows.r.status,'sent');assert.equal(rows.g.status,'sent');assert.equal(rows.c.status,'waiting_for_z02');assert.deepEqual(rows.c.blocker_details,{});checks++
 assert.equal(rows.m.contrl_due_at.toISOString(),'2026-09-30T12:30:00.000Z');assert.equal(rows.m.business_response_due_at.toISOString(),'2026-09-30T12:30:00.000Z');assert.equal(rows.r.sent_at.toISOString(),clock);checks++
 // Positive technical ACK completion preserves its cleared watch while the
 // independent actual private pending Z02 expectation repairs the business wait.
 await db.exec(`UPDATE ediel_messages SET status='acknowledged',contrl_status='received',contrl_due_at=NULL,ack_due_at=NULL,business_response_due_at=NULL;UPDATE customer_info_requests SET status='z01_prepared'`)
 await project();rows=await state();assert.equal(rows.c.status,'waiting_for_z02');assert.equal(rows.m.status,'acknowledged');assert.equal(rows.m.contrl_due_at,null);assert.equal(rows.m.ack_due_at,null);assert.equal(rows.m.business_response_due_at.toISOString(),'2026-09-30T12:30:00.000Z');checks++
 // Simulate a source arriving after an earlier caller read: native projection
 // must use current locked rows, not the stale caller's pending status.
 await db.exec(`UPDATE ediel_messages SET status='acknowledged',contrl_status='received',contrl_due_at=NULL,ack_due_at=NULL,business_response_due_at=NULL;UPDATE outbound_requests SET status='acknowledged',failure_reason='KEEP-established';UPDATE grid_owner_data_requests SET status='received',failure_reason='KEEP-established';UPDATE customer_info_requests SET status='z02_received',blocker_code='KEEP-established',next_required_action='KEEP-established';`)
 result=await project();rows=await state();assert.equal(rows.r.status,'acknowledged');assert.equal(rows.g.status,'received');assert.equal(rows.c.status,'z02_received');assert.equal(rows.m.status,'acknowledged');checks++
 assert.equal(rows.m.contrl_due_at,null);assert.equal(rows.m.ack_due_at,null);assert.equal(rows.m.business_response_due_at,null);assert.equal(rows.c.blocker_code,'KEEP-established');assert.equal(rows.r.failure_reason,'KEEP-established');checks++
 for(const terminal of ['failed','cancelled','rejected']){await db.query('UPDATE outbound_requests SET status=$1',[terminal]);await db.query('UPDATE grid_owner_data_requests SET status=$1',[terminal]);await db.query('UPDATE customer_info_requests SET status=$1',[terminal]);await project();rows=await state();assert.equal(rows.r.status,terminal);assert.equal(rows.g.status,terminal);assert.equal(rows.c.status,terminal);checks++}
 const stable=await state();await project();assert.deepEqual(await state(),{...stable,m:{...stable.m,updated_at:(await state()).m.updated_at},r:{...stable.r,updated_at:(await state()).r.updated_at},g:{...stable.g,updated_at:(await state()).g.updated_at},c:{...stable.c,updated_at:(await state()).c.updated_at}});checks++
 await assert.rejects(project(uid(99)),/actor_forbidden/);checks++
 await assert.rejects(project(company,uid(99)),/actor_forbidden/);checks++
 await assert.rejects(project(company,actor,'f'.repeat(64)),/original_changed/);checks++
 await db.exec('UPDATE company_memberships SET accepted_at=NULL');await assert.rejects(project(),/actor_forbidden/);await db.exec('UPDATE company_memberships SET accepted_at=now()');checks++
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='unknown'`);await assert.rejects(project(),/accepted_receipt_required/);await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='accepted'`);checks++
 // Every projected relation is qualified before writes; a foreign last row
 // rolls back the whole transaction, including expectation reconciliation.
 await db.exec(`UPDATE ediel_messages SET message_sent_at=NULL;UPDATE outbound_requests SET sent_at=NULL;UPDATE grid_owner_data_requests SET sent_at=NULL;UPDATE customer_info_requests SET company_id='${uid(99)}'`)
 await assert.rejects(project(),/owned_info_request_required/);rows=await state();assert.equal(rows.m.message_sent_at,null);assert.equal(rows.r.sent_at,null);assert.equal(rows.g.sent_at,null);checks++;await db.exec(`UPDATE customer_info_requests SET company_id='${company}'`)
 await db.exec(`UPDATE ediel_messages SET status='sent',contrl_status='pending',contrl_due_at=NULL,ack_due_at=NULL;UPDATE gridex_ediel_transport.attempts SET binding=binding-'technicalExpectationPlan'`);await assert.rejects(project(),/frozen_technical_plan_required/);checks++
 await db.exec(`UPDATE ediel_messages SET contrl_due_at='2026-09-30 12:40+00',ack_due_at='2026-09-30 12:40+00'`);assert.equal((await project()).technicalDeadlineBasis,'retained_legacy_projection_not_reverified');assert.equal((await state()).m.ack_due_at.toISOString(),'2026-09-30T12:40:00.000Z');checks++
 await db.query("UPDATE gridex_ediel_transport.attempts SET binding=binding||jsonb_build_object('technicalExpectationPlan',$1::jsonb)",[{...technicalPlan,offset:31}]);await assert.rejects(project(),/technical_expectation_source_plan_required/);checks++
 // Execute the real message repair, private receipt and source projection
 // together. These fixtures remain synthetic; this is not native/concurrency evidence.
 await db.query("UPDATE gridex_ediel_transport.attempts SET binding=binding||jsonb_build_object('technicalExpectationPlan',$1::jsonb)",[technicalPlan])
 const repair=async(mid=source.mid)=>{await db.exec('SET ROLE service_role');try{return(await db.query('SELECT gridex_ediel_repair_accepted_transport_projection_v1($1,$2,$3,$4) r',[company,'test',actor,mid])).rows[0].r}finally{await db.exec('RESET ROLE')}}
 for(const current of ['dispatching','acknowledged','failed','cancelled','rejected','completed']){
  await db.query("UPDATE ediel_messages SET status=$1,processing_status=$1,contrl_status='received',contrl_due_at=NULL,ack_due_at=NULL,message_sent_at=NULL",[current])
  const repaired=await repair(),s=await state()
  assert.equal(repaired.projectionStatus,current==='dispatching'?'sent':current)
  assert.equal(s.m.processing_status,current==='dispatching'?'sent':current)
  assert.equal(s.m.message_sent_at.toISOString(),clock);assert.equal(s.m.ack_due_at,null);checks++
 }
 await db.exec(`UPDATE ediel_messages SET status='dispatching',processing_status='dispatching',message_sent_at=NULL;UPDATE outbound_requests SET status='queued',sent_at=NULL;UPDATE grid_owner_data_requests SET status='pending',sent_at=NULL;UPDATE customer_info_requests SET status='z01_prepared',company_id='${uid(99)}',sent_at=NULL`)
 const beforeFailure=await state(),expectationsBefore=(await db.query('SELECT * FROM ediel_business_expectations ORDER BY id')).rows
 await assert.rejects(repair(),/owned_info_request_required/)
 assert.deepEqual(await state(),beforeFailure);assert.deepEqual((await db.query('SELECT * FROM ediel_business_expectations ORDER BY id')).rows,expectationsBefore);checks++
 await db.exec(`UPDATE customer_info_requests SET company_id='${company}';UPDATE gridex_ediel_transport.attempts SET classification='unknown'`)
 const beforeMissingReceipt=await state();assert.equal(await repair(),null);assert.deepEqual(await state(),beforeMissingReceipt);checks++
 await db.exec(`UPDATE gridex_ediel_transport.attempts SET classification='accepted'`)
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.repair_message_projection_v1(uuid,text,uuid,uuid)','EXECUTE') a")).rows[0].a,false);checks++
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid)','EXECUTE') a")).rows[0].a,false);checks++
 // The actual outer wrapper must add its method-owner call in the same
 // transaction. This named boundary double proves composition/rollback only;
 // the actual method owner has its independent focused SQL regression.
 await db.exec(`CREATE SCHEMA gridex_method_expectations;
 CREATE TABLE fixture_method_calls(message_id uuid);
 CREATE TABLE fixture_method_failure(fail boolean);INSERT INTO fixture_method_failure VALUES(false);
 CREATE FUNCTION gridex_method_expectations.mutate_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
 BEGIN INSERT INTO public.fixture_method_calls VALUES((i->>'messageId')::uuid);
 IF (SELECT fail FROM public.fixture_method_failure) THEN RAISE EXCEPTION 'fixture_method_owner_failure';END IF;
 RETURN '[]'::jsonb;END $$;`)
 await db.exec(migration('20260930234515_ediel_accepted_metering_method_watch_projection.sql'))
 const methodSource=await seed('Z09',33,'2026-09-30T12:00:00Z')
 const methodTechnicalPlan={...technicalPlan,policy:{...technicalPlan.policy,profileKey:'prodat_z09_masterdata_supplier_to_grid'}}
 await db.exec(`UPDATE ediel_messages SET message_family='PRODAT',message_code='Z09',status='dispatching',requires_contrl=true,contrl_status='pending' WHERE id='${methodSource.mid}';
 UPDATE gridex_ediel_transport.attempts SET binding=(binding-'businessExpectationPlan')||jsonb_build_object('to','recipient@example.invalid','technicalExpectationPlan',${literal(JSON.stringify(methodTechnicalPlan))}::jsonb),provider_result='{"accepted":["recipient@example.invalid"],"rejected":[],"messageId":"SYNTHETIC-method-ID","response":"SYNTHETIC 250"}' WHERE message_id='${methodSource.mid}';
 INSERT INTO fixture_source_rule_basis SELECT company_id,'${methodSource.mid}',basis FROM fixture_source_rule_basis WHERE message_id='${source.mid}';`)
 await repair(methodSource.mid);assert.equal((await db.query('SELECT count(*) n FROM fixture_method_calls')).rows[0].n,1);checks++
 await db.exec(`UPDATE ediel_messages SET status='dispatching',processing_status='dispatching',message_sent_at=NULL WHERE id='${methodSource.mid}';UPDATE fixture_method_failure SET fail=true`)
 const methodState=async()=>(await db.query('SELECT * FROM ediel_messages ORDER BY id')).rows
 const beforeMethodFailure=await methodState(),beforeMethodExpectations=(await db.query('SELECT * FROM ediel_business_expectations ORDER BY id')).rows
 await assert.rejects(repair(methodSource.mid),/fixture_method_owner_failure/)
 assert.deepEqual(await methodState(),beforeMethodFailure);assert.deepEqual((await db.query('SELECT * FROM ediel_business_expectations ORDER BY id')).rows,beforeMethodExpectations)
 assert.equal((await db.query('SELECT count(*) n FROM fixture_method_calls')).rows[0].n,1);checks++
 await db.exec(`UPDATE fixture_method_failure SET fail=false;UPDATE gridex_ediel_transport.attempts SET classification='unknown' WHERE message_id='${methodSource.mid}'`)
 assert.equal(await repair(methodSource.mid),null);assert.equal((await db.query('SELECT count(*) n FROM fixture_method_calls')).rows[0].n,1);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_transport.repair_before_method_watch_v1(uuid,text,uuid,uuid)','EXECUTE') a")).rows[0].a,false);checks++
 for(const permission of ['communication.read','communication.write','ediel_testing.write']){await db.exec('TRUNCATE fixture_permissions');await db.query('INSERT INTO fixture_permissions VALUES($1)',[permission]);await assert.rejects(project(),/actor_forbidden/);checks++}
 assert.equal((await db.query("SELECT has_function_privilege('authenticated','ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)','EXECUTE') a")).rows[0].a,false);checks++
 console.log(`PASS ${checks} atomic accepted-source PostgreSQL checks; actual receipt/expectation/projection functions, actual central plan validator with named synthetic source-owner port, native/concurrency/authentic proof deferred`)
}finally{await db.close()}
