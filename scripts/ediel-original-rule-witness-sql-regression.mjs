// Execute actual forward SQL on a synthetic existing-schema boundary. This is
// scoped integrity/atomicity evidence, not native replay or authentic fixtures.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE public.ediel_rule_packs(id uuid PRIMARY KEY,market text,family text,guide_version text,guide_revision text,unh_association_code text,valid_from date,valid_to date,source_document text,source_hash text,field_matrix_version text,status text);
 CREATE TABLE public.ediel_message_profiles(id uuid PRIMARY KEY,rule_pack_id uuid,message_code text,transaction_subtype text,direction text,business_process text,phase text,profile_key text,profile jsonb,is_enabled boolean);
 CREATE TABLE public.ediel_runtime_capabilities(rule_pack_id uuid,message_code text,transaction_subtype text,direction text,parser_ready boolean,builder_ready boolean,validator_ready boolean,ack_ready boolean,state_machine_ready boolean);
 CREATE TABLE public.ediel_rule_pack_sources(id uuid PRIMARY KEY,rule_pack_id uuid,title text,source_hash text);
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,message_family text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_hash text,received_context jsonb);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,facts_text text,facts_hash text);
 CREATE TABLE public.synthetic_original_ack(company_id uuid,source_message_id uuid,evidence jsonb);
 CREATE FUNCTION public.gridex_read_inbound_ack_source_v1(company uuid,environment text,msg uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('sourceRulePackEvidence',evidence) FROM public.synthetic_original_ack WHERE company_id=company AND source_message_id=msg$$;
 INSERT INTO public.ediel_rule_packs VALUES('${uid(1)}','electricity','UTILTS','25-A-3','3','E5SE5A','2025-06-01','2026-09-30','actual named synthetic source','${'a'.repeat(64)}','v3','transition'),('${uid(2)}','electricity','UTILTS','25-A-4','4','E5SE5A','2026-10-01',NULL,'new named synthetic source','${'b'.repeat(64)}','v4','active');
 INSERT INTO public.ediel_message_profiles SELECT '${uid(10)}',id,'S02','','inbound','metering',NULL,'UTILTS:S02:E5SE5A:3','{}',true FROM public.ediel_rule_packs WHERE id='${uid(1)}';
 INSERT INTO public.ediel_message_profiles SELECT '${uid(11)}',id,'S02','','inbound','metering',NULL,'UTILTS:S02:E5SE5A:4','{}',true FROM public.ediel_rule_packs WHERE id='${uid(2)}';
 INSERT INTO public.ediel_runtime_capabilities SELECT id,'S02','','inbound',true,true,true,true,true FROM public.ediel_rule_packs;
 INSERT INTO public.ediel_rule_pack_sources VALUES('${uid(20)}','${uid(1)}','frozen-source-row','${'c'.repeat(64)}');
 INSERT INTO public.ediel_messages VALUES('${uid(30)}','${uid(100)}','test','UTILTS'),('${uid(31)}','${uid(100)}','test','APERAK');
 INSERT INTO gridex_received_sources.sources SELECT id,company_id,environment,encode(sha256(convert_to('exact raw','UTF8')),'hex'),'{}' FROM public.ediel_messages;`)
 const original=readFileSync(new URL('../supabase/migrations/20260713100000_ediel_completion_and_platform_contract.sql',import.meta.url),'utf8');await db.exec(original.slice(original.indexOf('create or replace function public.resolve_canonical_ediel_rule_pack('),original.indexOf('with prodat_pack as (',original.indexOf('create or replace function public.resolve_canonical_ediel_rule_pack('))))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930193136_ediel_locked_original_rule_pack_witness.sql',import.meta.url),'utf8'));checks++
 const resolve=async(date='2026-09-30')=>(await db.query("select * from public.resolve_canonical_ediel_rule_pack_with_witness_v1('electricity','UTILTS','S02','','inbound',$1)",[date])).rows[0].resolve_canonical_ediel_rule_pack_with_witness_v1
 const prior=await resolve();assert.equal(prior.original_version,'25-A-3:r3');assert.equal(prior.rule_pack_id,uid(1));assert.equal(prior.original_snapshot.guideSources[0].title,'frozen-source-row');checks++
 const current=await resolve('2026-10-01');assert.equal(current.rule_pack_id,uid(2));assert.equal(current.original_version,'25-A-4:r4');checks++
 const pack={profileKey:prior.profile_key,messageProfileId:prior.message_profile_id,rulePackId:prior.rule_pack_id,sourceHash:prior.source_hash,version:prior.original_version,snapshot:prior.original_snapshot}
 const facts={version:1,owner:'canonical-runtime-with-registry-v1',sourceDisposition:'not_established',objectDisposition:'not_checked',partyDisposition:'not_checked',coverage:'canonical_runtime_only',originalTenantMatch:'matched',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',messageReference:'DOC',reasonCodes:[],rulePackEvidence:pack}
 const append=async(value=facts,id=30)=>(await db.query('select gridex_received_sources.append_validation($1,\'test\',$2,$3,$4) result',[uid(100),uid(id),'0'.repeat(64),JSON.stringify(value)]))
 const validAppend=async(value=facts,id=30)=>(await db.query('select gridex_received_sources.append_validation($1,\'test\',$2,encode(sha256(convert_to(\'exact raw\',\'UTF8\')),\'hex\'),$3) result',[uid(100),uid(id),JSON.stringify(value)])).rows[0].result
 await assert.rejects(append(),/received_validation_source_unavailable/);checks++
 const first=await validAppend();assert.ok(first.assessmentId);checks++
 for(const change of [p=>delete p.version,p=>delete p.snapshot,p=>p.version='25-A-3:r999',p=>p.snapshot.rulePack.source_document='forged',p=>p.snapshot.messageProfile.profile_key='foreign',p=>p.snapshot.guideSources=[],p=>p.extra='true']){
  const altered=structuredClone(facts);change(altered.rulePackEvidence);await assert.rejects(validAppend(altered),/received_validation_rule_evidence_unavailable/);checks++
 }
 await db.exec(`UPDATE public.ediel_rule_packs SET guide_revision='999' WHERE id='${uid(1)}'`);await assert.rejects(validAppend(),/received_validation_rule_evidence_unavailable/);checks++
 // Actual protected original lookup preserves old owner witness despite later
 // named metadata changes. This stub models only the original read contract.
 await db.query('insert into public.synthetic_original_ack values($1,$2,$3)',[uid(100),uid(31),JSON.stringify(pack)])
 const ack=await validAppend(facts,31);assert.ok(ack.assessmentId);checks++
 const malformed=structuredClone(facts);malformed.rulePackEvidence.version='25-A-3:r999';await assert.rejects(validAppend(malformed,31),/received_validation_rule_evidence_unavailable/);checks++
 assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n,2);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date)','execute') authenticated,has_function_privilege('service_role','public.resolve_canonical_ediel_rule_pack_with_witness_v1(text,text,text,text,text,date)','execute') service")).rows[0];assert.deepEqual(acl,{authenticated:false,service:true});checks++
 console.log(`Actual locked original rule witness/immutable append/inherited ACK/ACL checks: ${checks} PASS`)
}catch(error){console.error(error);process.exitCode=1}finally{await db.close()}
