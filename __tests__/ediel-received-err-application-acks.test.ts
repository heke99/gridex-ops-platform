import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn(),source:vi.fn(),existing:vi.fn(),create:vi.fn(),repair:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/ackSourceRulePackEvidence',()=>({readSourceBoundOutboundAckRulePackEvidence:io.source}))
vi.mock('@/lib/ediel/core/ackDraftSource',()=>({readExistingAckBeforeDraft:io.existing}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {createReceivedErrApplicationAcks} from '@/lib/ediel/flows/receivedErrApplicationAcks'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Actual coordinator and opaque native-reader validation; modeled read/write
// ports prove neither authentic source admission nor live counterparty reply.
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`
const own=['OWN:A+B?C',' LEADING']
function message():EdielMessageRow{
 const raw=EdifactEnvelopeCodec.encode({sender:'REMOTE',receiver:'LOCAL',interchangeReference:'ERR-I',applicationReference:'23-DDQ-E66-T',environment:'test',acknowledgementRequest:true,messages:[{messageReference:'ERR-M',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:['BGM+ERR::260+ERR-D+9+AB','NAD+MS+52100:SVK:260','NAD+MR+52101:SVK:260','IDE+24+OWN?:A?+B??C','RFF+TN:ORIGINAL-A','IDE+24+ LEADING','RFF+TN:ORIGINAL-B']}]})
 return {...energyHandoffMessage('2026-10-01',uuid(2)),id:uuid(1),direction:'inbound',message_family:'UTILTS_ERR',message_standard:'edifact',environment:'test',raw_payload:raw}
}
const m=message(),actor=uuid(7)
const evidence={rulePackId:uuid(3),messageProfileId:uuid(4),profileKey:'synthetic-original',version:'opaque-original',sourceHash:'a'.repeat(64),snapshot:{rulePack:{guide_version:'25-A-3'},version:'opaque-original'}}
const ack=(index:number):EdielMessageRow=>({...m,id:uuid(20+index),direction:'outbound',message_family:'APERAK',related_message_id:m.id,ack_outcome:'positive',transaction_reference:own[index]})
const input={actorUserId:actor,message:m,createAck:io.create,repairRetainedAck:io.repair}
beforeEach(()=>{
 vi.resetAllMocks();io.actor.mockResolvedValue(undefined);io.existing.mockResolvedValue(null);io.repair.mockResolvedValue(undefined)
 io.source.mockResolvedValue({sourceMessage:m,evidence})
 io.rpc.mockResolvedValue({data:{version:1,sourceMessage:m,sourceRulePackEvidence:evidence,sourceHash:createHash('sha256').update(m.raw_payload!).digest('hex'),canonicalAssessmentId:uuid(5),correlatedOriginalMessageId:uuid(6),transactions:own.map((transactionId,transactionIndex)=>({transactionIndex,transactionId})),authorizesBusinessEffect:false},error:null})
 io.create.mockImplementation(async(scope:{relatedTransactionReference:string})=>ack(own.indexOf(scope.relatedTransactionReference)))
})
describe('prescribed application response follows the committed incoming ERR owner',()=>{
 it('returns retained own replies and repairs their outbox before any current guide/source lookup',async()=>{
  io.existing.mockImplementation(async(p:{acknowledgedReferences:string[]})=>ack(own.indexOf(p.acknowledgedReferences[0])))
  expect(await createReceivedErrApplicationAcks(input)).toEqual([uuid(20),uuid(21)])
  expect(io.repair.mock.calls.map(call=>call[0].id)).toEqual([uuid(20),uuid(21)])
  expect(io.rpc).not.toHaveBeenCalled();expect(io.source).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
  expect(io.existing.mock.calls.map(call=>call[0].acknowledgedReferences)).toEqual(own.map(ref=>[ref]))
 })
 it('creates only the missing own response from the exact protected original and preserves leading/escaped identities',async()=>{
  io.existing.mockImplementation(async(p:{acknowledgedReferences:string[]})=>p.acknowledgedReferences[0]===own[0]?ack(0):null)
  expect(await createReceivedErrApplicationAcks(input)).toEqual([uuid(20),uuid(21)])
  expect(io.repair).toHaveBeenCalledExactlyOnceWith(ack(0));expect(io.create).toHaveBeenCalledExactlyOnceWith({sourceMessage:m,relatedTransactionReference:own[1]})
  expect(io.existing.mock.invocationCallOrder.at(-1)!).toBeLessThan(io.rpc.mock.invocationCallOrder[0])
 })
 it('holds missing accepted native authority after preserving an already committed sibling',async()=>{
  io.existing.mockImplementation(async(p:{acknowledgedReferences:string[]})=>p.acknowledgedReferences[0]===own[0]?ack(0):null)
  io.rpc.mockResolvedValue({data:null,error:null})
  await expect(createReceivedErrApplicationAcks(input)).rejects.toThrow('utilts_err_application_response_authority_unavailable')
  expect(io.repair).toHaveBeenCalledExactlyOnceWith(ack(0));expect(io.create).not.toHaveBeenCalled()
 })
 it('does not replace a committed opposite final outcome with a new positive reply',async()=>{
  io.existing.mockRejectedValue(new Error('canonical_ack_final_outcome_conflict'))
  await expect(createReceivedErrApplicationAcks(input)).rejects.toThrow('canonical_ack_final_outcome_conflict')
  expect(io.rpc).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled();expect(io.repair).not.toHaveBeenCalled()
 })
 it('refuses incomplete or duplicate own physical scope without choosing RFF TN as own IDE',async()=>{
  for(const raw of [m.raw_payload!.replace('IDE+24+ LEADING','IDE+24+'),m.raw_payload!.replace('IDE+24+ LEADING','IDE+24+OWN?:A?+B??C')])
   await expect(createReceivedErrApplicationAcks({...input,message:{...m,raw_payload:raw}})).rejects.toThrow('utilts_err_application_response_own_scope_required')
  expect(io.existing).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
})
