/** Explicit synthetic mechanical SQL regression. Qualification helpers below
 * are test-only stubs; this is NOT native/RLS/original-owner/legal acceptance. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
await db.exec(readFileSync(new URL('./fixtures/ediel-z02-core-embedded-schema.sql',import.meta.url),'utf8'))
await db.exec(`CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
CREATE TABLE public.supplier_switch_requests(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,source_message_id uuid,market_state_version bigint);
CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);
ALTER TABLE public.ediel_messages ADD COLUMN message_received_at timestamptz;
CREATE TABLE public.ediel_message_events(company_id uuid,ediel_message_id uuid,message_id uuid,event_type text,event_status text,message text,payload jsonb,event_payload jsonb,created_by uuid);
CREATE TABLE gridex_received_sources.object_assessments(id uuid PRIMARY KEY,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,canonical_assessment_id uuid,previous_assessment_id uuid,facts_text text);
CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA gridex_ediel_source_rules;
CREATE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION gridex_ediel_source_rules.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`)
const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
await db.exec(readFileSync(new URL('../supabase/migrations/20260930193612_ediel_structural_source_atomic_review_apply.sql',import.meta.url),'utf8'))
await db.exec(readFileSync(new URL('../supabase/migrations/20260930205032_ediel_structural_owner_preflight.sql',import.meta.url),'utf8'))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),customer=id(3),site=id(4),point=id(5),source=id(6),canonical=id(7),owner=id(8)
await db.query('INSERT INTO public.companies VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query('INSERT INTO public.customer_sites(id,company_id,customer_id) VALUES($1,$2,$3)',[site,company,customer])
await db.query("INSERT INTO public.metering_points(id,company_id,customer_id,site_id,meter_point_id,reading_frequency) VALUES($1,$2,$3,$4,'735123456789012345','quarter_hourly')",[point,company,customer,site])
const segments=["UNB+UNOC:3+54321:14+12345:14+261002:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z06+DOC+9","NAD+FR+54321:160:SVK+++++++SE","NAD+DO+12345:160:SVK+++++++SE","LIN+1++735123456789012345:::9+1:1","RFF+LI:OWN-A","DTM+157:202610010000:203","CCI++Z13","CAV+E64","RFF+MG:NEW?+METER","CCI++Z16","CAV+:::HT","LIN+2++735123456789012345:::9+1:2","CCI++Z16","CAV+:::LT","LIN+3++735123456789012346:::9+1:1","RFF+LI:OWN-B","DTM+157:202610010000:203","UNT+17+M","UNZ+1+I"]
const raw=segments.join("'")+"'",tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) AS tokens',[raw])).rows[0].tokens
const registers=tokens.filter(t=>t.tag==='LIN').slice(0,2).map((t,index)=>({lineIndex:index,lineNumber:String(index+1),registerIndex:String(index+1),registerPosition:index+1,segmentIndex:t.index}))
const badLin=tokens.filter(t=>t.tag==='LIN')[2]
const badObject={messageIndex:0,messageReference:'M',objectId:'735123456789012346',identityAgency:'9',registers:[{lineIndex:2,lineNumber:'3',registerIndex:'1',registerPosition:1,segmentIndex:badLin.index}]}
const object={messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers}
const wire={object,messageCode:'Z06',businessCase:'change_with_reading',effectiveFrom:{fieldNumber:'216',marketMinute:'202610010000',utc:'2026-09-30T23:00:00Z'},meterNumber:'NEW+METER',oldMeterNumber:null,registers:[{position:1,registerId:'HT'},{position:2,registerId:'LT'}]}
const period=id(10)
const sourceHash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[raw])).rows[0].hash
const business={sourceMessageId:source,sourcePayloadHash:sourceHash,owner:'reviewed-received-structure-v1',companyId:company,environment:'test',supplyPeriodId:period,meteringPointId:point,siteId:site,customerId:customer,wire}
const entry={object,disposition:'accepted',reasons:[],party:{syntheticUnqualified:true},business}
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at,parsed_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3,'2026-10-02T11:00:00Z',$4)",[source,company,raw,{customerId:'FOREIGN',readingFrequency:'hourly',proposedChanges:[{entityId:id(99),proposedValue:'EVIL'}]}])
await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test','Z06','2026-10-02T11:00:00Z',$3,encode(sha256(convert_to($3,'UTF8')),'hex'))",[source,company,raw])
await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,source_message_id,company_id,environment,payload_hash,$2,NULL FROM gridex_received_sources.sources WHERE source_message_id=$3",[canonical,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted'}),source])
await db.query("INSERT INTO gridex_received_sources.object_assessments SELECT $1,source_message_id,company_id,environment,payload_hash,$2,NULL,$3 FROM gridex_received_sources.sources WHERE source_message_id=$4",[owner,canonical,JSON.stringify({objects:[entry,{object:badObject,disposition:'rejected',reasons:['own_application_rejected'],business:null,party:null}]}),source])
// Qualification ports are explicitly synthetic; the actual canonical V4 helper
// is separately covered by outbound-owner SQL regression. This harness composes
// real decoder, source lock/preflight, effects and immutable batch/object SQL.
await db.exec(`CREATE TABLE public.synthetic_application(company_id uuid,source_id uuid,canonical_id uuid,object_scope jsonb,accepted boolean);
CREATE FUNCTION gridex_received_sources.require_prodat_application_objects_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('assessmentId',v.id,'headerDecision','accepted') FROM gridex_received_sources.validation_assessments v WHERE v.company_id=c AND v.source_message_id=source_id$$;
CREATE FUNCTION gridex_received_sources.prodat_application_object_accepted_v1(c uuid,source_id uuid,canonical_id uuid,object_scope jsonb) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT a.accepted FROM public.synthetic_application a WHERE a.company_id=$1 AND a.source_id=$2 AND a.canonical_id=$3 AND a.object_scope=$4),false)$$;
-- Exact real pre-existing gate witness allows the forward replacement to be
-- exercised. Owner/party acceptance is NOT proven by this mechanical stub.
CREATE FUNCTION gridex_received_sources.append_object_assessment(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_canonical_assessment_id uuid,p_facts_text text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE register_fact jsonb;original jsonb;src gridex_received_sources.sources%rowtype;canonical gridex_received_sources.validation_assessments%rowtype;scope jsonb;
BEGIN IF register_fact->>'disposition' IS DISTINCT FROM 'accepted' OR original->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR original->>'applicationDecision' IS DISTINCT FROM 'accepted' OR original->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'synthetic_unqualified';END IF;RETURN '{}';END$fn$;`)
await db.query('INSERT INTO public.synthetic_application VALUES($1,$2,$3,$4,true),($1,$2,$3,$5,false)',[company,source,canonical,object,badObject])
await db.exec(`ALTER TABLE gridex_received_sources.object_assessments ADD COLUMN facts_hash text;
UPDATE gridex_received_sources.object_assessments SET facts_hash=encode(sha256(convert_to(facts_text,'UTF8')),'hex');
CREATE TABLE gridex_received_sources.prodat_ignored_field_facets(canonical_assessment_id uuid,company_id uuid,source_message_id uuid,environment text,source_payload_hash text,fields_hash text,fields_text text);
CREATE SCHEMA gridex_method_expectations;
CREATE TABLE public.synthetic_method_observations(source_id uuid,own_count integer);
CREATE FUNCTION gridex_method_expectations.reconcile_v1(expected uuid,source_filter uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE src record;b record;BEGIN
 FOR src IN SELECT r.source_message_id FROM gridex_received_sources.structural_apply_receipts r
  WHERE r.company_id=b.company_id AND r.environment=b.environment AND (source_filter IS NULL OR r.source_message_id=source_filter) ORDER BY r.applied_at,r.source_message_id LOOP
 NULL;END LOOP;END$fn$;
CREATE FUNCTION gridex_method_expectations.applied_source_v1() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.synthetic_method_observations SELECT NEW.source_message_id,count(*) FROM gridex_received_sources.structural_object_apply_receipts r WHERE r.source_message_id=NEW.source_message_id;RETURN NEW;END$$;`)
await db.exec(readFileSync(new URL('../supabase/migrations/20261001011232_ediel_partial_prodat_structural_owner_effects.sql',import.meta.url),'utf8'))
// Original guide/checker, source-rule and canonical-reader boundaries are
// explicit fixtures. The actual final materializer/binding/read helper SQL is
// exercised against real 011232 immutable primary effects and raw source hash.
const publication=readFileSync(new URL('../supabase/migrations/20260930222834_ediel_registered_original_native_response_guides.sql',import.meta.url),'utf8')
const edition=JSON.parse(publication.match(/FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)[1].replaceAll("''","'"))
await db.exec(`ALTER TABLE public.ediel_messages ADD COLUMN execution_context_snapshot jsonb,ADD COLUMN related_message_id uuid;
CREATE SCHEMA gridex_ediel_ack_guide;CREATE SCHEMA gridex_ediel_outbound_owner;
CREATE TABLE gridex_ediel_ack_guide.source_bindings(source_message_id uuid,kind text,company_id uuid,environment text,payload_sha256 text,source_version text);
CREATE TABLE gridex_ediel_ack_guide.synthetic_editions(source_version text,projection jsonb);
CREATE FUNCTION gridex_ediel_ack_guide.projection_for_original_v1(v text) RETURNS jsonb LANGUAGE sql AS $$SELECT projection FROM gridex_ediel_ack_guide.synthetic_editions WHERE source_version=$1$$;
CREATE TABLE gridex_ediel_outbound_owner.witnesses(id uuid PRIMARY KEY,company_id uuid,environment text,related_message_id uuid,payload_sha256 text);
CREATE TABLE gridex_ediel_outbound_owner.consumptions(witness_id uuid,source_message_id uuid);
CREATE TABLE gridex_received_sources.prodat_response_facets(assessment_id uuid PRIMARY KEY,response_facts_text text,response_facts_hash text);
CREATE FUNCTION gridex_received_sources.read_prodat_response_assessment_v1(c uuid,source_id uuid,a uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT response_facts_text::jsonb||jsonb_build_object('assessmentId',assessment_id) FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=$3$$;
CREATE FUNCTION gridex_received_sources.require_prodat_responses_v1(c uuid,source_id uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_received_sources.read_prodat_response_assessment_v1($1,$2,(SELECT id FROM gridex_received_sources.validation_assessments WHERE source_message_id=$2))$$;
CREATE TABLE gridex_ediel_ack_guide.prodat_response_owner_bindings(witness_id uuid,assessment_id uuid,source_message_id uuid,company_id uuid,environment text,ack_hash text,facet_hash text);
CREATE FUNCTION gridex_ediel_ack_guide.bound_prodat_response_v1(m public.ediel_messages,s public.ediel_messages) RETURNS jsonb LANGUAGE sql AS $$SELECT gridex_received_sources.require_prodat_responses_v1(m.company_id,s.id)$$;
-- The prepare/parser boundary below deliberately accepts fixture raw positive
-- A only. It does NOT prove national guide, scope reservation or ACK codec.
CREATE FUNCTION gridex_ediel_ack_guide.prodat_wire_responses_v1(raw text,objects jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_array(jsonb_build_object('lineIndex',objects#>'{0,lineIndex}','ercCode','100'))$$;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(i jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE facet jsonb;result jsonb;source public.ediel_messages%rowtype;f gridex_received_sources.prodat_response_facets%rowtype;w gridex_ediel_outbound_owner.witnesses%rowtype;draft public.ediel_messages%rowtype;before_seal jsonb;
BEGIN SELECT * INTO source FROM public.ediel_messages WHERE id=(i->>'relatedMessageId')::uuid;
 facet:=gridex_received_sources.require_prodat_responses_v1(source.company_id,source.id);
 draft.company_id:=source.company_id;draft.environment:=source.environment;draft.raw_payload:=i->>'rawPayload';draft.related_message_id:=source.id;
 before_seal:=gridex_ediel_ack_guide.bound_prodat_response_v1(draft,source);
 IF before_seal#>>'{objects,0,outcome}' IS DISTINCT FROM 'positive' THEN RAISE EXCEPTION 'synthetic_native_checker_requires_actual_final_scope_before_seal';END IF;
 INSERT INTO gridex_ediel_outbound_owner.witnesses VALUES((i->>'witnessId')::uuid,source.company_id,source.environment,source.id,encode(sha256(convert_to(i->>'rawPayload','UTF8')),'hex'));
 SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=(facet->>'assessmentId')::uuid;
 SELECT * INTO w FROM gridex_ediel_outbound_owner.witnesses WHERE id=(i->>'witnessId')::uuid;
 INSERT INTO gridex_ediel_ack_guide.prodat_response_owner_bindings VALUES(w.id,f.assessment_id,source.id,w.company_id,w.environment,w.payload_sha256,f.response_facts_hash);
 RETURN jsonb_build_object('witnessId',w.id);END $fn$;`)
await db.query('INSERT INTO gridex_ediel_ack_guide.synthetic_editions VALUES($1,$2)',[edition.sourceVersion,edition.projection])
await db.query("INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES($1,'national',$2,'test',$3,$4)",[source,company,sourceHash,edition.sourceVersion])
const facet={version:1,sourcePayloadHash:sourceHash,objects:[{lineIndex:registers[0].segmentIndex,registerLineIndices:registers.map(reg=>reg.segmentIndex),id:object.objectId,li:'OWN-A',outcome:'held'},{lineIndex:badLin.index,registerLineIndices:[badLin.index],id:badObject.objectId,li:'OWN-B',outcome:'negative'}],responses:[{scope:'object',lineIndex:badLin.index,ercCode:'41',fieldCode:'217',text:'Mätmetod saknas',id:badObject.objectId,li:'OWN-B'}]}
await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,encode(sha256(convert_to($2,'UTF8')),'hex'))",[canonical,JSON.stringify(facet)])
await db.exec(readFileSync(new URL('../supabase/migrations/20261001013700_ediel_prodat_structural_final_response_receipts.sql',import.meta.url),'utf8'))
let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++},rejects=async(p,e)=>{await assert.rejects(p,e);checks++}
const read=async(indices=null,c=company)=>(await db.query('SELECT public.ediel_read_prodat_structural_final_response_v1($1,$2,$3) AS result',[c,source,indices])).rows[0].result
await db.exec('SET ROLE service_role;');check(await read(),null)
await rejects(read([registers[0].segmentIndex]),/own_effect_unavailable/)
await db.exec(`RESET ROLE;CREATE OR REPLACE FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;SET ROLE service_role;`)
await db.query('SELECT public.ediel_apply_reviewed_structure_objects_v2($1,$2,$3,NULL)',[company,source,actor])
const plan=await read();check(plan.sourceMessage.raw_payload,raw);check(plan.responseFacet.effectScopes.length,1)
check(plan.responseFacet.objects[0].outcome,'positive');check(plan.responseFacet.objects[1].outcome,'negative')
check(plan.responseFacet.responses.find(e=>e.lineIndex===badLin.index),facet.responses[0])
const positive=plan.responseFacet.responses.find(e=>e.lineIndex===registers[0].segmentIndex)
check(positive,{scope:'object',lineIndex:registers[0].segmentIndex,ercCode:'100',fieldCode:null,text:edition.projection.constraints.common.positiveText,id:object.objectId,li:'OWN-A'})
await rejects(read([badLin.index]),/own_effect_unavailable/);await rejects(read([registers[0].segmentIndex,registers[0].segmentIndex]),/scope_required/)
await rejects(read([registers[1].segmentIndex]),/own_effect_unavailable/);await rejects(read(null,id(99)),/source_required/)
const witness=id(40),ackId=id(41),ackRaw="SYNTHETIC-OWN-A"
await db.exec('RESET ROLE;')
const prepared=(await db.query('SELECT gridex_ediel_outbound_owner.prepare_v1($1) AS result',[{witnessId:witness,relatedMessageId:source,rawPayload:ackRaw}])).rows[0].result
check(prepared.witnessId,witness)
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,execution_context_snapshot) VALUES($1,$2,'test','outbound','edifact','APERAK','APERAK',$3,$4)",[ackId,company,ackRaw,{outboundOwnerWitnessId:witness}])
const bound=async()=>(await db.query('SELECT gridex_ediel_ack_guide.bound_prodat_response_v1(m,s) AS facet FROM public.ediel_messages m,public.ediel_messages s WHERE m.id=$1 AND s.id=$2',[ackId,source])).rows[0].facet
check((await bound()).responses,plan.responseFacet.responses)
await rejects(db.exec("UPDATE gridex_ediel_ack_guide.prodat_structural_response_bindings SET facet_text='{}'"),/received_source_evidence_is_append_only/)
// No lookup of today's canonical leaf or mutable ACK hints may relabel this.
await db.query('UPDATE gridex_received_sources.prodat_response_facets SET response_facts_text=$1 WHERE assessment_id=$2',[JSON.stringify({...facet,responses:[]}),canonical])
check((await bound()).responses,plan.responseFacet.responses)
await db.query('INSERT INTO gridex_ediel_outbound_owner.consumptions VALUES($1,$2)',[witness,ackId])
await db.query("UPDATE public.ediel_messages SET execution_context_snapshot='{}' WHERE id=$1",[ackId])
check((await bound()).responses,plan.responseFacet.responses)
await db.query("UPDATE public.ediel_messages SET raw_payload='EVIL' WHERE id=$1",[ackId]);await rejects(bound(),/frozen_binding_changed/)
await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',[ackRaw,ackId])
await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'EVIL' WHERE id=$1",[source])
await rejects(bound(),/frozen_binding_changed/);await db.exec('SET ROLE service_role;');await rejects(read(),/original_guide_unavailable/);await db.exec('RESET ROLE;')
check((await db.query("SELECT has_function_privilege('authenticated','public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[])','EXECUTE') AS allowed")).rows[0].allowed,false)
check((await db.query("SELECT has_table_privilege('service_role','gridex_ediel_ack_guide.prodat_structural_response_bindings','SELECT') AS allowed")).rows[0].allowed,false)
await db.close();console.log(`PASS ${checks}: focused actual own effect→final positive/native immutable binding; guide/reader/prepare boundary fixtures explicit. Native/replay/full original acceptance NOT RUN.`)
