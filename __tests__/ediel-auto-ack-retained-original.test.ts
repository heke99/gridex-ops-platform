import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielEngineDecision} from '@/lib/ediel/decisionEngine'
const io=vi.hoisted(()=>({prepare:vi.fn(),outbox:vi.fn(),kernel:vi.fn(),list:vi.fn(),supersede:vi.fn(),event:vi.fn()}))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft',()=>({prepareSourceAckDraft:io.prepare}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.kernel}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:io.event,listAckMessagesForSource:io.list}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:io.outbox}))
vi.mock('@/lib/ediel/outbox/supersedeWrongDrafts',()=>({supersedeWrongDraftsForDecision:io.supersede}))
import {runAutoAckOrchestratorForInboundMessage} from '@/lib/ediel/orchestrator/autoAckOrchestrator'
const source={id:'source',company_id:'tenant',environment:'test',direction:'inbound',message_family:'UTILTS'} as EdielMessageRow
const original={id:'original',company_id:'tenant',environment:'test',direction:'outbound',message_family:'UTILTS_ERR',related_message_id:'source',raw_payload:'immutable original bytes'} as EdielMessageRow
const decision={kind:'ack',ackFamily:'UTILTS_ERR',outcome:'negative',messageText:'E19',reason:'Actual retained response'} as EdielEngineDecision
beforeEach(()=>{vi.clearAllMocks();io.outbox.mockResolvedValue({id:'existing-outbox',status:'failed'})})
it.each(['prepared','failed','sent'])('retains status%s original without claiming accepted SMTP or requeueing it',async status=>{
 const actual={...original,status};io.prepare.mockResolvedValue({kind:'existing',message:actual})
 const result=await runAutoAckOrchestratorForInboundMessage({actorUserId:'actor',sourceMessage:source,decision,autoSend:true})
 expect(result).toMatchObject({status:'retained',ackMessageId:'original',lifecycleStatus:'existing_response_retained'})
 expect(io.outbox).toHaveBeenCalledExactlyOnceWith({actorUserId:'actor',message:actual,sourceMessageId:'source',status:'prepared'})
 expect(io.kernel).not.toHaveBeenCalled();expect(io.supersede).not.toHaveBeenCalled();expect(io.list).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled()
 expect(actual.raw_payload).toBe(original.raw_payload)
})
it('respects outbox:false on a protected original replay',async()=>{
 io.prepare.mockResolvedValue({kind:'existing',message:original})
 expect(await runAutoAckOrchestratorForInboundMessage({actorUserId:'actor',sourceMessage:source,decision,outbox:false,autoSend:true})).toMatchObject({status:'retained'})
 expect(io.outbox).not.toHaveBeenCalled();expect(io.kernel).not.toHaveBeenCalled()
})
