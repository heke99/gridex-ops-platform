import {beforeEach,describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn(),message:{} as Record<string,unknown>}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:state.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:state.actor}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:vi.fn()}))
import {applyConfirmedCustomerSource,isConfirmedCustomerSourceCandidate} from '@/lib/ediel/production/confirmedCustomerSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import type {EdielMessageRow} from '@/lib/ediel/types'
const companyId='00000000-0000-0000-0000-000000000001',actorUserId='00000000-0000-0000-0000-000000000002',sourceMessageId='00000000-0000-0000-0000-000000000003',hash='a'.repeat(64)
const receipt={applied:true,owner:'confirmed-customer-source-v1',sourceMessageId,appliedCount:1,payloadHash:hash,eventId:companyId,objects:[{meteringPointId:companyId,siteId:companyId,effectiveAt:'2026-10-01T12:00Z',sourceReceivedAt:'2026-10-01T12:01Z'}]}
const witness={owner:'confirmed-customer-source-availability-v1',sourceMessageId,payloadHash:hash,availableAt:'2026-10-01T12:03Z'}
const wire="UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z06+SOURCE+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++735999123456789012:::9'CCI++Z13'CAV+E34'CCI++Z17'CAV+Z41'RFF+LI:OWN'NAD+UD+199001019999:SE1:260++TEST CUSTOMER'"
beforeEach(()=>{state.rpc.mockReset();state.actor.mockReset();state.actor.mockResolvedValue(undefined);state.message={id:sourceMessageId,company_id:companyId,direction:'inbound',message_family:'PRODAT',message_code:'Z06',raw_payload:wire,parsed_payload:{customerName:'FORGED'}}})
describe('actual customer source review consumer',()=>{
 it('routes physical Z06E to native source-only owner then separate committed availability witness',async()=>{state.rpc.mockResolvedValueOnce({data:receipt,error:null}).mockResolvedValueOnce({data:witness,error:null});expect((await approveSafeMasterdataChanges({actorUserId,edielMessageId:sourceMessageId})).status).toBe('applied');expect(state.actor).toHaveBeenCalledWith({companyId,actorUserId,permission:'customers.write'});expect(state.rpc.mock.calls).toEqual([['ediel_apply_reviewed_customer_source_v1',{p_company_id:companyId,p_source_message_id:sourceMessageId,p_actor_user_id:actorUserId}],['ediel_witness_confirmed_customer_source_v1',{p_company_id:companyId,p_source_message_id:sourceMessageId,p_actor_user_id:actorUserId}]]);expect(JSON.stringify(state.rpc.mock.calls)).not.toContain('FORGED')})
 it('surfaces held bilateral/life-event source; no success or witness is invented',async()=>{state.rpc.mockResolvedValue({data:{applied:false,reason:'customer_source_separate_bilateral_non_death_ground_required'},error:null});await expect(approveSafeMasterdataChanges({actorUserId,edielMessageId:sourceMessageId})).rejects.toThrow('separate_bilateral');expect(state.rpc).toHaveBeenCalledTimes(1)})
 it('cannot claim committed availability from the apply response or a wrong witness',async()=>{state.rpc.mockResolvedValueOnce({data:receipt,error:null}).mockResolvedValueOnce({data:{...witness,payloadHash:'b'.repeat(64)},error:null});await expect(applyConfirmedCustomerSource({companyId,sourceMessageId,actorUserId})).rejects.toThrow('availability_unconfirmed')})
 it('rejects foreign receipts before availability',async()=>{state.rpc.mockResolvedValue({data:{...receipt,sourceMessageId:companyId},error:null});await expect(applyConfirmedCustomerSource({companyId,sourceMessageId,actorUserId})).rejects.toThrow('receipt_invalid');expect(state.rpc).toHaveBeenCalledTimes(1)})
 // Deliberately incomplete, hostile selector input: this negative port test must
 // ignore mutable labels and may inspect only the original physical message.
 it('never routes F/G or mutable subtype/customer labels to the customer owner',()=>{for(const reason of ['E64','E32'])expect(isConfirmedCustomerSourceCandidate({...state.message,raw_payload:wire.replace('E34',reason),parsed_payload:{variant:'E',death:true}} as unknown as EdielMessageRow)).toBe(false)})
})
