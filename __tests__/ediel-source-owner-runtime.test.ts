import {beforeEach,expect,it,vi} from 'vitest'
import {OWNER,ownerId,ownerRows,ownerSource} from './helpers/sourceOwnerFixtures'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,calls:[] as {name:string;args:Record<string,unknown>}[],badReceipt:'',badCount:false,failTable:'',hideSupply:false,message:undefined as ReturnType<typeof ownerSource>|undefined}))
const reading=vi.hoisted(()=>({sdk:null as import('./helpers/prodatOwnSourceReadingFixture').ProdatOwnSourceReadingSdk|null,phase:'canonical' as 'read'|'canonical'}))
vi.mock('@/lib/supabase/service',async()=>{
 reading.sdk=(await import('./helpers/prodatOwnSourceReadingFixture')).createProdatOwnSourceReadingSdk()
 const business=(await import('./helpers/sourceOwnerTestDatabase')).sourceOwnerTestDatabase(io)
 return {supabaseService:{
  from:(table:string)=>reading.phase==='read'?reading.sdk!.from(table):business.from(table),
  rpc:(name:string,args:Record<string,unknown>)=>reading.phase==='read'?reading.sdk!.rpc(name,args):business.rpc(name,args),
 }}
})
vi.mock('@/lib/ediel/db',async importOriginal=>({...await importOriginal<typeof import('@/lib/ediel/db')>(),createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {publishSourceSwitchCommit} from '@/lib/ediel/flows/sourceSwitchCommit'
import {inspectReceivedSourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import {timelineAssessment,timelineBody,timelineReceipt,timelineSource as sourceTimeline,timelineScope} from './helpers/sourceDecisionTimelineFixtures'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

const timelineSource=(overrides:Record<string,unknown>={})=>{
 const rawPayload=io.message?.raw_payload
 if(!rawPayload)throw Error('TIMELINE_TEST_SOURCE_MISSING')
 return sourceTimeline({rawPayload,payloadHash:evidenceHash(rawPayload),...overrides})
}

import {loadProdatOwnSourceReadingContext} from '@/lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'

// The bootstrap READ trace is separate from the unchanged canonical/business IO.
const readingScope={actorUserId:ownerId(50),receivedAt:'2026-09-22T10:00:00.000000Z',
 mailId:ownerId(60),parseId:ownerId(61),receptionId:ownerId(62),legalActorId:ownerId(9)}
const assertProtectedReadTrace=()=>{
 const sdk=reading.sdk!
 const permission={kind:'rpc',name:'gridex_actor_has_company_permission',args:{p_actor_user_id:ownerId(50),p_company_id:ownerId(2),p_permission:'communication.read'}}
 const edielPermission={kind:'rpc',name:'gridex_actor_has_company_permission',args:{p_actor_user_id:ownerId(50),p_company_id:ownerId(2),p_permission:'ediel.read'}}
 const membership={kind:'table',name:'company_memberships',args:{company_id:ownerId(2),user_id:ownerId(50),status:'active',is_active:true},notNull:['accepted_at']}
 const profile={kind:'table',name:'user_profiles',args:{id:ownerId(50),user_status:'active'},notNull:[]}
 const expected=[permission,permission,edielPermission,edielPermission,membership,membership,profile,profile,
  {kind:'table',name:'ediel_messages',args:{id:ownerId(1),company_id:ownerId(2)},notNull:[]},
  {kind:'rpc',name:'ediel_require_inbound_legal_context_v1',args:{p_company_id:ownerId(2),p_message_id:ownerId(1)}},
  {kind:'rpc',name:'ediel_inbound_reception_request_v1',args:{p_company_id:ownerId(2),p_message_id:ownerId(1),p_actor_user_id:ownerId(50),p_inbound_email_message_id:ownerId(60)}},
  {kind:'table',name:'inbound_email_messages',args:{id:ownerId(60),company_id:ownerId(2),environment:'test'},notNull:[]},
  {kind:'table',name:'inbound_ediel_parse_results',args:{id:ownerId(61),company_id:ownerId(2)},notNull:[]}]
 expect(sdk.calls).toHaveLength(13)
 // JSON sorts call records, not query fields: exact request keys/order stay visible.
 expect(sdk.calls.map(call=>JSON.stringify(call)).sort()).toEqual(expected.map(call=>JSON.stringify(call)).sort())
}

const record=async(row=ownerSource({readingDeclarations:true}))=>{
 io.message=structuredClone(row)
 installProdatOwnSourceReadingFixture(reading.sdk!,row,'L',readingScope)
 reading.sdk!.permissions=new Set(['communication.read'])
 reading.phase='read'
 let context:Awaited<ReturnType<typeof loadProdatOwnSourceReadingContext>>
 try{context=await loadProdatOwnSourceReadingContext(row,readingScope.actorUserId)}finally{reading.phase='canonical'}
 expect(context).not.toBeNull()
 assertProtectedReadTrace()
 expect(io.calls).toEqual([])
 expect(reading.sdk!.rows.ediel_messages).toEqual([io.message])
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row,{prodatOwnSourceReadingContext:context!,prodatOwnSourceReadingActorUserId:readingScope.actorUserId})
 const receipt=await recordReceivedSourceValidation({original:row,validated:row,resolvedCompanyId:OWNER.company,decision})
 return {row,decision,receipt,session:createReceivedSourceOwnerSession(receipt)}
}
const apply=async(state:Awaited<ReturnType<typeof record>>)=>{
 if(!state.session)throw Error('missing fresh session')
 await applyInboundBusinessStateMachine({actorUserId:ownerId(50),message:state.row,matchedSwitchRequestId:OWNER.switch,onSourceSwitchCommitted:state.session.onSwitchCommitted})
 return state.session.finish()
}
const objectFacts=()=>JSON.parse(String(io.calls.find(c=>c.name==='gridex_record_source_object_decisions_v1')?.args.p_facts_text??'null'))
beforeEach(()=>{io.rows=ownerRows();io.calls=[];io.badReceipt='';io.badCount=false;io.failTable='';io.hideSupply=false
 delete io.message;reading.phase='canonical';resetProdatOwnSourceReadingSdk(reading.sdk!)
})
it('uses a real fully accepted canonical register source as the positive oracle',async()=>{
 const {decision,receipt}=await record()
 expect(decision.issues).toEqual([])
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(decision.validationReport.rulePackEvidence).toMatchObject({profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:'PRODAT:Z04:L:26.A:r3'})
 expect(io.calls[0]).toEqual({name:'resolve_canonical_ediel_rule_pack_with_witness_v1',args:{p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'L',p_direction:'inbound',p_business_date:'2026-09-22'}})
 expect(JSON.parse(String(io.calls[1].args.p_facts_text)).rulePackEvidence).toMatchObject({profileKey:'PRODAT:Z04:L:26.A:r3',version:'26.A:r3',snapshot:{rulePack:{id:ownerId(12)},messageProfile:{id:ownerId(11),rule_pack_id:ownerId(12)}}})
 const full=JSON.parse(String(io.calls[1].args.p_object_facts_text));expect(full).toMatchObject({sharedAccepted:true,objects:[{objectId:OWNER.external,identityAgency:'9',firstLineIndex:0,lineItemReference:'CASE-1',disposition:'accepted',reasons:[],negativeFields:[]}]});expect(io.calls.filter(c=>c.name==='gridex_record_prodat_object_validation_v1')).toHaveLength(0)
 expect(decision.issues).toEqual([]);expect(decision.prodatRegisterValidation?.objects[0].disposition).toBe('accepted');expect(receipt.status).toBe('recorded')
})
it('composes the real canonical, tenant, selected-party and committed Z04 owners, then witnesses separately',async()=>{
 const state=await record();const receipt=await apply(state)
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'accepted',assessmentId:ownerId(31),witnessId:ownerId(32)})
 expect(io.calls.map(x=>x.name)).toEqual(['resolve_canonical_ediel_rule_pack_with_witness_v1','gridex_record_prodat_source_validation_v6','ediel_apply_supply_source_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])
 const fact=objectFacts();expect(fact.objects).toHaveLength(1)
 expect(fact.objects[0]).toMatchObject({disposition:'accepted',reasons:[],object:{messageIndex:0,messageReference:'M',objectId:OWNER.external,identityAgency:'9'},business:{owner:'inbound-z04-switch-confirmation-v1',switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,effectiveFrom:{fieldNumber:'210',marketMinute:'202610010000',utc:'2026-09-30T23:00:00.000Z'}},party:{receiver:{evidence:{completeness:'exact_count'}},parties:{legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321'}}})
 expect(await state.session!.finish()).toEqual(receipt);expect(io.calls).toHaveLength(5)
})
it('cannot rehydrate approval capability from copied canonical receipt JSON',async()=>{const {receipt}=await record();expect(createReceivedSourceOwnerSession(JSON.parse(JSON.stringify(receipt)))).toBeNull()})
it('a caller-provided commit-shaped object cannot impersonate the successful business path',async()=>{
 const s=await record();await s.session!.onSwitchCommitted({message:s.row,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply})
 expect(await s.session!.finish()).toMatchObject({sourceDisposition:'not_established'})
 expect(objectFacts()?.objects[0].disposition).toBe('unavailable')
})
it('without the successful write handoff, preexisting accepted rows and status reports are insufficient',async()=>{
 const s=await record();Object.assign(io.rows.supplier_switch_requests[0],{status:'accepted',confirmed_start_date:'2026-10-01'});io.rows.customer_supply_periods[0].status='confirmed_by_grid_owner'
 s.row.validation_report={sourceDisposition:'accepted',businessDisposition:'committed'}
 expect(await s.session!.finish()).toMatchObject({sourceDisposition:'not_established'});expect(objectFacts()?.objects[0].disposition).toBe('unavailable')
})
for(const table of ['tenant_ediel_profiles','tenant_actor_identifiers','tenant_actor_roles','metering_points','customer_sites','grid_owners'])it(`does not approve when actual ${table} evidence is unavailable`,async()=>{
 const s=await record();io.failTable=table;expect(await apply(s)).toMatchObject({sourceDisposition:'not_established'});expect(objectFacts()?.objects[0].disposition).toBe('unavailable')
})
it('truncated tenant reads never become accepted',async()=>{const s=await record();io.badCount=true;expect(await apply(s)).toMatchObject({sourceDisposition:'not_established'})})
for(const [table,key,value] of [
 ['grid_owners','ediel_id','99999'],['grid_owners','environment','production'],['grid_owners','is_active',false],
 ['tenant_actor_identifiers','identifier_value','99999'],['tenant_actor_roles','role_code','grid_owner'],
 ['metering_points','meter_point_id','FOREIGN'],['metering_points','site_id',ownerId(99)],['customer_sites','grid_owner_id',ownerId(99)],
 ['customer_supply_periods','start_date','2026-10-02'],
] as const)it(`withholds mismatched ${table}.${key}`,async()=>{const s=await record();io.rows[table][0][key]=value;expect(await apply(s)).toMatchObject({sourceDisposition:'not_established'});expect(objectFacts()?.objects[0].disposition).toBe('unavailable')})
it.each(['gridex_record_prodat_source_validation_v6','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])('rejects a foreign-company %s receipt',async name=>{
 io.badReceipt=name;const s=await record();if(name==='gridex_record_prodat_source_validation_v6'){expect(s.session).toBeNull();return}expect(await apply(s)).toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
})
it('binds the committed message to the immutable original rather than its mutable report',async()=>{
 const s=await record();const original=s.row.raw_payload;s.row.raw_payload=String(original).replace('12345:14','99999:14')
 expect(await apply(s)).toMatchObject({sourceDisposition:'not_established'})
})
it('a failed supply write cannot create any accepted assessment',async()=>{
 const s=await record();io.failTable='customer_supply_periods';await expect(apply(s)).rejects.toThrow('injected database failure')
 expect(await s.session!.finish()).toMatchObject({sourceDisposition:'not_established'});expect(objectFacts()?.objects[0].disposition).toBe('unavailable')
})
it('retires the in-process capability after callback completion',async()=>{
 const s=await record();let saved:Parameters<NonNullable<typeof s.session>['onSwitchCommitted']>[0]|undefined
 await publishSourceSwitchCommit(async c=>{saved=c},{message:s.row,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply})
 await s.session!.onSwitchCommitted(saved!);expect(await s.session!.finish()).toMatchObject({sourceDisposition:'not_established'})
})

for(const mutation of ['none','foreign-business','foreign-party','missing-owner'] as const)it(`timeline consumes actual composed owners without minting a new capability: ${mutation}`,async()=>{
 const state=await record(),receipt=await apply(state)
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'accepted'})
 if(receipt.status!=='recorded')throw Error('expected recorded source owner')
 const facts=objectFacts()
 if(mutation==='foreign-business')facts.objects[0].business.companyId=ownerId(999)
 if(mutation==='foreign-party')facts.objects[0].party.source.companyId=ownerId(999)
 if(mutation==='missing-owner')facts.objects[0].party=null
 const factsText=JSON.stringify(facts),at=receipt.availableAt
 const assessment=timelineAssessment(31,null,{canonicalAssessmentId:ownerId(30),assessedAt:at,availableAt:at,availabilityWitnessId:receipt.witnessId,factsText,factsHash:evidenceHash(factsText)})
 const body=timelineBody([timelineSource({assessments:[assessment]})],{cutoffAt:at,capturedAt:at})
 const result=inspectReceivedSourceDecisionTimeline({...timelineScope,cutoffAt:at},timelineReceipt(body))
 expect(result).toMatchObject({authorityStatus:'not_established',selection:'not_performed',marketSupersession:'not_performed'})
 if(mutation==='none'){
   expect(result.status).toBe('inspected');expect(result.sources[0].asOf).toMatchObject({assessmentId:receipt.assessmentId,recordedDisposition:'accepted',objects:[{object:{objectId:OWNER.external},disposition:'accepted'}]})
   expect(createReceivedSourceOwnerSession(JSON.parse(JSON.stringify(result.sources[0].asOf)))).toBeNull()
 } else expect(result).toMatchObject({status:'read_failed',sources:[],snapshotId:null})
})

it.each(['objectFactsHash','ignoredFieldsHash','responseFactsHash','applicationFactsHash','sourceFunctionFactsHash'])('a malformed primary atomic %s receipt creates no source-owner capability',async field=>{
 io.badReceipt='gridex_record_prodat_source_validation_v6:'+field
 const state=await record();expect(state.receipt).toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'});expect(state.session).toBeNull()
 expect(io.calls.some(c=>c.name==='ediel_apply_supply_source_v1'||c.name==='gridex_record_source_object_decisions_v1')).toBe(false)
})
