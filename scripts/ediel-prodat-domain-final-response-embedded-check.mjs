/** Focused domain-final receipt mechanics. C/R business authorization, canonical
 * owner and prepare IO are explicit synthetic boundaries. Actual inherited wire
 * lexer/scoping and this forward are exercised; NOT native/RLS/replay/legal proof. */
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
 IF EXISTS(SELECT FROM jsonb_array_elements(gridex_ediel_ack_guide.prodat_wire_responses_v1(draft.raw_payload,before_seal->'objects'))q_wire(value)
  WHERE q_wire.value->>'ercCode'='100' AND NOT EXISTS(SELECT FROM jsonb_array_elements(before_seal->'objects')q_own(value) WHERE q_own.value->'lineIndex'=q_wire.value->'lineIndex' AND q_own.value->>'outcome'='positive'))
  THEN RAISE EXCEPTION 'synthetic_native_checker_requires_actual_final_scope_before_seal';END IF;
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

// Supply/permission getters below are explicit contractual fixtures. Their real
// native first-effect owners have separate regression packages; these cannot
// prove a signed contract, grant, RLS or actual canonical field authorization.
await db.exec(`CREATE TABLE gridex_received_sources.customer_primary_response_receipts(source_message_id uuid,first_line_index integer);
CREATE TABLE public.synthetic_domain_effects(company_id uuid,source_message_id uuid,effect jsonb);
CREATE FUNCTION gridex_received_sources.committed_supply_effects_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 -- The real supply owner returns NULL for an unproved legacy partition.
 SELECT jsonb_agg(e.effect ORDER BY(e.effect#>>'{objectScope,registers,0,segmentIndex}')::integer) FROM public.synthetic_domain_effects e
 WHERE e.company_id=$1 AND e.source_message_id=$2 AND e.effect->>'effectKind'='supply'
 AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
 AND($3 IS NULL OR(e.effect#>>'{objectScope,registers,0,segmentIndex}')::integer=ANY($3))$$;
CREATE FUNCTION gridex_received_sources.committed_permission_effects_v1(c uuid,source_id uuid,requested integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT coalesce(jsonb_agg(e.effect ORDER BY(e.effect#>>'{objectScope,registers,0,segmentIndex}')::integer),'[]') FROM public.synthetic_domain_effects e
 WHERE e.company_id=$1 AND e.source_message_id=$2 AND e.effect->>'effectKind'='metering_permission'
 AND e.xmin::text::numeric<>mod(pg_current_xact_id()::text::numeric,4294967296)
 AND($3 IS NULL OR(e.effect#>>'{objectScope,registers,0,segmentIndex}')::integer=ANY($3))$$;
CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ack_authority;`)
const lexical=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
await db.exec(lexical.slice(lexical.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),lexical.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
const ackAuthority=readFileSync(new URL('../supabase/migrations/20260930170932_ediel_inbound_ack_source_atomic_authority.sql',import.meta.url),'utf8')
await db.exec(ackAuthority.slice(ackAuthority.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ackAuthority.indexOf('CREATE FUNCTION gridex_ack_authority.source_match_v1')))
const planned=readFileSync(new URL('../supabase/migrations/20260930235457_ediel_native_prodat_planned_response_authority.sql',import.meta.url),'utf8')
const physical=planned.slice(planned.indexOf('CREATE FUNCTION gridex_ediel_ack_guide.prodat_wire_responses_v1'),planned.indexOf('CREATE FUNCTION gridex_ediel_ack_guide.validate_response_for_message_v1')).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
await db.exec(physical)
// Apply the real previous prepare/bound branch extensions. Customer-only
// business receipt/capture is outside this focused domain-forward boundary.
const customerExtension=readFileSync(new URL('../supabase/migrations/20261001022101_ediel_prodat_customer_primary_final_responses.sql',import.meta.url),'utf8')
await db.exec(customerExtension.slice(customerExtension.indexOf('DO $$DECLARE body text;signature regprocedure;'),customerExtension.indexOf('REVOKE ALL ON FUNCTION')))
await db.exec(readFileSync(new URL('../supabase/migrations/20261001043602_ediel_committed_domain_prodat_final_responses.sql',import.meta.url),'utf8'))
let checks=0
const check=(a,b)=>{assert.deepEqual(a,b);checks++},rejects=async(p,e)=>{await assert.rejects(p,e);checks++}
const sha=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS h",[text])).rows[0].h
function ack(ownRef='OWN-A',erc='100',objectId='735123456789012345'){
 const body=['UNH+ACK+APERAK:D:96A:UN:E2SE6A','BGM+++34','DTM+137:202610021200:203','RFF+ACW:DOC',
  'NAD+FR+12345:160:SVK+++++++SE','NAD+DO+54321:160:SVK+++++++SE',`ERC+${erc}`,`FTX+AAP+++${erc==='100'?edition.projection.constraints.common.positiveText:'Mätmetod saknas'}`,
  `RFF+LI:${ownRef}`,`RFF+Z07:${objectId}`]
 return ['UNB+UNOC:3+12345:14+54321:14+261002:1200+ACK++23-DDQ-PRODAT++++1',...body,`UNT+${body.length+1}+ACK`,'UNZ+1+ACK'].join("'")+"'"
}
async function domain(code,n,{nationalPositiveSibling=false}={}){
 const sourceId=id(n),assessment=id(n+1),domainRaw=raw.replace('BGM+Z06','BGM+'+code),hash=await sha(domainRaw)
 await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at) VALUES($1,$2,'test','inbound','edifact','PRODAT',$3,$4,'2026-10-02T11:00:00Z')",[sourceId,company,code,domainRaw])
 await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,'2026-10-02T11:00:00Z',$4,$5)",[sourceId,company,code,domainRaw,hash])
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,'test',$4,$5,NULL)",[assessment,sourceId,company,hash,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted'})])
 const initial={...facet,sourcePayloadHash:hash,objects:facet.objects.map((o,i)=>({...o,outcome:nationalPositiveSibling&&i===1?'positive':o.outcome})),responses:nationalPositiveSibling?[{...facet.responses[0],ercCode:'100',fieldCode:null,text:edition.projection.constraints.common.positiveText}]:facet.responses}
 await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,encode(sha256(convert_to($2,'UTF8')),'hex'))",[assessment,JSON.stringify(initial)])
 await db.query("INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES($1,'national',$2,'test',$3,$4)",[sourceId,company,hash,edition.sourceVersion])
 const effect={receiptId:id(n+2),canonicalAssessmentId:assessment,sourcePayloadHash:hash,objectScope:object,appliedAt:'2026-10-02T11:01:00Z',effectKind:['Z04','Z05'].includes(code)?'supply':'metering_permission',effectFactsHash:'a'.repeat(64)}
 return {sourceId,assessment,hash,initial,effect,code,raw:domainRaw}
}
const read=async(d,indices=null,c=company)=>{await db.exec('SET ROLE service_role;');try{return(await db.query('SELECT public.ediel_read_prodat_structural_final_response_v1($1,$2,$3) AS p',[c,d.sourceId,indices])).rows[0].p}finally{await db.exec('RESET ROLE;')}}
const put=async(d,effect=d.effect,c=company)=>db.query('INSERT INTO public.synthetic_domain_effects VALUES($1,$2,$3)',[c,d.sourceId,effect])
const d=await domain('Z04',100)
await db.exec('SET ROLE service_role;')
check(await read(d),null);await rejects(read(d,[object.registers[0].segmentIndex]),/own_effect_unavailable/)
await db.exec('RESET ROLE;')
check((await db.query('SELECT gridex_ediel_outbound_owner.prepare_v1($1) AS p',[{companyId:company,environment:'test',relatedMessageId:d.sourceId,witnessId:id(129),rawPayload:ack('OWN-B','41','735123456789012346')}])).rows[0].p.witnessId,id(129))
await db.query('DELETE FROM gridex_ediel_outbound_owner.witnesses WHERE id=$1',[id(129)])
await rejects(db.query('SELECT gridex_ediel_outbound_owner.prepare_v1($1)',[{companyId:company,environment:'test',relatedMessageId:d.sourceId,witnessId:id(130),rawPayload:ack()}]),/own_effect_unavailable/)
check((await db.query('SELECT count(*)::integer AS n FROM gridex_ediel_outbound_owner.witnesses')).rows[0].n,0)
await db.exec('BEGIN;');await put(d);await rejects(db.query('SELECT gridex_received_sources.prodat_structural_response_v1($1,$2,$3)',[company,d.sourceId,[object.registers[0].segmentIndex]]),/own_effect_unavailable/);await db.exec('ROLLBACK;')
await put(d)
const result=await read(d)
check(result.responseFacet.objects.map(o=>o.outcome),['positive','negative'])
check(result.responseFacet.effectScopes[0],{lineIndex:object.registers[0].segmentIndex,canonicalAssessmentId:d.assessment,objectAssessmentId:null,effectReceiptId:d.effect.receiptId,effectFactsHash:d.effect.effectFactsHash,appliedAt:d.effect.appliedAt,effectKind:'supply'})
check(result.responseFacet.responses.find(r=>r.lineIndex===badLin.index),d.initial.responses[0])
await rejects(read(d,[badLin.index]),/own_effect_unavailable/)
await rejects(read(d,[object.registers[1].segmentIndex]),/own_effect_unavailable/)
await rejects(read(d,[object.registers[0].segmentIndex,object.registers[0].segmentIndex]),/scope_required/)
await rejects(read(d,null,id(999)),/source_required/)
const witness=id(131),ackId=id(132)
check((await db.query('SELECT gridex_ediel_outbound_owner.prepare_v1($1) AS p',[{companyId:company,environment:'test',relatedMessageId:d.sourceId,witnessId:witness,rawPayload:ack()}])).rows[0].p.witnessId,witness)
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,related_message_id,execution_context_snapshot) VALUES($1,$2,'test','outbound','edifact','APERAK','APERAK',$3,$4,$5)",[ackId,company,ack(),d.sourceId,{outboundOwnerWitnessId:witness}])
const bound=async()=>(await db.query('SELECT gridex_ediel_ack_guide.bound_prodat_response_v1(m,s) AS p FROM public.ediel_messages m,public.ediel_messages s WHERE m.id=$1 AND s.id=$2',[ackId,d.sourceId])).rows[0].p
check((await bound()).effectScopes[0].effectReceiptId,d.effect.receiptId)
await db.query('DELETE FROM public.synthetic_domain_effects WHERE source_message_id=$1',[d.sourceId])
check((await bound()).responses,result.responseFacet.responses)
check((await db.query('SELECT count(*)::integer AS n FROM gridex_ediel_ack_guide.prodat_structural_response_bindings WHERE witness_id=$1',[witness])).rows[0].n,1)
await rejects(db.exec("UPDATE gridex_ediel_ack_guide.prodat_structural_response_bindings SET facet_text='{}'"),/append_only/)
// A pending older seal without a born ACK cannot manufacture a first positive.
const missing=await domain('Z05',200),pending=id(230)
await db.query('INSERT INTO gridex_ediel_outbound_owner.witnesses VALUES($1,$2,$3,$4,$5)',[pending,company,'test',missing.sourceId,await sha(ack())])
await rejects(db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,related_message_id,execution_context_snapshot) VALUES($1,$2,'test','outbound','edifact','APERAK','APERAK',$3,$4,$5)",[id(231),company,ack(),missing.sourceId,{outboundOwnerWitnessId:pending}]),/own_effect_unavailable/)
check((await db.query('SELECT count(*)::integer AS n FROM public.ediel_messages WHERE id=$1',[id(231)])).rows[0].n,0)
// Different domain kinds and unsupported own source facts cannot borrow receipts.
for(const [code,n]of [['Z05',300],['Z14',400],['Z15',500]]){
 const next=await domain(code,n);await put(next);const positive=await read(next)
 check(positive.responseFacet.effectScopes[0].effectKind,next.effect.effectKind)
 check(positive.responseFacet.objects.map(o=>o.outcome),['positive','negative'])
}
const normal=await domain('Z04',600,{nationalPositiveSibling:true});await put(normal)
const projected=await read(normal);check(projected.responseFacet.objects.map(o=>o.outcome),['positive','held'])
check(projected.responseFacet.responses.map(r=>r.li),['OWN-A'])
await rejects(read(normal,[badLin.index]),/own_effect_unavailable/)
for(const [n,mutation]of [
 [700,e=>({...e,sourcePayloadHash:'b'.repeat(64)})],[800,e=>({...e,effectFactsHash:null})],
 [900,e=>({...e,objectScope:{...e.objectScope,objectId:badObject.objectId}})],
 [1000,e=>({...e,objectScope:{...e.objectScope,registers:[e.objectScope.registers[1]]}})],
 [1100,e=>({...e,canonicalAssessmentId:id(9999)})],
]){
 const wrong=await domain('Z04',n);await put(wrong,mutation(wrong.effect));await rejects(read(wrong),/own_(effect|plan)_unavailable/)
}
check((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.prodat_structural_response_v1(uuid,uuid,integer[])','EXECUTE') AS allowed")).rows[0].allowed,false)
check((await db.query("SELECT has_function_privilege('authenticated','public.ediel_read_prodat_structural_final_response_v1(uuid,uuid,integer[])','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close();console.log(`PASS ${checks}: domain final-receipt materialization/native birth/frozen binding mechanics; C/R source/business/canonical qualification and prepare IO explicitly synthetic. Native/RLS/concurrency/clean replay/legal originals NOT RUN.`)
