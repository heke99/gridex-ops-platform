// Component regression: database READ/commit/ACK ports are declared substitutes.
// Real original-wire parsing, snapshot decoding, dated selection, safe apply and
// inbound-case callers execute. These DTOs are not native owner/coverage proof.
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {structuralOwnerSource} from './helpers/structuralOwnerFixtures'
import {timelineFacts,timelineSource,timelineAssessment,timelineBody,timelineReceipt} from './helpers/sourceDecisionTimelineFixtures'
import {ownerId,OWNER} from './helpers/sourceOwnerFixtures'
import {readStructuralSourceWire} from '@/lib/ediel/sources/structuralSourceWire'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {SourceObjectScope} from '@/lib/ediel/sources/sourceOwnerWire'
import type {ReviewedStructuralBusiness} from '@/lib/ediel/sources/reviewedStructuralSource'

const io=vi.hoisted(()=>({source:{} as ReturnType<typeof structuralOwnerSource>,snapshot:null as unknown,
 rpc:vi.fn(),actor:vi.fn(),acks:vi.fn(),final:vi.fn(),update:vi.fn(),caseRow:{} as Record<string,unknown>}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.source,createEdielMessageEvent:vi.fn(),linkEdielMessage:vi.fn()}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:()=>{throw Error('MUTABLE_PROPOSAL_FORBIDDEN')}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks',()=>({createReceivedProdatStructuralAcks:io.acks}))
vi.mock('@/lib/ediel/core/receivedProdatFinalResponsePlan',()=>({readReceivedProdatFinalResponsePlan:io.final}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:(table:string)=>{
 if(table!=='ediel_inbound_cases')throw Error('UNDECLARED_READ:'+table)
 const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:io.caseRow,error:null})};return query
}}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({from:()=>({update:(payload:Record<string,unknown>)=>{
 io.update(payload);const query={eq:()=>query,select:()=>query,maybeSingle:async()=>({data:{...io.caseRow,...payload},error:null})};return query
}})})}))
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {approveEdielInboundCase} from '@/lib/ediel/inboundCases'

const cutoff='2026-11-02T12:00:00.000Z',actor=ownerId(50)
const coverage={kind:'post_ledger_supply' as const,baselineSourceMessageId:ownerId(101),baselineAssessmentId:ownerId(201),baselineFactsHash:'a'.repeat(64),
 supplyPeriodId:OWNER.supply,switchRequestId:OWNER.switch,switchCreatedAt:'2026-09-22T09:00:00Z',outboundSourceMessageId:ownerId(103),
 outboundCreatedAt:'2026-09-22T09:01:00Z',validFrom:'2026-09-30T23:00:00.000Z',validTo:null}
