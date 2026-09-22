import {execFileSync} from 'node:child_process'
import {afterEach,beforeAll,expect,it,vi} from 'vitest'
import {structuralOwnerSource} from '../__tests__/helpers/structuralOwnerFixtures'
import {reviewReceivedStructuralSource} from '@/lib/ediel/sources/reviewReceivedStructuralSource'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {compareUtiltsStructure} from '@/lib/ediel/utilts/structuralComparison'
import {utiltsStructureWire,STRUCTURE_POINT} from '../__tests__/helpers/structuralComparisonFixtures'
import {ownerSource} from '../__tests__/helpers/sourceOwnerFixtures'
import type {EdielMessageRow} from '@/lib/ediel/types'

// No database/client, parser, canonical registry or ownership decision is
// mocked. Only unrelated notification/event sinks are withheld on this runner.
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'

import {inspectReceivedSourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal=(v:unknown):string=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
function sql<T>(input:string):T {
  if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('local_only')
  const out=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
  return out?JSON.parse(out) as T:undefined as T
}
let serial=0
/** Only draft business rows are seeded. The actual business owner must perform
 * the UPDATE and supply INSERT through the real Supabase HTTP API. */
async function seed(delegated=false, structural=false) {
  const caseNo=++serial
  const id=(n:number)=>`10000000-0000-4000-8000-${String(caseNo*100+n).padStart(12,'0')}`
  const ids={source:id(1),company:id(2),customer:id(3),point:id(4),site:id(5),grid:id(6),switch:id(7),actor:id(9),transport:id(10),outbound:id(11),reviewer:id(12),route:id(13),routeProfile:id(14)}
  const external=`735123456789${String(caseNo).padStart(6,'0')}`
  const transportEdiel=String(88000+caseNo)
  const input=structural?structuralOwnerSource():ownerSource(), wire=String(input.raw_payload).replaceAll('735123456789012345',external).replace('+54321:14+',delegated?`+${transportEdiel}:14+`:'+54321:14+')
  const p=(key:keyof typeof ids)=>literal(ids[key])
  sql(`
  DO $$ BEGIN IF EXISTS(SELECT FROM public.companies WHERE id=${p('company')}) THEN RAISE EXCEPTION 'native_fixture_collision';END IF;END $$;
  INSERT INTO public.companies(id,name,status) VALUES(${p('company')},'E035 native runtime synthetic ${caseNo}','active');
  INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${p('customer')},${p('company')},'E035-NATIVE-${caseNo}','Synthetic native customer','private');
  INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${p('grid')},${p('company')},'Synthetic native grid ${caseNo}','12345','test',true,'active');
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${p('site')},${p('company')},${p('customer')},'Synthetic native site','consumption','active','SE',${literal(external)},${p('grid')});
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,reading_frequency,measurement_type,is_settlement_relevant,grid_owner_id) VALUES(${p('point')},${p('company')},${p('customer')},${p('site')},${p('site')},${literal(external)},${literal(external)},'hourly','consumption',true,${p('grid')});
  INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${p('company')},'test','electricity',true,clock_timestamp()-interval '1 day');
  INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${p('company')},'test',${p('actor')},'EdielId','54321',clock_timestamp()-interval '1 day');
  INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${p('company')},'test',${p('actor')},'electricity_supplier',clock_timestamp()-interval '1 day');
  ${delegated?`
  INSERT INTO public.platform_market_actors(id,name) VALUES(${p('transport')},'Synthetic native transport ${caseNo}');
  INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified,valid_from,valid_to) VALUES(${p('transport')},'EdielId',${literal(transportEdiel)},true,'2026-01-01','2099-01-01');
  INSERT INTO public.tenant_counterparty_relations(company_id,environment,counterparty_actor_id,relation_type,is_enabled,valid_from) VALUES(${p('company')},'test',${p('transport')},'ediel_transport_agent',true,clock_timestamp()-interval '1 day');`:''}

  INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_type,status,requested_start_date,rff_li_reference) VALUES(${p('switch')},${p('company')},${p('customer')},${p('site')},${p('point')},${p('grid')},'switch','draft','2026-10-01','CASE-1');
  ${structural?`
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(${p('reviewer')},'authenticated','authenticated','e035-native-${caseNo}@example.invalid',now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status,created_at,updated_at)
  VALUES(${p('reviewer')},'e035-native-${caseNo}@example.invalid','Synthetic E035 reviewer','active',now(),now()) ON CONFLICT(id) DO UPDATE SET user_status='active';
  INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
  VALUES(${p('company')},${p('reviewer')},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
  INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
  SELECT ${p('reviewer')},id,'company_admin',${p('company')},'active',true FROM public.roles WHERE key='company_admin'
  ON CONFLICT DO NOTHING;
  INSERT INTO public.communication_routes(id,company_id,route_name,grid_owner_id,environment_type,is_active)
  VALUES(${p('route')},${p('company')},'Isolated synthetic native route',${p('grid')},'bilateral_test',true);
  INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
  VALUES(${p('routeProfile')},${p('company')},${p('route')},'Isolated synthetic native profile','test','edifact','54321','12345','23-DDQ-PRODAT',true);
  INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_sent_at,application_reference,communication_route_id,route_profile_id,source_operation_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${p('outbound')},${p('company')},${p('customer')},${p('site')},${p('point')},'test','outbound','edifact','PRODAT','Z03','sent',${literal(wire.replace('BGM+Z04','BGM+Z03'))},'{}',clock_timestamp(),'23-DDQ-PRODAT',${p('route')},${p('routeProfile')},${p('switch')},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z03:L:26.A:r3' AND profile.is_enabled;
  UPDATE public.supplier_switch_requests SET outbound_z03_message_id=${p('outbound')} WHERE id=${p('switch')};
  `:''}
  INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${p('source')},${p('company')},${p('customer')},${p('site')},${p('point')},'test','inbound','edifact','PRODAT','Z04','received',${literal(wire)},${literal(input.parsed_payload)}::jsonb,${structural?"clock_timestamp()":"clock_timestamp()-interval '2 minutes'"},'{}','23-DDQ-PRODAT','12345',${literal(delegated?transportEdiel:'54321')},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;

  `)
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',ids.source).single()
  expect(error).toBeNull();expect(data).not.toBeNull()
  return {ids,original:data as unknown as EdielMessageRow}
}
async function prepare(f:Awaited<ReturnType<typeof seed>>) {
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.original)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
  const canonical=await recordReceivedSourceValidation({original:f.original,validated:f.original,resolvedCompanyId:f.ids.company,decision})
  expect(canonical, JSON.stringify({rulePackEvidence:decision.validationReport.rulePackEvidence,sourceReceivedAt:f.original.message_received_at,context:f.original.execution_context_snapshot})).toMatchObject({status:'recorded'})
  const session=createReceivedSourceOwnerSession(canonical)
  expect(session).not.toBeNull()
  return {canonical,session:session!}
}
async function complete(f:Awaited<ReturnType<typeof seed>>,given?:Awaited<ReturnType<typeof prepare>>) {
  const prepared=given ?? await prepare(f)
  const result=await applyInboundBusinessStateMachine({message:f.original,actorUserId:f.ids.actor,matchedSwitchRequestId:f.ids.switch,onSourceSwitchCommitted:prepared.session.onSwitchCommitted})
  expect(result.outcome).toBe('supplier_switch_accepted')
  return prepared.session.finish()
}
function stored(source:string) {
  return sql<{facts:Record<string,unknown>;readsets:{observedAt:string}[];assessmentId:string;canonicalId:string;sourceHash:string;factsText:string;factsHash:string;createdXid:string;witnessXid:string|null}[]>(`
   SELECT coalesce(jsonb_agg(jsonb_build_object('facts',a.facts_text::jsonb,'factsText',a.facts_text,'factsHash',a.facts_hash,'readsets',a.owner_readsets,'assessmentId',a.id,'canonicalId',a.canonical_assessment_id,'sourceHash',a.source_payload_hash,'createdXid',a.created_xid::text,'witnessXid',w.xmin::text) ORDER BY a.assessed_at),'[]') FROM gridex_received_sources.object_assessments a LEFT JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id WHERE a.source_message_id=${literal(source)};`)
}
beforeAll(async()=>{
  // Confirm the local Data API has observed the replay's final schema.
  sql("NOTIFY pgrst, 'reload schema';")
  for(let i=0;i<20;i++) {
    const {error}=await supabaseService.rpc('gridex_witness_source_objects_v1',{p_company_id:'00000000-0000-4000-8000-000000000000',p_environment:'test',p_assessment_id:'00000000-0000-4000-8000-000000000000',p_facts_hash:'0'.repeat(64)})
    if(error?.code!=='PGRST202')return
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  throw Error('native_schema_cache_not_ready')
})
afterEach(()=>vi.restoreAllMocks())

it('the semantic runtime key cannot impersonate the actual activation-row key in SQL',async()=>{
  const f=await seed(),decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.original)
  const evidence=decision.validationReport.rulePackEvidence as Record<string,unknown>
  expect(evidence.databaseProfileKey).toBe('PRODAT:Z04:L:26.A:r3')
  expect(evidence.profileKey).not.toBe(evidence.databaseProfileKey)
  const wrongNamespace=structuredClone(decision)
  delete (wrongNamespace.validationReport.rulePackEvidence as Record<string,unknown>).databaseProfileKey
  const wrong=buildReceivedSourceValidationEvidence({original:f.original,validated:f.original,resolvedCompanyId:f.ids.company,decision:wrongNamespace})
  expect(wrong).not.toBeNull()
  const {error}=await supabaseService.rpc('gridex_record_source_validation_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:wrong!.sourcePayloadHash,p_facts_text:wrong!.factsText})
  expect(error?.code).toBe('23514');expect(error?.message).toBe('received_validation_rule_evidence_unavailable')
  await prepare(f)
})

it.each([false,true])('real HTTP/database owners commit and persist source approval, delegated=%s',async delegated=>{
  const f=await seed(delegated), receipt=await complete(f)
  expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
  const records=stored(f.ids.source);expect(records).toHaveLength(1)
  expect(records[0].facts).toMatchObject({objects:[{disposition:'accepted',party:{receiver:{evidence:{completeness:'exact_count'}},disposition:'accepted'},business:{businessDisposition:'committed'}}]})
  expect(records[0].readsets).toHaveLength(1);expect(records[0].readsets[0].observedAt).toMatch(/\+00:00$/)
  expect(records[0].witnessXid).not.toBeNull();expect(records[0].witnessXid).not.toBe(records[0].createdXid)
  expect(sql(`SELECT jsonb_build_object('switch',sw.status,'supply',sp.status) FROM public.supplier_switch_requests sw JOIN public.customer_supply_periods sp ON sp.source_message_id=sw.inbound_z04_message_id WHERE sw.id=${literal(f.ids.switch)}`)).toEqual({switch:'accepted',supply:'confirmed_by_grid_owner'})
})
it('without a successful business callback, native rows cannot grant approval',async()=>{
  const f=await seed(), {session}=await prepare(f)
  expect(await session.finish()).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
  expect(stored(f.ids.source)[0].facts).toMatchObject({objects:[{disposition:'unavailable',business:null,party:null}]})
})
it('a real owner-row change between HTTP reads and append is rejected by SQL',async()=>{
  const f=await seed(),prepared=await prepare(f), originalRpc=supabaseService.rpc.bind(supabaseService)
  vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
    if(name==='gridex_record_source_object_decisions_v1') sql(`UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=${literal(f.ids.company)}`)
    return originalRpc(name,args,options)
  })
  expect(await complete(f,prepared)).toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
  expect(stored(f.ids.source)).toEqual([])
})
it('a real second-write failure never grants source approval and preserves the first committed write',async()=>{
  const f=await seed(),{session}=await prepare(f)
  sql(`ALTER TABLE public.customer_supply_periods ADD CONSTRAINT e035_native_supply_failure CHECK(company_id<>${literal(f.ids.company)}::uuid)`)
  try {
    await expect(applyInboundBusinessStateMachine({message:f.original,actorUserId:f.ids.actor,matchedSwitchRequestId:f.ids.switch,onSourceSwitchCommitted:session.onSwitchCommitted})).rejects.toBeDefined()
  } finally {sql('ALTER TABLE public.customer_supply_periods DROP CONSTRAINT e035_native_supply_failure')}
  expect(await session.finish()).toMatchObject({sourceDisposition:'not_established'})
  expect(stored(f.ids.source)[0].facts).toMatchObject({objects:[{disposition:'unavailable'}]})
  expect(sql(`SELECT to_jsonb(status) FROM public.supplier_switch_requests WHERE id=${literal(f.ids.switch)}`)).toBe('accepted')
})
it('native ACL/scope checks reject a different tenant using otherwise genuine assessment data',async()=>{
  const f=await seed();expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});const a=stored(f.ids.source)[0]
  const {error}=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:'00000000-0000-4000-8000-000000000999',p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:a.sourceHash,p_canonical_assessment_id:a.canonicalId,p_facts_text:a.factsText})
  expect(error?.code).toBe('23514');expect(stored(f.ids.source)).toHaveLength(1)
})
it('the actual runtime proof serializes in UTC regardless of caller timezone; the former behavior is reproduced',async()=>{
  const f=await seed(true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});const a=stored(f.ids.source)[0]
  const probe=(zone:string,old=false)=>sql<string>(`BEGIN;
    ${old?`ALTER FUNCTION gridex_received_sources.owner_rows_match(text,jsonb,uuid,text,uuid) RESET timezone;
      ALTER FUNCTION gridex_received_sources.object_owner_proof_consistent(jsonb,jsonb,timestamptz) RESET timezone;
      ALTER FUNCTION gridex_received_sources.append_object_assessment(uuid,text,uuid,text,uuid,text) RESET timezone;`:''}
    SET LOCAL timezone=${literal(zone)};
    SET LOCAL ROLE service_role;
    SELECT public.gridex_record_source_object_decisions_v1(${literal(f.ids.company)},'test',${literal(f.ids.source)},${literal(a.sourceHash)},${literal(a.canonicalId)},${literal(a.factsText)})->>'assessmentId' AS assessment_id \\gset
    RESET ROLE;
    SELECT to_jsonb(owner_readsets#>>'{0,observedAt}') FROM gridex_received_sources.object_assessments WHERE id=:'assessment_id'::uuid;
    ROLLBACK;`)
  expect(probe('Europe/Stockholm',true)).not.toMatch(/\+00:00$/)
  for(const zone of ['UTC','Europe/Stockholm','America/New_York'])expect(probe(zone)).toMatch(/\+00:00$/)
  expect(stored(f.ids.source)).toHaveLength(1)
})

