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
CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY,company_id uuid);
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
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),actor=id(2),customer=id(3),site=id(4),point=id(5),source=id(6),canonical=id(7),owner=id(8)
await db.query('INSERT INTO public.companies VALUES($1)',[company])
await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor])
await db.query('INSERT INTO public.customer_sites(id,company_id,customer_id) VALUES($1,$2,$3)',[site,company,customer])
await db.query("INSERT INTO public.metering_points(id,company_id,customer_id,site_id,meter_point_id,reading_frequency) VALUES($1,$2,$3,$4,'735123456789012345','quarter_hourly')",[point,company,customer,site])
const segments=["UNB+UNOC:3+54321:14+12345:14+261002:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A","BGM+Z06+DOC+9","NAD+FR+54321:160:SVK+++++++SE","NAD+DO+12345:160:SVK+++++++SE","LIN+1++735123456789012345:::9+1:1","DTM+157:202610010000:203","CCI++Z13","CAV+E64","RFF+MG:NEW?+METER","CCI++Z16","CAV+:::HT","LIN+2++735123456789012345:::9+1:2","CCI++Z16","CAV+:::LT","UNT+15+M","UNZ+1+I"]
const raw=segments.join("'")+"'",tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) AS tokens',[raw])).rows[0].tokens
const registers=tokens.filter(t=>t.tag==='LIN').map((t,index)=>({lineIndex:index,lineNumber:String(index+1),registerIndex:String(index+1),registerPosition:index+1,segmentIndex:t.index}))
const object={messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers}
const wire={object,messageCode:'Z06',businessCase:'change_with_reading',effectiveFrom:{fieldNumber:'216',marketMinute:'202610010000',utc:'2026-09-30T23:00:00Z'},meterNumber:'NEW+METER',oldMeterNumber:null,registers:[{position:1,registerId:'HT'},{position:2,registerId:'LT'}]}
const business={owner:'reviewed-received-structure-v1',meteringPointId:point,siteId:site,customerId:customer,wire}
const entry={object,disposition:'accepted',reasons:[],party:{syntheticUnqualified:true},business}
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,message_received_at,parsed_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3,'2026-10-02T11:00:00Z',$4)",[source,company,raw,{customerId:'FOREIGN',readingFrequency:'hourly',proposedChanges:[{entityId:id(99),proposedValue:'EVIL'}]}])
await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test','Z06','2026-10-02T11:00:00Z',$3,encode(sha256(convert_to($3,'UTF8')),'hex'))",[source,company,raw])
await db.query("INSERT INTO gridex_received_sources.validation_assessments SELECT $1,source_message_id,company_id,environment,payload_hash,$2,NULL FROM gridex_received_sources.sources WHERE source_message_id=$3",[canonical,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'}),source])
await db.query("INSERT INTO gridex_received_sources.object_assessments SELECT $1,source_message_id,company_id,environment,payload_hash,$2,NULL,$3 FROM gridex_received_sources.sources WHERE source_message_id=$4",[owner,canonical,JSON.stringify({objects:[entry]}),source])
// PGlite extended queries cannot combine statements; service-role gate is
// exercised as an actual role, with owner test fixtures established above.
await db.exec('GRANT USAGE ON SCHEMA public TO service_role;SET ROLE service_role;')
const apply=async(c=company)=>(await db.query('SELECT public.ediel_apply_reviewed_structure_v1($1,$2,$3) AS result',[c,source,actor])).rows[0].result
assert.equal((await apply()).reason,'structural_apply_original_review_required')
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_apply_receipts')).rows[0].n,0)
// The deployed original proof helper is never overridden by this migration.
// Test-only true permits examination of mechanical atomic effects below.
await db.exec('CREATE OR REPLACE FUNCTION gridex_received_sources.review_business_proof_consistent(jsonb,jsonb,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;SET ROLE service_role;')
await db.exec("RESET ROLE;CREATE FUNCTION public.fail_structural_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic_late_event_failure';END$$;CREATE TRIGGER fail_structural_event BEFORE INSERT ON public.ediel_message_events FOR EACH ROW EXECUTE FUNCTION public.fail_structural_event();SET ROLE service_role;")
await assert.rejects(()=>apply(),/synthetic_late_event_failure/)
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.structural_apply_receipts')).rows[0].n,0)
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.ediel_message_events')).rows[0].n,0)
await db.exec('DROP TRIGGER fail_structural_event ON public.ediel_message_events;SET ROLE service_role;')
const result=await apply();assert.equal(result.applied,true);assert.equal(result.appliedCount,2)
assert.equal(result.objects[0].sourceReceivedAt,'2026-10-02T11:00:00+00:00')
assert.equal(result.objects[0].effectiveAt,'2026-09-30T23:00:00+00:00')
assert.equal(result.objects[0].sourceRegisters[0].tokens.find(t=>t.tag==='RFF').elements[1][1],'NEW+METER')
assert.equal(result.objects[0].sourceRegisters[1].tokens.find(t=>t.tag==='CAV').elements[1][3],'LT')
assert.equal(result.objects[0].readingFollowUp.fulfilled,false);assert.equal(result.objects[0].readingFollowUp.deadline,null)
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT reading_frequency FROM public.metering_points WHERE id=$1',[point])).rows[0].reading_frequency,'quarter_hourly')
assert.equal((await db.query('SELECT count(*)::int AS n FROM public.ediel_message_events')).rows[0].n,1)
await db.query('UPDATE gridex_received_sources.validation_assessments SET facts_text=$1 WHERE id=$2',[JSON.stringify({syntaxDecision:'rejected'}),canonical])
await db.exec('SET ROLE service_role;');assert.deepEqual(await apply(),result)
await assert.rejects(()=>apply(id(99)),/structural_apply_source_required/)
await db.exec('RESET ROLE;')
await db.query("UPDATE public.company_memberships SET status='revoked' WHERE company_id=$1",[company])
await db.exec('SET ROLE service_role;');await assert.rejects(()=>apply(),/ediel_tenant_actor_forbidden/);await db.exec('RESET ROLE;')
await assert.rejects(()=>db.exec('UPDATE gridex_received_sources.structural_apply_receipts SET result=\'{}\''),/received_source_evidence_is_append_only/)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_apply_reviewed_structure_v1(uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: synthetic source-only whole-register apply, physical UNA release decoding, tenant/current actor denial, unchanged quarter frequency, separate effective/receipt time and immutable prior result. Native/replay/RLS/authentic original/source-owner acceptance NOT RUN.')