function declaredSource(code:'Z04'|'Z10',n:number,oldMeter='METER-1',newMeter='NEW',minute='202610150000',
 replaces:ReviewedStructuralBusiness['replaces']=null){
 const message=structuralOwnerSource(code,'E64','SOURCE-'+n)
 message.id=ownerId(n);message.raw_payload=message.raw_payload!.replaceAll('RFF+Z02:METER-1','RFF+Z02:'+oldMeter)
 if(code==='Z10')message.raw_payload=message.raw_payload.replaceAll('RFF+MG:NEW','RFF+MG:'+newMeter).replaceAll('DTM+157:202610150000','DTM+157:'+minute)
 if(replaces)message.raw_payload=message.raw_payload.replace('BGM+Z10+SOURCE-'+n+'+9','BGM+Z10+SOURCE-'+n+'+5')
 const facts=timelineFacts(message.raw_payload)
 const object=facts.objects[0].object as SourceObjectScope
 const wire=readStructuralSourceWire(message.raw_payload,object)!
 if(!wire)throw Error('FIXTURE_WIRE_INVALID')
 // Closed serialized shape at a declared service READ boundary, never a grant
 // to install accepted owners or a replacement for B's real database producer.
 const business:ReviewedStructuralBusiness={version:1,owner:'reviewed-received-structure-v1',coverage:'reviewed_post_ledger_supply',
  sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',sourceMessageId:message.id,
  sourcePayloadHash:evidenceHash(message.raw_payload),sourceReceivedAt:message.message_received_at!,companyId:OWNER.company,environment:'test',object,
  assessedAt:'2026-10-16T10:00:00Z',wire,reviewerUserId:actor,reviewStatement:'original_structural_message',customerId:OWNER.customer,
  meteringPointId:OWNER.point,siteId:OWNER.site,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,coverageWindow:structuredClone(coverage),
  baselineCurrentAssessmentId:ownerId(201),reviewSnapshot:{snapshotId:ownerId(9000),readsetHash:'d'.repeat(64),cutoffAt:'2026-10-16T09:59:00Z'},replaces}
 const party={version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{sourceMessageId:message.id,sourcePayloadHash:evidenceHash(message.raw_payload),
  companyId:OWNER.company,environment:'test',receivedAt:message.message_received_at},object,assessedAt:'2026-10-16T10:00:00Z',completedAt:'2026-10-16T10:00:00Z',
  disposition:'accepted',reasons:[],receiver:{evidence:{completeness:'exact_count'}}}
 Object.assign(facts.objects[0],{disposition:'accepted',reasons:[],business,party})
 const factsText=JSON.stringify(facts)
 const source=timelineSource({sourceMessageId:message.id,rawPayload:message.raw_payload,payloadHash:evidenceHash(message.raw_payload),messageCode:code,
  receivedAt:message.message_received_at,capturedAt:'2026-09-22T10:00:00.001Z',assessments:[timelineAssessment(n+100,null,{factsText,factsHash:evidenceHash(factsText),
   assessedAt:'2026-10-16T10:00:00Z',availableAt:'2026-10-16T10:00:01Z'})]})
 return {message,source,object,business}
}
function fixture(oldMeter='METER-1',extra:ReturnType<typeof declaredSource>[]=[]){
 const baseline=declaredSource('Z04',101),candidate=declaredSource('Z10',102,oldMeter)
 io.source=candidate.message
 io.snapshot=timelineReceipt(timelineBody([baseline.source,candidate.source,...extra.map(v=>v.source)],{cutoffAt:cutoff,capturedAt:cutoff}))
 return candidate
}
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(cutoff));fixture()
 io.caseRow={id:'CASE',company_id:OWNER.company,ediel_message_id:ownerId(102),status:'pending_review',updated_at:'2026-10-16T00:00:00Z',review_decision:null}
 io.actor.mockResolvedValue(undefined);io.final.mockResolvedValue(null);io.acks.mockResolvedValue([])
 io.rpc.mockImplementation((name:string)=>{
  const result=name==='gridex_source_object_snapshot_v1'?{data:io.snapshot,error:null}
   :name==='ediel_apply_reviewed_structure_objects_v2'?{data:{applied:true,appliedCount:1,sourceMessageId:io.source.id,objects:[{}]},error:null}
   :{data:null,error:Error('UNDECLARED_RPC:'+name)}
  const response=Promise.resolve(result);return Object.assign(response,{abortSignal:()=>response})
 })
})
afterEach(()=>vi.useRealTimers())
const apply=()=>approveSafeMasterdataChanges({actorUserId:actor,edielMessageId:io.source.id})
const commits=()=>io.rpc.mock.calls.filter(([name])=>name==='ediel_apply_reviewed_structure_objects_v2')

