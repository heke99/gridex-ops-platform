import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn(),rulePack:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.rulePack}))
import {requireEdielTechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {validateRulebookMessage,validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
const company='10000000-0000-4000-8000-000000000001',source='20000000-0000-4000-8000-000000000001',originalRef='REFERENCE-LONGER-THAN14'
const basis=()=>({kind:'technical_syntax_ack',version:1,companyId:company,environment:'test',sourceMessageId:source,sourceHash:'a'.repeat(64),observedAt:'2026-09-30T12:00:00Z',syntaxAssessmentId:'assessment',syntaxDecision:'rejected',transportActorId:'actor',transportEdielId:'LOCAL',originalUNB:{sender:['REMOTE','ZZ','SUB-R'],receiver:['LOCAL','ZZ','SUB-L'],interchangeReference:originalRef,uciReference:originalRef.slice(0,14),applicationReference:'',testIndicator:'1'}})
const raw=()=>EdifactEnvelopeCodec.encode({sender:'LOCAL',receiver:'REMOTE',senderSubAddress:'SUB-L',receiverSubAddress:'SUB-R',interchangeReference:'ACKI',applicationReference:null,environment:'test',acknowledgementRequest:false,messages:[{messageReference:'ACKM',messageTypeToken:'CONTRL:2:2:UN:EDIEL2',businessSegments:[`UCI+${originalRef.slice(0,14)}+REMOTE:ZZ:SUB-R+LOCAL:ZZ:SUB-L+4`]}]})
const input=()=>({family:'CONTRL',code:'CONTRL',direction:'outbound' as const,mode:'send' as const,companyId:company,environment:'test' as const,rawPayload:raw()})
beforeEach(()=>{io.rpc.mockReset();io.rulePack.mockReset();io.rpc.mockResolvedValue({data:basis(),error:null})})
describe('one canonical protected technical CONTRL admission',()=>{
 it('admits the exact prescribed negative syntax response with no business pack or legal profile',async()=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source)
  const own={...input(),technicalSyntaxAckEvidence}
  for(const result of [validateRulebookMessage(own),await validateRulebookMessageWithRegistry(own)])expect(result).toMatchObject({ok:true,blocking:false,family:'CONTRL',fieldRuleSource:'technical_source',rulePackSnapshot:null})
  expect(io.rulePack).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(1)
 })
 it('refuses a structural copy or another tenant/environment despite genuine envelope facts',async()=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source)
  for(const patch of [{technicalSyntaxAckEvidence:{...technicalSyntaxAckEvidence}},{companyId:'foreign'},{environment:'production' as const}])expect((await validateRulebookMessageWithRegistry({...input(),technicalSyntaxAckEvidence,...patch})).ok).toBe(false)
 })
 it.each([
  (s:string)=>s.replace('SUB-L+REMOTE','WRONG+REMOTE'),
  (s:string)=>s.replace('UCI+REFERENCE-LONG','UCI+WRONG'),
  (s:string)=>s.replace('SUB-L+4','SUB-L+1'),
  (s:string)=>s.replace('UNT+3+ACKM','UNT+99+ACKM'),
 ])('holds mutated source route/reference/finalized outcome or syntax',async(change)=>{
  const technicalSyntaxAckEvidence=await requireEdielTechnicalSyntaxAckEvidence(company,source)
  expect((await validateRulebookMessageWithRegistry({...input(),technicalSyntaxAckEvidence,rawPayload:change(raw())})).ok).toBe(false)
 })
})
