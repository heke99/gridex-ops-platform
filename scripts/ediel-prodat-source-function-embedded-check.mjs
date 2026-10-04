/** Focused mechanical PostgreSQL proof. Canonical V3 admission, original rule
 * basis and physical C decoder are explicitly synthetic ports here. Actual new
 * V5/application validators, committed context/facet coupling, append rollback,
 * latest own read and ACL run together. Not native replay/legal/E effect proof. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
let checks=0
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_customer_life_events;CREATE SCHEMA gridex_ediel_source_rules;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,raw_payload text,payload_hash text);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_payload_hash text,previous_assessment_id uuid,owner text,facts_text text,facts_hash text);
 CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid,response_facts_text text);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'append_only';END$$;
 CREATE FUNCTION gridex_received_sources.append_prodat_validation_v3(c uuid,env text,s uuid,h text,f text,i text,r text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE a uuid;p uuid;BEGIN
 SELECT id INTO p FROM gridex_received_sources.validation_assessments WHERE source_message_id=s AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=id);
 INSERT INTO gridex_received_sources.validation_assessments(company_id,environment,source_message_id,source_payload_hash,previous_assessment_id,owner,facts_text,facts_hash)VALUES(c,env,s,h,p,'canonical-runtime-with-registry-v1',f,encode(sha256(convert_to(f,'UTF8')),'hex')) RETURNING id INTO a;
 INSERT INTO gridex_received_sources.prodat_response_facets VALUES(a,r);RETURN jsonb_build_object('assessmentId',a,'version',3);END$$;
 CREATE TABLE public.synthetic_basis(evidence jsonb);CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT evidence FROM public.synthetic_basis$$;
 CREATE TABLE public.synthetic_physical(raw text,wire jsonb);CREATE FUNCTION gridex_customer_life_events.wire_partition_v1(raw text) RETURNS jsonb LANGUAGE sql AS $$SELECT wire FROM public.synthetic_physical WHERE raw=$1$$;
 CREATE TABLE gridex_customer_life_events.inbound_context_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,environment text NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),payload_hash text NOT NULL,context_facts jsonb NOT NULL,context_facts_hash text NOT NULL CHECK(context_facts_hash=encode(sha256(convert_to(context_facts::text,'UTF8')),'hex')),actor_user_id uuid NOT NULL REFERENCES auth.users(id),recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,source_message_id,payload_hash,context_facts_hash));`)
 const contextSource=readFileSync(new URL('../supabase/migrations/20261001023512_ediel_partial_customer_life_event_source_effects.sql',import.meta.url),'utf8')
 const helper=contextSource.match(/CREATE FUNCTION gridex_customer_life_events\.inbound_context_object_is_qualified_v1[\s\S]*?END\$\$;/)?.[0]
 if(!helper)throw Error('actual C context helper missing');await db.exec(helper)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001010321_ediel_complete_prodat_own_application_facets.sql',import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001025115_ediel_canonical_prodat_source_function_facets.sql',import.meta.url),'utf8'));checks++
 await db.exec('GRANT USAGE ON SCHEMA gridex_received_sources TO service_role')
 const raw="UNB+UNOC:3+12345:14+54321:14+261001:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z06+DOC+9'LIN+1++A:::89+1:1'LIN+2++B:::89+1:1'UNT+5+M'UNZ+1+I'"
 const hash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[raw])).rows[0].h
 const scope=(objectId,index)=>({messageIndex:0,messageReference:'M',objectId,identityAgency:'89',registers:[{lineIndex:index===3?0:1,lineNumber:index===3?'1':'2',registerIndex:'1',registerPosition:1,segmentIndex:index}]})
 const good=scope('A',3),held=scope('B',4),basis={profileKey:'PRODAT:Z06:E:26.A:r3',messageProfileId:id(11),rulePackId:id(12),sourceHash:'a'.repeat(64),version:'26.A:r3',snapshot:{rulePack:{id:id(12)},messageProfile:{id:id(11)},guideSources:[]}}
 await db.query('insert into public.synthetic_basis values($1)',[basis]);await db.query('insert into auth.users values($1)',[id(3)])
 await db.query("insert into ediel_messages values($1,$2,'test','inbound','PRODAT','Z06',$3)",[id(1),id(2),raw])
 await db.query("insert into gridex_received_sources.sources values($1,$2,'test',$3,$4)",[id(1),id(2),raw,hash])
 await db.query('insert into public.synthetic_physical values($1,$2)',[raw,{legalReceiver:'54321',unh:'M'}])
 const context={status:'authorized',rawPayload:raw,legalContext:{actorRole:'electricity_supplier',legalEdielId:'54321'},plans:[{scope:{classification:'death',classificationSourceHash:'d'.repeat(64)},object:{point:'A',identityAgency:'89',firstLineIndex:3,lineIndexes:[3]}}]}
 const captured=(await db.query("insert into gridex_customer_life_events.inbound_context_receipts(id,company_id,environment,source_message_id,payload_hash,context_facts,context_facts_hash,actor_user_id) values($1,$2,'test',$3,$4,$5,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),$6) returning context_facts_hash h",[id(9),id(2),id(1),hash,context,id(3)])).rows[0].h
 const facts={syntaxDecision:'accepted',applicationDecision:'manual_review',functionalDecision:'manual_review',rulePackEvidence:basis,registerValidation:{version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[good,held].map(o=>({...o,disposition:'accepted',reasons:[]}))}}
 const application={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision:'accepted',sourcePayloadHash:hash,objects:[good,held].map(o=>({...o,applicationDecision:'accepted',reasonCodes:[]}))}
 const functional={version:1,owner:'canonical-prodat-source-function-v1',coverage:'customer_life_event_only',sourcePayloadHash:hash,sourceContextReceiptId:id(9),sourceContextFactsHash:captured,objects:[{...good,functionalDecision:'accepted',reasonCodes:[]},{...held,functionalDecision:'held',reasonCodes:['customer_life_event_source_scope_unqualified']}]}
 const response={responses:[]}
 const record=async(app=application,func=functional)=>{await db.exec('set role service_role');try{return(await db.query('select public.gridex_record_prodat_source_validation_v5($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[id(2),'test',id(1),hash,JSON.stringify(facts),null,JSON.stringify(response),JSON.stringify(app),func===null?null:JSON.stringify(func)])).rows[0].r}finally{await db.exec('reset role')}}
 assert.equal((await db.query('select gridex_received_sources.validate_prodat_application_v1($1,$2,$3,$4) ok',[raw,facts,application,response])).rows[0].ok,false);checks++
 const receipt=await record();assert.equal(receipt.version,5);assert.ok(receipt.sourceFunctionFactsHash);checks++
 const stored=(await db.query('select gridex_received_sources.require_prodat_source_function_objects_v1($1,$2) r',[id(2),id(1)])).rows[0].r
 assert.equal(stored.assessmentId,receipt.assessmentId);assert.deepEqual(stored.objects.map(o=>o.functionalDecision),['accepted','held']);checks++
 assert.equal((await db.query('select gridex_received_sources.prodat_source_function_object_accepted_v1($1,$2,$3,$4) ok',[id(2),id(1),receipt.assessmentId,good])).rows[0].ok,true);checks++
 assert.equal((await db.query('select gridex_received_sources.prodat_source_function_object_accepted_v1($1,$2,$3,$4) ok',[id(2),id(1),receipt.assessmentId,held])).rows[0].ok,false);checks++
 const appStored=(await db.query('select gridex_received_sources.require_prodat_application_objects_v1($1,$2) r',[id(2),id(1)])).rows[0].r
 assert.deepEqual(appStored.objects.map(o=>o.applicationDecision),['accepted','accepted']);checks++
 assert.equal((await db.query('select facts_text::jsonb->>\'functionalDecision\' d from gridex_received_sources.validation_assessments where id=$1',[receipt.assessmentId])).rows[0].d,'manual_review');checks++
 for(const bad of [{...functional,sourcePayloadHash:'f'.repeat(64)},{...functional,sourceContextFactsHash:'f'.repeat(64)},{...functional,sourceContextReceiptId:id(99)}, {...functional,objects:[functional.objects[0]]},{...functional,objects:[functional.objects[0],functional.objects[0]]},{...functional,objects:functional.objects.map(o=>({...o,functionalDecision:'accepted',reasonCodes:[]}))},{...functional,businessAccepted:true}]){
  await assert.rejects(record(application,bad),/same_owner_required/);assert.equal((await db.query('select count(*)::int n from gridex_received_sources.validation_assessments')).rows[0].n,1);checks++
 }
 await assert.rejects(record({...application,headerDecision:'held'},functional),/same_owner_required/);checks++
 await assert.rejects(record(application,null),/application_same_owner_required/);checks++
 await assert.rejects(db.exec('update gridex_received_sources.prodat_source_function_facets set function_facts_text=function_facts_text'),/append_only/);checks++
 assert.deepEqual((await db.query("select has_table_privilege('service_role','gridex_received_sources.prodat_source_function_facets','insert') write_facet,has_function_privilege('service_role','gridex_received_sources.require_prodat_source_function_objects_v1(uuid,uuid)','execute') private_read")).rows[0],{write_facet:false,private_read:false});checks++
 await db.exec('begin')
 const fresh=(await db.query("insert into gridex_customer_life_events.inbound_context_receipts(id,company_id,environment,source_message_id,payload_hash,context_facts,context_facts_hash,actor_user_id)values($1,$2,'test',$3,$4,$5,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),$6)returning context_facts_hash h",[id(10),id(2),id(1),hash,{...context,extra:'uncommitted'},id(3)])).rows[0].h
 assert.equal((await db.query('select gridex_received_sources.validate_prodat_source_function_v1($1,$2,$3,$4,$5) ok',[id(2),id(1),raw,facts,{...functional,sourceContextReceiptId:id(10),sourceContextFactsHash:fresh}])).rows[0].ok,false);await db.exec('rollback');checks++
 console.log(`Focused own-source function partition/V5 atomicity/context coupling/ACL mechanics: ${checks} PASS (synthetic ports; native/replay/legal/effects NOT RUN)`)
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1}finally{await db.close()}
