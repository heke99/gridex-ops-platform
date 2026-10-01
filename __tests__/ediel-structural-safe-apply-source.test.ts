import {beforeEach,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({message:{id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'inbound',message_family:'PRODAT',message_code:'Z06',parsed_payload:{readingFrequency:'quarter_hourly',customerId:'ATTACKER'}},
 result:{} as unknown,actor:vi.fn(),rpc:vi.fn(),proposal:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:vi.fn()}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:state.proposal}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:state.actor}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:state.rpc,from:()=>{throw Error('UNEXPECTED_MUTABLE_ENTITY_WRITE')}}}))
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
const actorUserId='00000000-0000-4000-8000-000000000003'
beforeEach(()=>{vi.clearAllMocks();state.actor.mockResolvedValue(undefined);state.rpc.mockImplementation(async()=>({data:state.result,error:null}));state.result={applied:true,appliedCount:2,sourceMessageId:state.message.id,objects:[{}]}})
it('submits only genuine source/tenant/current actor to atomic owner, never mutable quarter-frequency or customer proposals',async()=>{
 expect(await approveSafeMasterdataChanges({actorUserId,edielMessageId:state.message.id})).toMatchObject({status:'applied',appliedCount:2})
 expect(state.actor).toHaveBeenCalledWith({companyId:state.message.company_id,actorUserId,permission:'metering.write'})
 expect(state.rpc).toHaveBeenCalledWith('ediel_apply_reviewed_structure_v1',{p_company_id:state.message.company_id,p_source_message_id:state.message.id,p_actor_user_id:actorUserId})
 expect(state.proposal).not.toHaveBeenCalled()
})
it('holds missing actual original review without manufacturing applied history',async()=>{
 state.result={applied:false,reason:'structural_apply_original_review_required'}
 await expect(approveSafeMasterdataChanges({actorUserId,edielMessageId:state.message.id})).rejects.toThrow('structural_apply_original_review_required')
})
it('denies current actor before any source application IO',async()=>{
 state.actor.mockRejectedValueOnce(Error('ediel_tenant_actor_forbidden'))
 await expect(approveSafeMasterdataChanges({actorUserId,edielMessageId:state.message.id})).rejects.toThrow('ediel_tenant_actor_forbidden')
 expect(state.rpc).not.toHaveBeenCalled()
})
