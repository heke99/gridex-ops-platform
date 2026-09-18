import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { validateProdatSubtypePolicy } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, raw, rule, type Parts } from './fixtures/prodat-register'

// The ordinary policy/readiness tests cover the rest of the envelope/fields.
// These assertions require a *specific* migrated-cell issue; an unrelated error
// is not evidence that the six D paths reached the guard.
function message(body: Parts[], code = 'Z09', environment: 'test' | 'production' = 'test', alphabet: readonly string[] = alphabets[0]): EdielMessageRow {
  const payload = raw(body,code,alphabet)
  const wire = input(payload,code)
  const evidence = createProdatRegisterEvidence({code,rawSegments:wire.rawSegments,una:wire.una,facts:{market:'electricity',meterReadingsSentInUtilts:false}})
  const row: Partial<EdielMessageRow> = {message_family:'PRODAT',message_code:code,message_version:'26A',direction:'outbound',environment,
    message_standard:'edifact',application_reference:'23-DDQ-PRODAT',
    company_id:'synthetic-company',raw_payload:payload,mime_type:'application/EDIFACT',
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence:evidence,
      dependentConditionStatuses:evaluateProdatDependentConditions({messageCode:code,facts:{canonicalSubtype:'F'}})
        .map(condition=>({...condition,status:'not_required'}))}},
  }
  // Deliberately partial synthetic persistence boundary, not a database row certificate.
  return row as EdielMessageRow
}
const badBody = () => [line('1','A'),...characteristic('Z13','E64')]
const target = (issue: {code:string;scope?:string;description:string}) => issue.scope === 'prodat_dependent' || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')

describe('source D cells at the real row and send boundaries',()=>{
  for (const environment of ['test','production'] as const) {
    it(`${environment}: forged complete snapshot cannot suppress the missing Z09F method`,()=>{
      const result=validateEdielMessageRowWithRulebook(message(badBody(),'Z09',environment),'send')
      expect(result.issues.some(issue=>target(issue)&&issue.fieldPath==='CCI++Z04/CAV'&&issue.severity==='error'&&issue.blocking)).toBe(true)
    })
    it(`${environment}: intentional-invalid-send flag cannot suppress a migrated D defect`,()=>{
      expect(()=>assertRulebookAllowsSend(message(badBody(),'Z09',environment))).toThrow(/D-villkor|PRODAT_DEPENDENT/)
    })
    it(`${environment}: missing field223 is blocking, not a test-only warning`,()=>{
      const result=validateEdielMessageRowWithRulebook(message([line('1','A')],'Z09',environment),'send')
      expect(result.issues.some(issue=>target(issue)&&issue.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&issue.blocking&&issue.severity==='error')).toBe(true)
    })
    it(`${environment}: row preflight and transport lock keep the D gate`,()=>{
      const m=message(badBody(),'Z09',environment)
      const result=preflightEdielMessageRow(m,'send')
      expect(result.issues.some(issue=>target(issue)&&issue.severity==='error'&&issue.description.includes('Z09:217'))).toBe(true)
      expect(result.ok).toBe(false)
      expect(()=>assertEdielSendLock(m)).toThrow(/PRODAT_DEPENDENT_PREFLIGHT_/)
    })
  }
  it.each(alphabets)('wire-derived valid mandatory method/validity passes the bounded gate with %j', (...alphabet)=>{
    const m=message([line('1','A'),['DTM',['157','202610010000','203']],...characteristic('Z13','E64'),...characteristic('Z04','Z03')],'Z09','test',alphabet)
    const validated=validateEdielMessageRowWithRulebook(m,'send')
    expect(validated.issues.some(issue=>issue.code==='CANONICAL_POLICY_VALIDATION_FAILED')).toBe(false)
    const failures=validated.issues.filter(target)
    expect(failures).toEqual([])
    expect(preflightEdielMessageRow(m,'send').issues.filter(target)).toEqual([])
    expect(()=>assertRulebookAllowsSend(m)).not.toThrow()
    expect(()=>assertEdielSendLock(m)).not.toThrow()
  })
  it('does not run outbound D enforcement in syntax-only inbound row preflight',()=>{
    const m={...message(badBody()),direction:'inbound' as const}
    expect(preflightEdielMessageRow(m,'parse').issues.filter(issue=>issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))).toEqual([])
  })
})

describe('field223 and optional coded-field evidence cannot disappear',()=>{
  const check=(body:Parts[])=>validateProdatSubtypePolicy(input(raw(body,'Z06'),'Z06'),[rule('217','Z06')])
  it.each(([
    [...characteristic('Z13','E64'),['CCI','','Z13']],
    [['CCI','','Z13'],...characteristic('Z13','E64')],
    [...characteristic('Z13','E64'),...characteristic('Z13','')],
    [...characteristic('Z13','E64'),...characteristic('Z13','E64')],
  ] as Parts[][]).map(reasons=>[reasons] as const))('rejects dangling, empty and equal duplicate reasons: %j',(reasons)=>{
    expect(check([line('1','A'),...reasons,...characteristic('Z04','Z03')]).some(issue=>issue.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  })
  it('rejects an empty optional coded method when its CCI is supplied',()=>{
    expect(check([line('1','A'),...characteristic('Z13','E32'),...characteristic('Z04','')]).some(issue=>issue.blocking)).toBe(true)
  })
})

it('retains a supplied matrix code list when the D outcome is optional',()=>{
  const wire=input(raw([line('1','A'),...characteristic('Z13','E32'),...characteristic('Z04','INVALID')],'Z06'),'Z06')
  expect(validateProdatSubtypePolicy(wire,[{...rule('217','Z06'),allowedValues:['Z03']}]).some(issue=>issue.blocking)).toBe(true)
})

it('a wrong caller code or application reference cannot hide D defects before transport',()=>{
  const m=message(badBody())
  m.message_code='Z04'
  m.application_reference='23-DGI-PRODAT'
  expect(preflightEdielMessageRow(m,'send').issues.some(issue=>target(issue)&&issue.description.includes('Z09:217'))).toBe(true)
  expect(()=>assertRulebookAllowsSend(m)).toThrow(/D-villkor|PRODAT_DEPENDENT|REGISTER/)
  expect(()=>assertEdielSendLock(m)).toThrow(/PRODAT_DEPENDENT_PREFLIGHT_/)
})
