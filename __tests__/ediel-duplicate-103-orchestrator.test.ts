// Declared native reception/command IO proves actual producer dispatch only;
// duplicate source authorization and wire execute in their separate owner tests.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({reception:vi.fn(),duplicate:vi.fn(),ordinary:vi.fn(),event:vi.fn(),outbox:vi.fn(),create:vi.fn(),supersede:vi.fn()}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({readInboundReceptionRequest:io.reception}))
vi.mock('@/lib/ediel/inbound/duplicateResponses',()=>({prepareDuplicate103Response:io.duplicate}))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft',()=>({prepareSourceAckDraft:io.ordinary}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.create}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:io.outbox}))
vi.mock('@/lib/ediel/outbox/supersedeWrongDrafts',()=>({supersedeWrongDraftsForDecision:io.supersede}))
import {runAutoAckOrchestratorForInboundMessage} from '@/lib/ediel/orchestrator/autoAckOrchestrator'
const source={id:'source',company_id:'company',environment:'test',direction:'inbound',message_family:'PRODAT'} as EdielMessageRow
const input={actorUserId:'actor',sourceMessage:source,inboundEmailMessageId:'new-mail',decision:{kind:'no_ack' as const,ackFamily:null,outcome:null,messageText:null,applicationErrors:[],ruleKeys:[],classification:null,reason:'ordinary business result irrelevant to the new reception'},autoSend:true}
beforeEach(()=>{
 vi.resetAllMocks()
 io.reception.mockResolvedValue({classification:'protocol_duplicate',status:'held',reason:'authentic_duplicate_transport_response_policy_required'})
 io.duplicate.mockResolvedValue({ackMessage:{id:'new-103'},replayed:false})
})
const noOrdinaryEffect=()=>{
 expect(io.ordinary).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled();expect(io.outbox).not.toHaveBeenCalled()
 expect(io.create).not.toHaveBeenCalled();expect(io.supersede).not.toHaveBeenCalled()
}
it.each([false,true])('a genuine new reception executes the shared native103 command; replay=%s',async replayed=>{
 io.duplicate.mockResolvedValue({ackMessage:{id:'new-103'},replayed})
 expect(await runAutoAckOrchestratorForInboundMessage(input)).toMatchObject({status:replayed?'retained':'created',ackMessageId:'new-103',lifecycleStatus:'duplicate_protocol_response_prepared'})
 expect(io.duplicate).toHaveBeenCalledExactlyOnceWith({companyId:'company',sourceMessageId:'source',inboundEmailMessageId:'new-mail',actorUserId:'actor'})
 noOrdinaryEffect()
})
it('native current authority/source failure remains held without old business effects or final response',async()=>{
 io.duplicate.mockRejectedValue(new Error('current_actor_denied: private source details'))
 expect(await runAutoAckOrchestratorForInboundMessage(input)).toMatchObject({status:'manual_review',ackMessageId:null,reason:'current_actor_denied'})
 noOrdinaryEffect()
})
it.each(['identity_conflict','first_reception'])('a held %s does not mint a protocol duplicate response',async classification=>{
 io.reception.mockResolvedValue({classification,status:'held',reason:'held-native-original'})
 expect(await runAutoAckOrchestratorForInboundMessage(input)).toMatchObject({status:'manual_review',ackMessageId:null})
 expect(io.duplicate).not.toHaveBeenCalled();noOrdinaryEffect()
})
it('an unsupported source family remains explicit native-policy hold',async()=>{
 expect(await runAutoAckOrchestratorForInboundMessage({...input,sourceMessage:{...source,message_family:'UTILTS'}})).toMatchObject({status:'manual_review',ackMessageId:null})
 expect(io.duplicate).not.toHaveBeenCalled();noOrdinaryEffect()
})
