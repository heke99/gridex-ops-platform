import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {findExistingAckForSource} from '@/lib/ediel/core/ackPolicy'
const source='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222'
type OriginalPortMessage=Pick<EdielMessageRow,'id'|'company_id'|'environment'|'direction'|'message_family'|'related_message_id'|'status'|'raw_payload'|'ack_outcome'|'parsed_payload'>
function original(positive=true,reference='OWN',status:EdielMessageRow['status']='failed'):{status:string;message:OriginalPortMessage;payloadHash:string}{
 const raw=EdifactEnvelopeCodec.encode({sender:'B',receiver:'A',environment:'test',acknowledgementRequest:false,applicationReference:'23-DDQ-E66-T',interchangeReference:'ACK-I',messages:[{messageReference:'ACK-M',messageTypeToken:'APERAK:D:04A:UN:E5SE5A',businessSegments:[`BGM+${positive?'312':'313'}+ACK-D+9`,'DOC+E66:SVK:260+SOURCE-D','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260',`ERC+${positive?'100':'42'}::260`,`RFF+ACW:${reference}`]}]})
 return {status:'qualified',message:{id:'ack',company_id:company,environment:'test',direction:'outbound',message_family:'APERAK',related_message_id:source,status,raw_payload:raw,ack_outcome:positive?'negative':'positive',parsed_payload:{ackOutcome:positive?'negative':'positive'}} satisfies Pick<EdielMessageRow,'id'|'company_id'|'environment'|'direction'|'message_family'|'related_message_id'|'status'|'raw_payload'|'ack_outcome'|'parsed_payload'>,payloadHash:createHash('sha256').update(raw).digest('hex')}
}
function response(originals:unknown[]){return {data:{version:1,sourceMessageId:source,sourcePayloadHash:'a'.repeat(64),companyId:company,environment:'test',originals},error:null}}
beforeEach(()=>vi.clearAllMocks())
describe('existing outbound original ACK controls deduplication',()=>{
 it.each(['failed','cancelled'] as const)('preserves physical positive ACK despite mutable status%s/outcome',async status=>{
  io.rpc.mockResolvedValue(response([original(true,'OWN',status)]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',outcome:'positive'})).toMatchObject({id:'ack',status,ack_outcome:'positive',parsed_payload:{ackOutcome:'positive'}})
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',outcome:'negative'})).toBeNull()
 })
 it('preserves a negative original instead of inferring positivity from mutable cache',async()=>{
  io.rpc.mockResolvedValue(response([original(false)]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',outcome:'negative'})).toMatchObject({ack_outcome:'negative'})
 })
 it('preserves each own object outcome in one immutable mixed PRODAT APERAK',async()=>{
  const raw=EdifactEnvelopeCodec.encode({sender:'B',receiver:'A',environment:'test',acknowledgementRequest:false,applicationReference:'23-DDQ-PRODAT',interchangeReference:'ACK-I',messages:[{messageReference:'ACK-M',messageTypeToken:'APERAK:D:96A:UN:E2SE6A',businessSegments:['BGM+12+ACK-D+34','NAD+FR+B:160:SVK','NAD+DO+A:160:SVK','RFF+ACW:SOURCE-D','ERC+100::260','FTX+ACB+++Accepted','RFF+LI:OWN-POSITIVE','ERC+42::260','FTX+ACB+++Rejected','RFF+LI:OWN-NEGATIVE']}]})
  const item=original();item.message={...item.message,raw_payload:raw};item.payloadHash=createHash('sha256').update(raw).digest('hex')
  io.rpc.mockResolvedValue(response([item]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',transactionReference:'OWN-POSITIVE',outcome:'positive'})).toMatchObject({id:'ack',ack_outcome:'positive',status:'failed'})
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',transactionReference:'OWN-POSITIVE',outcome:'negative'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',transactionReference:'OWN-NEGATIVE',outcome:'negative'})).toMatchObject({id:'ack',ack_outcome:'negative'})
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',transactionReference:'OWN-NEGATIVE',outcome:'positive'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',acknowledgedReferences:['OWN-POSITIVE','OWN-NEGATIVE'],outcome:'negative'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',acknowledgedReferences:['OWN-POSITIVE','OWN-NEGATIVE'],outcome:'positive'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',acknowledgedReferences:['OWN-NEGATIVE','ABSENT'],outcome:'negative'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'object',acknowledgedReferences:['OWN-POSITIVE','OWN-NEGATIVE']})).toMatchObject({id:'ack',ack_outcome:'negative'})
 })
 it('requires the entire own physical transaction set rather than a sibling subset',async()=>{
  io.rpc.mockResolvedValue(response([original(true,'OWN')]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'transaction',acknowledgedReferences:['OWN','SIBLING'],outcome:'positive'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'transaction',acknowledgedReferences:['OWN'],outcome:'positive'})).toMatchObject({id:'ack'})
 })
 it('recognizes explicit national header rejection as whole-source negative coverage',async()=>{
  const item=original(false);item.message.raw_payload=item.message.raw_payload!.replace("RFF+ACW:OWN'",'')
  item.message.raw_payload=item.message.raw_payload!.replace(/UNT\+\d+\+ACK-M/, 'UNT+7+ACK-M')
  item.payloadHash=createHash('sha256').update(item.message.raw_payload!).digest('hex')
  io.rpc.mockResolvedValue(response([item]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'transaction',acknowledgedReferences:['OWN','SIBLING'],outcome:'negative'})).toMatchObject({id:'ack'})
 })
 it('does not collapse another physical transaction into the requested scope',async()=>{
  io.rpc.mockResolvedValue(response([original(true,'SIBLING'),original(false,'OWN')]))
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'transaction',transactionReference:'OWN',outcome:'positive'})).toBeNull()
  expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',ackScope:'transaction',transactionReference:'OWN',outcome:'negative'})).toMatchObject({ack_outcome:'negative'})
 })
 it('holds matching old original without a protected basis rather than minting a replacement',async()=>{
  io.rpc.mockResolvedValue(response([{...original(),status:'held'}]))
  await expect(findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK',outcome:'positive'})).rejects.toThrow('ediel_existing_ack_original_basis_unavailable')
 })
 it.each(['direction','environment','company_id'])('refuses a tampered native read%s',async field=>{
  const item=original();(item.message as unknown as Record<string,unknown>)[field]='wrong'
  io.rpc.mockResolvedValue(response([item]));await expect(findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK'})).rejects.toThrow('read_scope_invalid')
 })
 it('refuses mutated raw hash and RPC failure, never falls back to public row metadata',async()=>{
  const item=original();item.message.raw_payload+=' '
  io.rpc.mockResolvedValue(response([item]));await expect(findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK'})).rejects.toThrow('read_scope_invalid')
  io.rpc.mockResolvedValue({data:null,error:{message:'unavailable'}});await expect(findExistingAckForSource({sourceMessageId:source,ackFamily:'APERAK'})).rejects.toThrow('read_unavailable')
 })
 it('preserves a syntax-negative technical original mirroring an absent application reference',async()=>{
  const raw=EdifactEnvelopeCodec.encode({sender:'B',receiver:'A',environment:'test',acknowledgementRequest:false,interchangeReference:'ACK-I',messages:[{messageReference:'ACK-M',messageTypeToken:'CONTRL:2:2:UN',businessSegments:['UCI+SOURCE-I+A:ZZ+B:ZZ+4']}]})
  const item=original();item.message={...item.message,message_family:'CONTRL',raw_payload:raw};item.payloadHash=createHash('sha256').update(raw).digest('hex')
  io.rpc.mockResolvedValue(response([item]));expect(await findExistingAckForSource({sourceMessageId:source,ackFamily:'CONTRL',outcome:'negative'})).toMatchObject({ack_outcome:'negative'})
 })
})