async function nativeTimeline(companyId:string,cutoffAt:string) {
  const scope={companyId,environment:'test' as const,cutoffAt}
  const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:companyId,p_environment:'test',p_cutoff:cutoffAt})
  expect(error).toBeNull()
  const result=inspectReceivedSourceDecisionTimeline(scope,data)
  expect(result,JSON.stringify(result)).toMatchObject({status:'inspected',authorityStatus:'not_established',selection:'not_performed',marketSupersession:'not_performed'})
  return result
}
it('actual immutable HTTP readsets preserve historical approval across a real unavailable correction',async()=>{
  const f=await seed(true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
  const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp());')
  const initial=await nativeTimeline(f.ids.company,cutoff)
  expect(initial.sources).toHaveLength(1)
  expect(initial.sources[0].asOf).toMatchObject({recordedDisposition:'accepted',objects:[{disposition:'accepted'}]})
  const priorId=initial.sources[0].asOf!.assessmentId
  const beforeWitness=sql<string>(`SELECT to_jsonb(assessed_at) FROM gridex_received_sources.object_assessments WHERE id=${literal(priorId)};`)
  const earlier=await nativeTimeline(f.ids.company,beforeWitness)
  expect(earlier.sources[0]).toMatchObject({asOf:null,visibility:'incomplete'})
  // A new fresh canonical owner session with NO business callback cannot reuse
  // the already accepted rows. The real append and witness record unavailable.
  const {session}=await prepare(f);expect(await session.finish()).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
  const corrected=await nativeTimeline(f.ids.company,sql<string>('SELECT to_jsonb(clock_timestamp());'))
  expect(corrected.sources[0].asOf).toMatchObject({previousAssessmentId:priorId,recordedDisposition:'unavailable'})
  expect(corrected.sources[0].revisions).toHaveLength(2)
  const repeatedHistorical=await nativeTimeline(f.ids.company,cutoff)
  expect(repeatedHistorical.sources[0].asOf).toEqual(initial.sources[0].asOf)
  expect(repeatedHistorical.sources[0].revisions[1].availability).toBe('after_cutoff')
})
it('actual unwitnessed successor prevents an accepted predecessor being revived',async()=>{
  const f=await seed();expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
  const a=stored(f.ids.source)[0]
  const {data,error}=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,p_source_payload_hash:a.sourceHash,p_canonical_assessment_id:a.canonicalId,p_facts_text:a.factsText})
  expect(error).toBeNull()
  const persisted=stored(f.ids.source);expect(persisted).toHaveLength(2)
  const successor=persisted.find(row=>row.assessmentId!==a.assessmentId)
  expect(successor).toBeDefined();expect(successor!.witnessXid).toBeNull()
  // The append RPC returns an integrity receipt, NOT runtime approval or a
  // visibility witness. Assert its exact SQL contract, including no such fields.
  expect(data).toEqual({version:1,assessmentId:successor!.assessmentId,companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,sourcePayloadHash:a.sourceHash,canonicalAssessmentId:a.canonicalId,factsHash:a.factsHash})
  // SQL committed, but no separate visibility witness exists for this version.
  const result=await nativeTimeline(f.ids.company,sql<string>('SELECT to_jsonb(clock_timestamp());'))
  expect(result.sources[0]).toMatchObject({asOf:null,visibility:'incomplete'})
  expect(result.sources[0].revisions).toHaveLength(2)
  expect(result.sources[0].revisions[0].availability).toBe('witnessed_by_cutoff')
  expect(result.sources[0].revisions[1].availability).toBe('not_witnessed_by_cutoff')
})

