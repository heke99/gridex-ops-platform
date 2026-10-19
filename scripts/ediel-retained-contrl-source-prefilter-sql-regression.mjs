import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3)
const repo=resolve(option('repo')??join(dirname(fileURLToPath(import.meta.url)),'..'))
const migrationPath=resolve(option('migration')??join(repo,'supabase/migrations/20261019043000_ediel_retained_contrl_source_prefilter.sql'))
const outputPath=option('output')?resolve(option('output')):null
const {PGlite}=await import(pathToFileURL(join(repo,'node_modules/@electric-sql/pglite/dist/index.js')).href)
process.on('uncaughtException',e=>{console.error(JSON.stringify({message:e.message,code:e.code,where:e.where}));process.exit(1)})
const hash=s=>createHash('sha256').update(s).digest('hex')
const schema=readFileSync(join(repo,'supabase/schema.sql'),'utf8')
const immutablePath=join(repo,'supabase/migrations/20261001134600_ediel_retained_technical_ack_private_chain_and_phase.sql')
const immutableMigration=readFileSync(immutablePath,'utf8'),forward=readFileSync(migrationPath,'utf8')
function extractFunction(text,name){
 const start=text.indexOf('CREATE FUNCTION '+name+'(');assert(start>=0,name+' exact source definition')
 const match=/\bAS (\$[^$]*\$)/.exec(text.slice(start));assert(match,name+' source body delimiter')
 const bodyStart=start+match.index+match[0].length,end=text.indexOf(match[1]+';',bodyStart)
 assert(end>bodyStart);return {definition:text.slice(start,end+match[1].length+1)+'\n',body:text.slice(bodyStart,end)}
}
const names=['gridex_utilts_binding.wire_tokens_v1','gridex_ack_authority.wire_v1','gridex_ediel_technical_ack.envelope','gridex_ediel_wire_namespace.keys','gridex_ediel_technical_ack.require_source_v1','gridex_ediel_technical_ack.require_current_endpoint_v1','gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1','gridex_ediel_technical_ack.require_contrl_v1']
const definitions=Object.fromEntries(names.map(name=>[name,extractFunction(schema,name)]))
const immutableBaseline=extractFunction(immutableMigration,'gridex_ediel_technical_ack.retained_source_v1')
assert.equal(Buffer.byteLength(immutableBaseline.body),3054);assert.equal(hash(immutableBaseline.body),'f6985446102ad8306a5905870b423f24b654884275047b2366059b111faae24d')
const baseline=immutableBaseline.definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
const needle=/needle CONSTANT text:=\$old\$([\s\S]*?)\$old\$;/.exec(forward)?.[1]
const replacement=/replacement CONSTANT text:=\$new\$([\s\S]*?)\$new\$;/.exec(forward)?.[1]
assert(needle&&replacement?.endsWith(needle));const predicate=replacement.slice(0,-needle.length)
assert(predicate.includes('COLLATE "C"'));assert.equal(immutableBaseline.body.split(needle).length,2)
const postHash=/post_hash CONSTANT text:='([a-f0-9]{64})';/.exec(forward)?.[1]
assert.equal(hash(immutableBaseline.body.replace(needle,()=>replacement)),postHash)
const manifest={schemaSHA256:hash(schema),immutableBaselineMigration:{path:'supabase/migrations/20261001134600_ediel_retained_technical_ack_private_chain_and_phase.sql',sha256:hash(immutableMigration)},sourceRepresentation:'frozen source definitions; baseline exclusively immutable20261001134600 migration, not the future generated schema',functions:{...Object.fromEntries(names.map(name=>[name,{bodyBytes:Buffer.byteLength(definitions[name].body),bodySHA256:hash(definitions[name].body)}])), 'gridex_ediel_technical_ack.retained_source_v1':{bodyBytes:3054,bodySHA256:hash(immutableBaseline.body)}},predicate,candidateBodySHA256:postHash,guardedForwardSHA256:hash(forward)}
let candidate
const db=new PGlite(),company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',ackId='00000000-0000-4000-8000-000000009000',targetId='00000000-0000-4000-8000-000000001000'
await db.exec(`CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_ediel_technical_ack;CREATE SCHEMA gridex_ediel_wire_namespace;CREATE SCHEMA gridex_received_sources;CREATE SCHEMA probe;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,raw_payload text,related_message_id uuid,immutable_rendered_at timestamptz,immutable_payload_hash text,message_received_at timestamptz);
 CREATE TABLE gridex_ediel_technical_ack.sources(source_message_id uuid PRIMARY KEY,source_company_id uuid,company_id uuid,environment text,payload_sha256 text,observed_at timestamptz,source_received_at timestamptz,status text,reason text,evidence jsonb);
 CREATE TABLE gridex_ediel_technical_ack.replies(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,payload_sha256 text,canonical_assessment_id uuid,evidence jsonb);
 CREATE TABLE gridex_ediel_technical_ack.syntax_facets(id uuid PRIMARY KEY,source_message_id uuid UNIQUE,company_id uuid,environment text,payload_sha256 text,facts_text text,facts_hash text);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,owner text,facts_text text,facts_hash text,previous_assessment_id uuid);
 CREATE TABLE gridex_ediel_wire_namespace.coverage(source_message_id uuid PRIMARY KEY,payload_sha256 text,company_id uuid,environment text);
 CREATE TABLE gridex_ediel_wire_namespace.reservations(environment text,sender_namespace text,application_namespace text,reference_kind text,wire_reference text,source_message_id uuid,company_id uuid,first_payload_sha256 text,PRIMARY KEY(environment,sender_namespace,application_namespace,reference_kind,wire_reference));
 CREATE TABLE public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
 CREATE TABLE probe.envelope_calls(n integer NOT NULL);INSERT INTO probe.envelope_calls VALUES(0);`)
