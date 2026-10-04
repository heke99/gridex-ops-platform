import type {EdielMessageRow} from '@/lib/ediel/types'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),rulePack:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.rulePack}))
import {requireEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
const company='10000000-0000-4000-8000-000000000001',sender='40000000-0000-4000-8000-000000000001',source='20000000-0000-4000-8000-000000000001',originalRef='REFERENCE-LONGER-THAN14'
const basis=()=>({kind:'technical_syntax_ack',version:1,companyId:company,environment:'test',sourceMessageId:source,sourceHash:'a'.repeat(64),observedAt:'2026-09-30T12:00:00Z',syntaxAssessmentId:'assessment',syntaxDecision:'rejected',transportActorId:'actor',transportEdielId:'LOCAL',originalUNB:{sender:['REMOTE','ZZ','SUB-R'],receiver:['LOCAL','ZZ','SUB-L'],interchangeReference:originalRef,uciReference:originalRef.slice(0,14),applicationReference:'',testIndicator:'1'}})
const raw=()=>EdifactEnvelopeCodec.encode({sender:'LOCAL',receiver:'REMOTE',senderSubAddress:'SUB-L',receiverSubAddress:'SUB-R',interchangeReference:'ACKI',applicationReference:null,environment:'test',acknowledgementRequest:false,messages:[{messageReference:'ACKM',messageTypeToken:'CONTRL:2:2:UN:EDIEL2',businessSegments:[`UCI+${originalRef.slice(0,14)}+REMOTE:ZZ:SUB-R+LOCAL:ZZ:SUB-L+4`]}]})
const input=()=>({family:'CONTRL',code:'CONTRL',direction:'outbound' as const,mode:'send' as const,companyId:company,environment:'test' as const,rawPayload:raw()})
beforeEach(()=>{io.rpc.mockReset();io.rulePack.mockReset();io.rpc.mockResolvedValue({data:basis(),error:null})})
describe('one canonical protected technical CONTRL admission',()=>{
 it('admits the exact prescribed negative syntax response with no business pack or legal profile',async()=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source,{actorUserId:sender,phase:'prepare'})
  const own={...input(),technicalSyntaxAckEvidence}
  for(const result of [validateRulebookMessage(own),await validateRulebookMessageWithRegistry(own)])expect(result).toMatchObject({ok:true,blocking:false,family:'CONTRL',fieldRuleSource:'technical_source',rulePackSnapshot:null})
  expect(io.rulePack).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(1)
 })
 it('requalifies a persisted ACK from the actual native row without trusting the caller related pointer',async()=>{
  const id='30000000-0000-4000-8000-000000000001',messageRow={id,created_at:'2026-09-30T12:01:00Z',company_id:company,environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:raw(),related_message_id:'forged-caller-source'} as unknown as EdielMessageRow
  io.rpc.mockResolvedValue({data:{version:2,executionActorUserId:sender,executionPhase:'send',ackMessage:{...messageRow,related_message_id:source},technicalSyntaxAckEvidence:basis()},error:null})
  const result=await validateRulebookMessageWithRegistry({...input(),messageRow,executionActorUserId:sender})
  expect(result).toMatchObject({ok:true,fieldRuleSource:'technical_source',rulePackSnapshot:null})
  expect(io.rpc).toHaveBeenCalledWith('ediel_read_persisted_technical_contrl_basis_v2',{p_company_id:company,p_environment:'test',p_ack_message_id:id,p_actor_user_id:sender,p_phase:'send'})
  expect(io.rulePack).not.toHaveBeenCalled()
 })
 it('never lets supplied provenance replace the persisted sender SEND read',async()=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source,{actorUserId:sender,phase:'prepare'})
  const id='30000000-0000-4000-8000-000000000001',messageRow={id,created_at:'2026-09-30T12:01:00Z',company_id:company,environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:raw()} as unknown as EdielMessageRow
  io.rpc.mockReset();io.rpc.mockResolvedValue({data:null,error:new Error('ediel_ack_replay_actor_not_authorized')})
  expect((await validateRulebookMessageWithRegistry({...input(),messageRow,technicalSyntaxAckEvidence,executionActorUserId:sender})).ok).toBe(false)
  expect((await validateRulebookMessageWithRegistry({...input(),messageRow,technicalSyntaxAckEvidence})).ok).toBe(false)
  expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(io.rpc).toHaveBeenCalledWith('ediel_read_persisted_technical_contrl_basis_v2',{p_company_id:company,p_environment:'test',p_ack_message_id:id,p_actor_user_id:sender,p_phase:'send'})
 })
 it('holds absent historical technical authority without read-time capture or business fallback',async()=>{
  const id='30000000-0000-4000-8000-000000000001',messageRow={id,created_at:'2026-09-30T12:01:00Z',company_id:company,environment:'test',direction:'outbound',message_family:'CONTRL',raw_payload:raw()} as unknown as EdielMessageRow
  io.rpc.mockResolvedValue({data:null,error:new Error('ediel_historical_technical_ack_basis_unavailable')})
  expect((await validateRulebookMessageWithRegistry({...input(),messageRow})).ok).toBe(false)
  expect(io.rpc.mock.calls.every(([name])=>String(name).includes('read'))).toBe(true)
  expect(io.rulePack).not.toHaveBeenCalled()
 })
 it('refuses a structural copy or another tenant/environment despite genuine envelope facts',async()=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source,{actorUserId:sender,phase:'prepare'})
  for(const patch of [{technicalSyntaxAckEvidence:{...technicalSyntaxAckEvidence}},{companyId:'foreign'},{environment:'production' as const}])expect((await validateRulebookMessageWithRegistry({...input(),technicalSyntaxAckEvidence,...patch})).ok).toBe(false)
 })
 it.each([
  (s:string)=>s.replace('SUB-L+REMOTE','WRONG+REMOTE'),
  (s:string)=>s.replace('UCI+REFERENCE-LONG','UCI+WRONG'),
  (s:string)=>s.replace('SUB-L+4','SUB-L+1'),
  (s:string)=>s.replace('UNT+3+ACKM','UNT+99+ACKM'),
 ])('holds mutated source route/reference/finalized outcome or syntax',async(change)=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source,{actorUserId:sender,phase:'prepare'})
  expect((await validateRulebookMessageWithRegistry({...input(),technicalSyntaxAckEvidence,rawPayload:change(raw())})).ok).toBe(false)
 })
})