// Market-structure integration: real canonical registry, actual committed Z04
// owner, full original review, immutable snapshots and comparison. No authority
// or decision is mocked. Fixtures are isolated localhost synthetic entities.
async function reviewed(f:Awaited<ReturnType<typeof seed>>,source=f.ids.source,replaces:string|null=null){
 const result=await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:source,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:replaces})
 expect(result,JSON.stringify(stored(source).map(row=>row.facts))).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return result
}
async function structuralSnapshot(f:Awaited<ReturnType<typeof seed>>,cutoffAt=sql<string>('SELECT to_jsonb(clock_timestamp())')){
 const scope={companyId:f.ids.company,environment:'test' as const,cutoffAt}
 const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.ids.company,p_environment:'test',p_cutoff:cutoffAt})
 expect(error).toBeNull();const result=inspectStructuralReadset(scope,data)
 expect(result.timeline,JSON.stringify(result.timeline)).toMatchObject({status:'inspected',boundedReadComplete:true})
 return result
}
async function insertStructuralChange(f:Awaited<ReturnType<typeof seed>>,code:'Z06'|'Z10',reason:string,document:string,replacement=false){
 const message=structuralOwnerSource(code,reason,document,replacement)
 const external=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const body=message.raw_payload!.replaceAll('735123456789012345',external)
 const id=sql<string>(`INSERT INTO public.ediel_messages(company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},'test','inbound','edifact','PRODAT',${literal(code)},'received',${literal(body)},${literal(message.parsed_payload)}::jsonb,clock_timestamp(),'23-DDQ-PRODAT',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key=${literal(`PRODAT:${code}:${(message.parsed_payload as Record<string,unknown>).subtype}:26.A:r3`)} AND profile.is_enabled RETURNING to_jsonb(id);`)
 expect(id).toMatch(/^[a-f0-9-]{36}$/);return id
}
it('native full-original Z04 review proves post-ledger coverage without replaying the switch writes',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const before=await structuralSnapshot(f);expect(before.versions[0].coverage).toBeNull()
 await reviewed(f)
 const result=await structuralSnapshot(f)
 expect(result.versions).toHaveLength(1);expect(result.versions[0]).toMatchObject({disposition:'accepted',coverage:{kind:'post_ledger_supply'}})
 expect(stored(f.ids.source)).toHaveLength(2)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE source_message_id=${literal(f.ids.source)}`)).toBe(1)
 const wire=utiltsStructureWire({period:'202610010000202610150000',meter:'METER-1',ids:['101'],sender:'12345',receiver:'54321'}).replaceAll(STRUCTURE_POINT,result.versions[0].wire.object.objectId!)
 expect(compareUtiltsStructure({raw:wire,transactionIndex:0,cutoffAt:result.timeline.cutoffAt??'',ledgerStartedAt:result.timeline.ledgerStartedAt??'',
  readComplete:true,unresolvedSources:result.unresolvedSources,versions:result.versions})).toMatchObject({status:'matched',codes:[]})
})
it.each([['Z06','E34'],['Z06','E64'],['Z06','E32'],['Z10','E58']] as const)('native full-original %s/%s approval is not partial safe-apply',async(code,reason)=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,code,reason,'CHANGE')
 const pending=await structuralSnapshot(f);expect(pending.versions.find(version=>version.sourceMessageId===id)?.disposition).toBe('unavailable')
 await reviewed(f,id)
 const result=await structuralSnapshot(f),version=result.versions.find(item=>item.sourceMessageId===id)
 expect(version).toMatchObject({disposition:'accepted',wire:{messageCode:code},coverage:{baselineSourceMessageId:f.ids.source}})
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)).toBe(1)
})
it('native BGM5 correction pins an approved predecessor; a later receipt alone is never replacement',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const prior=await insertStructuralChange(f,'Z10','E58','ORIGINAL');await reviewed(f,prior)
 const correction=await insertStructuralChange(f,'Z10','E58','CORRECTION',true)
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:correction,reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({sourceDisposition:'not_established'})
 await reviewed(f,correction,prior)
 const result=await structuralSnapshot(f)
 expect(result.versions.find(version=>version.sourceMessageId===correction)?.replaces).toMatchObject({sourceMessageId:prior,assessmentId:stored(prior)[0].assessmentId})
})
it('native user without company permission cannot create even a canonical-ledger assessment during review',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 sql(`UPDATE public.company_memberships SET status='inactive',is_active=false WHERE user_id=${literal(f.ids.reviewer)};`)
 const before=sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)).toBe(before)
})
