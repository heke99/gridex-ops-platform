// Synthetic originals and explicit canonical-owner boundary fixture only.
// Exercises actual protected positive-origin migration, never authentic TGT evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,company=uid(1),actor=uid(2),run=uid(3),message=uid(4),literal=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>`${literal(JSON.stringify(v))}::jsonb`
let checks=0
const raw="UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I++APP++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z09+DOC+9'UNT+3+M'UNZ+1+I'"
const scope={companyId:company,runId:run,actorUserId:actor,roleCode:'supplier',caseCode:'unit-positive',suite:'PRODAT',revision:'unit-only',stepNo:1,sourceReference:'synthetic://unit-original',ownerDecisionReference:'synthetic://unit-decision',expectedOutcome:'positive',expectedDiagnosticCodes:[],testReceiverEdielId:'TEST',validUntil:'2099-01-01T00:00:00Z'}
const publish=(s=scope,r=raw)=>`select public.gridex_ediel_positive_fixture_publish_v1(${json(s)},decode('${Buffer.from(r,'latin1').toString('hex')}','hex')) id;`,read=(extra={})=>`select public.gridex_ediel_positive_fixture_read_v1(${json({...scope,rawPayload:raw,...extra})}) result;`
async function as(role,sql){try{return(await db.exec(`set role ${role};${sql}`))[1].rows?.[0]}finally{await db.exec('reset role')}}
async function rejects(role,sql,re){await assert.rejects(as(role,sql),re);checks++}
const insert=(id,witness,payload=raw,env='test')=>`insert into ediel_messages values('${id}','${company}','outbound','${env}','edifact',${literal(payload)},'PRODAT','Z09',${json({sourceQualifiedPositiveFixtureWitnessId:witness})});`
const require=(id=message,code='Z09')=>`select gridex_negative_fixtures.require_positive_message_v1('${company}','${id}',${literal(code)}) result;`
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table companies(id uuid primary key);create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);create table user_profiles(id uuid,user_status text);create table permission_fixture(permission text primary key);insert into permission_fixture values('communication.write'),('communication.send');create function gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select exists(select from public.permission_fixture where permission=$3)';
 create table ediel_test_runs(id uuid primary key,company_id uuid,environment text,status text,role_code text,test_case_code text,test_suite text,approval_version text);create table ediel_test_run_messages(test_run_id uuid,ediel_message_id uuid,step_no integer);create table ediel_messages(id uuid primary key,company_id uuid,direction text,environment text,message_standard text,raw_payload text,message_family text,message_code text,execution_context_snapshot jsonb);create schema gridex_received_sources;
 create schema gridex_ediel_outbound_owner;create table gridex_ediel_outbound_owner.boundary_fixture(message_id uuid primary key,raw_payload text);create function gridex_ediel_outbound_owner.require_v1(c uuid,m uuid) returns jsonb language plpgsql as $$begin if not exists(select from gridex_ediel_outbound_owner.boundary_fixture f join public.ediel_messages e on e.id=f.message_id where f.message_id=m and e.company_id=c and f.raw_payload=e.raw_payload) then raise exception 'ediel_historical_outbound_owner_witness_unavailable';end if;return '{"fixture":"not-native-owner-proof"}'::jsonb;end$$;
 insert into companies values('${company}');insert into company_memberships values('${company}','${actor}','active',true,now());insert into user_profiles values('${actor}','active');insert into ediel_test_runs values('${run}','${company}','test','running','supplier','unit-positive','PRODAT','unit-only');`)
 const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
 await db.exec(decoder.slice(decoder.indexOf('CREATE FUNCTION gridex_received_sources.wire_tokens_bounded_v1'),decoder.indexOf('-- Keep the existing closure budget')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930171839_ediel_source_qualified_negative_fixture_v1.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930212435_ediel_source_qualified_positive_fixture_v1.sql',import.meta.url),'utf8'));checks++
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930221133_ediel_test_original_preparer_scope.sql',import.meta.url),'utf8'));checks++
 assert.equal((await as('service_role',read())).result,null);checks++
 await rejects('service_role',publish(),/permission denied/)
 await rejects('gridex_ediel_fixture_authority_owner',publish({...scope,expectedOutcome:'negative',expectedDiagnosticCodes:['NATIONAL']}),/qualified_original_required/)
 await rejects('gridex_ediel_fixture_authority_owner',publish({...scope,roleCode:'esco'}),/run_scope_mismatch/)
 await rejects('gridex_ediel_fixture_authority_owner',publish(scope,raw.replace('++++1', '++++0')),/test_original_required/)
 const registration=(await as('gridex_ediel_fixture_authority_owner',publish())).id
 assert.equal((await as('gridex_ediel_fixture_authority_owner',publish())).id,registration);checks++
 const qualified=(await as('service_role',read())).result
 assert.equal(qualified.registrationId,registration);assert.equal(qualified.expectedOutcome,'positive');assert.deepEqual(qualified.expectedDiagnosticCodes,[]);assert.equal(qualified.authorizesBusinessEffect,false);checks++
 assert.equal((await as('service_role',read({rawPayload:raw+' '}))).result,null);checks++
 assert.equal((await as('service_role',read({stepNo:2}))).result,null);checks++
 await rejects('service_role',read({actorUserId:uid(99)}),/actor_not_authorized/)
 const context={...scope,rawPayload:raw,registrationId:registration},prepared=(await as('service_role',`select public.gridex_ediel_positive_fixture_prepare_v1(${json(context)}) result;`)).result,witness=prepared.witnessId
 assert.equal((await as('service_role',`select gridex_negative_fixtures.prepared_positive_fixture_v1('${company}','${witness}',${literal(raw)},'${actor}') result;`)).result.registrationId,registration);checks++;
 await assert.rejects(db.exec(insert(message,witness)),/outbound_owner_witness_unavailable/);assert.equal((await db.query('select count(*)::int n from gridex_negative_fixtures.positive_consumptions')).rows[0].n,0);checks++
 await db.exec(`insert into gridex_ediel_outbound_owner.boundary_fixture values('${message}',${literal(raw)});`)
 await assert.rejects(db.exec(insert(message,witness,raw+' ')),/message_scope_invalid/);checks++
 await assert.rejects(db.exec(insert(message,witness,raw,'production')),/message_scope_invalid/);checks++
 await db.exec(insert(message,witness));checks++
 await rejects('service_role',require(),/actual_run_link_required/)
 await db.exec(`insert into ediel_test_run_messages values('${run}','${message}',1);`)
 await db.exec("delete from permission_fixture where permission='communication.send';");assert.equal((await as('service_role',require())).result.registrationId,registration);checks++;assert.equal((await db.query("select gridex_actor_has_company_permission($1,$2,'communication.send') allowed",[actor,company])).rows[0].allowed,false);checks++; // source proof is not current sender permission
 await db.exec("delete from permission_fixture;");await rejects('service_role',require(),/actor_not_authorized/);await db.exec("insert into permission_fixture values('communication.write'),('communication.send');");
 assert.equal((await as('service_role',require())).result.registrationId,registration);checks++
 await rejects('service_role',`select gridex_negative_fixtures.prepared_positive_fixture_v1('${company}','${witness}',${literal(raw)},'${actor}') result;`,/prepared_original_required/)
 await rejects('service_role',require(message,'Z06'),/physical_message_required/)
 await db.exec(`update ediel_messages set raw_payload=raw_payload where id='${message}';`);checks++ // established exact consumption retained
 await assert.rejects(db.exec(insert(uid(5),witness)),/original_already_consumed/);checks++
 await db.exec(`update ediel_test_runs set approval_version='other' where id='${run}';`);await rejects('service_role',require(),/current_run_required/)
 await db.exec(`update ediel_test_runs set approval_version='unit-only' where id='${run}';insert into ediel_test_run_messages values('${run}','${message}',2);`);await rejects('service_role',require(),/actual_run_link_required/)
 await rejects('service_role',`update gridex_negative_fixtures.positive_originals set expected_diagnostic_codes='["FAKE"]';`,/permission denied/)
 await assert.rejects(db.exec(`truncate gridex_negative_fixtures.positive_consumptions;`),/original_immutable/);checks++
 const owned=(await db.query(`select rolcanlogin login,(select count(*)::int from pg_auth_members where roleid=r.oid) members from pg_roles r where rolname='gridex_ediel_fixture_authority_owner'`)).rows[0];assert.deepEqual(owned,{login:false,members:0});checks++
 // Historical raw does not become a prospective original through a new token.
 await db.exec(`update ediel_test_runs set test_case_code='historical' where id='${run}';`)
 const oldscope={...scope,caseCode:'historical',stepNo:2},oldregistration=(await as('gridex_ediel_fixture_authority_owner',publish(oldscope))).id,oldcontext={...oldscope,rawPayload:raw,registrationId:oldregistration},oldwitness=(await as('service_role',`select public.gridex_ediel_positive_fixture_prepare_v1(${json(oldcontext)}) result;`)).result.witnessId
 await db.exec(`insert into ediel_messages values('${uid(6)}','${company}','outbound','test','edifact',${literal(raw)},'PRODAT','Z09','{}');insert into gridex_ediel_outbound_owner.boundary_fixture values('${uid(6)}',${literal(raw)});`)
 await assert.rejects(db.exec(`update ediel_messages set execution_context_snapshot=${json({sourceQualifiedPositiveFixtureWitnessId:oldwitness})} where id='${uid(6)}';`),/historical_original_unavailable/);checks++
 // Preparation of a registered negative uses the distinct protected port.
 await db.exec(`update ediel_test_runs set test_case_code='unit-positive' where id='${run}';delete from permission_fixture where permission='communication.send';`)
 const negative={...scope,stepNo:3,expectedOutcome:'negative',expectedDiagnosticCodes:['SYNTHETIC_EXPECTED']}
 const negregistration=(await as('gridex_ediel_fixture_authority_owner',`select public.gridex_ediel_negative_fixture_publish_v1(${json(negative)},decode('${Buffer.from(raw,'latin1').toString('hex')}','hex')) id;`)).id
 const negcontext={...negative,rawPayload:raw,registrationId:negregistration}
 const negq=(await as('service_role',`select public.gridex_ediel_negative_fixture_prepare_read_v1(${json(negcontext)}) result;`)).result
 assert.equal(negq.expectedOutcome,'negative');assert.equal(negq.authorizesBusinessEffect,false);checks++
 const negw=(await as('service_role',`select public.gridex_ediel_negative_fixture_prepare_v1(${json(negcontext)}) result;`)).result.witnessId
 assert.equal((await as('service_role',`select gridex_negative_fixtures.prepared_negative_fixture_v1('${company}','${negw}',${literal(raw)},'${actor}') result;`)).result.registrationId,negregistration);checks++
 await rejects('service_role',`select gridex_negative_fixtures.prepared_positive_fixture_v1('${company}','${negw}',${literal(raw)},'${actor}') result;`,/prepared_original_required/)
 await rejects('service_role',`select gridex_negative_fixtures.prepared_negative_fixture_v1('${company}','${negw}',${literal(raw+' ')},'${actor}') result;`,/prepared_original_required/)
 await db.exec(`insert into gridex_ediel_outbound_owner.boundary_fixture values('${uid(7)}',${literal(raw)});insert into ediel_messages values('${uid(7)}','${company}','outbound','test','edifact',${literal(raw)},'PRODAT','Z09',${json({sourceQualifiedNegativeFixtureWitnessId:negw})});insert into ediel_test_run_messages values('${run}','${uid(7)}',3);`);checks++
 assert.equal((await as('service_role',`select gridex_negative_fixtures.require_negative_message_v1('${company}','${uid(7)}','Z09') result;`)).result.registrationId,negregistration);checks++
 await db.exec("delete from permission_fixture;");await rejects('service_role',`select gridex_negative_fixtures.require_negative_message_v1('${company}','${uid(7)}','Z09') result;`,/actor_not_authorized/);await db.exec("insert into permission_fixture values('communication.write'),('communication.send');")
 assert.equal((await as('service_role',`select gridex_negative_fixtures.require_negative_message_v1('${company}','${uid(7)}','Z09') result;`)).result.registrationId,negregistration);checks++
 await rejects('service_role',`select gridex_negative_fixtures.prepared_negative_fixture_v1('${company}','${negw}',${literal(raw)},'${actor}') result;`,/prepared_original_required/)
 await db.exec("delete from permission_fixture;insert into permission_fixture values('ediel_testing.write');")
 assert.equal((await as('service_role',read({stepNo:1}))).result.registrationId,registration);checks++ // actual registered TEST only
 console.log(`PASS ${checks} actual positive-original protection checks; synthetic originals and canonical-owner boundary fixture only, no native replay`)
}finally{await db.close()}
