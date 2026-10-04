// Executes the forward SQL over real service owner commands and explicitly
// synthetic private source/accepted-storage dependencies. This is bounded
// PostgreSQL consumer evidence, not native acceptance or legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-positive-ack-service-scope-sql-regression.mjs',import.meta.url),'utf8')
const marker=' // Existing administration checks below retain their original source fixture.'
assert.equal(original.split(marker).length,2)
const extension=String.raw`
 // All declarations below are finite synthetic dependency fixtures. Genuine
 // native multi-mission publication/storage/replay is a separate suite.
 await db.exec("CREATE TABLE public.metering_points(id uuid,company_id uuid,customer_id uuid,ediel_metering_point_id text,meter_point_id text,metering_point_id text,customer_site_id uuid,site_id uuid);CREATE TABLE gridex_ediel_inbound_context.receipts(company_id uuid,source_message_id uuid,environment text,status text,context jsonb);")
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001015846_ediel_service_scope_grant_set_and_projection_entry.sql',import.meta.url),'utf8'))
 let grantSetChecks=0
 const multiCheck=async fn=>{await fn();grantSetChecks++}
 await multiCheck(async()=>{await requireScope();assert.deepEqual(await effects(),stable)})
 const secondFields={...fields,beneficiary_company_id:uid(3),purpose:'quality-monitoring',field_sets:['quality']}
 await db.exec("INSERT INTO companies VALUES('"+uid(3)+"','active');INSERT INTO company_memberships VALUES('"+uid(3)+"','"+uid(20)+"','active',true,now())")
 const second=await command({action:'create_assignment',commandId:uid(500),fields:secondFields})
 assert.equal(second.status,'held')
 const aid2=second.assignmentId
 const kinds=['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles']
 for(let i=0;i<kinds.length;i++){
  const staged=await command({action:'stage_evidence',commandId:uid(510+i),assignmentId:aid2,expectedVersion:1,fields:{kind:kinds[i],source_reference:'DECLARED SYNTHETIC DEPENDENCY '+kinds[i],source_sha256:'d'.repeat(64),source_version:'grant-set-fixture',valid_from:'2000-01-01',valid_to:null,...(kinds[i]==='end_user_contract'?{permission_agreement_reference:'SOURCE-DECLARED-ANJ'}:{})}})
  assert.equal(staged.status,'pending')
  // The separate archive/review/issuer producer is deliberately not simulated
  // as authentic here. Its dependency is a labelled, exact finite fixture.
  await db.query("UPDATE ediel_service_evidence SET status='verified',approved_by=$1,approved_at='2000-01-01',approved_assignment_version=1 WHERE id=$2",[uid(20),staged.evidenceId])
 }
 const approved2=await command({action:'approve_assignment',commandId:uid(520),assignmentId:aid2,expectedVersion:1})
 assert.equal(approved2.status,'approved_waiting_permission')
 await db.query('INSERT INTO ediel_assignment_permission_links(id,company_id,assignment_id,permission_id) VALUES($1,$2,$3,$4)',[uid(530),uid(1),aid2,uid(201)])
 const grant2=await command({action:'create_grant',commandId:uid(531),assignmentId:aid2,expectedVersion:2,fields:{permission_link_id:uid(530),object_ids:['point-a'],product_ids:['8716867000030'],fields:['quality'],data_start:'2026-01-01',data_end:'2027-01-01',valid_from:'2000-01-01',valid_to:null}})
 const published2=await command({action:'publish_grant',commandId:uid(532),assignmentId:aid2,expectedVersion:2,grantId:grant2.grantId,expectedGrantVersion:1})
 assert.equal(published2.status,'active')
 const raw2=ackRaw.replace('+A++','+MULTI++').replace('BGM+312+A','BGM+312+MULTI').replace('UNZ+1+A','UNZ+1+MULTI')
 const projection=async(raw=raw2)=>(await db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4) p',[uid(1),'test',uid(210),raw])).rows[0].p
 await multiCheck(async()=>{const p=await projection();assert.equal(p.version,2);assert.equal(p.transactions.length,1);assert.deepEqual(p.transactions[0].scopes.map(s=>s.grant.id).sort(),[grant.grantId,grant2.grantId].sort());assert.deepEqual(p.transactions[0].scopes.map(s=>s.assignment.beneficiary_company_id).sort(),[uid(2),uid(3)].sort())})
 await multiCheck(async()=>{await requireScope();const p=(await db.query('SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE ack_raw_hash=encode(sha256(convert_to($1,\'UTF8\')),\'hex\')',[ackRaw])).rows[0].projection;assert.equal(p.version,1);assert.equal(p.transactions[0].grant.id,grant.grantId)})
 await multiCheck(async()=>{await capture(raw2);await requireScope(raw2);const e=await effects();assert.equal(e.receipts,2);await capture(raw2);await requireScope(raw2);assert.deepEqual(await effects(),e)})
 const multiStable=await effects()
 const multiHeld=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(requireScope(raw2),pattern)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await effects(),multiStable);await requireScope(raw2)}
 await multiCheck(()=>multiHeld("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id='"+grant2.grantId+"'",/captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id='"+aid2+"' AND kind='dso_contract'",/captured_grant_not_current/))
 await multiCheck(async()=>{await assert.rejects(db.exec("UPDATE ediel_service_assignments SET customer_id='"+uid(999)+"' WHERE id='"+aid2+"'"),/identity_immutable/);await requireScope(raw2);assert.deepEqual(await effects(),multiStable)})
 await multiCheck(()=>multiHeld("UPDATE ediel_service_assignments SET purpose='caller-change' WHERE id='"+aid2+"'",/captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE tenant_ediel_profiles SET is_enabled=false",/current_captured_role_unavailable/))
 await multiCheck(()=>multiHeld("UPDATE service_actor_permission_fixture SET allowed=false",/actor_not_authorized/))
 await multiCheck(()=>multiHeld("UPDATE source_authority_fixture SET allowed=false",/current_grant_required|captured_grant_not_current/))
 await multiCheck(()=>multiHeld("UPDATE metering_permission_sites SET end_at='2026-01-15'",/current_grant_required|captured_grant_not_current/))
 const beneficiaryPage=(beneficiary,grantId,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8)',[beneficiary,uid(20),grantId,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-02',17.250,'KWH','56','220')",[uid(540),uid(1),uid(211)])
 await multiCheck(async()=>{const rows=(await beneficiaryPage(uid(2),grant.grantId,'analysis',['quantity'])).rows[0].ediel_beneficiary_series_page_v1.rows;assert.deepEqual(rows,[{quantity:'17.250'}])})
 await multiCheck(async()=>{const rows=(await beneficiaryPage(uid(3),grant2.grantId,'quality-monitoring',['quality'])).rows[0].ediel_beneficiary_series_page_v1.rows;assert.deepEqual(rows,[{quality:'56'}])})
 await multiCheck(async()=>{await assert.rejects(beneficiaryPage(uid(3),grant2.grantId,'quality-monitoring',['quantity']),/outside_grant/);await assert.rejects(beneficiaryPage(uid(2),grant2.grantId,'quality-monitoring',['quality']),/no rows|query returned no rows/);await assert.rejects(beneficiaryPage(uid(999),grant.grantId,'analysis',['quantity']),/beneficiary_forbidden/);assert.deepEqual(await effects(),multiStable)})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE tenant_actor_roles SET valid_to=now()");await assert.rejects(beneficiaryPage(uid(2),grant.grantId,'analysis',['quantity']),/current_captured_role_unavailable/)}finally{await db.exec('ROLLBACK')}})
 await multiCheck(async()=>{const definition=(await db.query("SELECT pg_get_functiondef('public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,uuid)'::regprocedure) body")).rows[0].body;assert.ok(definition.indexOf('lock_current_graph_v2')<definition.indexOf('beneficiary_series_page_filtered_v2'));assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_ediel_ack_replay.current_service_grant_set_v2(uuid,text,jsonb,text,text,text,timestamptz,timestamptz,jsonb,uuid[])','EXECUTE') allowed")).rows[0].allowed,false)})
 await db.exec("CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_source_rules;ALTER TABLE gridex_received_sources.permission_transitions ADD company_id uuid,ADD source_message_id uuid,ADD payload_hash text,ADD permission_id uuid,ADD qualified_expected_message_code text,ADD qualified_original_message_id uuid;")
 await db.exec(getFunction(new URL('../supabase/migrations/20260930202616_ediel_native_aperak_own_erc_scope.sql',import.meta.url),'CREATE OR REPLACE FUNCTION gridex_ack_authority.wire_v1'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930203615_ediel_ack_first14_and_committed_replay.sql',import.meta.url),'CREATE OR REPLACE FUNCTION gridex_ack_authority.source_match_v1'))
 await db.exec(getFunction(new URL('../supabase/migrations/20260930231746_ediel_native_prodat_ack_immutable_scope.sql',import.meta.url),'CREATE FUNCTION gridex_ediel_ack_guide.prodat_outcomes_v1'))
 const prodatRaw="UNB+UNOC:3+54321:14+21660:14+261001:1200+P++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z14+PZ14+9'DTM+137:202610011200:203'NAD+FR+54321:160:SVK'NAD+DO+21660:160:SVK'LIN+1++point-a:::9'UNT+7+1'UNZ+1+P'"
 const prodatAck="UNB+UNOC:3+21660:14+54321:14+261001:1200+PA++23-DDQ-PRODAT++++1'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'RFF+ACW:PZ14'NAD+FR+21660:160:SVK'NAD+DO+54321:160:SVK'ERC+100::260'FTX+AAO+++OK'RFF+Z07:point-a'UNT+9+1'UNZ+1+PA'"
 const prodatBasis={...serviceBasis,family:'PRODAT',code:'Z14',applicationReference:'23-DDQ-PRODAT',canonicalProjection:{...serviceBasis.canonicalProjection,applicationReferences:['23-DDQ-PRODAT']}}
 await db.query('INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,application_reference) VALUES($1,$2,\'test\',\'inbound\',\'PRODAT\',\'Z14\',$3,\'23-DDQ-PRODAT\')',[uid(550),uid(1),prodatRaw])
 await db.query('INSERT INTO gridex_ediel_inbound_context.fixture VALUES($1,$2,$3)',[uid(1),uid(550),prodatBasis])
 await db.exec("CREATE FUNCTION gridex_ediel_source_rules.require_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF c='"+uid(1)+"' AND s='"+uid(550)+"' AND EXISTS(SELECT FROM gridex_received_sources.permission_transitions WHERE company_id=c AND source_message_id=s) THEN RETURN jsonb_build_object('fixture','EXPLICIT SYNTHETIC SOURCE-RULE DEPENDENCY');END IF;RAISE EXCEPTION 'source_rules_fixture_unavailable';END$$;")
 await db.query("INSERT INTO gridex_received_sources.permission_transitions(company_id,source_message_id,payload_hash,permission_id,qualified_expected_message_code,qualified_original_message_id) VALUES($1,$2,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'Z14',$5)",[uid(1),uid(550),prodatRaw,uid(201),uid(202)])
 const requireProdat=()=>db.query('SELECT gridex_ediel_ack_replay.require_positive_service_scope_v1($1,$2,$3,$4)',[uid(1),'test',uid(550),prodatAck])
 await multiCheck(async()=>{await capture(prodatAck,uid(1),'test',uid(550));await requireProdat();const p=(await db.query('SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE source_message_id=$1',[uid(550)])).rows[0].projection;assert.equal(p.scopeKind,'prescribed_prodat_permission_ack');assert.equal(p.dataAccessGranted,false);assert.equal(p.permissionTransitions.length,1);assert.equal(p.outcomes[0].outcome,'positive');assert.equal(p.transactions,undefined)})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("DELETE FROM gridex_received_sources.permission_transitions WHERE source_message_id='"+uid(550)+"'");await assert.rejects(requireProdat(),/source_rules_fixture_unavailable|prodat_own_commit_required/)}finally{await db.exec('ROLLBACK')}await requireProdat()})
 await multiCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE tenant_actor_roles SET valid_to=now()");await assert.rejects(requireProdat(),/current_captured_role_unavailable/)}finally{await db.exec('ROLLBACK')}await requireProdat()})
 await multiCheck(async()=>{await assert.rejects(capture(prodatAck.replace('RFF+Z07:point-a','RFF+Z07:OTHER'),uid(1),'test',uid(550)),/physical_scope_required/);await assert.rejects(capture(prodatAck.replace('RFF+ACW:PZ14','RFF+ACW:FORGED'),uid(1),'test',uid(550)),/physical_scope_required/)})
 console.log('Grant-set forward SQL: '+grantSetChecks+' PASS; finite synthetic source/accepted/review fixtures, NOT native/legal approval proof')
 // Restore only the public filtered body and finite dependency context for the
 // unchanged historic administration regression below. No migration bytes or
 // private immutable receipts are modified.
 const oldAdmin=readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8')
 const functionStart=oldAdmin.indexOf('CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1'),functionEnd=oldAdmin.indexOf('\nCREATE FUNCTION public.ediel_service_administration_command_v1',functionStart)
 await db.exec(oldAdmin.slice(functionStart,functionEnd))
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(540)])
`
const modified=original.replace(marker,()=>extension+marker).replace("'./.ediel-positive-service-scope.tmp.mjs'","'./.ediel-grant-set-consumer.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-grant-set-runner.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
