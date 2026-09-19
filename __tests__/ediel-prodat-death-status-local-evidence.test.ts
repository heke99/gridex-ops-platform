import {it,expect} from 'vitest'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {copyDeathSelection,type DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {characteristic,input as wireInput} from './fixtures/prodat-register'
const policyInput=(code:'Z05'|'Z06',deathStatus?:DeathSelection)=>({family:'PRODAT',messageCode:code,subtypeOrReasonCode:code==='Z05'?'LK':'E',direction:'inbound' as const,mode:'parse' as const,referenceDate:'2026-09-19',applicationReference:'23-DDQ-PRODAT',prodatDependentFacts:{deathStatus}})
function malformed(code:'Z05'|'Z06'):unknown[]{
 const missing=deathSelection('death',code);Reflect.deleteProperty(missing.objects[0].assessment,'evidence')
 const mismatch=deathSelection('death',code);if(mismatch.objects[0].assessment.kind==='known')mismatch.objects[0].assessment.evidence.revision='stale'
 return [missing,mismatch,{source:{kind:'caller_selection',reference:'local'},objects:null},{source:{kind:'caller_selection',reference:'local'},objects:'nonempty'}, {source:{kind:'caller_selection',reference:'local'}}, {source:{kind:'caller_selection',reference:'local'},objects:[null]}]
}
for(const code of ['Z05','Z06'] as const){
 it(`${code} malformed local shapes/provenance remain U and preserve every ordinary inbound diagnostic`,()=>{
  const rawPayload=deathRaw(code,deathBody(code==='Z05'?'Z23':'E34'))
  const params={family:'PRODAT',code,rawPayload,mode:'parse' as const,direction:'inbound' as const}
  const baseline=validateRulebookMessage(params)
  expect(baseline.issues.some(i=>i.severity==='error')).toBe(true) // Deliberately incomplete wire: ordinary diagnostics must survive.
  for(const bad of malformed(code)){
   const deathStatus=bad as DeathSelection
   const actual=validateRulebookMessage({...params,deathStatus})
   expect(actual.issues.filter(i=>!i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual(baseline.issues)
   expect(actual.issues).not.toContainEqual(expect.objectContaining({code:'PRODAT_REGISTER_EVIDENCE_INVALID'}))
   expect(actual.issues).not.toContainEqual(expect.objectContaining({code:'CANONICAL_POLICY_VALIDATION_FAILED'}))
   expect(actual.issues.filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_'))).toEqual([expect.objectContaining({code:'PRODAT_DEATH_STATUS_EVIDENCE_INVALID',severity:'warning',blocking:false})])
   const policy=resolveCanonicalEdielPolicy(policyInput(code,deathStatus))
   expect(policy.prodatDependentConditions.find(c=>c.fieldNumber==='310')?.status).toBe('undetermined')
   expect(policy.prodatDependentFacts?.deathStatus).toEqual(bad) // Wire owner retains the invalid input for its warning.
   expect(()=>copyDeathSelection(bad)).toThrow('prodat_register_evidence_death_status_invalid')
   expect(()=>resolveCanonicalEdielPolicy({...policyInput(code,deathStatus),direction:'outbound',businessContext:'death'})).toThrow()
   const wire=wireInput(rawPayload,code)
   expect(validateCanonicalPolicyFields({policy:{...policy,direction:'outbound'},rawSegments:wire.rawSegments,una:wire.una})).toContainEqual(expect.objectContaining({code:'PRODAT_DEATH_STATUS_EVIDENCE_INVALID',blocking:true}))
  }
 })
 it(`${code} missing local evidence stays U while supplied code and qualifier validation still runs`,()=>{
  const codeReason=code==='Z05'?'Z23':'E34'
  for(const deathStatus of [undefined,...malformed(code)] as (DeathSelection|undefined)[]){
   expect(resolveCanonicalEdielPolicy(policyInput(code,deathStatus)).prodatDependentConditions.find(c=>c.fieldNumber==='310')?.status).toBe('undetermined')
   for(const [parts,expected] of [[[],null],[characteristic('Z17','BAD'),'PRODAT_DEATH_STATUS_VALUE_INVALID'],[[['CCI','','Z17'],['CAV',['Z41','BAD']]],'PRODAT_DEATH_STATUS_QUALIFIER_INVALID']] as const){
    const rawPayload=deathRaw(code,deathBody(codeReason,[...parts]))
    const result=validateRulebookMessage({family:'PRODAT',code,rawPayload,direction:'inbound',mode:'parse',deathStatus})
    expect(result.issues.some(i=>['PRODAT_REGISTER_EVIDENCE_INVALID','CANONICAL_POLICY_VALIDATION_FAILED','PRODAT_DEATH_STATUS_REQUIRED'].includes(i.code))).toBe(false)
    expect(result.issues.filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_')&&i.blocking).map(i=>i.code)).toEqual(expected?[expected]:[])
   }
  }
 })
}
it('unrelated canonical failure remains blocking instead of being suppressed by local-evidence handling',()=>{
 const result=validateRulebookMessage({family:'PRODAT',code:'Z06',rawPayload:deathRaw(),mode:'parse',direction:'inbound',applicationReference:'WRONG',deathStatus:malformed('Z06')[0] as DeathSelection})
 expect(result.issues).toContainEqual(expect.objectContaining({code:'CANONICAL_POLICY_VALIDATION_FAILED',blocking:true,severity:'error'}))
})
