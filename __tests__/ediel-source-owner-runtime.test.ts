import {beforeEach,expect,it,vi} from 'vitest'
import {OWNER,ownerId,ownerRows,ownerSource} from './helpers/sourceOwnerFixtures'
const io=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>,calls:[] as {name:string;args:Record<string,unknown>}[],badReceipt:'',badCount:false,failTable:'',hideSupply:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:'PRODAT:Z04:L:26.A:r3',sourceHash:'a'.repeat(64),messageProfileId:'00000000-0000-4000-8000-000000000011',rulePackId:'00000000-0000-4000-8000-000000000012'})}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/sourceOwnerTestDatabase')).sourceOwnerTestDatabase(io)}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {createReceivedSourceOwnerSession} from '@/lib/ediel/sources/receivedSourceOwnerSession'
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
import {publishSourceSwitchCommit} from '@/lib/ediel/flows/sourceSwitchCommit'
import {inspectReceivedSourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import {timelineAssessment,timelineBody,timelineReceipt,timelineSource,timelineScope} from './helpers/sourceDecisionTimelineFixtures'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

const record=async(row=ownerSource())=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row)
 const receipt=await recordReceivedSourceValidation({original:row,validated:row,resolvedCompanyId:OWNER.company,decision})
 return {row,decision,receipt,session:createReceivedSourceOwnerSession(receipt)}
}
const apply=async(state:Awaited<ReturnType<typeof record>>)=>{
 if(!state.session)throw Error('missing fresh session')
 await applyInboundBusinessStateMachine({actorUserId:ownerId(50),message:state.row,matchedSwitchRequestId:OWNER.switch,onSourceSwitchCommitted:state.session.onSwitchCommitted})
 return state.session.finish()
}
const objectFacts=()=>JSON.parse(String(io.calls.find(c=>c.name==='gridex_record_source_object_decisions_v1')?.args.p_facts_text??'null'))
beforeEach(()=>{io.rows=ownerRows();io.calls=[];io.badReceipt='';io.badCount=false;io.failTable='';io.hideSupply=false})
it('uses a real fully accepted canonical register source as the positive oracle',async()=>{
 const {decision,receipt}=await record()
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
 expect(decision.validationReport.rulePackEvidence).toMatchObject({profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:'PRODAT:Z04:L:26.A:r3'})
 expect(JSON.parse(String(io.calls[0].args.p_facts_text)).rulePackEvidence.profileKey).toBe('PRODAT:Z04:L:26.A:r3')
 expect(decision.issues).toEqual([]);expect(decision.prodatRegisterValidation?.objects[0].disposition).toBe('accepted');expect(receipt.status).toBe('recorded')
})
it('composes the real canonical, tenant, selected-party and committed Z04 owners, then witnesses separately',async()=>{
 const state=await record();const receipt=await apply(state)
 expect(receipt).toMatchObject({status:'recorded',sourceDisposition:'accepted',assessmentId:ownerId(31),witnessId:ownerId(32)})
 expect(io.calls.map(x=>x.name)).toEqual(['gridex_record_source_validation_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])
 const fact=objectFacts();expect(fact.objects).toHaveLength(1)
 expect(fact.objects[0]).toMatchObject({disposition:'accepted',reasons:[],object:{messageIndex:0,messageReference:'M',objectId:OWNER.external,identityAgency:'9'},business:{owner:'inbound-z04-switch-confirmation-v1',switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,effectiveFrom:{fieldNumber:'210',marketMinute:'202610010000',utc:'2026-09-30T23:00:00.000Z'}},party:{receiver:{evidence:{completeness:'exact_count'}},parties:{legalSender:'12345',legalReceiver:'54321',transportSender:'12345',transportReceiver:'54321'}}})
 expect(await state.session!.finish()).toEqual(receipt);expect(io.calls).toHaveLength(3)
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
it.each(['gridex_record_source_validation_v1','gridex_record_source_object_decisions_v1','gridex_witness_source_objects_v1'])('rejects a foreign-company %s receipt',async name=>{
 io.badReceipt=name;const s=await record();if(name==='gridex_record_source_validation_v1'){expect(s.session).toBeNull();return}expect(await apply(s)).toMatchObject({status:'unconfirmed',sourceDisposition:'not_established'})
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