for(const name of ['gridex_utilts_binding.wire_tokens_v1','gridex_ack_authority.wire_v1','gridex_ediel_technical_ack.envelope','gridex_ediel_wire_namespace.keys','gridex_ediel_technical_ack.require_source_v1','gridex_ediel_technical_ack.require_current_endpoint_v1','gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1','gridex_ediel_technical_ack.require_contrl_v1'])await db.exec(definitions[name].definition)
await db.exec(`ALTER FUNCTION gridex_ediel_technical_ack.envelope(text) RENAME TO actual_envelope_for_probe;
 CREATE FUNCTION gridex_ediel_technical_ack.envelope(p_raw text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$BEGIN UPDATE probe.envelope_calls SET n=n+1;RETURN gridex_ediel_technical_ack.actual_envelope_for_probe(p_raw);END$$;`)
await db.exec(baseline)
await db.exec(`CREATE ROLE prefilter_probe_acl;REVOKE ALL ON FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) FROM PUBLIC;GRANT EXECUTE ON FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) TO prefilter_probe_acl;`)
const catalog=async()=>{const r=(await db.query("SELECT to_jsonb(p) data,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid='gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)'::regprocedure")).rows[0];return r}
const initialCatalog=await catalog(),initialMetadata={...initialCatalog.data};delete initialMetadata.prosrc
await db.exec(forward)
const migratedCatalog=await catalog(),migratedMetadata={...migratedCatalog.data};delete migratedMetadata.prosrc
assert.deepEqual(migratedMetadata,initialMetadata,'actual guarded migration preserves all pg_proc metadata except prosrc')
assert.equal(hash(migratedCatalog.data.prosrc),postHash);candidate=migratedCatalog.definition
assert.equal(migratedCatalog.data.prosrc.replace(predicate,''),immutableBaseline.body,'only existing FOR WHERE predicate added')
const migrationResults=[{name:'actual_guarded_forward',result:'PASS_EMBEDDED_ONLY',preimageSHA256:hash(initialCatalog.data.prosrc),postimageSHA256:hash(migratedCatalog.data.prosrc),oidBefore:initialCatalog.data.oid,oidAfter:migratedCatalog.data.oid,aclBefore:initialCatalog.data.proacl,aclAfter:migratedCatalog.data.proacl,configBefore:initialCatalog.data.proconfig,configAfter:migratedCatalog.data.proconfig,allMetadataExceptProsrcEqual:true,metadataKeys:Object.keys(initialMetadata).sort()}]
async function rejectedMigration(name,sql,expected,prepare){
 await db.exec(baseline);if(prepare)await prepare()
 const before=(await catalog()).data;let error
 try{await db.exec(sql)}catch(e){error={code:e.code,message:e.message};await db.exec('ROLLBACK')}
 assert.equal(error?.message,expected,name+' exact failclosed guard');assert.deepEqual((await catalog()).data,before,name+' complete transaction rollback')
 migrationResults.push({name,result:'PASS_EMBEDDED_REJECTION_ROLLBACK',error,wholeCatalogIncludingBodyUnchanged:true})
}
await rejectedMigration('unknown_preimage',forward,'ediel_retained_contrl_prefilter_preimage_changed',()=>db.exec(baseline.replace('END$$;',()=> '--unknown preimage\nEND$$;')))
await rejectedMigration('postimage_is_not_a_preimage',forward,'ediel_retained_contrl_prefilter_preimage_changed',()=>db.exec(candidate))
await rejectedMigration('missing_unique_replacement_shape',forward.replace('needle CONSTANT text:=$old$'+needle,'needle CONSTANT text:=$old$NOT_THE_FROZEN_NEEDLE'),'ediel_retained_contrl_prefilter_replacement_shape_changed')
await rejectedMigration('computed_postimage_guard',forward.replace("post_hash CONSTANT text:='"+postHash+"'","post_hash CONSTANT text:='"+'0'.repeat(64)+"'"),'ediel_retained_contrl_prefilter_definition_postimage_changed')
await rejectedMigration('actual_catalog_postimage_guard',forward.replace(' EXECUTE definition;'," EXECUTE replace(definition,post_body,post_body||E'\\n--wrong catalog postimage\\n');"),'ediel_retained_contrl_prefilter_catalog_postimage_changed')
await rejectedMigration('metadata_cost_guard',forward.replace(' EXECUTE definition;'," EXECUTE definition;EXECUTE 'ALTER FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) COST 17';"),'ediel_retained_contrl_prefilter_function_metadata_changed')
await rejectedMigration('metadata_config_guard',forward.replace(' EXECUTE definition;'," EXECUTE definition;EXECUTE 'ALTER FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) SET search_path TO public';"),'ediel_retained_contrl_prefilter_function_metadata_changed')
await rejectedMigration('metadata_ACL_guard',forward.replace(' EXECUTE definition;'," EXECUTE definition;EXECUTE 'REVOKE EXECUTE ON FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean) FROM prefilter_probe_acl';"),'ediel_retained_contrl_prefilter_function_metadata_changed')
await rejectedMigration('OID_guard',forward.replace(' EXECUTE definition;'," EXECUTE 'DROP FUNCTION gridex_ediel_technical_ack.retained_source_v1(public.ediel_messages,boolean)';EXECUTE definition;"),'ediel_retained_contrl_prefilter_oid_changed')
function encode(parts,{custom=false,noUna=false}={}){const component=custom?';':':',data=custom?'*':'+',end=custom?'~':"'",advice=custom?'UNA;*.! ~':"UNA:+.? '";return (noUna?'':advice)+parts.map(p=>p.map(e=>Array.isArray(e)?e.join(component):e).join(data)+end).join('')}
function sourceWire(ref='TARGETREF12345',o={}){return encode([
 ['UNB',['UNOC','3'],[o.sender??'60004','14'],[o.receiver??'40004','14'],['261019','0400'],ref,'',o.app??'23-DDQ-PRODAT','','','',o.indicator??'1'],
 ['UNH','SRCMSG00001',['PRODAT','D','97A','UN','E2SE6A']],['BGM','Z04','SOURCEDOC01','9','AB'],['NAD','FR',['60004','160','SVK']],['NAD','DO',['40004','160','SVK']],['UNT','5','SRCMSG00001'],['UNZ','1',ref]],o)}
