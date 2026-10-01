// Embedded PostgreSQL checks of this prospective owner. This is not native
// replay or authentic counterparty timing evidence. Applied-source RPCs are
// represented by their private ledger contract; their validation is separate.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const company=uid(1), actor=uid(2)
let checks=0
const literal=v=>`'${String(v).replaceAll("'","''")}'`
const plan=(code)=>({version:1,sourceCode:code,expectedFamily:'PRODAT',expectedCode:code==='Z01'?'Z02':code==='Z13'?'Z14':'Z15',expectedSubtypes:[],anchor:'actual_accepted_smtp_observed_at',remoteReceiptKnown:false,timerKind:code==='Z18'?'untimed_business_response':'internal_sender_watch',offset:code==='Z18'?null:code==='Z01'?30:21,unit:code==='Z18'?null:code==='Z01'?'minutes':'calendar_days',deadlineSource:{document:'Svensk Elmarknadshandbok',edition:'26A'},policy:{guideRevision:'26-A-3',referenceDate:'2026-09-30',sourceTrace:[{authority:'guide'}]}})
const call=(action,extra={})=>`set role service_role;select public.gridex_ediel_business_expectations_v1(${literal(JSON.stringify({companyId:company,environment:'test',actorUserId:actor,action,...extra}))}::jsonb) as result;reset role;`
async function invoke(action,extra={}){return (await db.exec(call(action,extra)))[1].rows[0].result}
async function rejects(sql,re){try{await assert.rejects(db.exec(sql),re);checks++}finally{await db.exec('reset role')}}
async function seed(code,n=3,observed='2026-10-24T12:00:00Z'){
 const mid=uid(n),aid=uid(n+100),wire=`UNB+UNOC:3+12345:ZZ+54321:ZZ+260930:1200+I'UNH+M+PRODAT:D:97A:UN:E5SE2A'BGM+${code}+D+9+NA'LIN+1++OBJECT:OP:9'UNT+4+M'UNZ+1+I'`
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,message_standard,raw_payload,immutable_rendered_at,immutable_payload_hash) values('${mid}','${company}','test','outbound','edifact',${literal(wire)},now(),encode(sha256(convert_to(${literal(wire)},'UTF8')),'hex'));
 insert into gridex_ediel_transport.attempts(id,message_id,company_id,environment,entered_at,observed_at,classification,binding) select '${aid}',id,company_id,environment,${literal(observed)}::timestamptz-interval '1 second',${literal(observed)},'accepted',jsonb_build_object('originalHash',immutable_payload_hash,'businessExpectationPlan',${literal(JSON.stringify(plan(code)))}::jsonb) from ediel_messages where id='${mid}';`)
 return {mid,aid,wire}
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table companies(id uuid primary key);create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);
 create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 create table ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_standard text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,source_operation_id text,operation_id uuid);
 create table ediel_business_expectations(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_operation_id text,expected_family text,expected_code text,expected_subtype text,expected_case_reference text,due_at timestamptz not null,status text default 'pending',fulfilled_by_message_id uuid,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index expectations_identity on ediel_business_expectations(company_id,environment,source_message_id,expected_family,expected_code,coalesce(expected_subtype,''));
 create schema gridex_ediel_transport;create table gridex_ediel_transport.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,entered_at timestamptz,observed_at timestamptz,classification text,binding jsonb);
 create schema gridex_received_sources;create table gridex_received_sources.permission_transitions(source_message_id uuid,company_id uuid,previous_state jsonb,resulting_state jsonb,payload_hash text,qualified_original_message_id uuid,qualified_expected_message_code text,applied_at timestamptz default now());
 create table gridex_received_sources.z02_core_applications(source_message_id uuid,company_id uuid,environment text,source_payload_hash text,originating_z01_message_id uuid,object_id text,identity_agency text,applied_at timestamptz default now());
 insert into companies values('${company}');insert into company_memberships values('${company}','${actor}','active',true,now());insert into user_profiles values('${actor}','active');`)
 const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
 await db.exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),decoder.indexOf('-- Keep the existing closure budget')))
 await db.exec(`create function gridex_received_sources.z02_core_wire_v1(raw text) returns jsonb language sql immutable as $wire$select jsonb_build_object('objects',jsonb_agg(jsonb_build_object('objectId',t#>>'{elements,3,0}','identityAgency',t#>>'{elements,3,2}'))) from jsonb_array_elements(gridex_received_sources.wire_tokens_bounded_v1(raw,999999)) t where t->>'tag'='LIN'$wire$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930154712_ediel_source_bound_business_expectations_v1.sql',import.meta.url),'utf8'));checks++
 const z13=await seed('Z13')
 let result=await invoke('register',{messageId:z13.mid});assert.equal(result.length,1);assert.equal(result[0].metadata.remoteReceiptKnown,false);assert.equal(new Date(result[0].due_at).toISOString(),'2026-11-14T13:00:00.000Z');checks++ // calendar watch crosses Stockholm DST correctly
 const original=result[0];assert.equal((await invoke('register',{messageId:z13.mid}))[0].id,original.id);checks++
 await db.exec(`update gridex_ediel_transport.attempts set binding=binding-'businessExpectationPlan' where id='${z13.aid}'`)
 assert.equal((await invoke('register',{messageId:z13.mid}))[0].id,original.id);checks++ // frozen binding replay never reselects policy
 const z18=await seed('Z18',8);result=await invoke('register',{messageId:z18.mid});assert.equal(result[0].due_at,null);checks++
 await db.exec(`update ediel_business_expectations set due_at=now()-interval '1 minute' where source_message_id='${z13.mid}'`)
 await invoke('expire');result=await invoke('read',{messageId:z13.mid});assert.equal(result[0].status,'manual_review');assert.equal((await invoke('read',{messageId:z18.mid}))[0].status,'pending');checks++
 const noAcceptance=await seed('Z01',20);await db.exec(`update gridex_ediel_transport.attempts set classification='unknown' where id='${noAcceptance.aid}'`)
 await rejects(call('register',{messageId:noAcceptance.mid}),/actual_smtp_acceptance_required/)
 const missingPlan=await seed('Z01',25);await db.exec(`update gridex_ediel_transport.attempts set binding=binding-'businessExpectationPlan' where id='${missingPlan.aid}'`)
 await rejects(call('register',{messageId:missingPlan.mid}),/prepared_policy_missing/)
 const z01=await seed('Z01',30,'2026-09-30T12:00:00Z'), response=uid(31)
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,raw_payload) values('${response}','${company}','test','inbound','genuine-applied-owner-fixture');
 insert into gridex_received_sources.z02_core_applications select id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'${z01.mid}','OBJECT','9',now() from ediel_messages where id='${response}'`)
 result=await invoke('register',{messageId:z01.mid});assert.equal(result[0].status,'fulfilled');assert.equal(result[0].fulfilled_by_message_id,response);checks++ // genuine applied source wins registration race
 const multi=await seed('Z01',40),first=uid(41),second=uid(42)
 await db.exec(`update ediel_messages set raw_payload=replace(raw_payload,'UNT+4','LIN+2++SECOND:OP:9''UNT+5'),immutable_payload_hash=encode(sha256(convert_to(replace(raw_payload,'UNT+4','LIN+2++SECOND:OP:9''UNT+5'),'UTF8')),'hex') where id='${multi.mid}';
 update gridex_ediel_transport.attempts set binding=binding||jsonb_build_object('originalHash',(select immutable_payload_hash from ediel_messages where id='${multi.mid}')) where id='${multi.aid}';
 insert into ediel_messages(id,company_id,environment,direction,raw_payload) values('${first}','${company}','test','inbound','first-applied-object'),('${second}','${company}','test','inbound','second-applied-object');
 insert into gridex_received_sources.z02_core_applications select id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'${multi.mid}','OBJECT','9',now() from ediel_messages where id='${first}'`)
 assert.equal((await invoke('register',{messageId:multi.mid}))[0].status,'pending');checks++
 await db.exec(`insert into gridex_received_sources.z02_core_applications select id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'${multi.mid}','SECOND','9',now() from ediel_messages where id='${second}'`)
 assert.equal((await invoke('read',{messageId:multi.mid}))[0].status,'fulfilled');checks++
 const ended=uid(50)
 await db.exec(`insert into ediel_messages(id,company_id,environment,direction,raw_payload) values('${ended}','${company}','test','inbound','applied-Z15-source');
 insert into gridex_received_sources.permission_transitions(source_message_id,company_id,previous_state,resulting_state,payload_hash) select id,company_id,jsonb_build_object('outbound_z18_message_id','${z18.mid}'),jsonb_build_object('inbound_z15_message_id',id),encode(sha256(convert_to(raw_payload,'UTF8')),'hex') from ediel_messages where id='${ended}'`)
 assert.equal((await invoke('read',{messageId:z18.mid}))[0].status,'pending');checks++ // last pointer alone is not correlated source authority
 await db.exec(`insert into gridex_received_sources.permission_transitions(source_message_id,company_id,previous_state,resulting_state,payload_hash,qualified_original_message_id,qualified_expected_message_code) select id,company_id,'{}',jsonb_build_object('inbound_z15_message_id',id),encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'${z18.mid}','Z15' from ediel_messages where id='${ended}'`)
 assert.equal((await invoke('read',{messageId:z18.mid}))[0].status,'fulfilled');checks++
 await rejects(call('read',{companyId:uid(99)}),/actor_not_authorized/)
 const acl=await db.query(`select has_function_privilege('anon','public.gridex_ediel_business_expectations_v1(jsonb)','execute') rpc,has_table_privilege('service_role','gridex_business_expectations.bindings','update') edit`)
 assert.deepEqual(acl.rows,[{rpc:false,edit:false}]);checks++
 await rejects(`set role service_role;update gridex_business_expectations.bindings set observed_at=now();`,/permission denied/)
 console.log(`PASS ${checks} targeted expectation PostgreSQL checks; synthetic source-ledger contract fixture, not native/replay or counterparty receipt evidence`)
}finally{await db.close()}
