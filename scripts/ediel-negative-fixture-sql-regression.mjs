// Prospective protected qualification contract checks with synthetic originals.
// These are not authentic TGT files, native replay or permission to activate.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,company=uid(1),actor=uid(2),run=uid(3),message=uid(4),literal=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>`${literal(JSON.stringify(v))}::jsonb`
let checks=0
const raw="UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC'FTX+AAO+++ÅÄÖ'UNT+4+M'UNZ+1+I'"
const scope={companyId:company,runId:run,actorUserId:actor,roleCode:'supplier',caseCode:'unit-negative',suite:'PRODAT',revision:'unit-only',stepNo:1,sourceReference:'synthetic://unit-original',ownerDecisionReference:'synthetic://unit-decision',expectedOutcome:'negative',expectedDiagnosticCodes:['NATIONAL_FIELD_MISSING'],testReceiverEdielId:'TEST',validUntil:'2099-01-01T00:00:00Z'}
const publish=(s=scope)=>`select public.gridex_ediel_negative_fixture_publish_v1(${json(s)},decode('${Buffer.from(raw,'latin1').toString('hex')}','hex')) id;`,read=(extra={})=>`select public.gridex_ediel_negative_fixture_read_v1(${json({...scope,rawPayload:raw,...extra})}) result;`
async function as(role,sql){try{return(await db.exec(`set role ${role};${sql}`))[1].rows[0]}finally{await db.exec('reset role')}}
async function rejects(role,sql,re){await assert.rejects(as(role,sql),re);checks++}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table companies(id uuid primary key);create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 create table ediel_test_runs(id uuid primary key,company_id uuid,environment text,status text,role_code text,test_case_code text,test_suite text,approval_version text);create table ediel_test_run_messages(test_run_id uuid,ediel_message_id uuid,step_no integer);create table ediel_messages(id uuid primary key,company_id uuid,direction text,environment text,message_standard text,raw_payload text);create schema gridex_received_sources;
 insert into companies values('${company}');insert into company_memberships values('${company}','${actor}','active',true,now());insert into user_profiles values('${actor}','active');insert into ediel_test_runs values('${run}','${company}','test','running','supplier','unit-negative','PRODAT','unit-only');insert into ediel_messages values('${message}','${company}','outbound','test','edifact',${literal(raw)});insert into ediel_test_run_messages values('${run}','${message}',1);`)
 const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
 await db.exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),decoder.indexOf('-- Keep the existing closure budget')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930171839_ediel_source_qualified_negative_fixture_v1.sql',import.meta.url),'utf8'));checks++
 assert.equal((await as('service_role',read())).result,null);checks++
 await rejects('service_role',publish(),/permission denied/)
 await rejects('gridex_ediel_fixture_authority_owner',publish({...scope,roleCode:'esco'}),/run_scope_mismatch/)
 const id=(await as('gridex_ediel_fixture_authority_owner',publish())).id;assert.equal((await as('gridex_ediel_fixture_authority_owner',publish())).id,id);checks++
 const qualified=(await as('service_role',read())).result;assert.equal(qualified.registrationId,id);assert.equal(qualified.originalFileSha256,createHash('sha256').update(Buffer.from(raw,'latin1')).digest('hex'));assert.equal(qualified.expectedOutcome,'negative');assert.deepEqual(qualified.expectedDiagnosticCodes,scope.expectedDiagnosticCodes);checks++
 assert.equal((await as('service_role',read({messageId:message,runId:uid(99)}))).result.registrationId,id);checks++ // actual persisted link overrides caller run
 assert.equal((await as('service_role',read({rawPayload:raw+' '}))).result,null);checks++
 assert.equal((await as('service_role',read({stepNo:2}))).result,null);checks++
 await rejects('gridex_ediel_fixture_authority_owner',publish({...scope,expectedDiagnosticCodes:['OTHER']}),/original_conflict/)
 await rejects('service_role',read({companyId:uid(99)}),/no rows/)
 await db.exec(`update ediel_messages set environment='production' where id='${message}';`);await rejects('service_role',read({messageId:message}),/no rows/)
 await rejects('service_role',`update gridex_negative_fixtures.originals set expected_outcome='positive';`,/permission denied/)
 await assert.rejects(db.exec(`update gridex_negative_fixtures.originals set valid_until=now();`),/original_immutable/);checks++
 const owned=(await db.query(`select rolcanlogin login,(select count(*)::int from pg_auth_members where roleid=r.oid) members from pg_roles r where rolname='gridex_ediel_fixture_authority_owner'`)).rows[0];assert.deepEqual(owned,{login:false,members:0});checks++
 console.log(`PASS ${checks} targeted negative-fixture ownership checks; synthetic originals only, no authentic TGT evidence`)
}finally{await db.close()}
