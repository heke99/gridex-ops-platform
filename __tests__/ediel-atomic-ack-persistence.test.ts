import {beforeEach,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {persistAtomicOutboundAck} from '@/lib/ediel/core/atomicAckPersistence'
// Mechanical port DTO and whitelist assertions. Native source/witness/race
// qualification is independently exercised by SQL/native fixtures.
const source={id:'source',company_id:'tenant',environment:'test',direction:'inbound',message_family:'UTILTS',message_code:'E66',raw_payload:'original physical bytes'} as EdielMessageRow
const ack={id:'ack',company_id:'tenant',environment:'test',direction:'outbound',message_standard:'edifact',message_family:'APERAK',related_message_id:'source',raw_payload:'own bytes',ack_outcome:'positive',parsed_payload:{relatedTransactionReference:'OWN'}} as EdielMessageRow
const authority={sourceMessage:source,companyId:'tenant',environment:'test',actorUserId:'actor',ackFamily:'APERAK' as const,sequenceField:'relatedTransactionReference' as const,sequenceValue:'OWN',outcome:'positive' as const}
const draft={actorUserId:'spoofed',companyId:'foreign',direction:'outbound',messageStandard:'edifact',messageFamily:'APERAK',messageCode:'APERAK',environment:'test',rawPayload:'own bytes',relatedMessageId:'foreign-source',outboundRequestId:'foreign-business',canonicalRulePackId:'foreign-pack',sourceOperationId:'foreign-op',executionContextSnapshot:{outboundOwnerWitnessId:'fake'},rulePackSnapshot:{fake:true},senderEmail:'reply@example.invalid',parsedPayload:{relatedTransactionReference:'OWN'}} as CreateEdielMessageInput
beforeEach(()=>{io.rpc.mockReset();io.rpc.mockResolvedValue({data:{version:1,sourceMessage:source,ackMessage:ack},error:null})})
it('sends only whitelist wire/metadata and explicit actual scoped actor/original selectors to one native command',async()=>{
 expect(await persistAtomicOutboundAck(draft,authority)).toEqual(ack)
 expect(io.rpc).toHaveBeenCalledTimes(1)
 const [name,args]=io.rpc.mock.calls[0]
 expect(name).toBe('ediel_create_outbound_ack_atomic_v1')
 expect(args).toMatchObject({p_company_id:'tenant',p_environment:'test',p_source_message_id:'source',p_actor_user_id:'actor',p_ack_family:'APERAK',p_sequence_field:'relatedTransactionReference',p_sequence_value:'OWN',p_outcome:'positive',p_common_smtp:null,p_source_payload_hash:createHash('sha256').update(source.raw_payload!).digest('hex')})
 expect(args.p_draft).toEqual({rawPayload:'own bytes',senderEmail:'reply@example.invalid',parsedPayload:{relatedTransactionReference:'OWN'}})
})
for(const patch of [{id:'foreign-source'},{company_id:'foreign'},{raw_payload:'changed'}, {direction:'outbound'},{message_code:'E31'}])it('holds mismatched actual original '+JSON.stringify(patch),async()=>{
 io.rpc.mockResolvedValue({data:{version:1,sourceMessage:{...source,...patch},ackMessage:ack},error:null})
 await expect(persistAtomicOutboundAck(draft,authority)).rejects.toThrow('actual_original_mismatch')
})
for(const patch of [{company_id:'foreign'},{environment:'production'},{related_message_id:'foreign-source'},{ack_outcome:'negative'},{parsed_payload:{relatedTransactionReference:'FOREIGN'}}])it('holds foreign/outcome/sequence own output '+JSON.stringify(patch),async()=>{
 io.rpc.mockResolvedValue({data:{version:1,sourceMessage:source,ackMessage:{...ack,...patch}},error:null})
 await expect(persistAtomicOutboundAck(draft,authority)).rejects.toThrow('atomic_output_scope_mismatch')
})
it('propagates native transaction failure without a fallback public insert/event',async()=>{
 const error={code:'P0001',message:'atomic_last_write_failure'};io.rpc.mockResolvedValue({data:null,error})
 await expect(persistAtomicOutboundAck(draft,authority)).rejects.toEqual(error);expect(io.rpc).toHaveBeenCalledTimes(1)
})
