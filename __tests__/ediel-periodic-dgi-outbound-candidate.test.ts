// masterplan: U-05, AT-U-05
import {describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/versionRegistry',()=>({resolveCanonicalOutboundVersion:vi.fn(async()=>'E5SE5A')}))
import {buildUtiltsOutboundDraft} from '@/lib/ediel/utilts'
import {validateUnsmGrammar} from '@/lib/ediel/core/unsmGrammar'
const input={code:'E66' as const,environment:'test' as const,senderEdielId:'11111',receiverEdielId:'22222',applicationReference:'23-DGI-E66-T',externalReference:'OWN-PERIODIC',transactionReference:'OWN-IDE',payload:{legalSenderEdielId:'33333',legalReceiverEdielId:'44444',meterPointId:'735999100001686670',gridAreaId:'TES',periodStart:'2026-09-30T00:00:00+01:00',periodEnd:'2026-09-30T00:15:00+01:00',registrationTime:'2026-09-30T00:20:00+01:00',quantity:5,readingType:'E12',resolution:'15'}}
describe('periodic DGI wire candidate; current native send/business authority remains independently required',()=>{
 it('renders own national defaultE23 and actual legal NAD facts, while selecting full02B without any send/grant RPC',async()=>{
  const draft=await buildUtiltsOutboundDraft(input),raw=draft.rawPayload!
  expect(raw).toContain('STS+7++E23::260');expect(raw).toContain('NAD+DGI');expect(raw).toContain("NAD+MS+33333:SVK:260'NAD+MR+44444:SVK:260'")
  expect(raw).not.toContain('STS+7++E88::260');expect(raw).not.toContain('NAD+MS+11111');expect(validateUnsmGrammar(raw).syntaxOk).toBe(true);expect(io.rpc).not.toHaveBeenCalled()
 })
 it('cannot turn a payload flag or payload reason into an authenticated E88 exception',async()=>{
  const draft=await buildUtiltsOutboundDraft({...input,payload:{...input.payload,bilateralAgreementApproved:true,periodicE66Reason:'E88',reasonCode:'E88'}})
  expect(draft.rawPayload).toContain('STS+7++E23::260');expect(draft.rawPayload).not.toContain('STS+7++E88::260');expect(io.rpc).not.toHaveBeenCalled()
 })
 it('keeps nonperiodic DDQ own reason unchanged',async()=>{const draft=await buildUtiltsOutboundDraft({...input,applicationReference:'23-DDQ-E66-T'});expect(draft.rawPayload).toContain('STS+7++E88::260');expect(draft.rawPayload).not.toContain('NAD+DGI')})
})
