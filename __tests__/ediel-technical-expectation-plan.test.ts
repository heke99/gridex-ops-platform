import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
import {prepareEdielTechnicalExpectationPlan} from '@/lib/ediel/businessExpectations'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {source,head,own} from './fixtures/prodat-identity'
import {raw} from './fixtures/prodat-register'
import type {EdielMessageRow} from '@/lib/ediel/types'
const policy=()=>resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z01',subtypeOrReasonCode:'L',
  direction:'outbound',referenceDate:'2026-09-30',mode:'catalog_evidence'})
const message=()=>({...source(raw([...head(),...own('1','735123456789012345','OWN')],'Z01')),direction:'outbound',requires_contrl:false}) as EdielMessageRow
describe('frozen own technical sender expectation',()=>{
  it('uses the admitted protocol decision despite mutable ACK flags and does not assert recipient receipt',()=>{
    const p=policy(),plan=prepareEdielTechnicalExpectationPlan(message(),p)
    expect(plan).toMatchObject({ruleId:'TM-CONTRL',offset:30,unit:'minutes',anchor:'actual_accepted_smtp_observed_at',
      timerKind:'internal_sender_watch',remoteReceiptKnown:false,policy:{guideRevision:p.guide.guideRevision,referenceDate:'2026-09-30'}})
    expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan?.policy)).toBe(true)
  })
  it('rejects another message decision before a watch can enter the journal',()=>{
    expect(()=>prepareEdielTechnicalExpectationPlan({...message(),message_code:'Z03'},policy())).toThrow('ediel_technical_expectation_policy_source_mismatch')
    expect(()=>prepareEdielTechnicalExpectationPlan({...message(),direction:'inbound'},policy())).toThrow('ediel_technical_expectation_policy_source_mismatch')
  })
  it.each(['12','312','313','APERAK'])('uses the shared logical APERAK family for actual stored code %s',code=>{
    const p=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',associationAssignedCode:'E2SE6A',direction:'outbound',referenceDate:'2026-09-30',mode:'catalog_evidence'})
    expect(prepareEdielTechnicalExpectationPlan({...message(),message_family:'APERAK',message_code:code},p))
      .toMatchObject({ruleId:'TM-CONTRL',offset:30,policy:{guideRevision:p.guide.guideRevision}})
  })
})
