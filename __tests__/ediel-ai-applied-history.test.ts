import {beforeEach,describe,expect,it,vi} from 'vitest'
// These fixtures exercise the equality port. They are not source-owner evidence.
const {rpc,businessFor}=vi.hoisted(()=>({rpc:vi.fn(),businessFor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
vi.mock('@/lib/ediel/sources/structuralSourceReadset',()=>({reviewedBusinessFor:businessFor}))
import {requireAiListAppliedHistory} from '@/lib/ediel/aiListAppliedHistory'
import type {AiListHistoricalProjection,AiListHistoryScope} from '@/lib/ediel/aiListHistory'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {emptySourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'

const scope:AiListHistoryScope={companyId:'company',environment:'test',customerId:'customer',siteId:'site',meteringPointId:'point',legalSupplier:'supplier',legalNetwork:'network',fromDate:'20261001',toDate:'20261101',cutoffAt:'2026-11-02T12:00:00Z'}
const object={messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers:[]}
const history:AiListHistoricalProjection={details:[{anlaggningsId:object.objectId,kodlista:'9',franDatum:'20261015'}],evidence:{version:1,owner:'ai-reviewed-source-history-v1',snapshotId:'snapshot',readsetHash:'hash',cutoffAt:scope.cutoffAt,sourceMessageIds:['baseline','change'],supplyPeriodIds:['period'],rowSources:[{sourceMessageId:'change',baselineSourceMessageId:'baseline',addressSourceMessageId:'change',supplyPeriodId:'period'}]}}
function readset():StructuralReadset{return {timeline:{...emptySourceDecisionTimeline(),status:'inspected',snapshotId:'snapshot',readsetHash:'hash',cutoffAt:scope.cutoffAt},versions:[
 {sourceMessageId:'baseline',assessmentId:'baseline-assessment',wire:{object,messageCode:'Z04'}},
 {sourceMessageId:'change',assessmentId:'change-assessment',wire:{object,messageCode:'Z06'}},
] as StructuralReadset['versions'],sources:[],closures:[],closureBlockers:[],correctionContextBlockers:[],unresolvedSources:false}}
const run=(data=history,sources=readset())=>requireAiListAppliedHistory({actorUserId:'actor',scope,history:data,readset:sources})
beforeEach(()=>{
 vi.clearAllMocks()
 businessFor.mockReturnValue({companyId:scope.companyId,environment:scope.environment,customerId:scope.customerId,siteId:scope.siteId,meteringPointId:'point',supplyPeriodId:'period'})
 rpc.mockReturnValue({abortSignal:async()=>({data:{applied:true},error:null})})
})
describe('actual applied AI history equality',()=>{
 it('requires the same applied source, physical object, snapshot and period once per row',async()=>{
  await run()
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('ediel_read_structural_effect_scope_v1',{p_company_id:'company',p_environment:'test',p_actor_user_id:'actor',p_snapshot_id:'snapshot',p_readset_hash:'hash',p_customer_id:'customer',p_site_id:'site',p_point_id:'point',p_period_id:'period',p_at:prodatMarketMinuteToUtc('202610150000'),p_source_message_id:'change',p_assessment_id:'change-assessment',p_object_id:object.objectId,p_identity_agency:'9'})
 })
 it.each([{data:{applied:false},error:null},{data:null,error:new Error('unavailable')},{data:{applied:'true'},error:null}])('holds without the actual immutable applied receipt (%j)',async result=>{
  rpc.mockReturnValue({abortSignal:async()=>result})
  await expect(run()).rejects.toThrow('ai_list_applied_structural_source_unconfirmed')
 })
 it('does not disclose a foreign or missing owned point to the effect reader',async()=>{
  businessFor.mockReturnValue({companyId:'foreign',environment:'test',customerId:'customer',siteId:'site',meteringPointId:'point',supplyPeriodId:'period'})
  await expect(run()).rejects.toThrow('ai_list_applied_history_own_scope_unconfirmed')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('holds a replaced snapshot or missing row source before the read',async()=>{
  const sources=readset();sources.timeline.snapshotId='other'
  await expect(run(history,sources)).rejects.toThrow('ai_list_applied_history_snapshot_unconfirmed')
  await expect(run({...history,evidence:{...history.evidence,rowSources:[]}})).rejects.toThrow('ai_list_applied_history_scope_incomplete')
  expect(rpc).not.toHaveBeenCalled()
 })
 it('checks an inherited change address independently from the current meter state',async()=>{
  const sources=readset();sources.versions.push({...sources.versions[1],sourceMessageId:'exchange',assessmentId:'exchange-assessment',wire:{...sources.versions[1].wire,messageCode:'Z10'}})
  await run({...history,evidence:{...history.evidence,rowSources:[{...history.evidence.rowSources[0],sourceMessageId:'exchange'}]}},sources)
  expect(rpc.mock.calls.map(call=>call[1].p_source_message_id)).toEqual(['exchange','change'])
 })
 it('leaves the genuine baseline to the mandatory native normal supply owner',async()=>{
  await run({...history,evidence:{...history.evidence,rowSources:[{sourceMessageId:'baseline',baselineSourceMessageId:'baseline',addressSourceMessageId:'baseline',supplyPeriodId:'period'}]}})
  expect(rpc).not.toHaveBeenCalled()
 })
})
