// Bounded embedded PostgreSQL composition only. This executes the genuine
// historical derivation and new namespace bridges; inherited business schemas
// and source IO are finite declarations. No authentic native/RLS/market claim.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const inherited=process.env.EDIEL_SHARED_MIGRATIONS_ROOT
if(!inherited)throw Error('EDIEL_SHARED_MIGRATIONS_ROOT required')
const read=(name,own=false)=>readFileSync(own?new URL('../supabase/migrations/'+name,import.meta.url):inherited+'/'+name,'utf8')
function fn(name,file){const source=read(file),match=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\(').exec(source);if(!match)throw Error('Actual function missing '+name);const end=source.indexOf('$$;',match.index);if(end<0)throw Error('Actual terminator missing '+name);return source.slice(match.index,end+3)}
const names=['require_before_mixed_object_results_v1','require_before_prodat_scope_v1','require_v1'],signature=name=>'gridex_ediel_ack_guide.'+name+'(public.ediel_messages)'
const metadata=async name=>(await db.query('SELECT oid::text,proowner::text,proacl::text,proconfig,prosecdef,prosrc FROM pg_proc WHERE oid=$1::regprocedure',[signature(name)])).rows[0]
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_outbound_owner;CREATE SCHEMA gridex_ediel_common_header;CREATE SCHEMA gridex_ediel_source_rules;CREATE SCHEMA gridex_ediel_technical_ack;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,raw_payload text,related_message_id uuid,execution_context_snapshot jsonb DEFAULT '{}');
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_hash text,raw_payload text);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,facts_hash text,previous_assessment_id uuid,owner text);
 CREATE TABLE gridex_received_sources.prodat_object_validation_facets(assessment_id uuid,source_payload_hash text,facts_hash text);
 CREATE TABLE gridex_received_sources.prodat_mixed_object_receipts(source_message_id uuid,company_id uuid,environment text,source_payload_hash text,assessment_id uuid,object_facts_hash text,processed_objects jsonb);
 CREATE TABLE gridex_received_sources.prodat_mixed_reply_outbox(source_message_id uuid,company_id uuid,environment text,source_payload_hash text,object_facts_hash text);
 CREATE TABLE gridex_received_sources.normal_switch_confirmations(company_id uuid,source_message_id uuid,source_object jsonb);
 CREATE TABLE gridex_ediel_ack_guide.source_bindings(source_message_id uuid,kind text,company_id uuid,environment text,payload_sha256 text,source_version text,original_basis jsonb);
 CREATE TABLE gridex_ediel_outbound_owner.witnesses(id uuid PRIMARY KEY,company_id uuid,environment text,family text,related_message_id uuid,payload_sha256 text);
 CREATE TABLE gridex_ediel_outbound_owner.consumptions(witness_id uuid,source_message_id uuid,company_id uuid,environment text,payload_sha256 text);
 CREATE TABLE gridex_ediel_common_header.negative_witnesses(id uuid,source_message_id uuid,company_id uuid,environment text,payload_sha256 text);
 CREATE TABLE gridex_ediel_common_header.negative_consumptions(witness_id uuid,ack_message_id uuid,company_id uuid,environment text,payload_sha256 text);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;
 CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'finite_owner_unavailable';END$$;
 CREATE FUNCTION gridex_ediel_outbound_owner.assert_message_before_native_ack_guide_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses) RETURNS void LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'finite_owner_unavailable';END$$;`)
 for(const [name,file]of [['gridex_utilts_binding.wire_tokens_v1','20260923135706_ediel_utilts_consumption_binding_v1.sql'],['gridex_ack_authority.wire_v1','20260930202616_ediel_native_aperak_own_erc_scope.sql'],['gridex_ack_authority.source_match_v1','20260930203615_ediel_ack_first14_and_committed_replay.sql']])await db.exec(fn(name,file))
 const guide='20260930204944_ediel_source_generated_native_ack_guide_constraints.sql'
 for(const name of ['gridex_ediel_ack_guide.tail_populated_v1','gridex_ediel_ack_guide.date_time_v1'])await db.exec(fn(name,guide))
 await db.exec(fn('gridex_ediel_ack_guide.validate_v1',guide).replace('gridex_ediel_ack_guide.validate_v1(','gridex_ediel_ack_guide.validate_before_registered_responses_v1('))
 await db.exec(fn('gridex_ediel_ack_guide.validate_v1','20260930222834_ediel_registered_original_native_response_guides.sql'))
 await db.exec(fn('gridex_ediel_ack_guide.require_v1','20260930222834_ediel_registered_original_native_response_guides.sql'))
 const mixed=read('20260930224726_ediel_prodat_mixed_own_object_processing.sql'),start=mixed.indexOf('ALTER FUNCTION gridex_ediel_ack_guide.require_v1'),end=mixed.indexOf('-- Private durable reply intents',start)
 assert.ok(start>0&&end>start);await db.exec(mixed.slice(start,end))
 await db.exec(read('20260930231746_ediel_native_prodat_ack_immutable_scope.sql'))
 await db.exec(read('20260930234111_ediel_prodat_canonical_response_facets.sql'))
 const historical=read('20260930235457_ediel_native_prodat_planned_response_authority.sql'),wire=historical.slice(historical.indexOf('DO $wire$'),historical.indexOf('END $wire$;')+'END $wire$;'.length)
 await assert.rejects(db.exec(wire),/prodat_response_native_consumer_upgrade_mismatch/);checks++
 const before=await Promise.all(names.map(metadata))
 await db.exec(read('20260930235456_ediel_prodat_planned_response_mixed_predecessor_bridge.sql',true));checks++
 assert.equal((await metadata('require_before_prodat_scope_v1')).oid,before[0].oid);checks++
 assert.equal((await metadata('require_before_prodat_scope_mixed_owner_v1')).oid,before[1].oid);checks++
 // The entry remains mixed-wrapper -> actual guide -> original scope before
 // executing the untouched historical migration, never an always-ready bypass.
 assert.match((await metadata('require_v1')).prosrc,/require_before_prodat_scope_mixed_owner_v1\(m\);PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1\(m\)/);checks++
 await db.exec(historical);checks++
 await db.exec(read('20260930235458_ediel_prodat_planned_response_mixed_consumer_restore.sql',true));checks++
 const after=await Promise.all(names.map(metadata))
 for(let index=0;index<names.length;index++){
  const {prosrc:oldBody,...oldMetadata}=before[index],{prosrc:newBody,...newMetadata}=after[index]
  assert.deepEqual(newMetadata,oldMetadata);checks++
  assert.equal(newBody,index===0?oldBody.replace('gridex_ediel_ack_guide.validate_v1(m.raw_payload,source.raw_payload,projection)','gridex_ediel_ack_guide.validate_response_for_message_v1(m,source,projection)'):oldBody);checks++
 }
 assert.equal((await db.query("SELECT to_regprocedure('gridex_ediel_ack_guide.require_before_prodat_scope_mixed_owner_v1(public.ediel_messages)') IS NULL absent")).rows[0].absent,true);checks++
 assert.match(after[1].prosrc,/prodat_mixed_ack_committed_own_results_required/);assert.match(after[1].prosrc,/prodat_mixed_ack_own_commit_mismatch/);checks++
 assert.match((await db.query("SELECT prosrc FROM pg_proc WHERE oid='gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages)'::regprocedure")).rows[0].prosrc,/prodat_original_outcomes_v1\(m,source\)/);checks++
 for(const name of names){const privileges=(await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',['authenticated',signature(name)])).rows[0];assert.equal(privileges.allowed,false);checks++}
 // Actual composed guide rejection travels through the real restored entry;
 // no source/ACK/reservation can be created from absent immutable authority.
 await assert.rejects(db.query("SELECT gridex_ediel_ack_guide.require_v1(ROW(NULL,NULL,'test','outbound','edifact','APERAK','APERAK','unknown',NULL,'{}')::public.ediel_messages)"),/ediel_native_ack_guide_source_required/);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_ack_guide.outbound_prodat_scopes')).rows[0].n,0);checks++
 // Next genuinely published derivation targets the same original name.
 // Execute its actual guard red first, then its complete unchanged migration
 // between additive bridges and prove the same current chain remains intact.
 const inheritedErr=read('20261001002414_ediel_inherited_err_reason_guides.sql')
 const errGuard=inheritedErr.slice(inheritedErr.indexOf('DO $same_owner$'),inheritedErr.indexOf('END $same_owner$;')+'END $same_owner$;'.length)
 await assert.rejects(db.exec(errGuard),/ediel_err_reason_owner_contract_mismatch/);checks++
 const registered=read('20260930222834_ediel_registered_original_native_response_guides.sql')
 await db.exec(read(guide).match(/CREATE TABLE gridex_ediel_ack_guide\.editions[^\n]+/)[0])
 await db.exec(registered.match(/CREATE TABLE gridex_ediel_ack_guide\.edition_extensions[^\n]+/)[0])
 await db.exec(fn('gridex_ediel_ack_guide.projection_for_original_v1','20260930222834_ediel_registered_original_native_response_guides.sql'))
 const beforeErr=await Promise.all(names.map(metadata))
 await db.exec(read('20261001002413_ediel_inherited_err_mixed_predecessor_bridge.sql',true));checks++
 assert.equal((await metadata('require_before_prodat_scope_v1')).oid,beforeErr[0].oid);checks++
 assert.equal((await metadata('require_before_prodat_scope_err_mixed_owner_v1')).oid,beforeErr[1].oid);checks++
 assert.match((await metadata('require_v1')).prosrc,/require_before_prodat_scope_err_mixed_owner_v1\(m\);PERFORM gridex_ediel_ack_guide.require_prodat_scope_v1\(m\)/);checks++
 await db.exec(inheritedErr);checks++
 await db.exec(read('20261001002415_ediel_inherited_err_mixed_consumer_restore.sql',true));checks++
 const afterErr=await Promise.all(names.map(metadata))
 for(let index=0;index<names.length;index++){
  const {prosrc:oldBody,...oldMetadata}=beforeErr[index],{prosrc:newBody,...newMetadata}=afterErr[index]
  assert.deepEqual(newMetadata,oldMetadata);checks++
  const needle='projection:=gridex_ediel_ack_guide.projection_for_original_v1(b.source_version);'
  assert.equal(newBody,index===0?oldBody.replace(needle,needle+'projection:=gridex_ediel_ack_guide.qualify_err_reason_projection_v1(projection,basis);'):oldBody);checks++
 }
 assert.equal((await db.query("SELECT to_regprocedure('gridex_ediel_ack_guide.require_before_prodat_scope_err_mixed_owner_v1(public.ediel_messages)') IS NULL absent")).rows[0].absent,true);checks++
 const ownProjection=(await db.query("SELECT projection FROM gridex_ediel_ack_guide.editions WHERE projection ? 'utiltsErrReasonGuideScopes'")).rows[0].projection
 for(const [version,revision,e19]of [['25-A-3','3',true],['25-A-4','4',false]]){
  const result=(await db.query("SELECT gridex_ediel_ack_guide.qualify_err_reason_projection_v1($1::jsonb,$2::jsonb) p",[JSON.stringify(ownProjection),JSON.stringify({snapshot:{rulePack:{family:'UTILTS',guide_version:version,guide_revision:revision}}})])).rows[0].p
  assert.equal(result.utiltsErr.allowedReasons.includes('E19'),e19);checks++
 }
 await assert.rejects(db.query("SELECT gridex_ediel_ack_guide.qualify_err_reason_projection_v1($1::jsonb,$2::jsonb)",[JSON.stringify(ownProjection),JSON.stringify({snapshot:{rulePack:{family:'UTILTS',guide_version:'UNKNOWN',guide_revision:'99'}}})]),/ediel_original_err_reason_scope_unavailable/);checks++
 for(const name of names){assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',['authenticated',signature(name)])).rows[0].allowed,false);checks++}
 await assert.rejects(db.query("SELECT gridex_ediel_ack_guide.require_v1(ROW(NULL,NULL,'test','outbound','edifact','APERAK','APERAK','unknown',NULL,'{}')::public.ediel_messages)"),/ediel_native_ack_guide_source_required/);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_ediel_ack_guide.outbound_prodat_scopes')).rows[0].n,0);checks++
 console.log(JSON.stringify({status:'PASS',checks,boundary:'bounded_actual_mixed_immutable_scope_planned_response_inherited_ERR_namespace_composition',nativeReplay:'NOT_RUN',wholeAcceptance:'NOT_CLAIMED'},null,2))
}finally{await db.close()}
