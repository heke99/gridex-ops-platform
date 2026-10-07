// masterplan: AT-Z14V-ESCO
// Real immutable V6 -> V3 -> V2 facet validators and inserts in PostgreSQL/PGlite.
// Original canonical/registry/legal/context admission are explicit finite IO
// boundaries. This fixture is not native admission, market authority or a
// concurrent-lock proof. Root's independent PostgreSQL17 probe owns concurrency.
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const digest=x=>createHash('sha256').update(x).digest('hex')
export const signature='gridex_received_sources.append_prodat_validation_v6(uuid,text,uuid,text,text,text,text,text,text,text)'
export const forward=resolve('supabase/migrations/20261007051400_ediel_equivalent_prodat_canonical_replay.sql')
const migration=file=>readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')
const fn=(file,name)=>{const s=migration(file),m=new RegExp(`CREATE(?: OR REPLACE)? FUNCTION ${name.replaceAll('.','\\.')}\\(`).exec(s),start=m?.index??-1,end=s.indexOf('$$;',start);if(start<0||end<0)throw Error(name);return s.slice(start,end+3)}

export async function createReplayFixture(){
 const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE??resolve('node_modules/@electric-sql/pglite/dist/index.js')).href)
 const db=new PGlite()
 try{
  // Reuse only the declared DDL prefix; the protected old script is unchanged.
  const fixture=readFileSync(new URL('./ediel-prodat-mixed-own-object-sql-regression.mjs',import.meta.url),'utf8'),a=fixture.indexOf('await db.exec(`')+'await db.exec(`'.length,b=fixture.indexOf('`)',a)
  assert.ok(a>0&&b>a);await db.exec(fixture.slice(a,b))
  await db.exec(`ALTER TABLE gridex_received_sources.sources ADD COLUMN raw_payload text;
   ALTER TABLE gridex_received_sources.validation_assessments ADD COLUMN owner text DEFAULT 'canonical-runtime-with-registry-v1';
   CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_bilateral_prodat;CREATE SCHEMA gridex_customer_life_events;
   CREATE TABLE public.declared_current_guards(name text PRIMARY KEY,allowed boolean NOT NULL);
   INSERT INTO public.declared_current_guards VALUES('original_bytes',true),('canonical_registry',true);
   CREATE SEQUENCE public.declared_canonical_validator_calls;
   -- Minimal declared registry IO rows, including the actual lower authority
   -- lock targets. They do not constitute native rule-pack admission.
   CREATE TABLE public.ediel_rule_packs(id uuid PRIMARY KEY,source_hash text NOT NULL);
   CREATE TABLE public.ediel_message_profiles(id uuid PRIMARY KEY,rule_pack_id uuid NOT NULL,profile_key text NOT NULL);
   CREATE TABLE public.ediel_rule_pack_sources(id uuid PRIMARY KEY,rule_pack_id uuid NOT NULL,source_hash text NOT NULL);
   CREATE TABLE public.declared_receipt_custody(id uuid PRIMARY KEY,original_hash text NOT NULL);
   CREATE FUNCTION gridex_bilateral_prodat.lock_source_receipts_v1() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE public.user_permissions IN SHARE MODE;END$$;
   CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable';END$$;
   CREATE FUNCTION public.ediel_require_source_bytes_available_v1(uuid,uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN
    IF (SELECT allowed FROM public.declared_current_guards WHERE name='original_bytes') IS NOT TRUE OR NOT EXISTS(SELECT FROM public.ediel_messages WHERE company_id=$1 AND id=$2 AND raw_payload IS NOT NULL) THEN RAISE EXCEPTION 'declared_original_bytes_unavailable' USING ERRCODE='23514';END IF;END$$;
   CREATE FUNCTION gridex_received_sources.append_validation(c uuid,env text,source_id uuid,source_hash text,facts text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE next_id uuid:=gen_random_uuid();previous uuid;BEGIN
    -- This nontransactional sequence is an explicit observation of entering
    -- this finite port, not a substitute for the real V2/V3 validators.
    PERFORM nextval('public.declared_canonical_validator_calls');
    LOCK TABLE public.ediel_rule_pack_sources IN SHARE MODE;
    PERFORM rp.id FROM public.ediel_rule_packs rp WHERE rp.id::text=facts::jsonb#>>'{rulePackEvidence,rulePackId}' AND rp.source_hash=facts::jsonb#>>'{rulePackEvidence,sourceHash}' FOR SHARE;
    PERFORM mp.id FROM public.ediel_message_profiles mp WHERE mp.id::text=facts::jsonb#>>'{rulePackEvidence,messageProfileId}' AND mp.rule_pack_id::text=facts::jsonb#>>'{rulePackEvidence,rulePackId}' AND mp.profile_key=facts::jsonb#>>'{rulePackEvidence,profileKey}' FOR SHARE;
    IF (SELECT allowed FROM public.declared_current_guards WHERE name='canonical_registry') IS NOT TRUE THEN RAISE EXCEPTION 'declared_current_registry_refusal' USING ERRCODE='23514';END IF;
    IF NOT EXISTS(SELECT FROM gridex_received_sources.sources WHERE source_message_id=source_id AND company_id=c AND environment=env AND payload_hash=source_hash) THEN RAISE EXCEPTION 'declared_primary_scope_required';END IF;
    SELECT id INTO previous FROM gridex_received_sources.validation_assessments a WHERE a.company_id=c AND a.source_message_id=source_id AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
    INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash,previous_assessment_id) VALUES(next_id,source_id,c,env,source_hash,facts,encode(sha256(convert_to(facts,'UTF8')),'hex'),previous);
    RETURN jsonb_build_object('version',1,'assessmentId',next_id,'companyId',c,'environment',env,'sourceMessageId',source_id,'sourcePayloadHash',source_hash,'factsHash',encode(sha256(convert_to(facts,'UTF8')),'hex'),'sourceDisposition','not_established');END$$;`)
  for(const name of ['gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_transition_immutable_v1','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1'])await db.exec(fn('20260930144205_ediel_permission_source_atomic_transitions.sql',name))
  await db.exec(fn('20260930161624_ediel_supply_market_source_lifecycle.sql','gridex_received_sources.supply_wire_v1'))
  await db.exec(fn('20260930174333_ediel_production_contract_source_commands.sql','gridex_received_sources.production_contract_hash_v1'))
  await db.exec(migration('20260930201111_ediel_normal_switch_source_atomic_confirmation.sql'))
  await db.exec(fn('20260923135706_ediel_utilts_consumption_binding_v1.sql','gridex_utilts_binding.wire_tokens_v1'))
  const ignored=migration('20260930215244_ediel_prodat_ignored_field_source_projection.sql');await db.exec(ignored.slice(ignored.indexOf('CREATE TABLE'),ignored.indexOf('-- The immutable object snapshot')))
  for(const file of ['20260930224726_ediel_prodat_mixed_own_object_processing.sql','20260930234111_ediel_prodat_canonical_response_facets.sql','20261001000147_ediel_prodat_response_v3_namespace_bridge.sql','20261001000148_ediel_prodat_primary_full_object_capture_and_grant_lock.sql','20261001010321_ediel_complete_prodat_own_application_facets.sql'])await db.exec(migration(file))
  const context=migration('20261001023512_ediel_partial_customer_life_event_source_effects.sql');await db.exec(context.slice(context.indexOf('CREATE TABLE gridex_customer_life_events.inbound_context_receipts'),context.indexOf('CREATE TABLE gridex_customer_life_events.partition_receipts')))
  for(const name of ['gridex_customer_life_events.wire_partition_v1','gridex_customer_life_events.inbound_context_object_is_qualified_v1'])await db.exec(fn('20261001023512_ediel_partial_customer_life_event_source_effects.sql',name))
  for(const file of ['20261001025115_ediel_canonical_prodat_source_function_facets.sql','20261001032758_ediel_prodat_source_function_v5_namespace_bridge.sql','20261001032759_ediel_prodat_combined_primary_v5_facets.sql','20261001040236_ediel_prodat_combined_primary_v6_facets.sql'])await db.exec(migration(file))
  const prosrc=(await db.query('SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure($1)',[signature])).rows[0].prosrc
  assert.equal(digest(prosrc),'00c135366cc901cc4dc2ceb14d7a98f7eac34450c30e9dd83154ad96b2bd8cc9')
  const raw="UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+DOC+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735123456789012345:::9'CCI++Z13'CAV+Z22'RFF+LI:OWN-A'RFF+Z05:TES'NAD+UD+199001011234:SE2:260'DTM+92:202610011200:203'UNT+13+M'UNZ+1+I'"
  const register={objectId:'735123456789012345',identityAgency:'9',messageIndex:0,messageReference:'M',registers:[{lineIndex:0,lineNumber:'1',segmentIndex:5}],disposition:'accepted',reasons:[]}
  const facts={owner:'canonical-runtime-with-registry-v1',syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',messageReference:'M',reasonCodes:[],rulePackEvidence:{declaredFiniteRegistryOnly:true,rulePackId:id(80),messageProfileId:id(81),profileKey:'declared-finite-profile',sourceHash:'1'.repeat(64)},registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[register]}}
  const object={version:1,owner:'canonical-full-prodat-object-validation-v1',coverage:'full_canonical_guide_objects_only',sharedAccepted:true,reasonCodes:[],objects:[{objectId:register.objectId,identityAgency:'9',messageReference:'M',firstLineIndex:0,lineItemReference:'OWN-A',disposition:'accepted',reasons:[],negativeFields:[]}]}
  const response={version:1,sourcePayloadHash:digest(raw),objects:[{id:register.objectId,li:'OWN-A',lineIndex:5,outcome:'positive',registerLineIndices:[5]}],responses:[{scope:'object',ercCode:'100',fieldCode:null,text:'Accepted',id:register.objectId,li:'OWN-A',lineIndex:5}]}
  const {disposition:unusedDisposition,reasons:unusedReasons,...ownScope}=register
  const application={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',sourcePayloadHash:digest(raw),headerDecision:'accepted',objects:[{...ownScope,applicationDecision:'accepted',reasonCodes:[]}]}
  void unusedDisposition;void unusedReasons
  await db.query('INSERT INTO companies VALUES($1)',[id(1)])
  await db.query('INSERT INTO public.ediel_rule_packs VALUES($1,$2)',[id(80),'1'.repeat(64)])
  await db.query('INSERT INTO public.ediel_message_profiles VALUES($1,$2,$3)',[id(81),id(80),'declared-finite-profile'])
  await db.query('INSERT INTO public.ediel_rule_pack_sources VALUES($1,$2,$3)',[id(82),id(80),'1'.repeat(64)])
  const insertSource=async(source,bytes,code)=>{
   await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT',$3,$4)",[source,id(1),code,bytes])
   await db.query("INSERT INTO gridex_received_sources.sources(source_message_id,company_id,environment,payload_hash,raw_payload) VALUES($1,$2,'test',$3,$4)",[source,id(1),digest(bytes),bytes])
   await db.query('INSERT INTO legal_context_fixture VALUES($1,$2)',[source,{companyId:id(1)}])
   await db.query('INSERT INTO declared_receipt_custody VALUES($1,$2)',[source,digest(bytes)])
  }
  await insertSource(id(30),raw,'Z04')
  const customerRaw=raw.replace('BGM+Z04','BGM+Z06').replace('CAV+Z22','CAV+E34').replace('DTM+92:','DTM+157:'),customerHash=digest(customerRaw)
  await insertSource(id(31),customerRaw,'Z06');await db.query('INSERT INTO auth.users VALUES($1)',[id(90)])
  const contextFacts={status:'authorized',rawPayload:customerRaw,legalContext:{actorRole:'electricity_supplier',legalEdielId:'12345'},plans:[{object:{point:register.objectId,identityAgency:'9',firstLineIndex:5,lineIndexes:[5]}}]}
  const contextHash=(await db.query("INSERT INTO gridex_customer_life_events.inbound_context_receipts(id,company_id,environment,source_message_id,payload_hash,context_facts,context_facts_hash,actor_user_id) VALUES($1,$2,'test',$3,$4,$5,encode(sha256(convert_to($5::jsonb::text,'UTF8')),'hex'),$6) RETURNING context_facts_hash",[id(91),id(1),id(31),customerHash,contextFacts,id(90)])).rows[0].context_facts_hash
  const functional={version:1,owner:'canonical-prodat-source-function-v1',coverage:'customer_life_event_only',sourcePayloadHash:customerHash,sourceContextReceiptId:id(91),sourceContextFactsHash:contextHash,objects:[{...ownScope,functionalDecision:'accepted',reasonCodes:[]}]}
  const args=[id(1),'test',id(30),digest(raw),JSON.stringify(facts),'[]',JSON.stringify(object),JSON.stringify(response),JSON.stringify(application),null]
  const fullArgs=[id(1),'test',id(31),customerHash,JSON.stringify(facts),'[]',JSON.stringify(object),JSON.stringify({...response,sourcePayloadHash:customerHash}),JSON.stringify({...application,sourcePayloadHash:customerHash}),JSON.stringify(functional)]
  const run=async(input=args)=>(await db.query('SELECT gridex_received_sources.append_prodat_validation_v6($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) x',input)).rows[0].x
  const tables=['gridex_received_sources.validation_assessments','gridex_received_sources.prodat_ignored_field_facets','gridex_received_sources.prodat_object_validation_facets','gridex_received_sources.prodat_response_facets','gridex_received_sources.prodat_application_facets','gridex_received_sources.prodat_source_function_facets','public.ediel_messages','gridex_received_sources.sources','public.declared_receipt_custody','public.legal_context_fixture','gridex_customer_life_events.inbound_context_receipts','public.ediel_outbox','public.customer_supply_periods','public.ediel_rule_packs','public.ediel_message_profiles','public.ediel_rule_pack_sources']
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) x FROM ${name} t`)).rows[0].x])))
  return {db,args,fullArgs,run,snapshot,id,digest,signature,forward}
 }catch(error){await db.close();throw error}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const fixture=await createReplayFixture()
 try{
  if(process.env.EDIEL_EQUIVALENT_REPLAY_PROBE_MODULE)await (await import(pathToFileURL(process.env.EDIEL_EQUIVALENT_REPLAY_PROBE_MODULE).href)).default(fixture)
  else {if(existsSync(forward))await fixture.db.exec(readFileSync(forward,'utf8'));const first=await fixture.run(),before=await fixture.snapshot(),again=await fixture.run();assert.equal(again.assessmentId,first.assessmentId);assert.deepEqual(await fixture.snapshot(),before);console.log(JSON.stringify({status:'PASS',native:'NOT_RUN',concurrency:'NOT_RUN',scope:'equivalent current canonical replay preserves exact receipt and custody'}))}
 }finally{await fixture.db.close()}
}