function ackWire(ref='TARGETREF12345',o={}){return encode([
 ['UNB',['UNOC','3'],[o.sender??'40004',o.senderQualifier??'14'],[o.receiver??'60004',o.receiverQualifier??'14'],['261019','0400'],'ACKREF12345678','',o.app??'23-DDQ-PRODAT','','','',o.indicator??'1'],
 ['UNH','ACKMSG00001',[o.family??'CONTRL','2','2','UN','EDIEL2']],...(o.noUci?[]:[['UCI',ref,[o.uciSender??'60004',o.uciSenderQualifier??'14'],[o.uciReceiver??'40004',o.uciReceiverQualifier??'14'],o.action??'1']]),
 ['UCM',o.ucm??'SRCMSG00001','7'],['UNT',o.noUci?'3':'4','ACKMSG00001'],['UNZ','1','ACKREF12345678']],o)}
const literalJson=v=>JSON.stringify(v),sourceHash=raw=>hash(raw),rows=[]
async function reset(o={}){
 await db.exec(`TRUNCATE public.ediel_messages,gridex_ediel_technical_ack.sources,gridex_ediel_technical_ack.replies,gridex_ediel_technical_ack.syntax_facets,gridex_received_sources.validation_assessments,gridex_ediel_wire_namespace.coverage,gridex_ediel_wire_namespace.reservations,public.tenant_actor_identifiers,public.tenant_counterparty_relations,public.platform_actor_identifiers;`)
 const ref=o.ref??'TARGETREF12345',raw=o.raw??sourceWire(o.encodedRef??ref,o.sourceOptions??{}),ack=o.ack??ackWire(o.ackEncodedRef??ref.slice(0,14),o.ackOptions??{}),n=o.decoys??24
 const sources=[{id:targetId,raw},...Array.from({length:n},(_,i)=>({id:'00000000-0000-4000-8000-'+String(1100+i).padStart(12,'0'),raw:sourceWire('DECOY'+String(i).padStart(8,'0'))}))]
 const list=sources.map(x=>({...x,company_id:company,environment:'test',direction:'inbound',message_family:'PRODAT'}))
 await db.query(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,raw_payload,message_received_at)
 SELECT id::uuid,company_id::uuid,environment,direction,message_family,raw,'2026-10-19T04:00:00Z' FROM jsonb_to_recordset($1::jsonb) AS x(id text,company_id text,environment text,direction text,message_family text,raw text)`,[literalJson(list)])
 await db.query(`INSERT INTO public.ediel_messages VALUES($1,$2,'test','outbound','CONTRL',$3,$4,'2026-10-19T04:01:00Z',$5,'2026-10-19T04:01:00Z')`,[ackId,company,ack,o.wrongCache?sources[1].id:targetId,sourceHash(ack)])
 await db.query(`INSERT INTO public.tenant_actor_identifiers VALUES('00000000-0000-4000-8000-000000000003',$1,'test',$2,'EdielId','40004','2020-01-01',NULL)`,[company,actor])
 await db.query(`INSERT INTO gridex_ediel_technical_ack.sources
 SELECT id,company_id,company_id,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'2026-10-19T04:00:00Z',message_received_at,'ready',NULL,
 jsonb_build_object('kind','technical_syntax_ack','version',1,'companyId',company_id,'environment',environment,'sourceMessageId',id,'sourceHash',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'observedAt','2026-10-19T04:00:00Z','originalUNB',gridex_ediel_technical_ack.actual_envelope_for_probe(raw_payload),'transportActorId',$1::uuid,'transportEdielId','40004')
 FROM public.ediel_messages WHERE direction='inbound'`,[actor])
 await db.query(`INSERT INTO gridex_ediel_technical_ack.syntax_facets
 SELECT ('10000000'||substr(m.id::text,9))::uuid,m.id,s.company_id,s.environment,s.payload_sha256,
 jsonb_build_object('version',1,'owner','canonical-runtime-syntax-v1','syntaxDecision',CASE WHEN source_message_id=$1 THEN $2 ELSE 'accepted' END,'reasonCodes','[]'::jsonb)::text,''
 FROM gridex_ediel_technical_ack.sources s JOIN public.ediel_messages m ON m.id=s.source_message_id`,[targetId,o.syntax??'accepted'])
 await db.exec(`UPDATE gridex_ediel_technical_ack.syntax_facets SET facts_hash=encode(sha256(convert_to(facts_text,'UTF8')),'hex');
 INSERT INTO gridex_ediel_technical_ack.replies SELECT b.source_message_id,b.company_id,b.environment,b.payload_sha256,f.id,b.evidence||jsonb_build_object('syntaxAssessmentId',f.id,'syntaxDecision',f.facts_text::jsonb->>'syntaxDecision') FROM gridex_ediel_technical_ack.sources b JOIN gridex_ediel_technical_ack.syntax_facets f USING(source_message_id);`)
 await db.query(`INSERT INTO gridex_ediel_wire_namespace.coverage VALUES($1,$2,$3,'test')`,[ackId,sourceHash(ack),company])
 await db.query(`INSERT INTO gridex_ediel_wire_namespace.reservations SELECT 'test',k->>'sender',k->>'application',k->>'kind',k->>'value',$1,$2,$3 FROM jsonb_array_elements(gridex_ediel_wire_namespace.keys($4))k`,[ackId,company,sourceHash(ack),ack])
 if(o.change)await o.change({raw,ack,sources})
 return {raw,ack,sources}
}
async function invoke(definition,{complete=true,full=false,capture=false}={}){
 await db.exec(definition);await db.exec('UPDATE probe.envelope_calls SET n=0')
 let value=null,error=null
 try{
  if(capture)value=(await db.query('SELECT gridex_ediel_technical_ack.capture_reply_before_native_ack_guide_v1($1,$2) value',[company,targetId])).rows[0].value
  else if(full)value=(await db.query('SELECT gridex_ediel_technical_ack.require_contrl_v1(m) value FROM public.ediel_messages m WHERE id=$1',[ackId])).rows[0].value?.sourceMessageId??null
  else value=(await db.query('SELECT gridex_ediel_technical_ack.retained_source_v1(m,$2) value FROM public.ediel_messages m WHERE id=$1',[ackId,complete])).rows[0].value
 }catch(e){error={code:e.code,message:e.message}}
 const visits=(await db.query('SELECT n FROM probe.envelope_calls')).rows[0].n
 return {value,error,visits}
}
async function check(name,o={},expected=targetId,invokeOptions={}){
 const fixture=await reset(o),old=await invoke(baseline,invokeOptions),fresh=await invoke(candidate,invokeOptions)
 assert.deepEqual({value:fresh.value,error:fresh.error},{value:old.value,error:old.error},name+' preserves actual SQL result/error')
 if(expected==='error')assert(fresh.error,name+' actual error required')
 else if(typeof expected==='string'&&expected.startsWith('error:'))assert.equal(fresh.error?.message,expected.slice(6),name)
 else {assert.equal(fresh.error,null,name);assert.equal(fresh.value,expected,name)}
 rows.push({name,expected,baseline:old,candidate:fresh,sources:fixture.sources.length,scope:invokeOptions.capture?'actual_private_capture_predecessor':invokeOptions.full?'actual_require_contrl_and_retained_full_chain':'actual_retained_source'})
 return {old,fresh,fixture}
}
const perf=await check('default_UNA_128_decoys',{decoys:128});assert.equal(perf.old.visits,129);assert.equal(perf.fresh.visits,1)
await check('cache_wrong_relation_ignored',{wrongCache:true})
await check('cache_wrong_relation_full_contrl',{wrongCache:true},targetId,{full:true})
await check('absent_UNA',{raw:sourceWire('TARGETREF12345',{noUna:true})})
await check('UNA_question_only_in_advice',{})
await check('CRLF_split_inside_UNB_reference',{raw:sourceWire().replaceAll('TARGETREF12345','TARGET\r\nREF12345')})
await check('LF_split_inside_UNB_reference',{raw:sourceWire().replaceAll('TARGETREF12345','TARGET\nREF12345')})
await check('source_reference_over14_prefix',{ref:'TARGETREF12345LONGORIGINAL'})
await check('source_redundant_alnum_release',{ref:'ABCDEFGH12345',encodedRef:'A?BCDEFGH12345'})
await check('source_release_elsewhere_falls_back',{raw:sourceWire().replace('SOURCEDOC01','SOURCEDOC?001')})
await check('custom_UNA_source_falls_back',{raw:sourceWire('TARGETREF12345',{custom:true})})
await check('custom_UNA_redundant_alnum_release',{ref:'ABCDEFGH12345',raw:sourceWire('A!BCDEFGH12345',{custom:true})})
await check('absent_UNA_redundant_alnum_release',{ref:'ABCDEFGH12345',raw:sourceWire('A?BCDEFGH12345',{noUna:true})})
await check('custom_UNA_both',{raw:sourceWire('TARGETREF12345',{custom:true}),ack:ackWire('TARGETREF12345',{custom:true})})
await check('short_UCI_falls_back',{ref:'SHORT7'})
await check('nonalnum_UCI_falls_back',{ref:'ABC_DEF12345'})
await check('escaped_UCI_decoded_before_filter',{ref:'ABCDEFGH12345',ackEncodedRef:'A?BCDEFGH12345'})
await check('rejected_syntax_negative_UCI',{syntax:'rejected',ackOptions:{action:'4'}})
await check('rejected_syntax_full_contrl',{syntax:'rejected',ackOptions:{action:'4'}},targetId,{full:true})
await check('rejected_syntax_positive_UCI_refused',{syntax:'rejected'},null)
await check('accepted_syntax_negative_UCI_refused',{ackOptions:{action:'4'}},null)
for(const [name,ackOptions]of [
 ['wrong_outer_sender',{sender:'49999'}],['wrong_outer_sender_qualifier',{senderQualifier:'9'}],['wrong_outer_receiver',{receiver:'69999'}],['wrong_outer_receiver_qualifier',{receiverQualifier:'9'}],['wrong_environment',{indicator:'0'}],['wrong_application',{app:'23-DGI-PRODAT'}],['wrong_UCI_reference',{dummy:true}],['wrong_UCI_sender',{uciSender:'69999'}],['wrong_UCI_sender_qualifier',{uciSenderQualifier:'9'}],['wrong_UCI_receiver',{uciReceiver:'49999'}],['wrong_UCI_receiver_qualifier',{uciReceiverQualifier:'9'}],['wrong_UCI_action',{action:'7'}]]){
 await check(name,{ack:ackWire(name==='wrong_UCI_reference'?'WRONGREF12345':'TARGETREF12345',ackOptions)},null)
}
await check('same_14prefix_remains_ambiguous',{ref:'TARGETREF12345LONGA',change:async({sources})=>{
 const second=sourceWire('TARGETREF12345LONGB');await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',[second,sources[1].id]);await db.query("UPDATE gridex_ediel_technical_ack.sources SET payload_sha256=$1 WHERE source_message_id=$2",[hash(second),sources[1].id]);await db.query("UPDATE gridex_ediel_technical_ack.replies SET payload_sha256=$1,evidence=jsonb_set(evidence,'{originalUNB}',gridex_ediel_technical_ack.actual_envelope_for_probe($2)) WHERE source_message_id=$3",[hash(second),second,sources[1].id])}},'error:ediel_technical_ack_original_ambiguous')
await check('substring_only_false_positive_still_physical_refused',{ack:ackWire('SOURCEDOC01')},null)
for(const [name,sql,params]of [
 ['missing_coverage','DELETE FROM gridex_ediel_wire_namespace.coverage',[]],['coverage_wrong_hash',"UPDATE gridex_ediel_wire_namespace.coverage SET payload_sha256=repeat('a',64)",[]],['coverage_wrong_company','UPDATE gridex_ediel_wire_namespace.coverage SET company_id=$1',[actor]],
 ['source_receipt_held',"UPDATE gridex_ediel_technical_ack.sources SET status='held' WHERE source_message_id=$1",[targetId]],['source_receipt_company_mismatch','UPDATE gridex_ediel_technical_ack.sources SET company_id=$1 WHERE source_message_id=$2',[actor,targetId]],
 ['reply_company_mismatch','UPDATE gridex_ediel_technical_ack.replies SET company_id=$1 WHERE source_message_id=$2',[actor,targetId]],['source_receipt_environment_mismatch',"UPDATE gridex_ediel_technical_ack.sources SET environment='production' WHERE source_message_id=$1",[targetId]],
 ['reply_environment_mismatch',"UPDATE gridex_ediel_technical_ack.replies SET environment='production' WHERE source_message_id=$1",[targetId]],['source_row_direction_mismatch',"UPDATE public.ediel_messages SET direction='outbound' WHERE id=$1",[targetId]],
 ['source_row_company_mismatch','UPDATE public.ediel_messages SET company_id=$1 WHERE id=$2',[actor,targetId]],['source_row_environment_mismatch',"UPDATE public.ediel_messages SET environment='production' WHERE id=$1",[targetId]],
 ['source_hash_mismatch',"UPDATE gridex_ediel_technical_ack.sources SET payload_sha256=repeat('b',64) WHERE source_message_id=$1",[targetId]],['reply_hash_mismatch',"UPDATE gridex_ediel_technical_ack.replies SET payload_sha256=repeat('b',64) WHERE source_message_id=$1",[targetId]],
 ['raw_source_hash_changed',"UPDATE public.ediel_messages SET raw_payload=raw_payload||' ' WHERE id=$1",[targetId]],['missing_reply','DELETE FROM gridex_ediel_technical_ack.replies WHERE source_message_id=$1',[targetId]],
 ['reply_originalUNB_mismatch',"UPDATE gridex_ediel_technical_ack.replies SET evidence=jsonb_set(evidence,'{originalUNB,uciReference}','\"WRONGREF12345\"') WHERE source_message_id=$1",[targetId]],
 ['reply_unknown_syntax',"UPDATE gridex_ediel_technical_ack.replies SET evidence=jsonb_set(evidence,'{syntaxDecision}','\"unknown\"') WHERE source_message_id=$1",[targetId]],
 ['missing_immutable_seal','UPDATE public.ediel_messages SET immutable_rendered_at=NULL WHERE id=$1',[ackId]],['immutable_hash_mismatch',"UPDATE public.ediel_messages SET immutable_payload_hash=repeat('f',64) WHERE id=$1",[ackId]],
 ['missing_namespace_reservation',"DELETE FROM gridex_ediel_wire_namespace.reservations WHERE reference_kind='UNH'",[]],['reservation_company_mismatch','UPDATE gridex_ediel_wire_namespace.reservations SET company_id=$1',[actor]],
 ['reservation_hash_mismatch',"UPDATE gridex_ediel_wire_namespace.reservations SET first_payload_sha256=repeat('c',64)",[]],['reservation_sender_mismatch',"UPDATE gridex_ediel_wire_namespace.reservations SET sender_namespace='wrong'",[]],
 ['reservation_application_mismatch',"UPDATE gridex_ediel_wire_namespace.reservations SET application_namespace='wrong'",[]],['reservation_wire_ref_mismatch',"UPDATE gridex_ediel_wire_namespace.reservations SET wire_reference='wrong'",[]],
 ['reservation_source_id_mismatch','UPDATE gridex_ediel_wire_namespace.reservations SET source_message_id=$1',[actor]],['reservation_environment_mismatch',"UPDATE gridex_ediel_wire_namespace.reservations SET environment='production'",[]]]){
 await check(name,{change:()=>db.query(sql,params)},null)
}
await check('unattributed_source_with_exact_private_company',{change:()=>db.query('UPDATE public.ediel_messages SET company_id=NULL WHERE id=$1',[targetId])})
await check('complete_chain_false_preserves_discovery_only',{change:()=>db.query('UPDATE public.ediel_messages SET immutable_rendered_at=NULL WHERE id=$1',[ackId])},targetId,{complete:false})
await check('missing_UCI_has_no_string_substitute',{ackOptions:{noUci:true}},null)
await check('wrong_ack_family_refused',{ackOptions:{family:'APERAK'}},null)
await check('missing_facet_no_reply_capture_refused',{change:async()=>{await db.query('DELETE FROM gridex_ediel_technical_ack.replies WHERE source_message_id=$1',[targetId]);await db.query('DELETE FROM gridex_ediel_technical_ack.syntax_facets WHERE source_message_id=$1',[targetId])}},'error:ediel_technical_ack_basis_required',{capture:true})
await check('wrong_facet_hash_no_reply_capture_refused',{change:async()=>{await db.query('DELETE FROM gridex_ediel_technical_ack.replies WHERE source_message_id=$1',[targetId]);await db.query("UPDATE gridex_ediel_technical_ack.syntax_facets SET facts_hash=repeat('a',64) WHERE source_message_id=$1",[targetId])}},'error:ediel_technical_ack_basis_required',{capture:true})
await check('private_reply_retains_captured_syntax_without_fresh_facet_read',{change:()=>db.query('DELETE FROM gridex_ediel_technical_ack.syntax_facets WHERE source_message_id=$1',[targetId])})
await check('full_contrl_current_endpoint_refused',{change:()=>db.exec('DELETE FROM public.tenant_actor_identifiers')},'error:ediel_technical_endpoint_unqualified',{full:true})
await check('full_contrl_UCM_wrong_source_ref_refused',{ackOptions:{ucm:'OTHERMSG00001'}},'error:ediel_technical_ack_basis_required',{full:true})
await check('full_contrl_source_received_at_mismatch',{change:()=>db.query("UPDATE gridex_ediel_technical_ack.sources SET source_received_at='2026-10-19T03:59:00Z' WHERE source_message_id=$1",[targetId])},'error:ediel_historical_technical_ack_basis_unavailable',{full:true})
await check('malformed_ACK_UNT_refused_before_filter',{ack:ackWire().replace('UNT+4+','UNT+5+')},null)
for(const name of ['short_UCI_falls_back','nonalnum_UCI_falls_back']){const row=rows.find(r=>r.name===name);assert.equal(row.baseline.visits,25);assert.equal(row.candidate.visits,25)}
for(const name of ['absent_UNA','UNA_question_only_in_advice','CRLF_split_inside_UNB_reference','LF_split_inside_UNB_reference','source_reference_over14_prefix','source_redundant_alnum_release','custom_UNA_redundant_alnum_release','absent_UNA_redundant_alnum_release'])assert.equal(rows.find(r=>r.name===name).candidate.visits,1)
const mutants=[]
async function mutant(name,definition,fixture,kind='semantics'){
 assert.notEqual(definition,candidate,name+' changes actual candidate function');await reset(fixture)
 const actual=await invoke(candidate),changed=await invoke(definition)
 if(kind==='all_visits_required')assert.notEqual(changed.visits,25,name)
 else if(kind==='fast_visits_required')assert.notEqual(changed.visits,1,name)
 else assert.notDeepEqual({value:changed.value,error:changed.error},{value:actual.value,error:actual.error},name)
 mutants.push({name,result:'KILLED',actual,mutant:changed,definitionSHA256:hash(definition)})
}
const escapeLine="    OR strpos(CASE WHEN upper(left(s.raw_payload,3))='UNA' THEN substr(s.raw_payload,10) ELSE s.raw_payload END,'?')>0\n"
const customLine="    OR (upper(left(s.raw_payload,3))='UNA' AND left(s.raw_payload,9)<>'UNA:+.? ''')\n"
await mutant('remove_body_release_fallback',candidate.replace(escapeLine,''),{ref:'ABCDEFGH12345',encodedRef:'A?BCDEFGH12345'})
await mutant('remove_custom_UNA_fallback',candidate.replace(customLine,''),{ref:'ABCDEFGH12345',raw:sourceWire('A!BCDEFGH12345',{custom:true})})
await mutant('omit_CRLF_normalization',candidate.replace("replace(replace(s.raw_payload,E'\\r\\n',''),E'\\n','')",'s.raw_payload'),{raw:sourceWire().replaceAll('TARGETREF12345','TARGET\r\nREF12345')})
await mutant('require_delimited_full_reference',candidate.replace("a->>'uciRef')>0)","'+'||(a->>'uciRef')||'+')>0)"),{ref:'TARGETREF12345LONGORIGINAL'})
await mutant('optimize_short_refs_outside_scope',candidate.replace("coalesce(a->>'uciRef','') COLLATE \"C\" !~ '^[A-Za-z0-9]{8,14}$'",'false'),{ref:'SHORT7'},'all_visits_required')
await mutant('count_UNA_advice_as_body_release',candidate.replace("CASE WHEN upper(left(s.raw_payload,3))='UNA' THEN substr(s.raw_payload,10) ELSE s.raw_payload END",'s.raw_payload'),{},'fast_visits_required')
await mutant('trust_cached_relation',candidate.replace('  ORDER BY s.id FOR SHARE OF b,r,s LOOP','   AND s.id=m.related_message_id\n  ORDER BY s.id FOR SHARE OF b,r,s LOOP'),{wrongCache:true})
const ambiguousFixture={ref:'TARGETREF12345LONGA',change:async({sources})=>{const second=sourceWire('TARGETREF12345LONGB');await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',[second,sources[1].id]);await db.query('UPDATE gridex_ediel_technical_ack.sources SET payload_sha256=$1 WHERE source_message_id=$2',[hash(second),sources[1].id]);await db.query("UPDATE gridex_ediel_technical_ack.replies SET payload_sha256=$1,evidence=jsonb_set(evidence,'{originalUNB}',gridex_ediel_technical_ack.actual_envelope_for_probe($2)) WHERE source_message_id=$3",[hash(second),second,sources[1].id])}}
await mutant('omit_ambiguity_refusal',candidate.replace(" IF cardinality(ids)>1 THEN RAISE EXCEPTION 'ediel_technical_ack_original_ambiguous';END IF;",''),ambiguousFixture)
const output={scope:'PURE_EMBEDDED_SOURCE_SQL_MECHANICS_ONLY; explicitly synthetic declared tables/fixtures, no service/native/remote/runtime-catalog/concurrency/acceptance authority',source:manifest,migrationResults,fixtureRows:{performanceSources:129,normalSources:25},results:rows,mutants,
 checks:{sameActualResultAndError:true,baselineEnvelopeVisits:perf.old.visits,candidateEnvelopeVisits:perf.fresh.visits,onlyRetainedFORWherePredicateAdded:true,realLexerEnvelopeAckWireAndNamespaceKeys:true,actualRequireContrlAndSourceEndpointChecks:true,facetCaptureUsesActualPrivatePreGuidePredecessor:true},
 limits:['current source schema representation only; other installed function body hashes not independently runtime verified','single embedded PGlite session has no concurrency/locking/snapshot-race proof','synthetic rows deliberately model broken guard inputs without production RLS/immutable triggers','actual native SQL57014 statement timeout does not identify server plan/statement; fewer envelope visits demonstrate a bounded source-supported cost mechanism, not authentic performance or guaranteed timeout removal','facet is qualified before private reply capture; established immutable reply retains its captured decision and retained_source does not re-read facet','no business/ACK/acceptance/native result credit']}
if(outputPath)writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({cases:rows.length,migrationChecks:migrationResults.length,mutantsKilled:mutants.length,sourceBodySHA256:manifest.functions['gridex_ediel_technical_ack.retained_source_v1'].bodySHA256,candidateSHA256:hash(candidate),performance:output.checks,resultsPath:outputPath},null,2));await db.close()
