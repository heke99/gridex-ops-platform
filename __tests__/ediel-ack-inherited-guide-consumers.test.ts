import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),rulePack:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.rulePack}))
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {readSourceBoundOutboundAckRulePackEvidence,sourceBoundAckCanonicalPolicy} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import type {EdielMessageRow} from '@/lib/ediel/types'
const company='10000000-0000-4000-8000-000000000001',sourceId='20000000-0000-4000-8000-000000000001',ackId='30000000-0000-4000-8000-000000000001',packId='40000000-0000-4000-8000-000000000001',profileId='50000000-0000-4000-8000-000000000001'
const copy=['LOC+172+POINT::9','LOC+239+AAA:SVK:260','NAD+DDK+BRP:SVK:260','NAD+DDQ+SUPPLIER:SVK:260','PIA+1+V1:PT:SVK:260','DTM+324:202609290000202609300000:719','STS+7++E03::260']
function envelope(original=false,reason='E51'){return EdifactEnvelopeCodec.encode({sender:original?'GRID':'SUPPLIER',receiver:original?'SUPPLIER':'GRID',interchangeReference:original?'ORIGINAL-I':'ERR-I',environment:'test',applicationReference:'23-DDQ-E66-T',acknowledgementRequest:true,messages:[{messageReference:original?'ORIGINAL-M':'ERR-M',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:original?['BGM+E66::260+ORIGINAL-D+9+AB','DTM+137:202609301000:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+GRID:SVK:260','NAD+MR+SUPPLIER:SVK:260','NAD+DDQ','IDE+24+ORIGINAL-T',...copy]:['BGM+ERR::260+ERR-D+9+AB','DTM+137:202609301200:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+SUPPLIER:SVK:260','NAD+MR+GRID:SVK:260','NAD+DDQ','IDE+24+ERR-T',...copy,`STS+E01::260+41+${reason}::260`,'RFF+TN:ORIGINAL-T','RFF+E66:ORIGINAL-D']}]})}
const ack=(reason='E51')=>({id:ackId,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',message_family:'UTILTS_ERR',message_code:'ERR',raw_payload:envelope(false,reason),message_received_at:'2026-10-16T12:00:00Z',created_at:'2026-10-16T12:00:00Z',parsed_payload:{}}) as unknown as EdielMessageRow
const source=(direction:'inbound'|'outbound'='outbound')=>({...ack(),id:sourceId,direction,message_family:'UTILTS',message_code:'E66',raw_payload:envelope(true),message_sent_at:direction==='outbound'?'2026-09-30T10:00:00Z':null,immutable_rendered_at:direction==='outbound'?'2026-09-30T09:00:00Z':null}) as EdielMessageRow
const evidence=()=>({rulePackId:packId,messageProfileId:profileId,profileKey:'synthetic-own-original',version:'opaque-original-at-first-admission',sourceHash:'a'.repeat(64),snapshot:{profileKey:'synthetic-own-original',profileVersionId:profileId,version:'opaque-original-at-first-admission',checksum:'a'.repeat(64),rulePack:{id:packId,family:'UTILTS',guide_version:'25-A-3',guide_revision:'3',source_hash:'a'.repeat(64)},messageProfile:{id:profileId,rule_pack_id:packId},guideSources:[]}})
const outbound=()=>({family:'UTILTS_ERR',code:'ERR',direction:'outbound' as const,environment:'test' as const,companyId:company,rawPayload:envelope(),mode:'send' as const,admissionAt:'2026-10-16T12:00:00Z'})
beforeEach(()=>{io.rpc.mockReset();io.rulePack.mockReset();io.rpc.mockResolvedValue({data:{version:1,sourceMessage:source(),sourceRulePackEvidence:evidence()},error:null})})
describe('all actual ERR consumers retain the original protected guide edition, synthetic source ports',()=>{
 it('does not grant final functional admission merely because BGM is ERR',()=>{expect(resolveCanonicalRuntimeDecision(ack())).toMatchObject({applicationDecision:'accepted',functionalDecision:'manual_review'})})
 it('rejects a malformed national ERR in runtime and raw send before original lookup',async()=>{
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(ack('E999'))
  expect(decision.applicationDecision).toBe('rejected');expect(io.rpc).not.toHaveBeenCalled()
  const validation=validateRulebookMessage({...outbound(),rawPayload:envelope(false,'E999')})
  expect(validation.ok).toBe(false);expect(validation.issues.some(issue=>issue.code==='ACK_UTILTS_ERR_NATIONAL_REASON_INVALID')).toBe(true)
 })
 it('admits the original old edition after its grace period without consulting a current named pack',async()=>{
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(ack())
  expect(decision).toMatchObject({applicationDecision:'accepted',functionalDecision:'accepted',policy:{guide:{guideRevision:'25-A-3'}},validationReport:{canonicalPolicy:{guide:{guideRevision:'25-A-3'}},rulePackEvidence:{version:'opaque-original-at-first-admission'}}})
  expect(io.rulePack).not.toHaveBeenCalled()
 })
 it('applies the same source-qualified policy to inbound registry parser and prospective outbound sender',async()=>{
  const incoming=await validateRulebookMessageWithRegistry({...outbound(),mode:'parse',direction:'inbound',messageRow:ack()})
  expect(incoming).toMatchObject({ok:true,canonicalPolicy:{guide:{guideRevision:'25-A-3'}}})
  io.rpc.mockResolvedValue({data:{version:1,sourceMessage:source('inbound'),sourceRulePackEvidence:evidence()},error:null})
  const q=await readSourceBoundOutboundAckRulePackEvidence({companyId:company,environment:'test',sourceMessageId:sourceId})
  const result=await validateRulebookMessageWithRegistry({...outbound(),ackSourceQualification:q})
  expect(result).toMatchObject({ok:true,canonicalPolicy:{guide:{guideRevision:'25-A-3'}},rulePackSnapshot:{version:'opaque-original-at-first-admission'}})
  expect(()=>sourceBoundAckCanonicalPolicy({qualification:{...q},policy:result.canonicalPolicy!})).toThrow('ack_source_owner_qualification_required')
  expect(io.rulePack).not.toHaveBeenCalled()
 })
 it.each(['future guide','missing named witness','wrong original family'])('holds %s without a current-edition substitute or synthetic application rejection',async scenario=>{
  const pack=evidence()
  if(scenario==='future guide')pack.snapshot.rulePack.guide_version='FUTURE'
  if(scenario==='missing named witness')delete (pack.snapshot as Partial<typeof pack.snapshot>).messageProfile
  if(scenario==='wrong original family')pack.snapshot.rulePack.family='PRODAT'
  io.rpc.mockResolvedValue({data:{version:1,sourceMessage:source(),sourceRulePackEvidence:pack},error:null})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(ack())
  expect(decision.applicationDecision).toBe('manual_review');expect(decision.functionalDecision).toBe('manual_review')
  expect(decision.responsePlan.some(item=>item.family==='APERAK'||item.family==='UTILTS_ERR')).toBe(false)
  expect(io.rulePack).not.toHaveBeenCalled()
 })
})
