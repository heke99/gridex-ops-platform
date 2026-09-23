import {execFileSync} from 'node:child_process'
import {afterEach,beforeAll,expect,it,vi} from 'vitest'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {reviewReceivedClosureSource} from '@/lib/ediel/sources/reviewReceivedClosureSource'
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
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
  SELECT ${p('reviewer')},${p('company')},id,'ediel_testing.write' FROM public.permissions WHERE key='ediel_testing.write';
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
  if(structural){
    const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{
      p_actor_user_id:ids.reviewer,p_company_id:ids.company,p_permission:'ediel_testing.write',
    })
    expect(permission.error).toBeNull();expect(permission.data).toBe(true)
  }
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
it.each([['Z06','E64'],['Z06','E32'],['Z10','E58']] as const)('native full-original %s/%s approval is not partial safe-apply',async(code,reason)=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,code,reason,'CHANGE')
 const pending=await structuralSnapshot(f);expect(pending.versions.find(version=>version.sourceMessageId===id)?.disposition).toBe('unavailable')
 await reviewed(f,id)
 const result=await structuralSnapshot(f),version=result.versions.find(item=>item.sourceMessageId===id)
 expect(version).toMatchObject({disposition:'accepted',wire:{messageCode:code},coverage:{baselineSourceMessageId:f.ids.source}})
 if(code==='Z06'&&reason==='E64'){
  const entry=(stored(id).at(-1)!.facts as {objects:{business:Record<string,unknown>;party:Record<string,unknown>}[]}).objects[0]
  const forged={...entry.business,wire:{...(entry.business.wire as object),businessCase:'customer_only'}}
  expect(sql(`SELECT to_jsonb(gridex_received_sources.review_business_proof_consistent(${literal(entry.party)}::jsonb,${literal(forged)}::jsonb,${literal(id)}::uuid));`)).toBe(false)
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.ids.company)}`)).toBe(1)
})
it('native Z06/E34 remains unavailable without a qualified death or counterparty bilateral owner',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const id=await insertStructuralChange(f,'Z06','E34','CUSTOMER')
 const receipt=await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:id,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 const result=await structuralSnapshot(f)
 expect(result.versions.find(version=>version.sourceMessageId===id)).toMatchObject({disposition:'unavailable'})
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
 sql(`DELETE FROM public.user_permissions WHERE user_id=${literal(f.ids.reviewer)} AND permission_key='ediel_testing.write';`)
 const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{
  p_actor_user_id:f.ids.reviewer,p_company_id:f.ids.company,p_permission:'ediel_testing.write',
 })
 expect(permission.error).toBeNull();expect(permission.data).toBe(false)
 const before=sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toEqual({status:'unconfirmed',sourceDisposition:'not_established'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE source_message_id=${literal(f.ids.source)}`)).toBe(before)
})

// Closure acceptance uses a real prior reviewed coverage assessment, then the
// real legacy end owner. No hand-built accepted marker is an authority oracle.
async function insertClosure(f:Awaited<ReturnType<typeof seed>>,reason='Z22',minute='202610150000'){
 const external=sql<string>(`SELECT to_jsonb(meter_point_id) FROM public.metering_points WHERE id=${literal(f.ids.point)}`)
 const wire=closureFixture({reason,minute}).wire.replaceAll('735123456789012345',external)
 const payload={subtype:reason==='Z23'?'LK':'L',end_date:'2026-10-15',prodatDependentFacts:{market:'electricity',meterReadingsSentInUtilts:true}}
 const id=sql<string>(`INSERT INTO public.ediel_messages(company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(f.ids.company)},${literal(f.ids.customer)},${literal(f.ids.site)},${literal(f.ids.point)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},${literal(payload)}::jsonb,clock_timestamp(),'23-DDQ-PRODAT',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key=${literal(`PRODAT:Z05:${payload.subtype}:26.A:r3`)} AND profile.is_enabled RETURNING to_jsonb(id);`)
 expect(id).toMatch(/^[a-f0-9-]{36}$/)
 const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('id',id).single()
 expect(error).toBeNull();return data as unknown as EdielMessageRow
}
async function closureReview(f:Awaited<ReturnType<typeof seed>>,source:string){
 return reviewReceivedClosureSource({companyId:f.ids.company,environment:'test',sourceMessageId:source,reviewerUserId:f.ids.reviewer,confirmedOriginal:true})
}
type ClosureAppendArgs={p_company_id:string;p_environment:string;p_source_message_id:string;p_source_payload_hash:string;p_canonical_assessment_id:string;p_facts_text:string}
/** Local synthetic native diagnostics only. No original/owner mutation survives
 * the transaction and no guard is removed: false returns become labelled errors. */
