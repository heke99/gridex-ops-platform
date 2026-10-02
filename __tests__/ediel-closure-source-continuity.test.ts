import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:mocks.rpc}}))
vi.mock('@/lib/ediel/sources/structuralReviewReads',()=>({readStructuralReviewRow:mocks.read}))
import {resolveClosureCoverage} from '@/lib/ediel/sources/closureReviewCoverage'
import {isReviewedStructuralBusiness,type ReviewedStructuralBusiness} from '@/lib/ediel/sources/reviewedStructuralSource'
import {readStructuralSourceWire} from '@/lib/ediel/sources/structuralSourceWire'
import {emptySourceDecisionTimeline,type RecordedSourceAssessment} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import type {SourceOwnerSeed} from '@/lib/ediel/sources/sourceOwnerPersistence'
import {parseCanonicalEdifactAst} from '@/lib/ediel/core/canonicalEdifactAst'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {closureMarkerFixture} from './helpers/closureOwnerFixtures'
import {structuralOwnerSource} from './helpers/structuralOwnerFixtures'
import {OWNER,ownerId} from './helpers/sourceOwnerFixtures'

// Declared immutable-reader fixtures exercise the actual consumer; they are
// not native source admissions or transferable historical approval evidence.
function fixture(){
 const close=closureMarkerFixture(),baseline=structuralOwnerSource();baseline.raw_payload=baseline.raw_payload!.replace('202610010000','202610011230')
 const ast=parseCanonicalEdifactAst(baseline.raw_payload)
 const groups=prodatRegisterGroups(ast.segments,ast.una).groups
 const scope={messageIndex:0,messageReference:'M',objectId:OWNER.external,identityAgency:'9',registers:groups.map(g=>({lineIndex:g.lineIndex,lineNumber:g.lineNumber,registerIndex:g.registerIndex,registerPosition:g.registerPosition,segmentIndex:g.segments[0].index}))}
 const wire=readStructuralSourceWire(baseline.raw_payload,scope)!
 const coverage={...close.business.coverageWindow,validFrom:wire.effectiveFrom.utc}
 const prior:ReviewedStructuralBusiness={version:1,owner:'reviewed-received-structure-v1',coverage:'reviewed_post_ledger_supply',sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',sourceMessageId:OWNER.source,sourcePayloadHash:evidenceHash(baseline.raw_payload),sourceReceivedAt:'2026-09-23T09:30:00Z',companyId:OWNER.company,environment:'test',object:scope,assessedAt:'2026-09-23T09:40:00Z',wire,reviewerUserId:OWNER.actor,reviewStatement:'original_structural_message',customerId:OWNER.customer,meteringPointId:OWNER.point,siteId:OWNER.site,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,coverageWindow:coverage,baselineCurrentAssessmentId:ownerId(34),reviewSnapshot:close.business.reviewSnapshot,replaces:null}
 const root={object:scope,disposition:'accepted',reasons:[],business:{owner:'inbound-z04-switch-confirmation-v1',sourceMessageId:OWNER.source,sourcePayloadHash:prior.sourcePayloadHash,companyId:OWNER.company,environment:'test',customerId:OWNER.customer,meteringPointId:OWNER.point,siteId:OWNER.site,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,effectiveFrom:{...wire.effectiveFrom,committedDatePrecision:'market_minute'}},party:null}
 const record:RecordedSourceAssessment={assessmentId:coverage.baselineAssessmentId,previousAssessmentId:null,canonicalAssessmentId:ownerId(90),factsHash:coverage.baselineFactsHash,assessedAt:prior.assessedAt,availableAt:prior.assessedAt,availabilityWitnessId:ownerId(91),recordedDisposition:'accepted',objects:[]}
 const timeline=emptySourceDecisionTimeline();Object.assign(timeline,{status:'inspected',boundedReadComplete:true,ledgerStartedAt:'2026-09-23T08:00:00Z',cutoffAt:'2026-09-23T10:00:30Z'})
 timeline.sources=[{sourceMessageId:OWNER.source,payloadHash:prior.sourcePayloadHash,receivedAt:prior.sourceReceivedAt,capturedAt:prior.sourceReceivedAt,messageCode:'Z04',visibility:'witnessed',asOf:record,revisions:[{...record,availability:'witnessed_by_cutoff'}]}]
 const readset:StructuralReadset={timeline,versions:[],closures:[],closureBlockers:[],correctionContextBlockers:[],unresolvedSources:false,sources:[{sourceMessageId:OWNER.source,rawPayload:baseline.raw_payload,payloadHash:prior.sourcePayloadHash,asOf:record,objects:[{object:scope,disposition:'accepted',reasons:[],business:prior,party:null}],assessments:[{id:coverage.baselineAssessmentId,factsText:JSON.stringify({objects:[root]}),factsHash:coverage.baselineFactsHash,availableAt:prior.assessedAt}]}]}
 const seed:SourceOwnerSeed={original:{...baseline,id:close.business.sourceMessageId,message_code:'Z05',raw_payload:close.raw},assessmentId:ownerId(92),evidence:{companyId:OWNER.company,environment:'test',sourceMessageId:close.business.sourceMessageId,sourcePayloadHash:evidenceHash(close.raw),factsText:'{}'}}
 const point={id:OWNER.point,customer_id:OWNER.customer,site_id:OWNER.site}
 const basis={qualified:true,companyId:OWNER.company,periodId:OWNER.supply,switchId:OWNER.switch,initialSourceMessageId:OWNER.source,sourceMessageId:seed.evidence.sourceMessageId,customerId:OWNER.customer,meteringPointId:OWNER.point,siteId:OWNER.site,marketStartAt:wire.effectiveFrom.utc,marketEndAt:close.business.wire.effectiveTo.utc,dsoEdielId:close.business.wire.legalSender,originalMessageId:coverage.outboundSourceMessageId,originalAcceptedAt:'2026-09-23T09:10:00Z',sourceObjects:[{point:OWNER.external,identityAgency:'9'}]}
 const sw={id:OWNER.switch,inbound_z04_message_id:OWNER.source,status:'completed',rff_li_reference:wire.caseReference,customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,source_switch_request_id:null,confirmed_start_date:'2026-10-01',created_at:coverage.switchCreatedAt,outbound_z03_message_id:coverage.outboundSourceMessageId}
 const period={id:OWNER.supply,source_message_id:OWNER.source,status:'ending',end_date:'2026-10-15',customer_id:OWNER.customer,metering_point_id:OWNER.point,source_switch_request_id:OWNER.switch,start_date:'2026-10-01'}
 const outbound={environment:'test',direction:'outbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z03',customer_id:OWNER.customer,metering_point_id:OWNER.point,site_id:OWNER.site,created_at:coverage.outboundCreatedAt,message_sent_at:null}
 mocks.read.mockImplementation(async(table:string)=>table==='supplier_switch_requests'?sw:table==='customer_supply_periods'?period:outbound)
 mocks.rpc.mockImplementation(()=>({abortSignal:async()=>({data:basis,error:null})}))
 return {seed,wire:close.business.wire,readset,point,basis,prior}
}
beforeEach(()=>vi.resetAllMocks())
it('uses protected initial+closing-source proof for a completed switch with a minute start and future ending',async()=>{
 const f=fixture();expect(isReviewedStructuralBusiness(f.prior,f.readset.sources[0].rawPayload,f.prior.object)).toBe(true)
 await expect(resolveClosureCoverage(f.seed,f.wire,f.readset,f.point,OWNER.actor)).resolves.toMatchObject({coverage:{validFrom:'2026-10-01T11:30:00.000Z'}})
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_source_supply_basis_v1',{p_company_id:OWNER.company,p_actor_user_id:OWNER.actor,p_period_id:OWNER.supply,p_start:f.prior.coverageWindow.validFrom,p_end:f.wire.effectiveTo.utc})
})
it.each(['sourceMessageId','initialSourceMessageId','switchId','siteId','dsoEdielId','originalMessageId'])('holds changed protected %s without mutable status fallback',async key=>{
 const f=fixture();Object.assign(f.basis,{[key]:ownerId(99)})
 await expect(resolveClosureCoverage(f.seed,f.wire,f.readset,f.point,OWNER.actor)).rejects.toThrow('closure_baseline_ambiguous');expect(mocks.read).not.toHaveBeenCalled()
})
it('cannot replace missing witnessed baseline with a current protected period',async()=>{
 const f=fixture();f.readset.timeline.sources[0].revisions=[]
 await expect(resolveClosureCoverage(f.seed,f.wire,f.readset,f.point,OWNER.actor)).rejects.toThrow('closure_baseline_ambiguous');expect(mocks.rpc).not.toHaveBeenCalled()
})
it('holds source reader errors rather than reconstructing authority from current rows',async()=>{
 const f=fixture();mocks.rpc.mockImplementation(()=>({abortSignal:async()=>({data:null,error:Error('held')})}))
 await expect(resolveClosureCoverage(f.seed,f.wire,f.readset,f.point,OWNER.actor)).rejects.toThrow('closure_baseline_ambiguous');expect(mocks.read).not.toHaveBeenCalled()
})
it('matches the committed start instant whatever its timestamptz spelling, and still holds a different instant',async()=>{
 const f=fixture(),utc=f.prior.coverageWindow.validFrom
 f.prior.coverageWindow.validFrom=new Date(utc).toISOString().replace('.000Z','+00:00')
 await expect(resolveClosureCoverage(f.seed,f.wire,f.readset,f.point,OWNER.actor)).resolves.toMatchObject({source:{sourceMessageId:OWNER.source}})
 const g=fixture();g.prior.coverageWindow.validFrom=new Date(Date.parse(g.prior.coverageWindow.validFrom)+60_000).toISOString().replace('.000Z','+00:00')
 await expect(resolveClosureCoverage(g.seed,g.wire,g.readset,g.point,OWNER.actor)).rejects.toThrow('closure_baseline_ambiguous')
})
