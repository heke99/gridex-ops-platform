// masterplan: ACK-09, AT-ACK-09
import {beforeEach,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {readCommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {EdielMessageRow} from '@/lib/ediel/types'
const company='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333',actorUserId='44444444-4444-4444-8444-444444444444'
const message={id,company_id:company,environment:'test',direction:'inbound',message_family:'APERAK',raw_payload:'declared immutable ACK wire'} as EdielMessageRow
function fixture(){return {kind:'exact_receipt',ackMessageId:id,ackFamily:'APERAK',ackPayloadHash:evidenceHash(message.raw_payload!),sourceMessageId:sourceId,companyId:company,environment:'test',result:{version:1,sourceMessage:{id:sourceId,company_id:company,environment:'test',direction:'outbound'},outcome:'positive',scope:'transaction',scopeOutcomes:[{reference:'OWN',outcome:'positive'}],finalAckReached:false,wholeSourceRejected:false,sourceAccepted:false,failureReason:null,idempotent:false}}}
beforeEach(()=>{io.rpc.mockReset();io.rpc.mockResolvedValue({error:null,data:fixture()})})
it('reads the exact retained partial outcome without current rule or tenant projections',async()=>{const result=await readCommittedInboundAck({actorUserId,message});expect(result).toMatchObject({kind:'exact_receipt',result:{sourceAccepted:false,finalAckReached:false}});expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_read_committed_inbound_ack_v2',{p_company_id:company,p_environment:'test',p_ack_message_id:id,p_actor_user_id:actorUserId,p_ack_payload_hash:evidenceHash(message.raw_payload!)})})
it('keeps unavailable historic aggregate summary explicit without inventing false or positive flags',async()=>{const {result,...base}=fixture();io.rpc.mockResolvedValue({error:null,data:{...base,kind:'legacy_diagnostic',outcome:result.outcome,scope:result.scope,scopeOutcomes:result.scopeOutcomes,summaryUnavailable:true}});const receipt=await readCommittedInboundAck({actorUserId,message});expect(receipt).toMatchObject({kind:'legacy_diagnostic',summaryUnavailable:true});expect(receipt).not.toHaveProperty('sourceAccepted');expect(receipt).not.toHaveProperty('finalAckReached')})
it.each(['ackMessageId','companyId','environment','ackPayloadHash','ackFamily'])('refuses an alleged existing proof with different own %s',async key=>{io.rpc.mockResolvedValue({error:null,data:{...fixture(),[key]:'other'}});await expect(readCommittedInboundAck({actorUserId,message})).rejects.toThrow('ack_committed_read_invalid')})
it('fresh source returns null; read errors propagate before any fresh interpretation',async()=>{io.rpc.mockResolvedValue({error:null,data:null});expect(await readCommittedInboundAck({actorUserId,message})).toBeNull();io.rpc.mockResolvedValue({error:Error('permission denied'),data:null});await expect(readCommittedInboundAck({actorUserId,message})).rejects.toThrow('permission denied')})
it('allows a fresh tenantless source to continue actual source-based tenant qualification after protected absence',async()=>{
 io.rpc.mockResolvedValue({error:null,data:null})
 expect(await readCommittedInboundAck({actorUserId,message:{...message,company_id:null}})).toBeNull()
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_read_committed_inbound_ack_v2',{p_company_id:null,p_environment:'test',p_ack_message_id:id,p_actor_user_id:actorUserId,p_ack_payload_hash:evidenceHash(message.raw_payload!)})
})
it('uses only a protected retained tenant and keeps the old partial result when the selector is absent',async()=>{
 const result=await readCommittedInboundAck({actorUserId,message:{...message,company_id:null}})
 expect(result).toMatchObject({kind:'exact_receipt',result:{sourceMessage:{company_id:company},sourceAccepted:false,finalAckReached:false}})
})
it('preserves protected legacy diagnostics without reconstructing a whole result for a tenantless selector',async()=>{
 const {result,...base}=fixture();io.rpc.mockResolvedValue({error:null,data:{...base,kind:'legacy_diagnostic',outcome:result.outcome,scope:result.scope,scopeOutcomes:result.scopeOutcomes,summaryUnavailable:true}})
 const retained=await readCommittedInboundAck({actorUserId,message:{...message,company_id:null}})
 expect(retained).toMatchObject({kind:'legacy_diagnostic',summaryUnavailable:true});expect(retained).not.toHaveProperty('sourceAccepted')
})
it.each([{companyId:null},{companyId:'not-a-tenant'},{result:{...fixture().result,sourceMessage:{...fixture().result.sourceMessage,company_id:'55555555-5555-4555-8555-555555555555'}}}])('holds a purported retained tenant without exact own protected result scope %s',async delta=>{
 io.rpc.mockResolvedValue({error:null,data:{...fixture(),...delta}})
 await expect(readCommittedInboundAck({actorUserId,message:{...message,company_id:null}})).rejects.toThrow('ack_committed_read_invalid')
})
it('does not turn a malformed nonnull tenant selector into an unscoped read',async()=>{
 await expect(readCommittedInboundAck({actorUserId,message:{...message,company_id:'not-a-tenant'}})).rejects.toThrow('ack_committed_read_scope_required')
 expect(io.rpc).not.toHaveBeenCalled()
})