function closureSqlDiagnostics(args:ClosureAppendArgs,removeMidnight=false){
 const facts=JSON.parse(args.p_facts_text),entry=facts.objects[0]
 const party=literal(entry.party),business=literal(entry.business),source=literal(args.p_source_message_id)
 return sql<Record<string,unknown>>(`BEGIN;
  CREATE FUNCTION pg_temp.closure_native_trace() RETURNS jsonb LANGUAGE plpgsql AS $trace$
  DECLARE result jsonb; error_code text; error_message text; error_detail text; error_context text;
  BEGIN
   PERFORM gridex_received_sources.append_object_assessment(${literal(args.p_company_id)},${literal(args.p_environment)},${source},${literal(args.p_source_payload_hash)},${literal(args.p_canonical_assessment_id)},${literal(args.p_facts_text)});
   RETURN jsonb_build_object('accepted',true);
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS error_code=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT,error_detail=PG_EXCEPTION_DETAIL,error_context=PG_EXCEPTION_CONTEXT;
   RETURN jsonb_build_object('accepted',false,'code',error_code,'message',error_message,'detail',error_detail,'context',error_context);
  END $trace$;
  CREATE TEMP TABLE closure_native_diag(result jsonb);
  INSERT INTO closure_native_diag SELECT jsonb_build_object('append',pg_temp.closure_native_trace(),
   'wireMatches',gridex_received_sources.closure_wire_matches_v1(src.raw_payload,${business}::jsonb->'object',${business}::jsonb->'wire'),
   'partyProof',gridex_received_sources.review_party_proof_consistent(${party}::jsonb,${business}::jsonb,src.source_received_at),
   'closureProof',gridex_received_sources.review_closure_proof_consistent(${party}::jsonb,${business}::jsonb,src.source_message_id),
   'ownerRows',(SELECT jsonb_object_agg(proof_kind,gridex_received_sources.owner_rows_match(proof_kind,proof_rows,${literal(args.p_company_id)},${literal(args.p_environment)},proof_id)) FROM (VALUES
    ('profiles',${party}::jsonb#>'{receiver,evidence,records,profiles}',NULL::uuid),
    ('identifiers',${party}::jsonb#>'{receiver,evidence,records,identifiers}',NULL::uuid),
    ('roles',${party}::jsonb#>'{receiver,evidence,records,roles}',(${party}::jsonb#>>'{receiver,identity,legalActorId}')::uuid),
    ('relations',${party}::jsonb#>'{receiver,evidence,records,relations}',NULL::uuid),
    ('point',jsonb_build_array(${party}::jsonb#>'{facility,meteringPoint}'),(${business}::jsonb->>'meteringPointId')::uuid),
    ('site',jsonb_build_array(${party}::jsonb#>'{facility,site}'),(${business}::jsonb->>'siteId')::uuid),
    ('gridOwner',jsonb_build_array(${party}::jsonb#>'{facility,gridOwner}'),(${party}::jsonb#>>'{facility,gridOwner,id}')::uuid)
   ) proof(proof_kind,proof_rows,proof_id)),
   'snapshotSourceCount',(SELECT jsonb_array_length(snap.readset_text::jsonb->'sources') FROM gridex_received_sources.object_selection_snapshots snap WHERE snap.id=(${business}::jsonb#>>'{reviewSnapshot,snapshotId}')::uuid),
   'baselineEntries',(SELECT jsonb_agg(jsonb_build_object('id',a.id,'witness',w.observed_at,'latest',NOT EXISTS(SELECT FROM gridex_received_sources.object_assessments child WHERE child.previous_assessment_id=a.id),
     'owner',item#>>'{business,owner}','disposition',item->>'disposition','sameSupply',item#>>'{business,supplyPeriodId}'=${business}::jsonb->>'supplyPeriodId',
     'sameCover',item#>'{business,coverageWindow}'=${business}::jsonb->'coverageWindow','parties',item#>'{party,parties}'))
    FROM gridex_received_sources.object_assessments a LEFT JOIN gridex_received_sources.object_availability_witnesses w ON w.assessment_id=a.id
    CROSS JOIN LATERAL jsonb_array_elements(a.facts_text::jsonb->'objects') item
    WHERE a.source_message_id=(${business}::jsonb#>>'{coverageWindow,baselineSourceMessageId}')::uuid))
   FROM gridex_received_sources.sources src WHERE src.source_message_id=${source};
  DO $instrument$ DECLARE definition text; chunks text[]; rebuilt text; i integer; context text;
  BEGIN
   SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
   ${removeMidnight?`definition:=replace(definition,'OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000''','OR false');`:''}
   chunks:=string_to_array(definition,'RETURN false;');rebuilt:=chunks[1];
   FOR i IN 2..array_length(chunks,1) LOOP
    context:=right(chunks[i-1],220);
    rebuilt:=rebuilt||format('RAISE EXCEPTION USING MESSAGE=%L, DETAIL=%L;', 'closure_native_guard_'||(i-1)::text,context)||chunks[i];
   END LOOP;
   IF array_length(chunks,1)<10 THEN RAISE EXCEPTION 'closure_native_trace_incomplete'; END IF;
   EXECUTE rebuilt;
  END $instrument$;
  UPDATE closure_native_diag SET result=result||jsonb_build_object('labelledAppend',pg_temp.closure_native_trace(),'midnightRemovedForTrace',${removeMidnight});
  SELECT result FROM closure_native_diag; ROLLBACK;`)
}
async function approvedClosureWithDiagnostics(f:Awaited<ReturnType<typeof seed>>,source:string){
 const attempts:ClosureAppendArgs[]=[],errors:{name:string;code:string;message:string}[]=[]
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const observe=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')attempts.push(args as ClosureAppendArgs)
  const request=originalRpc(name,args,options),then=request.then.bind(request)
  request.then=((resolve,reject)=>then(response=>{
   if(response.error)errors.push({name,code:response.error.code,message:response.error.message})
   return response
  }).then(resolve,reject)) as typeof request.then
  return request
 })
 let result:Awaited<ReturnType<typeof closureReview>>
 try{result=await closureReview(f,source)}finally{observe.mockRestore()}
 const attempt=attempts.at(-1)
 const diagnostics=result.status==='recorded'&&result.sourceDisposition==='accepted'?null:
  {rpcErrors:errors,attemptedObjects:attempt?JSON.parse(attempt.p_facts_text).objects.map((item:{disposition:string})=>item.disposition):[],sql:attempt?closureSqlDiagnostics(attempt):null}
 expect(result,JSON.stringify(diagnostics)).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 return result
}
it.each(['Z22','Z23'])('native %s closure retains immutable Z04 coverage after the real legacy end mutation',async reason=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const baseline=stored(f.ids.source).at(-1)!,message=await insertClosure(f,reason)
 const ended=await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})
 expect(ended.outcome).toBe('supply_terminated')
 expect(ended.updated).toContain('customer_cases')
 expect(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'customer',customer_id,'site',site_id,'point',metering_point_id,
  'type',case_type,'reason',reason_category,'status',status,'title',title,'next',next_action,'source',source,'intent',metadata->>'review_intent')),'[]')
  FROM public.customer_cases WHERE company_id=${literal(f.ids.company)} AND metadata->>'source_ediel_message_id'=${literal(message.id)}`)).toEqual([{
   company:f.ids.company,customer:f.ids.customer,site:f.ids.site,point:f.ids.point,type:'other',reason:'final_metering_and_billing',status:'open',
   title:'Leveransen upphör – slutför mätvärden och fakturering',next:'Kontrollera slutmätvärden och faktureringsberedskap för leveransens slutdatum.',
   source:'ediel_inbound_state_machine',intent:'final_metering_and_billing'}])
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})).toMatchObject({status:'recorded'})
 const unreviewed=await structuralSnapshot(f)
 expect(unreviewed.closureBlockers).toHaveLength(1)
 const compare=(snapshot:Awaited<ReturnType<typeof structuralSnapshot>>,period:string,meter='METER-1',ids=['101'])=>compareUtiltsStructure({
  raw:utiltsStructureWire({period,meter,ids,point:snapshot.versions[0].wire.object.objectId!}),transactionIndex:0,
  cutoffAt:snapshot.timeline.cutoffAt!,ledgerStartedAt:snapshot.timeline.ledgerStartedAt!,readComplete:true,
  unresolvedSources:snapshot.unresolvedSources,versions:snapshot.versions,closures:snapshot.closures,closureBlockers:snapshot.closureBlockers})
 expect(compare(unreviewed,'202610010000202610142359')).toMatchObject({status:'matched',codes:[]})
 expect(compare(unreviewed,'202610010000202610150000')).toMatchObject({status:'unavailable',codes:[]})
 const pending=await approvedClosureWithDiagnostics(f,message.id)
 expect(pending,JSON.stringify(stored(message.id))).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 const a=stored(message.id).at(-1)!
 expect(a.facts).toMatchObject({objects:[{disposition:'accepted',business:{owner:'reviewed-received-closure-v1',
  legacyEndDateProjection:'2026-10-15',wire:{effectiveTo:{marketMinute:'202610150000',utc:'2026-10-14T23:00:00.000Z'}},
  baselineCoverageAssessment:{sourceMessageId:f.ids.source,assessmentId:baseline.assessmentId,factsHash:baseline.factsHash}}}]})
 expect(a.witnessXid).not.toBeNull();expect(a.createdXid).not.toBe(a.witnessXid)
 const snapshot=await structuralSnapshot(f)
 expect(snapshot.closures).toHaveLength(1);expect(snapshot.closureBlockers).toEqual([])
 expect(snapshot.versions).toHaveLength(1)
 expect(snapshot.versions[0].coverage?.validTo).toBeNull()
 expect(compare(snapshot,'202610010000202610150000')).toMatchObject({status:'matched',coverage:{validTo:'2026-10-14T23:00:00.000Z'},closure:{sourceMessageId:message.id}})
 expect(compare(snapshot,'202610010000202610150001')).toMatchObject({status:'unavailable',codes:[]})
 expect(compare(snapshot,'202610010000202610150000','WRONG')).toMatchObject({status:'mismatch',codes:['E61']})
 expect(compare(snapshot,'202610010000202610150000','METER-1',['999'])).toMatchObject({status:'mismatch',codes:['E62']})
 const saved=await structuralSnapshot(f,unreviewed.timeline.cutoffAt!)
 expect(saved.closures).toEqual([]);expect(saved.closureBlockers).toHaveLength(1)
 expect(await approvedClosureWithDiagnostics(f,message.id)).toMatchObject({sourceDisposition:'accepted'})
 expect(stored(message.id)).toHaveLength(2)
 const last=stored(message.id).at(-1)!
 const unwitnessed=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:message.id,
  p_source_payload_hash:last.sourceHash,p_canonical_assessment_id:last.canonicalId,p_facts_text:last.factsText})
 expect(unwitnessed.error).toBeNull()
 const blocked=await structuralSnapshot(f)
 expect(blocked.closures).toEqual([]);expect(blocked.closureBlockers).toHaveLength(1)
 expect(compare(blocked,'202610010000202610150000')).toMatchObject({status:'unavailable',codes:[]})
 expect((await structuralSnapshot(f,snapshot.timeline.cutoffAt!)).closures).toHaveLength(1)
 if(reason==='Z22'){
  const {observationHandoffMessage}=await import('../__tests__/helpers/utiltsObservationHandoff')
  const {resolveCanonicalEdielPolicy}=await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
  const {runUtiltsRuntimeForMessage}=await import('@/lib/ediel/utiltsEngine')
  const {qualifyReceivedUtiltsStructure}=await import('@/lib/ediel/utilts/qualifyReceivedStructure')
  const {buildUtiltsTransactionPersistencePayload}=await import('@/lib/ediel/utilts/transactionPersistence')
  const utilts=observationHandoffMessage('2026-10-16',f.ids.company)
  utilts.id=f.ids.outbound;utilts.sender_ediel_id='12345';utilts.receiver_ediel_id='54321'
  utilts.raw_payload=utilts.raw_payload!.replaceAll('735999260731000007',snapshot.versions[0].wire.object.objectId!)
   .replaceAll('91100','12345').replaceAll('21660','54321').replaceAll('202607010000','202610010000')
   .replaceAll('202608010000','202610150000').replace('?+0200','?+0100').replace('M-GRIDEX-2607-01','METER-1')
  const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:utilts.message_received_at!,applicationReference:utilts.application_reference,mode:'parse'})
  const runtime=runUtiltsRuntimeForMessage(utilts,{canonicalPolicy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
  const qualified=await qualifyReceivedUtiltsStructure({message:utilts,runtime,canonicalPolicy})
  expect(qualified).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,evidence:{comparisons:[{reason:'structural_closure_scoped_hold',codes:[]}]},
   runtime:{transactionDispositions:[{disposition:'internal_review',responseType:'none'}],ackPlan:{shouldSendAperak:false}}})
  expect(buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:qualified.runtime.facts.transactions,dispositions:qualified.runtime.transactionDispositions,matches:[]})).toMatchObject([{quantities:[],responseType:'none'}])
 }
})
it('native closure cannot manufacture missing prior reviewed coverage from ended live rows',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'})
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 expect(stored(message.id).at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
})

it('native append independently binds sealed raw values and midnight support; isolated mutations reproduce each gap',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await approvedClosureWithDiagnostics(f,message.id)).toMatchObject({sourceDisposition:'accepted'})
 const a=stored(message.id).at(-1)!
 type Facts={objects:{object:Record<string,unknown>;business:import('@/lib/ediel/sources/reviewedClosureSource').ReviewedClosureBusiness}[]}
 const probe=(mutate:(facts:Facts)=>void,removeBinding=false,removeMidnight=false)=>{
  const facts=JSON.parse(a.factsText) as Facts;mutate(facts)
  // Transaction-local mutation of the real proof body. Append itself is used;
  // ROLLBACK restores definition, inserted assessment and every owner readset.
  return sql<boolean>(`BEGIN;
   ${removeBinding?`DO $mutation$ DECLARE definition text; needle text:='OR NOT gridex_received_sources.closure_wire_matches_v1(src.raw_payload,p_business->''object'',wire)'; BEGIN
    SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'closure_native_binding_mutation_missing'; END IF;
    definition:=replace(definition,needle,'OR false');
    ${removeMidnight?`definition:=replace(definition, 'OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000''', 'OR false');`:''}
    EXECUTE definition; END $mutation$;`:''}
   CREATE FUNCTION pg_temp.closure_append_probe() RETURNS boolean LANGUAGE plpgsql AS $probe$ BEGIN
    PERFORM gridex_received_sources.append_object_assessment(${literal(f.ids.company)},'test',${literal(message.id)},${literal(a.sourceHash)},${literal(a.canonicalId)},${literal(JSON.stringify(facts))});
    RETURN true; EXCEPTION WHEN check_violation THEN RETURN false; END $probe$;
   SELECT to_jsonb(pg_temp.closure_append_probe()); ROLLBACK;`)
 }
 const minute=(facts:Facts)=>{facts.objects[0].business.wire.effectiveTo.marketMinute='202610150001';facts.objects[0].business.wire.effectiveTo.utc='2026-10-14T23:01:00.000Z'}
 const li=(facts:Facts)=>{facts.objects[0].business.wire.caseReference='FORGED-LI'}
 // LI isolates source binding. The minute control removes BOTH binding and
 // midnight support guards; it does not claim to isolate binding alone.
 // Minute+UTC agree and the legacy calendar DATE remains unchanged.
 expect(probe(minute,true)).toBe(false) // Midnight guard independently holds.
 expect(probe(minute,true,true)).toBe(true) // BOTH guards removed: old design gap.
 expect(probe(li,true)).toBe(true) // Binding-only isolated red control.
 expect(probe(minute)).toBe(false);expect(probe(li)).toBe(false)
 const mutations:((facts:Facts)=>void)[]=[
  facts=>{facts.objects[0].business.wire.documentReference='OTHER-DOC'},
  facts=>{facts.objects[0].business.wire.reason='Z23';facts.objects[0].business.wire.subtype='LK'},
  facts=>{Object.assign(facts.objects[0].business.wire,{functionCode:'5'})},
  facts=>{facts.objects[0].business.wire.object.objectId='735123456789999999'},
  facts=>{facts.objects[0].business.wire.object.identityAgency='89'},
  facts=>{facts.objects[0].business.wire.legalSender='99999'},
  facts=>{facts.objects[0].business.wire.legalReceiver='99999'},
  facts=>{facts.objects[0].business.wire.transportSender='99999'},
  facts=>{facts.objects[0].business.wire.transportReceiverQualifier='ZZ'},
  facts=>{facts.objects[0].business.wire.object.registers[0].segmentIndex++},
  facts=>{facts.objects[0].business.sourcePayloadHash='f'.repeat(64)},
  facts=>{facts.objects[0].business.sourceMessageId=f.ids.source},
  facts=>{facts.objects[0].business.supplyPeriodId=f.ids.switch},
  facts=>{facts.objects[0].business.reviewerUserId=f.ids.actor},
  facts=>{facts.objects[0].business.baselineCoverageAssessment.factsHash='f'.repeat(64)},
  facts=>{facts.objects[0].business.coverageWindow.outboundSourceMessageId=message.id},
 ]
 for(const mutate of mutations)expect(probe(mutate)).toBe(false)
 expect(stored(message.id)).toHaveLength(1)
 expect(stored(message.id)[0].assessmentId).toBe(a.assessmentId)
 expect(stored(message.id)[0].witnessXid).toBe(a.witnessXid)
})
it('native closure append rechecks stale party, switch and outbound rows after the fresh reads',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 const originalRpc=supabaseService.rpc.bind(supabaseService)
 const mutate=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.supplier_switch_requests SET rff_li_reference='CHANGED' WHERE id=${literal(f.ids.switch)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([]);mutate.mockRestore()
 sql(`UPDATE public.supplier_switch_requests SET rff_li_reference='CASE-1' WHERE id=${literal(f.ids.switch)}`)
 const staleParty=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.tenant_actor_roles SET role_code='grid_owner' WHERE company_id=${literal(f.ids.company)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([]);staleParty.mockRestore()
 sql(`UPDATE public.tenant_actor_roles SET role_code='electricity_supplier' WHERE company_id=${literal(f.ids.company)}`)
 vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>{
  if(name==='gridex_record_source_object_decisions_v1')sql(`UPDATE public.ediel_messages SET message_sent_at=NULL WHERE id=${literal(f.ids.outbound)}`)
  return originalRpc(name,args,options)
 })
 expect(await closureReview(f,message.id)).toMatchObject({status:'unconfirmed'})
 expect(stored(message.id)).toEqual([])
})
it('a genuine non-midnight original is held by producer and direct append, even with consistent fresh evidence',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const message=await insertClosure(f,'Z22','202610151234')
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 const before=stored(message.id)
 expect(before.at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
 // Deliberately compose an untrusted direct-append proposal from actual fresh
 // owner reads. It is NOT a producer approval or a synthetic positive oracle.
 const {takeReceivedSourceOwnerSeed}=await import('@/lib/ediel/core/receivedSourceValidationLedger')
 const {bindReceivedRegisterValidation}=await import('@/lib/ediel/core/receivedRegisterValidationBinding')
 const {readClosureSourceWire}=await import('@/lib/ediel/sources/closureSourceWire')
 const {resolveClosureCoverage}=await import('@/lib/ediel/sources/closureReviewCoverage')
 const {findStructuralReviewPoint}=await import('@/lib/ediel/sources/structuralReviewReads')
 const {resolveCanonicalTenantEdielIdentityWithEvidence}=await import('@/lib/ediel/tenant/tenantEdielIdentity')
 const {readSelectedFacilityEvidence}=await import('@/lib/ediel/sources/sourceOwnerReads')
 const {evidenceHash}=await import('@/lib/ediel/utilts/durableSourceDiscovery')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
 const receipt=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:f.ids.company,decision})
 const ownerSeed=takeReceivedSourceOwnerSeed(receipt)!
 expect(ownerSeed).not.toBeNull()
 const canonical=JSON.parse(ownerSeed.evidence.factsText)
 const {disposition,reasons,...object}=bindReceivedRegisterValidation(canonical.registerValidation,message.raw_payload!)!.objects[0]
 expect(disposition).toBe('accepted');expect(reasons).toEqual([])
 const wire=readClosureSourceWire(message.raw_payload!,object)!,snapshot=await structuralSnapshot(f)
 const point=await findStructuralReviewPoint(f.ids.company,object.objectId!),assessedAt=new Date().toISOString()
 const receiver=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:f.ids.company,environment:'test',asOf:assessedAt,requireExactCounts:true})
 const facility=await readSelectedFacilityEvidence({companyId:f.ids.company,environment:'test',meteringPointId:f.ids.point,siteId:f.ids.site,objectId:object.objectId!,signal:AbortSignal.timeout(5000)})
 const {source,coverage,legacyEndDateProjection}=await resolveClosureCoverage(ownerSeed,wire,snapshot,point)
 const business={version:1,owner:'reviewed-received-closure-v1',coverage:'reviewed_post_ledger_closure',sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',
  sourceMessageId:message.id,sourcePayloadHash:ownerSeed.evidence.sourcePayloadHash,sourceReceivedAt:message.message_received_at,companyId:f.ids.company,environment:'test',object,assessedAt,wire,reviewerUserId:f.ids.reviewer,
  reviewStatement:'original_supply_closure',customerId:f.ids.customer,meteringPointId:f.ids.point,siteId:f.ids.site,switchRequestId:coverage.switchRequestId,supplyPeriodId:coverage.supplyPeriodId,coverageWindow:coverage,
  baselineCurrentAssessmentId:source.asOf!.assessmentId,baselineCoverageAssessment:{sourceMessageId:source.sourceMessageId,assessmentId:source.asOf!.assessmentId,factsHash:source.asOf!.factsHash,payloadHash:source.payloadHash},
  reviewSnapshot:{snapshotId:snapshot.timeline.snapshotId,readsetHash:snapshot.timeline.readsetHash,cutoffAt:snapshot.timeline.cutoffAt},legacyEndDateProjection}
 const party={version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{sourceMessageId:message.id,sourcePayloadHash:ownerSeed.evidence.sourcePayloadHash,companyId:f.ids.company,environment:'test',receivedAt:message.message_received_at},
  object,assessedAt,completedAt:new Date().toISOString(),historicalKnowledge:'not_established',authentication:'not_assessed',disposition:'accepted',reasons:[],receiver,facility,
  parties:{legalSender:wire.legalSender,legalReceiver:wire.legalReceiver,transportSender:wire.transportSender,transportReceiver:wire.transportReceiver}}
 const facts=JSON.stringify({version:1,owner:'received-source-object-decisions-v1',ruleVersion:'1',canonicalFactsHash:evidenceHash(ownerSeed.evidence.factsText),objects:[{object,disposition:'accepted',reasons:[],business,party}]})
 const probe=(removeMidnight:boolean)=>sql<boolean>(`BEGIN;
  ${removeMidnight?`DO $mutation$ DECLARE definition text; needle text:='OR substring(wire#>>''{effectiveTo,marketMinute}'',9,4) IS DISTINCT FROM ''0000'''; BEGIN
   SELECT pg_get_functiondef('gridex_received_sources.review_closure_proof_consistent(jsonb,jsonb,uuid)'::regprocedure) INTO definition;
   IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'closure_native_midnight_mutation_missing'; END IF;
   EXECUTE replace(definition,needle,'OR false'); END $mutation$;`:''}
  CREATE FUNCTION pg_temp.closure_original_probe() RETURNS boolean LANGUAGE plpgsql AS $probe$ BEGIN
   PERFORM gridex_received_sources.append_object_assessment(${literal(f.ids.company)},'test',${literal(message.id)},${literal(ownerSeed.evidence.sourcePayloadHash)},${literal(ownerSeed.assessmentId)},${literal(facts)});
   RETURN true; EXCEPTION WHEN check_violation THEN RETURN false; END $probe$;
  SELECT to_jsonb(pg_temp.closure_original_probe()); ROLLBACK;`)
 expect(probe(false)).toBe(false)
 expect(probe(true),JSON.stringify(closureSqlDiagnostics({p_company_id:f.ids.company,p_environment:'test',p_source_message_id:message.id,p_source_payload_hash:ownerSeed.evidence.sourcePayloadHash,p_canonical_assessment_id:ownerSeed.assessmentId,p_facts_text:facts},true))).toBe(true) // Only midnight guard removed; original binding remains.
 expect(stored(message.id)).toEqual(before)
})
it('an unwitnessed later Z04 review cannot fall back to the older accepted coverage for closure',async()=>{
 const f=await seed(false,true);expect(await complete(f)).toMatchObject({sourceDisposition:'accepted'});await reviewed(f)
 const baseline=stored(f.ids.source).at(-1)!,originalRpc=supabaseService.rpc.bind(supabaseService)
 const stale=await supabaseService.rpc('gridex_record_source_object_decisions_v1',{p_company_id:f.ids.company,p_environment:'test',p_source_message_id:f.ids.source,
  p_source_payload_hash:baseline.sourceHash,p_canonical_assessment_id:baseline.canonicalId,p_facts_text:baseline.factsText})
 expect(stale.error).toMatchObject({code:'23514',message:'source_object_owner_snapshot_changed'})
 expect(stored(f.ids.source)).toHaveLength(2)
 // A fresh reviewed composition must name the currently latest baseline.
 // Replaying old review facts is correctly denied as stale by SQL. Withhold
 // only its separate witness via a real database hash-mismatch rejection.
 const witnessFailure=vi.spyOn(supabaseService,'rpc').mockImplementation((name,args,options)=>
  originalRpc(name,name==='gridex_witness_source_objects_v1'?{...args,p_facts_hash:'0'.repeat(64)}:args,options))
 expect(await reviewReceivedStructuralSource({companyId:f.ids.company,environment:'test',sourceMessageId:f.ids.source,
  reviewerUserId:f.ids.reviewer,confirmedOriginal:true,replacesSourceMessageId:null})).toMatchObject({status:'unconfirmed'})
 witnessFailure.mockRestore()
 const revisions=stored(f.ids.source)
 expect(revisions).toHaveLength(3)
 expect(revisions.at(-1)!.assessmentId).not.toBe(baseline.assessmentId)
 expect(revisions.at(-1)!.witnessXid).toBeNull()
 expect(revisions.at(-1)!.facts).toMatchObject({objects:[{disposition:'accepted',business:{baselineCurrentAssessmentId:baseline.assessmentId}}]})
 const message=await insertClosure(f)
 expect((await applyInboundBusinessStateMachine({message,actorUserId:f.ids.actor})).outcome).toBe('supply_terminated')
 expect(await closureReview(f,message.id)).toMatchObject({status:'recorded',sourceDisposition:'not_established'})
 expect(stored(message.id).at(-1)!.facts).toMatchObject({objects:[{disposition:'unavailable',business:null}]})
})
