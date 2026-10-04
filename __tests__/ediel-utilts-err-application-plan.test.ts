import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn(),registry:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.registry}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {assertUtiltsPositiveAckSourceAuthority} from '@/lib/ediel/utilts/positiveAckAuthority'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
const company='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001',errId='30000000-0000-4000-8000-000000000001',packId='40000000-0000-4000-8000-000000000001',profileId='50000000-0000-4000-8000-000000000001'
const copies=['LOC+172+POINT::9','LOC+239+AAA:SVK:260','NAD+DDK+52102:SVK:260','NAD+DDQ+52101:SVK:260','PIA+1+V1:PT:SVK:260','DTM+324:202609290000202609300000:719','STS+7++E03::260']
function raw(original=false,reason='E19'){
 return EdifactEnvelopeCodec.encode({sender:original?'GRID':'SUPPLIER',receiver:original?'SUPPLIER':'GRID',interchangeReference:original?'ORIGINAL-I':'ERR-I',environment:'test',applicationReference:'23-DDQ-E66-T',acknowledgementRequest:true,messages:[{messageReference:original?'ORIGINAL-M':'ERR-M',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:original?['BGM+E66::260+ORIGINAL-D+9+AB','DTM+137:202609301000:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+52100:SVK:260','NAD+MR+52101:SVK:260','NAD+DDQ','IDE+24+ORIGINAL-T',...copies]:['BGM+ERR::260+ERR-D+9+AB','DTM+137:202609301200:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+52101:SVK:260','NAD+MR+52100:SVK:260','NAD+DDQ','IDE+24+ERR-T',...copies,`STS+E01::260+41+${reason}::260`,'RFF+TN:ORIGINAL-T','RFF+E66:ORIGINAL-D']}]})
}
const err=(reason='E19')=>({id:errId,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'UTILTS_ERR',message_code:'ERR',raw_payload:raw(false,reason),message_received_at:'2026-10-16T12:00:00Z',created_at:'2026-10-16T12:00:00Z',parsed_payload:{}}) as unknown as EdielMessageRow
const original=()=>({...err(),id:sourceId,direction:'outbound',message_family:'UTILTS',message_code:'E66',raw_payload:raw(true),message_sent_at:'2026-09-30T10:00:00Z',immutable_rendered_at:'2026-09-30T09:00:00Z'}) as EdielMessageRow
function evidence(){return {rulePackId:packId,messageProfileId:profileId,profileKey:'synthetic-original-at-admission',version:'opaque-original-version',sourceHash:'a'.repeat(64),snapshot:{profileKey:'synthetic-original-at-admission',profileVersionId:profileId,version:'opaque-original-version',checksum:'a'.repeat(64),rulePack:{id:packId,family:'UTILTS',guide_version:'25-A-3',guide_revision:'3',source_hash:'a'.repeat(64)},messageProfile:{id:profileId,rule_pack_id:packId},guideSources:[]}}}
beforeEach(()=>{io.rpc.mockReset();io.registry.mockReset();io.rpc.mockResolvedValue({data:{version:1,sourceMessage:original(),sourceRulePackEvidence:evidence()},error:null})})
// Modeled immutable source and native RPC contracts. These tests exercise real
// canonical admission and the gateway guard, never native actor/legal proof.
describe('incoming ERR has its own source-qualified application response',()=>{
 it('projects positive APERAK only after inherited old E19 is actually guide-qualified',async()=>{
  const result=await resolveCanonicalRuntimeDecisionWithRegistry(err())
  expect(result).toMatchObject({applicationDecision:'accepted',functionalDecision:'accepted',policy:{guide:{guideRevision:'25-A-3'}}})
  expect(result.responsePlan.filter(item=>item.family==='APERAK')).toEqual([{family:'APERAK',outcome:'positive',bgm:'312',ftx:'OK',reason:expect.any(String)}])
  expect(result.responsePlan.some(item=>item.family==='UTILTS_ERR')).toBe(false)
  expect(io.registry).not.toHaveBeenCalled()
 })
 it.each(['missing original','missing frozen guide','foreign original transaction'])('holds %s with no application positive',async scenario=>{
  const message=err()
  if(scenario==='missing original')io.rpc.mockResolvedValue({data:null,error:null})
  if(scenario==='missing frozen guide'){const pack=evidence();delete (pack.snapshot as Partial<typeof pack.snapshot>).messageProfile;io.rpc.mockResolvedValue({data:{version:1,sourceMessage:original(),sourceRulePackEvidence:pack},error:null})}
  if(scenario==='foreign original transaction')message.raw_payload=message.raw_payload!.replace('TN:ORIGINAL-T','TN:FOREIGN-T')
  const result=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(result.functionalDecision).not.toBe('accepted')
  expect(result.responsePlan.some(item=>item.family==='APERAK'||item.family==='UTILTS_ERR')).toBe(false)
 })
 it.each(['E999','wrong structure'])('rejects %s before original source lookup',async fault=>{
  const message=err(fault==='E999'?'E999':'E19')
  if(fault==='wrong structure')message.raw_payload=message.raw_payload!.replace('STS+E01::260+41','STS+E01::260+42')
  const result=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  if(fault==='E999'){expect(result.syntaxDecision).toBe('rejected');expect(result.applicationDecision).toBe('not_applicable')}
  else expect(result.applicationDecision).toBe('rejected')
  expect(result.responsePlan.some(item=>item.family==='APERAK')).toBe(false);expect(io.rpc).not.toHaveBeenCalled()
 })
 it('requires native accepted ERR authority rather than treating ERR as stored metering',async()=>{
  const source=err(),draft={messageFamily:'APERAK',environment:'test',companyId:company,ackOutcome:'positive',rawPayload:EdifactEnvelopeCodec.encode({sender:'GRID',receiver:'SUPPLIER',environment:'test',acknowledgementRequest:false,interchangeReference:'AP-I',messages:[{messageReference:'AP-M',messageTypeToken:'APERAK:D:04A:UN:E5SE5A',businessSegments:['BGM+312+AP-D+9','RFF+ACW:ERR-T']}]})} as CreateEdielMessageInput
  io.rpc.mockResolvedValue({data:null,error:{message:'received_err_application_basis_unavailable'}})
  await expect(assertUtiltsPositiveAckSourceAuthority({sourceMessage:source,draft})).rejects.toThrow('utilts_positive_ack_storage_unavailable')
  io.rpc.mockResolvedValue({data:{authorityVersion:1,companyId:company,environment:'test',sourceMessageId:errId,transactionId:'ERR-T',sourceRawHash:createHash('sha256').update(source.raw_payload!).digest('hex'),ackMessageId:null},error:null})
  await expect(assertUtiltsPositiveAckSourceAuthority({sourceMessage:source,draft})).resolves.toBeUndefined()
  expect(io.rpc).toHaveBeenLastCalledWith('gridex_require_utilts_positive_ack_authority_v1',expect.objectContaining({p_source_message_id:errId,p_transaction_id:'ERR-T'}))
 })
})
