import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({caseRow:{} as Record<string,unknown>,source:{} as Record<string,unknown>,update:vi.fn(),apply:vi.fn(),acks:vi.fn(),final:vi.fn(),actor:vi.fn(),onboard:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:io.caseRow,error:null})})})})}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({from:()=>({update:(payload:Record<string,unknown>)=>{
 io.update(payload);const query={eq:()=>query,select:()=>query,maybeSingle:async()=>({data:{...io.caseRow,...payload},error:null})};return query
}})})}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.source,createEdielMessageEvent:vi.fn(),linkEdielMessage:vi.fn()}))
vi.mock('@/lib/ediel/safeApplyReview',()=>({approveSafeMasterdataChanges:io.apply}))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks',()=>({createReceivedProdatStructuralAcks:io.acks}))
vi.mock('@/lib/ediel/core/receivedProdatFinalResponsePlan',()=>({readReceivedProdatFinalResponsePlan:io.final}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/customers/canonicalOnboarding',()=>({canonicalIdempotencyKey:vi.fn(),onboardCustomerGraph:io.onboard}))
import {approveEdielInboundCase} from '@/lib/ediel/inboundCases'
const company='00000000-0000-4000-8000-000000000001',source='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003'
beforeEach(()=>{
 vi.clearAllMocks();io.caseRow={id:'CASE',company_id:company,ediel_message_id:source,status:'pending_review',updated_at:'2026-10-01T00:00:00Z',review_decision:null,proposed_action:{objects:[{badParsedGuess:true}]}}
 io.source={id:source,company_id:company,message_family:'PRODAT',message_code:'Z06',environment:'test',raw_payload:'EXACT-PHYSICAL-SOURCE'}
 io.actor.mockResolvedValue(undefined);io.apply.mockResolvedValue({appliedCount:2,skippedCount:0});io.acks.mockResolvedValue(['OWN-ACK'])
 // Protected reader/native apply are explicit IO boundaries. Application and
 // immutable receipt authority are covered independently by their SQL tests.
 io.final.mockResolvedValue({plans:[{objectLineIndices:[7]}],totalObjectCount:2})
})
it('uses the original native own scope and keeps a partial case pending even when selected apply skippedCount is zero',async()=>{
 const result=await approveEdielInboundCase({companyId:company,actorUserId:actor,caseId:'CASE',mode:'update_existing_customer',structuralObjectLineIndices:[7]})
 expect(result.status).toBe('pending_review');expect(io.onboard).not.toHaveBeenCalled()
 expect(io.apply).toHaveBeenCalledWith({actorUserId:actor,edielMessageId:source,objectLineIndices:[7]})
 expect(io.acks).toHaveBeenCalledWith({actorUserId:actor,companyId:company,sourceMessageId:source,objectLineIndices:[7]})
 expect(io.update).toHaveBeenCalledWith(expect.objectContaining({review_decision:expect.objectContaining({structuralApplication:expect.objectContaining({appliedObjectCount:1,totalObjectCount:2})})}))
})
it('rejects supplied graph creation/foreign IDs before any native effect',async()=>{
 for(const override of [{mode:'create_new_customer' as const},{selectedMeteringPointId:'FOREIGN'},{companyId:'FOREIGN'}]){
  await expect(approveEdielInboundCase({companyId:company,actorUserId:actor,caseId:'CASE',...override})).rejects.toThrow()
 }
 expect(io.apply).not.toHaveBeenCalled();expect(io.acks).not.toHaveBeenCalled();expect(io.onboard).not.toHaveBeenCalled()
})
it('current actor denial precedes source application and own reply IO',async()=>{
 io.actor.mockRejectedValue(Error('ediel_tenant_actor_forbidden'))
 await expect(approveEdielInboundCase({companyId:company,actorUserId:actor,caseId:'CASE',mode:'update_existing_customer'})).rejects.toThrow('ediel_tenant_actor_forbidden')
 expect(io.apply).not.toHaveBeenCalled();expect(io.acks).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled()
})