it('refuses a contradictory original old meter before any new first-effect commit',async()=>{
 fixture('UNRELATED-OLD-METER')
 await expect(apply()).rejects.toThrow('structural_meter_exchange_unresolved')
 expect(commits()).toEqual([])
})
it('keeps the public inbound case pending and creates no ACK for that qualified refusal',async()=>{
 fixture('UNRELATED-OLD-METER')
 expect(await approveEdielInboundCase({companyId:OWNER.company,actorUserId:actor,caseId:'CASE'})).toMatchObject({status:'pending_review'})
 expect(commits()).toEqual([]);expect(io.acks).not.toHaveBeenCalled()
})
it('allows a matching dated predecessor through the existing native owner',async()=>{
 await expect(apply()).resolves.toMatchObject({status:'applied'})
 expect(commits()).toHaveLength(1)
})
it('compares at the original effective instant even when a later exchange is already known',async()=>{
 fixture('METER-1',[declaredSource('Z10',104,'NEW','LATER','202610200000')])
 await expect(apply()).resolves.toMatchObject({status:'applied'})
 expect(commits()).toHaveLength(1)
})
it('preserves protected fully committed replay before reading a now unavailable universe',async()=>{
 const candidate=fixture('UNRELATED-OLD-METER')
 io.snapshot=null;io.final.mockResolvedValue({sourceMessage:io.source,plans:[{effectKind:'structural',objectLineIndices:[candidate.object.registers[0].segmentIndex]}],totalObjectCount:1})
 await expect(apply()).resolves.toMatchObject({status:'applied'})
 expect(commits()).toHaveLength(1);expect(io.rpc.mock.calls.some(([name])=>name==='gridex_source_object_snapshot_v1')).toBe(false)
})
it('does not turn corrupt/unavailable protected evidence into a successful business refusal',async()=>{
 io.snapshot=null
 await expect(apply()).rejects.toThrow('structural_apply_snapshot_unavailable')
 expect(commits()).toEqual([]);expect(io.update).not.toHaveBeenCalled()
})
it('propagates snapshot transport failure and never commits or ACKs',async()=>{
 io.rpc.mockImplementation((name:string)=>{if(name==='gridex_source_object_snapshot_v1')throw Error('DECLARED_TRANSPORT_FAILURE');throw Error('UNEXPECTED_COMMIT')})
 await expect(approveEdielInboundCase({companyId:OWNER.company,actorUserId:actor,caseId:'CASE'})).rejects.toThrow('DECLARED_TRANSPORT_FAILURE')
 expect(commits()).toEqual([]);expect(io.acks).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled()
})
it('denies the actor before protected effect/snapshot reads',async()=>{
 io.actor.mockRejectedValue(Error('ediel_tenant_actor_forbidden'))
 await expect(apply()).rejects.toThrow('ediel_tenant_actor_forbidden')
 expect(io.final).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled()
})
it('resolves a witnessed function-5 replacement before comparing its predecessor',async()=>{
 const baseline=declaredSource('Z04',101),superseded=declaredSource('Z10',105,'METER-1','SUPERSEDED','202610140000')
 const candidate=declaredSource('Z10',102,'METER-1','NEW','202610150000',{
  sourceMessageId:superseded.message.id,assessmentId:ownerId(205),payloadHash:evidenceHash(superseded.message.raw_payload!)})
 io.source=candidate.message
 io.snapshot=timelineReceipt(timelineBody([baseline.source,superseded.source,candidate.source],{cutoffAt:cutoff,capturedAt:cutoff}))
 await expect(apply()).resolves.toMatchObject({status:'applied'})
 expect(commits()).toHaveLength(1)
})
it('does not borrow a sibling committed effect for a still-uncommitted requested scope',async()=>{
 const candidate=fixture('UNRELATED-OLD-METER')
 io.final.mockResolvedValue({sourceMessage:io.source,plans:[{effectKind:'structural',objectLineIndices:[999]}],totalObjectCount:2})
 await expect(approveSafeMasterdataChanges({actorUserId:actor,edielMessageId:io.source.id,
  objectLineIndices:[candidate.object.registers[0].segmentIndex]})).rejects.toThrow('structural_meter_exchange_unresolved')
 expect(commits()).toEqual([])
})
it('holds a same-time competing source instead of choosing the incoming candidate',async()=>{
 fixture('METER-1',[declaredSource('Z10',104)])
 await expect(apply()).rejects.toThrow('structural_apply_current_selection_unavailable:structural_same_time_ambiguous')
 expect(commits()).toEqual([])
})
it('does not accept a snapshot from another tenant even with internally consistent hashes',async()=>{
 const receipt=io.snapshot as ReturnType<typeof timelineReceipt>,body=JSON.parse(receipt.readsetText)
 body.companyId=ownerId(999);io.snapshot=timelineReceipt(body)
 await expect(apply()).rejects.toThrow('structural_apply_snapshot_unavailable')
 expect(commits()).toEqual([])
})
it('rejects arbitrary error text instead of recording a qualified negative decision',async()=>{
 io.final.mockRejectedValue(Error('structural_meter_exchange_unresolved'))
 await expect(approveEdielInboundCase({companyId:OWNER.company,actorUserId:actor,caseId:'CASE'})).rejects.toThrow('structural_meter_exchange_unresolved')
 expect(commits()).toEqual([]);expect(io.acks).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled()
})
