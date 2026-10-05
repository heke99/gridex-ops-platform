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

 let tenChecks=0
 const tenCheck=async fn=>{await fn();tenChecks++}
 let inTx=false
 const readOnly=async fn=>{if(!inTx)return fn();await db.exec('SAVEPOINT ten_read');try{await fn()}finally{await db.exec('ROLLBACK TO SAVEPOINT ten_read')}}
 const grantVersion=async id=>Number((await db.query('SELECT version FROM ediel_data_access_grants WHERE id=$1',[id])).rows[0].version)
 const tenPage=(beneficiary,grantId,version,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[beneficiary,uid(20),grantId,version,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 // A third active tenant shares the platform and the GSRN but holds no grant.
 await db.exec("INSERT INTO companies VALUES('"+uid(4)+"','active');INSERT INTO company_memberships VALUES('"+uid(4)+"','"+uid(20)+"','active',true,now())")
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-03',18.500,'KWH','56','220')",[uid(640),uid(1),uid(211)])
 const ackHash=raw=>db.query("SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE ack_raw_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[raw])

 // TEN-08: one market reception/ACK, then one internal scope per valid grant.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.equal(rows.length,1,'one market ACK receipt')
  const scopes=rows[0].projection.transactions[0].scopes
  assert.deepEqual(scopes.map(s=>s.grant.id).sort(),[grant.grantId,grant2.grantId].sort())
  assert.deepEqual(scopes.map(s=>[s.assignment.beneficiary_company_id,s.assignment.purpose]).sort(),[[uid(2),'analysis'],[uid(3),'quality-monitoring']].sort())})
 // Prohibited: no copy to a tenant only because it shares the GSRN/platform.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.ok(!JSON.stringify(rows).includes(uid(4)))
  for(const g of [grant.grantId,grant2.grantId])await readOnly(()=>assert.rejects(tenPage(uid(4),g,2,'analysis',['quantity']),/beneficiary_forbidden|no rows/))})
 // Each grant distributes only its own purpose and fields.
 await tenCheck(async()=>{assert.deepEqual((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.map(r=>r.quantity).sort(),['17.250','18.500'])
  assert.deepEqual((await tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality'])).rows[0].p.rows,[{quality:'56'},{quality:'56'}])
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'quality-monitoring',['quantity']),/./))})

 // Time interval is part of the grant scope: a period outside the grant is refused.
 await tenCheck(()=>readOnly(()=>assert.rejects(db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[uid(2),uid(20),grant.grantId,2,'analysis',uid(211),['quantity'],'2025-01-01','2025-02-01']),/outside_grant|series_outside_grant/)))

 // TEN-10: internal revocation is its own event, checked against the current grant version.
 await db.exec('BEGIN');inTx=true
 try {
  const historyBefore=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
  await db.query("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant2.grantId])
  const revokedVersion=await grantVersion(grant2.grantId)
  await tenCheck(async()=>{assert.equal(revokedVersion,3)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality']),/grant_not_current/))})
  // Other beneficiaries on the same market permission keep their access.
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2)})
  // History/audit is retained, not deleted.
  await tenCheck(async()=>{const after=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
   assert.ok(after>historyBefore);assert.equal((await db.query('SELECT count(*)::int n FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0].n,1)})
  // Market end (Z15) followed by market restoration (Z15C) never touches the internal grant.
  await db.exec("UPDATE metering_permission_sites SET end_at='2026-01-15'")
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'analysis',['quantity']),/./))
  await db.exec("UPDATE metering_permission_sites SET end_at='2027-01-01',status='approved'")
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2,'restored market permission serves the unrevoked grant')
   const g=(await db.query('SELECT status,revoked_at FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0];assert.equal(g.status,'revoked');assert.ok(g.revoked_at)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))})
  // Prohibited: a revoked grant cannot be switched back on; access needs a new basis.
  await tenCheck(()=>readOnly(()=>assert.rejects(db.query("UPDATE ediel_data_access_grants SET status='active',revoked_at=NULL WHERE id=$1",[grant2.grantId]),/revoked_grant_requires_new_basis/)))
 } finally { await db.exec('ROLLBACK');inTx=false }
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(640)])
 console.log('TEN-08/TEN-10 grant SQL: '+tenChecks+' PASS; finite synthetic fixtures, NOT native/legal approval proof')
 console.log('Grant-set forward SQL: '+grantSetChecks+' PASS; finite synthetic source/accepted/review fixtures, NOT native/legal approval proof')
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
const generated=base.replace(urlImport,"import{pathToFileURL,fileURLToPath}from'node:url'").replace(marker,()=>extension+marker),temp=fileURLToPath(new URL('./.ediel-ten-08-10-consumer.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
