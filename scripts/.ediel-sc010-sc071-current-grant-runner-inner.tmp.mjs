// Embedded consumer proof only: genuine service commands/assessment and exact
// forward SQL execute over declared synthetic source/storage authorities.
// This is not native accepted-data, HTTP, original-guide or legal approval proof.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./ediel-service-administration-sql-regression.mjs',import.meta.url),'utf8')
const marker=' const page=()=>db.query'
assert.equal(base.split(marker).length,2)
const extension=String.raw`
 await db.exec("CREATE SCHEMA extensions;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA gridex_ediel_technical_ack;CREATE SCHEMA gridex_received_sources;CREATE TABLE gridex_received_sources.permission_transitions(id uuid);CREATE TABLE gridex_received_sources.validation_assessments(id uuid);CREATE TABLE public.admin_users(id uuid);CREATE TABLE public.user_roles(id uuid);CREATE TABLE public.roles(id uuid);CREATE TABLE public.role_permissions(id uuid);CREATE TABLE public.permissions(id uuid);CREATE TABLE public.user_permissions(id uuid);CREATE TABLE public.service_actor_permission_fixture(company_id uuid,actor_id uuid,allowed boolean);INSERT INTO public.service_actor_permission_fixture VALUES('"+uid(1)+"','"+uid(20)+"',true);ALTER TABLE public.companies ADD status text DEFAULT 'active';ALTER TABLE public.ediel_messages ADD application_reference text;CREATE TABLE gridex_utilts_binding.receipts(source_message_id uuid);ALTER TABLE gridex_utilts_binding.contracts ADD contract_hash text;CREATE TABLE public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,persisted_series_id uuid,disposition text,persistence_status text,planned_response_type text);");
 await db.exec("CREATE OR REPLACE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,p text) RETURNS boolean LANGUAGE sql AS $$ SELECT CASE WHEN p='communication.write' THEN coalesce((SELECT allowed FROM public.service_actor_permission_fixture WHERE company_id=c AND actor_id=a),false) ELSE true END $$");
 const getFunction=(path,prefix)=>{const s=readFileSync(path,'utf8'),start=s.indexOf(prefix),end=s.indexOf('END $$;',start);assert.ok(start>=0&&end>start);return s.slice(start,end+7)}
 await db.exec(getFunction(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'CREATE FUNCTION gridex_ediel_technical_ack.require_current_endpoint_v1'))
 const atomic=process.env.EDIEL_ATOMIC_ACK_FORWARD||fileURLToPath(new URL('../supabase/migrations/20260930231958_ediel_atomic_ack_owner_persistence.sql',import.meta.url))
 await db.exec(getFunction(atomic,'CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2'))
 await db.exec(getFunction(atomic,'CREATE FUNCTION gridex_ediel_ack_replay.require_current_source_role_v2'))
 // The separate accepted/native owner authority is a finite synthetic fixture.
 // No claim that these fixture rows were minted by its real producer is made.
 await db.exec("CREATE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(c uuid,env text,s uuid,t text,a uuid,r text) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.ediel_ack_transaction_results x WHERE x.company_id=c AND x.environment=env AND x.source_message_id=s AND x.source_transaction_id=t AND x.disposition='accepted' AND x.persistence_status='persisted' AND x.planned_response_type='positive_aperak') THEN RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable';END IF;RETURN jsonb_build_object('authorityVersion',1);END$$;")
 const serviceBasis={...basis,basisKind:'observed_source_persistence',companyId:uid(1),legalEdielId:'21660',applicationReference:'23-DGI-E66-T',transportActorId:uid(30),transportEdielId:'21660',canonicalProjection:{receiverRoles:['esco'],applicationReferences:['23-DGI-E66-T','23-DDQ-E66-T']},facts:{profile:{id:uid(40)}}}
 await db.exec("UPDATE ediel_messages SET application_reference='23-DGI-E66-T' WHERE id='"+uid(210)+"'")
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(serviceBasis)+';UPDATE gridex_utilts_binding.contracts SET contract_hash=encode(sha256(convert_to(contract::text,\'UTF8\')),\'hex\');INSERT INTO ediel_ack_transaction_results VALUES(\''+uid(1)+'\',\'test\',\''+uid(210)+'\',\'tx\',\''+uid(211)+'\',\'accepted\',\'persisted\',\'positive_aperak\');')
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930235702_ediel_positive_ack_service_scope.sql',import.meta.url),'utf8'))
 const ackRaw="UNB+UNOC:3+21660:14+54321:14+261001:1200+A++23-DGI-E66-T++++1'UNH+1+APERAK:D:04A:UN:E5SE5A'BGM+312+A+9'ERC+100::260'RFF+DM:OWN'RFF+ACW:tx'UNT+6+1'UNZ+1+A'"
 const capture=(raw=ackRaw,c=uid(1),env='test',s=uid(210),actor=uid(20))=>db.query('SELECT gridex_ediel_ack_replay.capture_positive_service_scope_v1($1,$2,$3,$4,$5)',[c,env,s,raw,actor])
 const requireScope=(raw=ackRaw)=>db.query('SELECT gridex_ediel_ack_replay.require_positive_service_scope_v1($1,$2,$3,$4)',[uid(1),'test',uid(210),raw])
 const effects=async()=>(await db.query('SELECT (SELECT count(*) FROM gridex_ediel_ack_replay.positive_service_scope_receipts) receipts,(SELECT count(*) FROM ediel_messages) messages,(SELECT count(*) FROM ediel_data_access_grants) grants')).rows[0]
 const check=async fn=>{await fn();scopeChecks++};let scopeChecks=0
 await check(async()=>{await capture();await requireScope();assert.equal((await effects()).receipts,1)})
 const stable=await effects()
 await check(async()=>{await capture();await requireScope();assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(capture(ackRaw,uid(2)),/actor_not_authorized/);await assert.rejects(capture(ackRaw,uid(1),'production'),/historical_identity_basis_unavailable|current_captured_role_unavailable/);assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(capture(ackRaw.replace('RFF+ACW:tx','RFF+ACW:tx\'RFF+ACW:tx')),/positive_reference_invalid/);await assert.rejects(capture(ackRaw.replace('ERC+100','ERC+40')),/positive_reference_unavailable/);assert.deepEqual(await effects(),stable)})
 const held=async(change,restore,pattern)=>{await db.exec(change);await assert.rejects(requireScope(),pattern);assert.deepEqual(await effects(),stable);await db.exec(restore);await requireScope()}
 await check(()=>held("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(1)+"'","UPDATE company_memberships SET is_active=true WHERE company_id='"+uid(1)+"'",/actor_not_authorized/))
 await check(()=>held("UPDATE service_actor_permission_fixture SET allowed=false","UPDATE service_actor_permission_fixture SET allowed=true",/actor_not_authorized/))
 await check(()=>held("UPDATE user_profiles SET user_status='suspended'","UPDATE user_profiles SET user_status='active'",/actor_not_authorized/))
 await check(()=>held("UPDATE tenant_ediel_profiles SET is_enabled=false","UPDATE tenant_ediel_profiles SET is_enabled=true",/current_captured_role_unavailable/))
 await check(()=>held("UPDATE tenant_actor_roles SET valid_to=now()","UPDATE tenant_actor_roles SET valid_to=null",/current_captured_role_unavailable/))
 await check(()=>held("UPDATE tenant_actor_identifiers SET valid_to=now()","UPDATE tenant_actor_identifiers SET valid_to=null",/endpoint_unqualified/))
 await check(()=>held("UPDATE source_authority_fixture SET allowed=false","UPDATE source_authority_fixture SET allowed=true",/unique_current_grant_required/))
 await check(()=>held("UPDATE metering_permission_sites SET end_at='2026-01-15'","UPDATE metering_permission_sites SET end_at='2027-01-01'",/unique_current_grant_required/))
 await check(()=>held("UPDATE ediel_ack_transaction_results SET persistence_status='failed'","UPDATE ediel_ack_transaction_results SET persistence_status='persisted'",/storage_unavailable/))
 const rolledBackHold=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(requireScope(),pattern)}finally{await db.exec('ROLLBACK')}assert.deepEqual(await effects(),stable);await requireScope()}
 await check(()=>rolledBackHold("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now()",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_data_access_grants SET valid_from='2001-01-01'",/receipt_changed/))
 await check(()=>rolledBackHold("UPDATE ediel_service_evidence SET status='revoked' WHERE kind='dso_contract'",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_service_assignments SET purpose='changed'",/unique_current_grant_required/))
 await check(()=>rolledBackHold("INSERT INTO ediel_data_access_grants(company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,status) SELECT company_id,beneficiary_company_id,assignment_id,permission_link_id,object_ids,product_ids,fields,purpose,data_start,data_end,valid_from,valid_to,'active' FROM ediel_data_access_grants",/unique_current_grant_required/))
 await check(()=>rolledBackHold("UPDATE ediel_messages SET application_reference='23-DDQ-E66-T' WHERE id='"+uid(210)+"'",/source_unqualified/))
 await check(async()=>{await db.exec("UPDATE ediel_messages SET execution_context_snapshot='{"+'"serviceAssignmentId":"FORGED","authorized":true'+"}' WHERE id='"+uid(210)+"'");await requireScope();assert.deepEqual(await effects(),stable)})
 await check(async()=>{const mixedRaw=ackRaw.replace("UNT+6+1'","ERC+40::260'RFF+DM:OTHER'RFF+ACW:UNACCEPTED'UNT+9+1'");const proof=(await db.query('SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v1($1,$2,$3,$4) p',[uid(1),'test',uid(210),mixedRaw])).rows[0].p;assert.deepEqual(proof.transactions.map(t=>t.transactionId),['tx']);assert.deepEqual(await effects(),stable)})
 await check(async()=>{await assert.rejects(db.exec('DELETE FROM gridex_ediel_ack_replay.positive_service_scope_receipts'),/scope_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_ack_replay.positive_service_scope_receipts'),/scope_immutable/)})
 await check(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_ack_replay.positive_service_scope_receipts','INSERT') direct,has_function_privilege('service_role','gridex_ediel_ack_replay.capture_positive_service_scope_v1(uuid,text,uuid,text,uuid)','EXECUTE') capture,has_function_privilege('authenticated','gridex_ediel_ack_replay.require_positive_service_scope_v1(uuid,text,uuid,text)','EXECUTE') replay")).rows[0];assert.deepEqual(acl,{direct:false,capture:false,replay:false})})
 console.log('Actual positive ACK service-scope SQL consumer: '+scopeChecks+' PASS; synthetic source/storage dependencies, NOT native/legal approval proof')

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
 // SC-011: one database, genuine Z13/Z14/Z15/Z15C permission producer,
 // genuine independent revoke command, and genuine current beneficiary read.
 // This probe rolls back its complete fixture graph before any unchanged
 // historical assertion. The companion source suite separately asserts the
 // genuinely committed Z15C receipt; this case proves the atomic consumer seam.
 await db.exec('BEGIN')
 try {
  const id=uid
  // SC-011 REUSED SOURCE INPUT HELPERS
  await db.exec("ALTER TABLE company_memberships ADD id uuid DEFAULT gen_random_uuid();ALTER TABLE metering_permissions ADD source_z13_message_id uuid,ADD outbound_z13_message_id uuid,ADD inbound_z15_message_id uuid,ADD outbound_z18_message_id uuid,ADD rff_li_reference text,ADD permission_id text,ADD permission_reference text,ADD approved_start_date date,ADD approved_end_date date,ADD approved_start_at timestamptz,ADD approved_end_at timestamptz,ADD report_frequency text,ADD last_blocker text,ADD market_state_version bigint,ADD updated_at timestamptz DEFAULT now(),ADD updated_by uuid;ALTER TABLE metering_permission_sites ADD customer_site_id uuid,ADD metering_point_id uuid,ADD grid_area_code text,ADD permission_end_at timestamptz,ADD updated_at timestamptz DEFAULT now();ALTER TABLE ediel_messages ADD status text,ADD message_sent_at timestamptz,ADD immutable_rendered_at timestamptz,ADD immutable_payload_hash text;ALTER TABLE gridex_received_sources.validation_assessments ADD source_message_id uuid,ADD company_id uuid,ADD environment text,ADD source_payload_hash text,ADD facts_text text,ADD previous_assessment_id uuid,ADD owner text DEFAULT 'canonical-runtime-with-registry-v1',ADD facts_hash text;ALTER TABLE gridex_received_sources.permission_transitions ADD previous_state jsonb,ADD previous_sites jsonb,ADD resulting_state jsonb,ADD applied_at timestamptz DEFAULT now(),ADD actor_user_id uuid,ADD resulting_sites jsonb;")
  await db.exec("CREATE TABLE ediel_business_expectations(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,expected_family text,expected_code text,status text,fulfilled_by_message_id uuid,updated_at timestamptz);CREATE TABLE gridex_received_sources.prodat_application_facets(assessment_id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,application_facts_text text,application_facts_hash text);CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,response_facts_text text,response_facts_hash text);CREATE TABLE application_fixture(source uuid PRIMARY KEY,facet jsonb);CREATE TABLE legal_fixture(source uuid PRIMARY KEY,basis jsonb);CREATE TABLE accepted_source_fixture(source uuid PRIMARY KEY,payload_hash text);")
  await db.exec('ALTER TABLE gridex_received_sources.validation_assessments ADD UNIQUE(id)')
  // SC-011 REUSED DECLARED SOURCE PORTS
  for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',name))
  await db.exec(fn('../supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql','gridex_received_sources.validate_prodat_application_v1'))
  const permissionForward=readFileSync(new URL('../supabase/migrations/20261001044351_ediel_partial_permission_source_effects.sql',import.meta.url),'utf8')
  assert.equal((permissionForward.match(/^BEGIN;$/gm)||[]).length,1)
  assert.equal((permissionForward.match(/^COMMIT;$/gm)||[]).length,1)
  // Only the forward's outer transaction statements are interpreted inside
  // this owned transaction. All actual function/DDL statement bytes are kept.
  await db.exec(permissionForward.replace(/^BEGIN;\n|^COMMIT;\n?/gm,''))
  // The old standalone administration fixture predates the committed S17/S18
  // normalization. Execute the actual current matcher, not a metadata UPDATE.
  await db.exec(getFunction(new URL('../supabase/migrations/20261001000926_ediel_service_evidence_archive_review.sql',import.meta.url),'CREATE OR REPLACE FUNCTION gridex_service_administration.permission_matches_assignment_v1'))
  const captured=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
  const writerStart=captured.indexOf('CREATE FUNCTION gridex_service_permission.lock_request_writer_v1(')
  assert.ok(writerStart>=0)
  await db.exec(captured.slice(writerStart,captured.indexOf('$$;',writerStart)+3))
  await db.exec(getFunction(new URL('../supabase/migrations/20261001043917_ediel_service_source_network_period_timing.sql',import.meta.url),'CREATE OR REPLACE FUNCTION public.ediel_service_administration_command_v1'))
  // The current public consumer also retains source provenance. Its accepted
  // storage/context input is still the declared port from this same fixture.
  await db.exec('CREATE SCHEMA gridex_ediel_services;ALTER TABLE gridex_utilts_binding.contracts ADD contract_version integer')
  // Empty relation definitions support the current genuine writer lock graph;
  // they contain no invented issuer, artifact, review or permission authority.
  for(const relation of ['public.user_permission_overrides','gridex_ediel_services.artifacts','gridex_ediel_services.issuer_keys','gridex_ediel_services.issuer_representations','gridex_ediel_services.issuer_revocations','gridex_ediel_services.reviews']){
   const start=captured.indexOf('CREATE TABLE '+relation+' (')
   assert.ok(start>=0,relation)
   await db.exec(captured.slice(start,captured.indexOf('\n);',start)+4))
  }
  const evidenceLockStart=captured.indexOf('CREATE FUNCTION gridex_ediel_services.lock_evidence_graph_v1(')
  assert.ok(evidenceLockStart>=0)
  await db.exec(captured.slice(evidenceLockStart,captured.indexOf('$$;',evidenceLockStart)+3))
  await db.query("UPDATE gridex_utilts_binding.contracts SET contract=contract||'{\"version\":2}'::jsonb,contract_version=2")
  await db.exec("UPDATE gridex_utilts_binding.contracts SET contract_hash=encode(sha256(convert_to(contract::text,'UTF8')),'hex')")
  await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',["UNB+UNOC:3+54321:14+21660:14+261001:1200+SC011++23-DGI-E66-T'UNH+1+UTILTS:D:02B:UN:E2SE6A'NAD+MS+54321:160:SVK'UNT+3+1'UNZ+1+SC011'",uid(210)])
  await db.exec(readFileSync(new URL('../supabase/migrations/20261001022500_ediel_beneficiary_projection_provenance_receipts.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../supabase/migrations/20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql',import.meta.url),'utf8'))
  const receive=async(n,code,objects)=>{
   const result=await incoming(n,code,objects)
   // Keep the existing legal-context dependency port; only its explicitly
   // declared input row is supplied for this exact incoming source.
   await db.query('INSERT INTO gridex_ediel_inbound_context.fixture SELECT $1,source,basis FROM legal_fixture WHERE source=$2',[uid(1),uid(n)])
   return result
  }
  const own={point:'point-a',permission:'SC011-PERM',li:'SC011-LI',start:'202601010000',end:'202701010000',status:'A74'}
  await permission(6201,[own]);await receive(6221,'Z14',[own])
  assert.equal((await apply(uid(6221))).applied,true)
  assert.equal(await current(uid(6201),uid(6221)),true)
  const pair=[]
  for(const [i,assignment,beneficiary,purpose,requested] of [[0,aid,uid(2),'analysis',['quantity']],[1,aid2,uid(3),'quality-monitoring',['quality']]]){
   const link=uid(6240+i)
   await db.query('INSERT INTO ediel_assignment_permission_links(id,company_id,assignment_id,permission_id) VALUES($1,$2,$3,$4)',[link,uid(1),assignment,uid(6201)])
   // Source local 2027-01-01 00:00 is 2026-12-31 23:00 UTC. Keep the grant
   // inside that actual decoded interval rather than the old fixture's UTC end.
   const created=await command({action:'create_grant',commandId:uid(6250+i),assignmentId:assignment,expectedVersion:2,fields:{permission_link_id:link,object_ids:['point-a'],product_ids:['8716867000030'],fields:requested,data_start:'2026-01-01',data_end:'2026-12-31T23:00:00Z',valid_from:'2000-01-01',valid_to:null}})
   const published=await command({action:'publish_grant',commandId:uid(6260+i),assignmentId:assignment,expectedVersion:2,grantId:created.grantId,expectedGrantVersion:1})
   assert.equal(published.status,'active',JSON.stringify(published))
   pair.push({assignment,beneficiary,purpose,requested,grantId:created.grantId})
  }
  const read=(item,version=2)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[item.beneficiary,uid(20),item.grantId,version,item.purpose,uid(211),item.requested,'2026-01-01','2026-02-01'])
  assert.deepEqual((await read(pair[0])).rows[0].ediel_beneficiary_series_page_v1.rows,[{quantity:'17.250'}])
  assert.deepEqual((await read(pair[1])).rows[0].ediel_beneficiary_series_page_v1.rows,[{quality:'56'}])
  await receive(6222,'Z15',[{...own,permissionEnd:'202601011200',endReason:'B77'}])
  assert.equal((await apply(uid(6222))).applied,true)
  assert.equal((await db.query('SELECT status FROM metering_permissions WHERE id=$1',[uid(6201)])).rows[0].status,'ended')
  assert.equal((await command({action:'revoke_grant',commandId:uid(6270),assignmentId:pair[0].assignment,expectedVersion:2,grantId:pair[0].grantId,expectedGrantVersion:2})).status,'revoked')
  const grantRows=async()=>(await db.query('SELECT * FROM ediel_data_access_grants WHERE id=ANY($1::uuid[]) ORDER BY id',[pair.map(item=>item.grantId)])).rows
  const before=await grantRows()
  const revoked=before.find(row=>row.id===pair[0].grantId),valid=before.find(row=>row.id===pair[1].grantId)
  assert.equal(revoked.status,'revoked');assert.equal(revoked.version,3);assert.ok(revoked.revoked_at)
  assert.equal(valid.status,'active');assert.equal(valid.version,2);assert.equal(valid.revoked_at,null)
  await db.exec('SAVEPOINT sc011_market_hold')
  await assert.rejects(read(pair[1]),/market_permission_not_approved/)
  await db.exec('ROLLBACK TO SAVEPOINT sc011_market_hold;RELEASE SAVEPOINT sc011_market_hold')
  const restored=await receive(6223,'Z15',[{...own,reason:'Z24',permissionEnd:'202601011200',endReason:'B77'}])
  // Frozen P field 223 / original example p139: C is BGM Z15 with CCI Z13
  // CAV Z24, not a literal BGM Z15C or an S17/S18 reason-code alias.
  assert.ok(restored.wire.includes('++23-DGI-PRODAT'))
  const restoredWire=(await db.query('SELECT gridex_received_sources.permission_partition_wire_v1($1) b',[restored.wire])).rows[0].b
  assert.equal(restoredWire.code,'Z15');assert.equal(restoredWire.objects[0].reason,'Z24')
  const result=await apply(uid(6223))
  assert.equal(result.applied,true)
  assert.deepEqual(result.manifest.map(item=>item.status),['applied'])
  assert.equal(await current(uid(6201),uid(6221)),true)
  assert.equal((await db.query('SELECT status FROM metering_permissions WHERE id=$1',[uid(6201)])).rows[0].status,'active')
  assert.equal((await db.query('SELECT permission_end_at FROM metering_permission_sites WHERE metering_permission_id=$1',[uid(6201)])).rows[0].permission_end_at,null)
  assert.deepEqual(await grantRows(),before)
  await db.exec('SAVEPOINT sc011_revoked_hold')
  // Use the revoked grant's CURRENT version, so a stale-version rejection
  // cannot masquerade as the independently retained revocation.
  await assert.rejects(read(pair[0],3),/grant_not_current/)
  await db.exec('ROLLBACK TO SAVEPOINT sc011_revoked_hold;RELEASE SAVEPOINT sc011_revoked_hold')
  await db.exec('SET ROLE service_role;SAVEPOINT sc011_new_basis_required')
  await assert.rejects(db.query('SELECT ediel_service_administration_command_v1($1,$2,$3) b',[uid(1),uid(20),{action:'publish_grant',commandId:uid(6271),assignmentId:pair[0].assignment,expectedVersion:2,grantId:pair[0].grantId,expectedGrantVersion:3}]),/revoked_grant_requires_new_basis/)
  await db.exec('ROLLBACK TO SAVEPOINT sc011_new_basis_required;RELEASE SAVEPOINT sc011_new_basis_required;RESET ROLE')
  assert.deepEqual((await read(pair[1])).rows[0].ediel_beneficiary_series_page_v1.rows,[{quality:'56'}])
  const committed=(await db.query('SELECT gridex_received_sources.committed_permission_effects_v1($1,$2,NULL) b',[uid(1),uid(6223)])).rows[0].b
  assert.deepEqual(committed,[]) // Own uncommitted changes are not final ACK evidence.
  const receipt=(await db.query('SELECT object_scopes,payload_hash FROM gridex_received_sources.permission_effect_receipts WHERE source_message_id=$1',[uid(6223)])).rows
  assert.equal(receipt.length,1);assert.deepEqual(receipt[0].object_scopes,[restored.scopes[0]])
  assert.equal(receipt[0].payload_hash,(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[restored.wire])).rows[0].h)
  assert.equal((await apply(uid(6223))).idempotent,true);assert.deepEqual(await grantRows(),before)
  console.log('SC-011 actual atomic source restore + independently revoked/current beneficiary contrast: PASS; rolled-back consumer probe, declared canonical/legal/source/review/storage ports, NOT native/legal approval')
 } finally {await db.exec('ROLLBACK')}
 console.log('Grant-set forward SQL: '+grantSetChecks+' PASS; finite synthetic source/accepted/review fixtures, NOT native/legal approval proof')

 // Exact physical application and contract version are finite synthetic
 // dependency declarations, not receipts forged into a genuine native owner.
 await db.exec("CREATE SCHEMA gridex_ediel_services;ALTER TABLE gridex_utilts_binding.contracts ADD contract_version integer DEFAULT 1;UPDATE gridex_utilts_binding.contracts SET contract=contract||'{\"version\":1}',contract_hash=encode(sha256(convert_to((contract||'{\"version\":1}')::text,'UTF8')),'hex');")
 await db.query('UPDATE ediel_messages SET raw_payload=replace(raw_payload,$1,$2) WHERE id=$3',["+260930:1200+S'","+260930:1200+S++23-DGI-E66-T'",uid(210)])
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001022500_ediel_beneficiary_projection_provenance_receipts.sql',import.meta.url),'utf8'))
 const beforeForward=(await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)'::regprocedure")).rows[0]
 if(process.env.EDIEL_PROJECTION_REPLAY_BASELINE!=='1')await db.exec(readFileSync(new URL('../supabase/migrations/20261001035402_ediel_beneficiary_receipt_read_before_write_replay.sql',import.meta.url),'utf8'))
 const afterForward=(await db.query("SELECT oid,proacl FROM pg_proc WHERE oid='public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)'::regprocedure")).rows[0]
 assert.deepEqual(afterForward,beforeForward)

 let provenanceChecks=0
 const provenanceCheck=async fn=>{await fn();provenanceChecks++}
 const pages=async(beneficiary=uid(2),grantId=grant.grantId,purpose='analysis',requested=['quantity'])=>(await beneficiaryPage(beneficiary,grantId,purpose,requested)).rows[0].ediel_beneficiary_series_page_v1
 const receiptCount=async()=>(await db.query('SELECT count(*) n FROM gridex_ediel_services.projection_receipts')).rows[0].n
 let quantityPage,qualityPage
 await provenanceCheck(async()=>{quantityPage=await pages();assert.deepEqual(quantityPage.rows,[{quantity:'17.250'}]);assert.equal(quantityPage.provenance.sourceRole,'DGI');assert.equal(quantityPage.provenance.sourceSenderEdielId,'54321');assert.equal(quantityPage.provenance.sourceMessageId,uid(210));assert.equal(quantityPage.provenance.purpose,'analysis');assert.equal(quantityPage.provenance.qualityOrigin,null);assert.deepEqual(quantityPage.provenance.fields,['quantity']);assert.match(quantityPage.provenance.sourceRawHash,/^[0-9a-f]{64}$/);assert.match(quantityPage.provenance.contractHash,/^[0-9a-f]{64}$/);assert.equal(await receiptCount(),1)})
 await provenanceCheck(async()=>{qualityPage=await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']);assert.deepEqual(qualityPage.rows,[{quality:'56'}]);assert.equal(qualityPage.provenance.sourceRole,'DGI');assert.equal(qualityPage.provenance.sourceRawHash,quantityPage.provenance.sourceRawHash);assert.equal(qualityPage.provenance.contractHash,quantityPage.provenance.contractHash);assert.equal(qualityPage.provenance.qualityOrigin.column,'meter_reading_values.quality');assert.equal(qualityPage.provenance.qualityOrigin.sourceMessageId,uid(210));assert.equal(qualityPage.provenance.purpose,'quality-monitoring');assert.notEqual(qualityPage.consumerReceiptId,quantityPage.consumerReceiptId);assert.equal(await receiptCount(),2)})
 await provenanceCheck(async()=>{const again=await pages();assert.deepEqual(again,quantityPage);assert.equal(await receiptCount(),2);assert.equal(JSON.stringify(quantityPage).includes('raw_payload'),false);assert.equal(JSON.stringify(quantityPage).includes('observations'),false);assert.equal(JSON.stringify(quantityPage).includes('quality":"56'),false)})
 await provenanceCheck(async()=>{await assert.rejects(pages(uid(2),grant.grantId,'unrelated'),/outside_grant/);await assert.rejects(pages(uid(2),grant.grantId,'analysis',['quality']),/outside_grant/);await assert.rejects(pages(uid(2),grant2.grantId,'quality-monitoring',['quality']),/no rows|query returned no rows/);assert.equal(await receiptCount(),2)})
 const provenanceHeld=async(change,pattern)=>{await db.exec('BEGIN');try{await db.exec(change);await assert.rejects(pages(),pattern)}finally{await db.exec('ROLLBACK')}assert.equal(await receiptCount(),2);assert.deepEqual(await pages(),quantityPage)}
 await provenanceCheck(()=>provenanceHeld("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'",/beneficiary_forbidden/))
 await provenanceCheck(()=>provenanceHeld("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id='"+grant.grantId+"'",/grant_not_current/))
 await provenanceCheck(()=>provenanceHeld("UPDATE tenant_actor_roles SET valid_to=now()",/current_captured_role_unavailable/))
 await provenanceCheck(()=>provenanceHeld("UPDATE gridex_ediel_inbound_context.fixture SET basis=jsonb_set(basis,'{applicationReference}','\"23-DDQ-E66-T\"') WHERE message_id='"+uid(210)+"'",/source_provenance_unavailable/))
 await provenanceCheck(()=>provenanceHeld("UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('f',64)",/native_origin_unavailable/))
 await provenanceCheck(async()=>{await assert.rejects(db.exec('UPDATE gridex_ediel_services.projection_receipts SET proof=proof'),/receipt_immutable/);await assert.rejects(db.exec('DELETE FROM gridex_ediel_services.projection_receipts'),/receipt_immutable/);await assert.rejects(db.exec('TRUNCATE gridex_ediel_services.projection_receipts'),/receipt_immutable/);assert.equal(await receiptCount(),2)})
 await provenanceCheck(async()=>{const acl=(await db.query("SELECT has_table_privilege('service_role','gridex_ediel_services.projection_receipts','SELECT') r,has_table_privilege('service_role','gridex_ediel_services.projection_receipts','INSERT') w,has_function_privilege('authenticated','public.ediel_beneficiary_series_page_v1(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid)','EXECUTE') execute")).rows[0];assert.deepEqual(acl,{r:false,w:false,execute:false})})

 let replayChecks=0
 const replayCheck=async fn=>{await fn();replayChecks++}
 const replayStable=await effects()
 await db.exec("CREATE FUNCTION gridex_ediel_services.projection_insert_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'projection_insert_attempt'; END $$;CREATE TRIGGER projection_insert_tripwire BEFORE INSERT ON gridex_ediel_services.projection_receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_services.projection_insert_tripwire()")
 try {
  await replayCheck(async()=>{assert.deepEqual(await pages(),quantityPage);assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await assert.rejects(pages(uid(2),grant.grantId,'unrelated'),/outside_grant/);await assert.rejects(pages(uid(2),grant.grantId,'analysis',['quality']),/outside_grant/);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await db.exec('BEGIN');try{await db.exec("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'");await assert.rejects(pages(),/beneficiary_forbidden/)}finally{await db.exec('ROLLBACK')}assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
  await replayCheck(async()=>{await assert.rejects(db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8,99)',[uid(2),uid(20),grant.grantId,'analysis',uid(211),['quantity'],'2026-01-01','2026-02-01']),/projection_insert_attempt/);assert.equal(await receiptCount(),2);assert.deepEqual(await effects(),replayStable)})
 } finally {await db.exec('DROP TRIGGER projection_insert_tripwire ON gridex_ediel_services.projection_receipts;DROP FUNCTION gridex_ediel_services.projection_insert_tripwire()')}

 const currentGrantResults=[]
 const currentGrantSnapshot=async()=>{
  const tables=(await db.query("SELECT schemaname,tablename FROM pg_catalog.pg_tables WHERE schemaname='public' OR schemaname LIKE 'gridex_%' ORDER BY schemaname,tablename")).rows
  const rows={}
  for(const table of tables){
   const identifier=value=>'"'+value.replaceAll('"','""')+'"'
   rows[table.schemaname+'.'+table.tablename]=(await db.query('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) state FROM '+identifier(table.schemaname)+'.'+identifier(table.tablename)+' t')).rows[0].state
  }
  return rows
 }
 const currentGrantCheck=async(name,fn)=>{await fn();currentGrantResults.push(name)}
 const currentGrantPage=async()=>{
  const version=(await db.query('SELECT version FROM ediel_data_access_grants WHERE id=$1',[grant.grantId])).rows[0].version
  return db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(2),uid(20),grant.grantId,version,'analysis',uid(211),['quantity'],'2026-01-01','2026-02-01'])
 }
 const currentGrantRefusal=async(fn,pattern)=>{
  await db.exec('SAVEPOINT current_grant_refusal')
  try{await assert.rejects(fn,pattern)}finally{await db.exec('ROLLBACK TO SAVEPOINT current_grant_refusal;RELEASE SAVEPOINT current_grant_refusal')}
 }
 const currentGrantHeld=async(change,pattern,read=()=>pages())=>{
  await db.exec('BEGIN')
  try {
   await db.exec(change)
   const before=await currentGrantSnapshot()
   await currentGrantRefusal(read,pattern)
   assert.deepEqual(await currentGrantSnapshot(),before,'refused read must preserve every finite-fixture row')
  }finally{await db.exec('ROLLBACK')}
  assert.deepEqual(await pages(),quantityPage,'rollback must retain the same positive receipt')
 }
 await currentGrantCheck('positive-current-read-and-retained-receipt',async()=>{
  assert.deepEqual(await pages(),quantityPage)
  assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage)
  assert.equal(await receiptCount(),2)
 })
 await currentGrantCheck('stale-version-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_data_access_grants SET valid_from='2001-01-01' WHERE id='"+grant.grantId+"'",/ediel_grant_not_current/))
 await currentGrantCheck('expired-grant-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_data_access_grants SET valid_to='2002-01-01' WHERE id='"+grant.grantId+"'",/ediel_grant_not_current/,currentGrantPage))
 await currentGrantCheck('revoked-beneficiary-membership-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE company_memberships SET is_active=false WHERE company_id='"+uid(2)+"'",/ediel_beneficiary_forbidden/))
 await currentGrantCheck('revoked-upstream-evidence-denied-with-zero-row-effects',()=>currentGrantHeld("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id='"+aid+"' AND kind='dso_contract'",/ediel_assignment_not_authorized/))
 // Use the existing command owner, rather than substituting a fabricated
 // successful revocation result or permanently UPDATEing the grant ourselves.
 const revokeInput={action:'revoke_grant',commandId:uid(701),assignmentId:aid,
  expectedVersion:(await db.query('SELECT version FROM ediel_service_assignments WHERE id=$1',[aid])).rows[0].version,
  grantId:grant.grantId,expectedGrantVersion:quantityPage.grantVersion}
 await db.exec('BEGIN')
 try {
  const beforeRevocation=await currentGrantSnapshot()
  const revoked=await command(revokeInput)
  await currentGrantCheck('actual-revoke-command-advances-own-version',async()=>{
   assert.equal(revoked.status,'revoked');assert.equal(revoked.accessGranted,false)
   assert.equal(revoked.grantId,quantityPage.grantId)
   assert.ok(Number(revoked.grantVersion)>quantityPage.grantVersion)
   const own=(await db.query('SELECT status,version,revoked_at FROM ediel_data_access_grants WHERE id=$1',[grant.grantId])).rows[0]
   assert.equal(own.status,'revoked');assert.equal(Number(own.version),Number(revoked.grantVersion));assert.ok(own.revoked_at)
   const after=await currentGrantSnapshot()
   for(const table of Object.keys(beforeRevocation)){
    if(!['public.ediel_data_access_grants','public.ediel_service_history','gridex_service_administration.commands'].includes(table))assert.deepEqual(after[table],beforeRevocation[table],table+' must remain unchanged on own revocation')
   }
   const beforeGrants=beforeRevocation['public.ediel_data_access_grants'],afterGrants=after['public.ediel_data_access_grants']
   assert.equal(afterGrants.length,beforeGrants.length)
   assert.deepEqual(afterGrants.filter(row=>row.id!==grant.grantId),beforeGrants.filter(row=>row.id!==grant.grantId))
   const oldGrant=beforeGrants.find(row=>row.id===grant.grantId),newGrant=afterGrants.find(row=>row.id===grant.grantId)
   assert.equal(Number(newGrant.version),Number(oldGrant.version)+1)
   assert.equal(newGrant.updated_at,newGrant.revoked_at,'revocation and scope update share the command transaction time')
   assert.deepEqual({...newGrant,status:oldGrant.status,revoked_at:oldGrant.revoked_at,version:oldGrant.version,updated_at:oldGrant.updated_at},oldGrant)
   const history=after['public.ediel_service_history'],oldHistory=beforeRevocation['public.ediel_service_history']
   assert.deepEqual(history.filter(row=>oldHistory.some(old=>old.id===row.id)),oldHistory)
   const appendedHistory=history.filter(row=>!oldHistory.some(old=>old.id===row.id))
   assert.equal(appendedHistory.length,1,'one exact own grant transition must be audited')
   assert.equal(appendedHistory[0].entity_table,'ediel_data_access_grants')
   assert.equal(appendedHistory[0].entity_id,grant.grantId);assert.equal(appendedHistory[0].company_id,uid(1))
   assert.deepEqual(appendedHistory[0].before_record,oldGrant);assert.deepEqual(appendedHistory[0].after_record,newGrant)
   assert.ok(appendedHistory[0].recorded_at)
   const commands=after['gridex_service_administration.commands'],oldCommands=beforeRevocation['gridex_service_administration.commands']
   assert.deepEqual(commands.filter(row=>row.command_id!==revokeInput.commandId),oldCommands)
   const appendedCommands=commands.filter(row=>row.command_id===revokeInput.commandId)
   assert.equal(appendedCommands.length,1);assert.equal(appendedCommands[0].company_id,uid(1));assert.equal(appendedCommands[0].actor_user_id,uid(20))
   assert.deepEqual(appendedCommands[0].input,revokeInput);assert.deepEqual(appendedCommands[0].result,revoked)
  })
  const revokedState=await currentGrantSnapshot()
  await currentGrantCheck('cached-previous-page-cannot-authorize-a-new-read',async()=>{
   assert.deepEqual(quantityPage.rows,[{quantity:'17.250'}])
   await currentGrantRefusal(()=>pages(),/ediel_grant_not_current/)
   await currentGrantRefusal(()=>pages(),/ediel_grant_not_current/)
   await currentGrantRefusal(currentGrantPage,/ediel_grant_not_current/)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
  await currentGrantCheck('revoke-replay-preserves-exact-result-and-all-rows',async()=>{
   assert.deepEqual(await command(revokeInput),revoked)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
  await currentGrantCheck('independent-beneficiary-retains-own-quality-only-read',async()=>{
   assert.deepEqual(await pages(uid(3),grant2.grantId,'quality-monitoring',['quality']),qualityPage)
   await currentGrantRefusal(()=>pages(uid(3),grant.grantId,'analysis',['quantity']),/no rows|query returned no rows/)
   assert.deepEqual(await currentGrantSnapshot(),revokedState)
  })
 }finally{await db.exec('ROLLBACK')}
 assert.deepEqual(await pages(),quantityPage)
 console.log('SC010_SC071_CURRENT_GRANT_RESULT '+JSON.stringify({checks:currentGrantResults,
  boundary:'existing SQL owners with finite actor/source/issuer/storage fixtures',
  leasedExportWorker:'NOT_EXERCISED',nativeConcurrency:'NOT_EXERCISED',wholeScenarios:'NOT_APPROVED'}))
 console.log('Projection replay SQL: '+replayChecks+' PASS plus same OID/ACL; real forward owner, bounded synthetic dependencies, NOT native races/legal approval')
 console.log('Projection provenance SQL: '+provenanceChecks+' PASS; actual receipt consumer with finite synthetic source/review/storage dependencies, NOT native/legal approval')
 // Restore only the public filtered body and finite dependency context for the
 // unchanged historic administration regression below. No migration bytes or
 // private immutable receipts are modified.
 const oldAdmin=readFileSync(new URL('../supabase/migrations/20260930184042_ediel_service_administration_commands_v1.sql',import.meta.url),'utf8')
 const functionStart=oldAdmin.indexOf('CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1'),functionEnd=oldAdmin.indexOf('\nCREATE FUNCTION public.ediel_service_administration_command_v1',functionStart)
 await db.exec(oldAdmin.slice(functionStart,functionEnd))
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(540)])
 // Existing administration checks below retain their original source fixture.
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(basis))
`
const urlImport="import{pathToFileURL}from'node:url'"
assert.equal(base.split(urlImport).length,2)
const generated=base.replace(urlImport,"import{pathToFileURL,fileURLToPath}from'node:url'").replace(marker,()=>extension+marker).replace('  // SC-011 REUSED SOURCE INPUT HELPERS',()=>"function fn(file,name){const sql=readFileSync(new URL(file,import.meta.url),'utf8'),a=sql.indexOf(`CREATE FUNCTION ${name}`),b=sql.indexOf('$$;',a);if(a<0||b<0)throw Error(name);return sql.slice(a,b+3)}\nconst raw=(code,objects,sender='54321',receiver='21660')=>[\"UNB+UNOC:3+54321:14+21660:14+261001:1200+I++23-DGI-PRODAT\",\"UNH+M+PRODAT:D:97A:UN:E2SE6A\",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[own.point===null&&own.agency===null?`LIN+${i+1}`:`LIN+${i+1}++${own.point??''}:::${own.agency??'9'}`,`RFF+LI:${own.li??'LI-A'}`,'RFF+Z05:TES',...(own.permission?[`RFF+Z09:${own.permission}`]:[]),...(own.omitCustomer?[]:[`NAD+UD+${own.customer??'PERSON-A'}:SE1:260`]),'CCI++Z13',`CAV+${own.reason??'S17'}`,...(own.status?['CCI++Z23',`CAV+${own.status}`]:[]),...(own.start?[`DTM+90:${own.start}:203`]:[]),...(own.end?[`DTM+91:${own.end}:203`]:[]),...(own.permissionEnd?[`DTM+164:${own.permissionEnd}:203`]:[]),...(own.endReason?['CCI++Z25',`CAV+${own.endReason}`]:[]),'CCI++Z14','CAV+::::8716867000030']),\"UNT\",\"UNZ+1+I\"].map((segment,index,segments)=>index===segments.length-2?`UNT+${segments.length-2}+M`:segment).join(\"'\")+\"'\"\nconst service=async(sql,params=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,params)}finally{try{await db.exec('RESET ROLE')}catch{ /* preserve actual transaction error */ }}}\nconst apply=(source=id(30),expected=null,actor=id(20),company=id(1))=>service('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) b',[company,source,actor,expected]).then(r=>r.rows[0].b)\nconst current=(permission=id(10),source=id(30))=>service('SELECT public.ediel_permission_source_is_current_v1($1,$2,$3) b',[id(1),permission,source]).then(r=>r.rows[0].b)\nconst fixtures=[]\nasync function incoming(n,code,objects,decisions=objects.map(()=> 'accepted'),functional='accepted',application=null){\n const wire=application===null?raw(code,objects):raw(code,objects).replace('23-DGI-PRODAT',application);await db.query(\"INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id) VALUES($1,$2,'test','inbound','PRODAT',$3,$4,'received',$5)\",[id(n),id(1),code,wire,id(10)])\n const tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) b',[wire])).rows[0].b\n const lines=tokens.filter(x=>x.tag==='LIN').map(x=>x.index)\n const scopes=objects.map((o,i)=>({messageIndex:0,messageReference:'M',objectId:o.point??null,identityAgency:o.agency===null?null:o.agency??'9',registers:[{lineIndex:i,lineNumber:String(i+1),registerIndex:null,registerPosition:0,segmentIndex:lines[i]}]}))\n const facet={assessmentId:id(n+1000),headerDecision:'accepted',objects:scopes.map((scope,i)=>({...scope,applicationDecision:decisions[i],reasonCodes:decisions[i]==='accepted'?[]:['MODELED_APP_REJECTION']}))}\n await db.query(\"INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)\",[id(n+1000),id(n),id(1),wire,JSON.stringify({syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted'})])\n const sourceHash=(await db.query(\"SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h\",[wire])).rows[0].h\n const applicationFacts={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',sourcePayloadHash:sourceHash,headerDecision:'accepted',objects:facet.objects}\n const originalFacts={syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted',rulePackEvidence:{declared:'external-original-owner-fixture'},registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map((scope,i)=>({...scope,disposition:decisions[i]==='rejected'?'rejected':'accepted',reasons:decisions[i]==='rejected'?['MODELED_APP_REJECTION']:[]}))}}\n await db.query(\"UPDATE gridex_received_sources.validation_assessments SET facts_text=$1,facts_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2\",[JSON.stringify(originalFacts),id(n+1000)])\n await db.query(\"INSERT INTO gridex_received_sources.prodat_application_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))\",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify(applicationFacts)])\n await db.query(\"INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))\",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify({responses:scopes.map((scope,i)=>({scope:'object',lineIndex:scope.registers[0].segmentIndex,ercCode:decisions[i]==='accepted'?'100':'MODELED_BAD'}))})])\n await db.query('INSERT INTO application_fixture VALUES($1,$2)',[id(n),facet]);await db.query('INSERT INTO legal_fixture VALUES($1,$2)',[id(n),{actorRole:'energy_service_company',legalEdielId:'21660',environment:'test',family:'PRODAT',code}]);fixtures.push(n);return{wire,scopes,facet}\n}\nasync function permission(n,objects,application=null){\n const original=raw('Z13',objects,'21660','54321'),wire=application===null?original:original.replace('23-DGI-PRODAT',application);await db.query(\"INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,'acknowledged',now(),now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4)\",[id(n+5000),id(1),wire,id(10)])\n await db.query(\"INSERT INTO accepted_source_fixture VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))\",[id(n+5000),wire])\n await db.query(\"INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'z13_sent',$4,$4,$5,'54321',0,'{}')\",[id(n),id(1),id(10),id(n+5000),objects[0].li??'LI-A'])\n}").replace('  // SC-011 REUSED DECLARED SOURCE PORTS',()=>"await db.exec(\" CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_receipt';END$$;\\n CREATE FUNCTION gridex_received_sources.sent_source_is_current_v1(m public.ediel_messages) RETURNS bool LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.accepted_source_fixture a WHERE a.source=m.id AND a.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))$$;\\n CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE b jsonb;BEGIN SELECT f.facet INTO b FROM public.application_fixture f JOIN public.ediel_messages m ON m.id=f.source AND m.company_id=c JOIN gridex_received_sources.validation_assessments v ON v.id=(f.facet->>'assessmentId')::uuid AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') WHERE f.source=s;IF b IS NULL THEN RAISE EXCEPTION 'declared_application_port_unavailable';END IF;RETURN b;END$$;\\n CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(c uuid,s uuid,a uuid,o jsonb) RETURNS bool LANGUAGE sql AS $$SELECT EXISTS(SELECT FROM public.application_fixture f JOIN public.ediel_messages m ON m.id=f.source AND m.company_id=c JOIN gridex_received_sources.validation_assessments v ON v.id=a AND v.source_message_id=s AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') CROSS JOIN LATERAL jsonb_array_elements(f.facet->'objects')x WHERE f.source=s AND x-'applicationDecision'-'reasonCodes'=o AND x->>'applicationDecision'='accepted')$$;\\n CREATE FUNCTION public.ediel_apply_permission_source_v1(c uuid,s uuid,a uuid,p uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE tr gridex_received_sources.permission_transitions%rowtype;m public.ediel_messages%rowtype;BEGIN SELECT * INTO tr FROM gridex_received_sources.permission_transitions WHERE source_message_id=s;SELECT * INTO m FROM public.ediel_messages WHERE id=s AND company_id=c;IF tr.source_message_id IS NULL OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR(p IS NOT NULL AND p IS DISTINCT FROM tr.permission_id) THEN RAISE EXCEPTION 'declared_legacy_replay_conflict';END IF;RETURN jsonb_build_object('applied',true,'permissionId',tr.permission_id,'idempotent',true);END$$;\\n CREATE FUNCTION public.ediel_advance_permission_deadlines_v1(uuid,uuid DEFAULT NULL,integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT '{\\\"updated\\\":0}'::jsonb$$;\")"),temp=fileURLToPath(new URL('./.ediel-sc010-sc071-current-grant-consumer.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
