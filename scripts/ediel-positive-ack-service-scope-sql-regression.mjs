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
 // Existing administration checks below retain their original source fixture.
 await db.exec('UPDATE gridex_ediel_inbound_context.fixture SET basis='+json(basis))
`
const urlImport="import{pathToFileURL}from'node:url'"
assert.equal(base.split(urlImport).length,2)
const generated=base.replace(urlImport,"import{pathToFileURL,fileURLToPath}from'node:url'").replace(marker,()=>extension+marker),temp=fileURLToPath(new URL('./.ediel-positive-service-scope.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
