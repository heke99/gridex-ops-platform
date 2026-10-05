/** RED defect evidence, NOT an application regression or accepted implementation.
 * Run by copying unchanged to __tests__/f3-reporting-context-probe-20260919.test.ts,
 * then npx vitest run __tests__/f3-reporting-context-probe-20260919.test.ts.
 * Remove that temporary copy after collecting results. Initial and post-fix outcomes are in the adjacent JSON. Remaining failures
 * are blocked on the producer contract documented in the adjacent audit.
 */
import { expect, it } from 'vitest'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { alphabets, characteristic, input, line, raw, type Parts } from '@/__tests__/fixtures/prodat-register'
import type { EdielMessageRow } from '@/lib/ediel/types'

const reason = (value: string) => characteristic('Z13', value)
function row(body: Parts[], alphabet: readonly string[]): EdielMessageRow {
  return {message_family:'PRODAT',message_code:'Z14',direction:'outbound',environment:'test',message_standard:'edifact',company_id:'synthetic',
    raw_payload:raw(body,'Z14',alphabet),application_reference:'23-DDQ-PRODAT',mime_type:'application/EDIFACT',
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{dependentConditionStatuses:[]}}} as unknown as EdielMessageRow
}
for (const code of ['Z13','Z14']) for (const byCell of [true,false]) it(`${code}: root byCell321 must not manufacture bounded-reporting authority (${byCell})`,()=>{
  expect(resolveProdatDependentCondition({messageCode:code,fieldNumber:'321',facts:{canonicalSubtype:'V',byCell:{[`${code}:321`]:byCell}}})?.status).toBe('undetermined')
})
for (const alphabet of alphabets) {
  const label=alphabet.join('')
  it(`${label}: minimal N control passes protected transport`,()=>{
    expect(()=>assertEdielSendLock(row([['LIN','1'],...reason('Z96')],alphabet))).not.toThrow()
  })
  it(`${label}: N purpose is excluded even with an intentional-invalid-test override`,()=>{
    expect(()=>assertEdielSendLock(row([['LIN','1'],...reason('Z96'),...characteristic('Z24','B71')],alphabet))).toThrow()
  })
  it(`${label}: N purpose is protected by the rulebook send guard`,()=>{
    expect(()=>assertRulebookAllowsSend(row([['LIN','1'],...reason('Z96'),...characteristic('Z24','B71')],alphabet))).toThrow()
  })
  it(`${label}: malformed supplied purpose sibling cannot hide in the header`,()=>{
    const message=row([...characteristic('Z24','A02'),['LIN','1'],...reason('Z96'),...characteristic('Z24','B71')],alphabet)
    expect(preflightEdielMessageRow(message,'send').issues.some(i=>i.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))).toBe(true)
  })
  it(`${label}: missing object context cannot be repaired by stale root N/private facts`,()=>{
    const wire=input(raw([line('1','A'),...reason('S17'),line('2','B'),...reason('Z96')],'Z14',alphabet),'Z14')
    const original=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:'N',direction:'outbound',referenceDate:'2026-09-19',mode:'catalog_evidence',
      prodatDependentFacts:{customerKind:'private',byCell:{'Z14:321':false}}})
    const policy={...original,fieldRules:original.fieldRules.filter(rule=>'fieldNumber' in rule&&['321','323'].includes(String(rule.fieldNumber)))}
    expect(validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una}).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  })
  it(`${label}: supplied Z13 purpose/date does not establish customer-kind/reporting intent`,()=>{
    const wire=input(raw([line('1','A'),['DTM',['91','202610010000','203']],...reason('S17'),...characteristic('Z24','B71')],'Z13',alphabet),'Z13')
    expect(validateProdatSubtypePayload(wire).some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  })
  it(`${label}: inbound control does not acquire outbound knowledge rejection`,()=>{
    const message=row([['LIN','1'],...reason('Z96'),...characteristic('Z24','B71')],alphabet)
    expect(validateRulebookMessage({rawPayload:message.raw_payload!,direction:'inbound',mode:'parse',environment:'test'}).issues.filter(i=>i.scope==='prodat_dependent')).toEqual([])
  })
  it(`${label}: later message control cannot pass protected transport`,()=>{
    const first=row([['LIN','1'],...reason('Z96')],alphabet)
    first.raw_payload += raw([['LIN','1'],...reason('Z96')],'Z14',alphabet).slice(9)
    expect(()=>assertEdielSendLock(first)).toThrow(/UNH/)
  })
}
it('existing register evidence correctly does not claim to transport reporting/customer authority',()=>{
  const wire=input(raw([line('1','A'),...reason('S17')],'Z13'),'Z13')
  const evidence=createProdatRegisterEvidence({...wire,code:'Z13',facts:{customerKind:'private',byCell:{'Z13:321':true}}})
  expect(evidence.facts).not.toHaveProperty('customerKind')
  expect(evidence.facts).not.toHaveProperty('byCell')
})
