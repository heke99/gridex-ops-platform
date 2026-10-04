import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {qualifyInboundAckSourceCandidates,readPhysicalAckSourceCorrelation,type ProdatAckObjectScope} from '@/lib/ediel/ack/sourceCorrelation'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {findExistingAckForSource} from '@/lib/ediel/core/ackPolicy'
const company='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000050'
function raw(type:string,segments:string[],reverse=false){return EdifactEnvelopeCodec.encode({sender:reverse?'B':'A',receiver:reverse?'A':'B',environment:'test',applicationReference:'23-DDQ-PRODAT',interchangeReference:reverse?'ACKI':'SOURCEI',acknowledgementRequest:false,messages:[{messageReference:reverse?'ACKM':'SOURCEM',messageTypeToken:type,businessSegments:segments}]})}
function source(extra:string[]=[]){return {id:'20000000-0000-4000-8000-000000000001',company_id:company,direction:'inbound',environment:'test',message_family:'PRODAT',message_standard:'edifact',raw_payload:raw('PRODAT:D:97A:UN:E2SE6A',['BGM+Z04+D+9+AB','NAD+FR+A:160:SVK','NAD+DO+B:160:SVK','LIN+1++OWN:::9',...extra])} as EdielMessageRow}
function ack(erc='41',extra:string[]=[]){return {id:'30000000-0000-4000-8000-000000000001',company_id:company,direction:'outbound',environment:'test',message_family:'APERAK',message_standard:'edifact',status:'failed',ack_outcome:'positive',raw_payload:raw('APERAK:D:96A:UN:E2SE6A',['BGM+++34','RFF+ACW:D','NAD+FR+B:160:SVK','NAD+DO+A:160:SVK',`ERC+${erc}::260`,'FTX+AAO++226::260+Ärendeidentitet saknas','RFF+Z07:OWN',...extra],true)} as EdielMessageRow}
function tuple(s=source()):ProdatAckObjectScope{return {objectId:'OWN',identityAgency:'9',firstLineIndex:tokenizeEdifact(s.raw_payload).segments.find(part=>part.tag==='LIN')!.index,lineItemReference:null}}
function native(s:EdielMessageRow,a=ack()){return {data:{version:2,executionActorUserId:actor,executionPhase:'read',sourceMessageId:s.id,sourcePayloadHash:createHash('sha256').update(s.raw_payload!).digest('hex'),companyId:company,environment:'test',originals:[{status:'qualified',message:a,payloadHash:createHash('sha256').update(a.raw_payload!).digest('hex')}]},error:null}}
beforeEach(()=>vi.clearAllMocks())
describe('source-owned PRODAT negative object with absent original LI',()=>{
 it('retains absence and qualifies the exact original object/agency/physical first LIN',()=>{
  const s=source(),a=ack(),scope=readPhysicalAckSourceCorrelation(a,s)
  expect(scope.scope).toBe('object');expect(scope.acknowledgedReferences).toEqual([])
  expect(scope.wholeSourceOutcome).toBeUndefined()
  expect(scope.prodatObjectOutcomes).toEqual([{...tuple(s),outcome:'negative'}])
  expect(qualifyInboundAckSourceCandidates({ackMessage:{...a,direction:'inbound'},candidates:[{...s,direction:'outbound',message_sent_at:'2026-09-30T12:00:00Z'}]}).status).toBe('unique')
 })
 it.each(['100','missingZ07','inventedLI'])('refuses unqualified or positive missing-LI outcome %s',kind=>{
  const s=source(),a=ack(kind==='100'?'100':'41',kind==='inventedLI'?['RFF+LI:OWN']:[])
  if(kind==='missingZ07')a.raw_payload=a.raw_payload!.replace('RFF+Z07:OWN','RFF+Z08:OWN')
  expect(()=>readPhysicalAckSourceCorrelation(a,s)).toThrow()
 })
 it('does not omit a known original LI or choose between duplicate identities/agencies',()=>{
  expect(()=>readPhysicalAckSourceCorrelation(ack(),source(['RFF+LI:REAL']))).toThrow('scope_mismatch')
  expect(()=>readPhysicalAckSourceCorrelation(ack(),source(['LIN+2++OWN:::11']))).toThrow('scope_mismatch')
 })
 it('retains only the selected immutable negative original and never treats it as its sibling or positive',async()=>{
  const s=source(['LIN+2++SIBLING:::9','RFF+LI:SIBLING-LI']);io.rpc.mockResolvedValue(native(s))
  const input={actorUserId:actor,phase:'read' as const,sourceMessageId:s.id,ackFamily:'APERAK' as const,ackScope:'object' as const,expectedSource:s,acknowledgedProdatObjects:[tuple(s)]}
  expect(await findExistingAckForSource({...input,outcome:'negative'})).toMatchObject({id:ack().id,status:'failed',ack_outcome:'negative'})
  expect(await findExistingAckForSource({...input,outcome:'positive'})).toBeNull()
  expect(await findExistingAckForSource({...input,acknowledgedProdatObjects:[{...tuple(s),identityAgency:'11'}]})).toBeNull()
  expect(await findExistingAckForSource({...input,acknowledgedProdatObjects:[{...tuple(s),firstLineIndex:999}]})).toBeNull()
  expect(await findExistingAckForSource({...input,acknowledgedProdatObjects:[{...tuple(s),objectId:'SIBLING'}]})).toBeNull()
 })
 it('preserves the whole original register chain and refuses contradictory own outcomes',()=>{
  const s=source();s.raw_payload=s.raw_payload!.replace('LIN+1++OWN','LIN+1+1:1+OWN')
  const a=ack('41',['ERC+42::260','FTX+AAO++217::260+Felaktigt Egenskap BAD','RFF+Z07:OWN'])
  expect(readPhysicalAckSourceCorrelation(a,s).prodatObjectOutcomes).toEqual([{...tuple(s),outcome:'negative'}])
  expect(()=>readPhysicalAckSourceCorrelation(ack('41',['ERC+100::260','FTX+AAO+++OK','RFF+Z07:OWN']),s)).toThrow()
 })
})
