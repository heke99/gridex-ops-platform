import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {source as sourceRow} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn(),actor:vi.fn(),create:vi.fn(),conflict:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/db',async original=>({...await original<object>(),createEdielMessage:io.create,createCanonicalAckConflictEvent:io.conflict}))
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
const company='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002'
function encode(reverse:boolean,type:string,businessSegments:string[]){return EdifactEnvelopeCodec.encode({sender:reverse?'B':'A',receiver:reverse?'A':'B',environment:'test',applicationReference:'23-DDQ-PRODAT',interchangeReference:reverse?'ACKI':'SOURCEI',acknowledgementRequest:false,messages:[{messageReference:reverse?'ACKM':'SOURCEM',messageTypeToken:type,businessSegments}]})}
function example(requestedCode='41'){
 const source:EdielMessageRow={...sourceRow(encode(false,'PRODAT:D:97A:UN:E2SE6A',['BGM+Z04+D+9+AB','NAD+FR+A:160:SVK','NAD+DO+B:160:SVK','LIN+1++OWN:::9'])),id:'20000000-0000-4000-8000-000000000001',company_id:company,direction:'inbound',message_code:'Z04',message_standard:'edifact',environment:'test'}
 const raw=encode(true,'APERAK:D:96A:UN:E2SE6A',['BGM+++34','DTM+137:202609301200:203','RFF+ACW:D','NAD+FR+B:160:SVK','NAD+DO+A:160:SVK','ERC+41::260','FTX+AAO++226::260+Ärendeidentitet saknas','RFF+Z07:OWN'])
 const original:EdielMessageRow={...source,id:'30000000-0000-4000-8000-000000000001',direction:'outbound',message_family:'APERAK',message_code:'APERAK',related_message_id:source.id,raw_payload:raw,status:'failed',ack_outcome:'negative'}
 const requested=raw.replace('ERC+41','ERC+'+requestedCode),lineIndex=tokenizeEdifact(source.raw_payload!).segments.find(s=>s.tag==='LIN')!.index
 const scopes=[{scope:'object',reference:String(lineIndex),physicalReference:{lineIndex,id:'OWN',li:null},outcome:'negative'}]
 // Independently declared finite own source/retained ACK read boundary. The
 // actual native V2 owner is not mocked as legal/current source qualification.
 io.rpc.mockResolvedValue({data:{version:2,sourceMessage:source,ackMessage:original,requestedPayloadHash:createHash('sha256').update(requested).digest('hex'),requestedScopes:scopes,ackScopes:scopes},error:null})
 const input={actorUserId:actor,sourceMessage:source,ackFamily:'APERAK' as const,outcome:'negative' as const,draft:{actorUserId:actor,companyId:company,environment:'test' as const,direction:'outbound' as const,messageFamily:'APERAK' as const,messageCode:'APERAK',messageStandard:'edifact' as const,rawPayload:requested}}
 return {input,original}
}
beforeEach(()=>{vi.clearAllMocks();io.actor.mockResolvedValue(undefined);io.conflict.mockResolvedValue(undefined)})
describe('actual ACK kernel retains missing-LI own original',()=>{
 it('reuses the immutable failed own negative without a string alias or fresh guide read',async()=>{
  const {input,original}=example()
  expect(await createCanonicalAckMessage(input)).toMatchObject({id:original.id,status:'failed',raw_payload:original.raw_payload,ack_outcome:'negative'})
  expect(io.actor).toHaveBeenCalledWith({companyId:company,actorUserId:actor,permission:'communication.write'})
  expect(io.rpc).toHaveBeenCalledTimes(1);expect(io.rpc.mock.calls[0][0]).toBe('ediel_read_outbound_ack_scope_replay_v2')
  expect(io.create).not.toHaveBeenCalled()
 })
 it('keeps the first own negative bytes when another negative diagnosis is attempted',async()=>{
  const {input,original}=example('42')
  expect(await createCanonicalAckMessage(input)).toMatchObject({id:original.id,raw_payload:original.raw_payload})
  expect(io.create).not.toHaveBeenCalled()
 })
 it('does not let a positive missing-LI request consume an old negative original',async()=>{
  const {input}=example();input.draft.rawPayload=input.draft.rawPayload.replace('ERC+41','ERC+100')
  await expect(createCanonicalAckMessage({...input,outcome:'positive'})).rejects.toThrow()
  expect(io.rpc).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
 })
})
