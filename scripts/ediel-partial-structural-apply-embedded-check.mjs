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
const segments=["UNB+UNOC:3+54321:14+12345:14+261002:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z06+DOC+9","NAD+FR+54321:160:SVK+++++++SE","NAD+DO+12345:160:SVK+++++++SE","LIN+1++735123456789012345:::9+1:1","DTM+157:202610010000:203","CCI++Z13","CAV+E64","RFF+MG:NEW?+METER","CCI++Z16","CAV+:::HT","LIN+2++735123456789012345:::9+1:2","CCI++Z16","CAV+:::LT","LIN+3++735123456789012346:::9+1:1","DTM+157:202610010000:203","UNT+17+M","UNZ+1+I"]
const raw=segments.join("'")+"'",tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) AS tokens',[raw])).rows[0].tokens
const registers=tokens.filter(t=>t.tag==='LIN').slice(0,2).map((t,index)=>({lineIndex:index,lineNumber:String(index+1),registerIndex:String(index+1),registerPosition:index+1,segmentIndex:t.index}))
const badLin=tokens.filter(t=>t.tag==='LIN')[2]
const badObject={messageIndex:0,messageReference:'M',objectId:'735123456789012346',identityAgency:'9',registers:[{lineIndex:2,lineNumber:'3',registerIndex:'1',registerPosition:1,segmentIndex:badLin.index}]}
const object={messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers}
const wire={object,messageCode:'Z06',businessCase:'change_with_reading',effectiveFrom:{fieldNumber:'216',marketMinute:'202610010000',utc:'2026-09-30T23:00:00Z'},meterNumber:'NEW+METER',oldMeterNumber:null,registers:[{position:1,registerId:'HT'},{position:2,registerId:'LT'}]}
const period=id(10)
const business={owner:'reviewed-received-structure-v1',companyId:company,environment:'test',supplyPeriodId:period,meteringPointId:point,siteId:site,customerId:customer,wire}
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
let checks=0
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++}
const rejects=async(promise,pattern)=>{await assert.rejects(promise,pattern);checks++}
const apply=async(indices=null,c=company)=>(await db.query('SELECT public.ediel_apply_reviewed_structure_objects_v2($1,$2,$3,$4) AS result',[c,source,actor,indices])).rows[0].result
const ownCount=async()=> (await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_object_apply_receipts')).rows[0].n
await db.exec('SET ROLE service_role;')
await rejects(apply([badLin.index]),/requested_object_not_qualified/)
await rejects(apply([999]),/requested_scope_invalid/)
await rejects(apply([registers[0].segmentIndex,registers[0].segmentIndex]),/requested_scope_invalid/)
await rejects(apply([null]),/requested_scope_invalid/)
await rejects(apply(),/original_review_required/)
await db.exec('RESET ROLE;');check(await ownCount(),0)
await db.exec(`CREATE OR REPLACE FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION public.fail_structural_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_late_event_failure';END$$;
CREATE TRIGGER fail_structural_event BEFORE INSERT ON public.ediel_message_events FOR EACH ROW EXECUTE FUNCTION public.fail_structural_event();SET ROLE service_role;`)
await rejects(apply(),/synthetic_late_event_failure/)
await db.exec('RESET ROLE;');check(await ownCount(),0)
check((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_apply_batches')).rows[0].n,0)
await db.exec('DROP TRIGGER fail_structural_event ON public.ediel_message_events;SET ROLE service_role;')
const result=await apply();check(result.applied,true);check(result.appliedCount,2);check(result.skippedCount,1)
check(result.objects.length,1);check(result.objects[0].object,object)
check(result.objects[0].sourceRegisters[0].tokens.find(t=>t.tag==='RFF').elements[1][1],'NEW+METER')
check(result.objects[0].sourceRegisters[1].tokens.find(t=>t.tag==='CAV').elements[1][3],'LT')
check(result.objects[0].effectiveAt,'2026-09-30T23:00:00+00:00');check(result.objects[0].sourceReceivedAt,'2026-10-02T11:00:00+00:00')
check(result.manifest.find(e=>e.object.objectId===badObject.objectId).status,'rejected')
check(result.objects[0].readingFollowUp.fulfilled,false)
await db.exec('RESET ROLE;');check(await ownCount(),1)
check((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_apply_receipts')).rows[0].n,0)
check((await db.query('SELECT reading_frequency FROM public.metering_points WHERE id=$1',[point])).rows[0].reading_frequency,'quarter_hourly')
check((await db.query('SELECT own_count FROM public.synthetic_method_observations')).rows[0].own_count,1)
const matches=async(own=object.objectId,at='2100-01-01T00:00:00Z')=>(await db.query("SELECT gridex_received_sources.structural_effect_matches_v1($1,'test',$2,$3,$4,$5,$6,$7,$8,'9',$9) AS matches",[company,source,owner,customer,site,point,period,own,at])).rows[0].matches
check(await matches(),true);check(await matches(badObject.objectId),false);check(await matches(object.objectId,'2000-01-01T00:00:00Z'),false)
await rejects(db.exec("UPDATE gridex_received_sources.structural_object_apply_receipts SET effect='{}'"),/received_source_evidence_is_append_only/)
await rejects(db.exec('DELETE FROM gridex_received_sources.structural_apply_batches'),/received_source_evidence_is_append_only/)
await rejects(db.exec('TRUNCATE gridex_received_sources.structural_object_apply_receipts'),/received_source_evidence_is_append_only/)
check((await db.query("SELECT has_table_privilege('service_role','gridex_received_sources.structural_object_apply_receipts','SELECT') AS allowed")).rows[0].allowed,false)
check((await db.query("SELECT has_function_privilege('authenticated','public.ediel_apply_reviewed_structure_objects_v2(uuid,uuid,uuid,integer[])','EXECUTE') AS allowed")).rows[0].allowed,false)
// Two selected owners: a later invalid genuine proof must roll back the
// earlier own effect and its source observation, not return a partial success.
const source2=id(21),canonical2=id(22),owner2=id(23),point2=id(20)
await db.query("INSERT INTO public.metering_points(id,company_id,customer_id,site_id,meter_point_id,reading_frequency) VALUES($1,$2,$3,$4,'735123456789012346','quarter_hourly')",[point2,company,customer,site])
await db.query('INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at) SELECT $1,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at FROM public.ediel_messages WHERE id=$2',[source2,source])
await db.query('INSERT INTO gridex_received_sources.sources SELECT $1,company_id,environment,message_code,source_received_at,raw_payload,payload_hash FROM gridex_received_sources.sources WHERE source_message_id=$2',[source2,source])
await db.query('INSERT INTO gridex_received_sources.validation_assessments SELECT $1,$2,company_id,environment,source_payload_hash,facts_text,NULL FROM gridex_received_sources.validation_assessments WHERE id=$3',[canonical2,source2,canonical])
const wire2={...wire,object:badObject},entry2={...entry,object:badObject,business:{...business,meteringPointId:point2,wire:wire2}}
const facts2=JSON.stringify({objects:[entry,entry2]})
await db.query("INSERT INTO gridex_received_sources.object_assessments SELECT $1,$2,company_id,environment,source_payload_hash,$3,NULL,$4,encode(sha256(convert_to($4,'UTF8')),'hex') FROM gridex_received_sources.object_assessments WHERE id=$5",[owner2,source2,canonical2,facts2,owner])
await db.query('INSERT INTO public.synthetic_application VALUES($1,$2,$3,$4,true),($1,$2,$3,$5,true)',[company,source2,canonical2,object,badObject])
await db.exec(`CREATE OR REPLACE FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $2->>'meteringPointId'<>'${point2}'$$;SET ROLE service_role;`)
await rejects(db.query('SELECT public.ediel_apply_reviewed_structure_objects_v2($1,$2,$3,NULL)',[company,source2,actor]),/structural_apply_original_review_required/)
await db.exec('RESET ROLE;')
check((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_object_apply_receipts WHERE source_message_id=$1',[source2])).rows[0].n,0)
check((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_apply_batches WHERE source_message_id=$1',[source2])).rows[0].n,0)
check((await db.query('SELECT count(*)::int AS n FROM public.synthetic_method_observations WHERE source_id=$1',[source2])).rows[0].n,0)
// Exact established batch is immutable after later source/identity decisions.
await db.query('UPDATE gridex_received_sources.validation_assessments SET facts_text=$1 WHERE id=$2',[JSON.stringify({syntaxDecision:'rejected'}),canonical])
await db.exec(`CREATE OR REPLACE FUNCTION gridex_ediel_inbound_context.require_v1(uuid,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_current_basis_revoked';END$$;SET ROLE service_role;`)
check(await apply(),result)
check((await apply([registers[0].segmentIndex])).objects,result.objects)
check((await db.query('SELECT public.ediel_apply_reviewed_structure_v1($1,$2,$3) AS result',[company,source,actor])).rows[0].result,result)
await rejects(apply(null,id(99)),/structural_apply_source_required/)
await db.exec('RESET ROLE;');await db.query("UPDATE public.company_memberships SET status='revoked' WHERE company_id=$1",[company])
await db.exec('SET ROLE service_role;');await rejects(apply(),/ediel_tenant_actor_forbidden/);await db.exec('RESET ROLE;')
await db.query("UPDATE public.company_memberships SET status='active' WHERE company_id=$1",[company])
await db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'EVIL' WHERE id=$1",[source])
await db.exec('SET ROLE service_role;');await rejects(apply(),/structural_apply_replay_conflict/);await db.exec('RESET ROLE;')
await db.close();console.log(`PASS ${checks}: focused embedded partial actual owner effects/partition/atomic rollback/immutable scope replay; canonical/legal/registry ports are synthetic, native/replay/authentic proof NOT RUN.`)
