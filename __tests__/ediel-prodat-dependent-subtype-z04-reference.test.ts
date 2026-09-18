import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { resolveProdatDependentCondition } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// Independent source oracle: P26.A r3 §2.2 p21 / §2.6 p78, original
// PC-319-Z04: D/Z70 requires the linked consumption-point RFF/Z07, other
// valid Z04 reasons forbid it. This does not certify other D cells or live DBs.
const reason = (value = 'Z70') => characteristic('Z13', value)
const reference = (value = '000-CONSUMPTION'): Parts => ['RFF', ['Z07', value]]
function message(body: Parts[], environment: 'test' | 'production', alphabet: readonly string[]): EdielMessageRow {
  const payload = raw(body, 'Z04', alphabet)
  const wire = input(payload, 'Z04')
  const registerEvidence = createProdatRegisterEvidence({code:'Z04',rawSegments:wire.rawSegments,una:wire.una,
    facts:{market:'electricity',meterReadingsSentInUtilts:false}})
  const row: Partial<EdielMessageRow> = {
    message_family:'PRODAT',message_code:'Z04',message_version:'26A',direction:'outbound',environment,
    message_standard:'edifact',application_reference:'23-DDQ-PRODAT',company_id:'synthetic-company',
    raw_payload:payload,mime_type:'application/EDIFACT',validation_report:{systemTestAckSend:true},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence,dependentConditionStatuses:[
      {...resolveProdatDependentCondition({messageCode:'Z04',fieldNumber:'319',facts:{canonicalSubtype:'L'}}),status:'not_required'},
    ]}},
  }
  return row as EdielMessageRow // explicit synthetic persistence boundary
}
const protected319 = (issue: {scope?:string;code:string;description:string;fieldPath?:string|null}) =>
  (issue.scope === 'prodat_dependent' && issue.fieldPath === 'RFF+Z07') ||
  (issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_') && issue.description.includes('Z04:319'))
const defects: {name:string;body:Parts[]}[] = [
  {name:'missing required reference',body:[line('1','A'),...reason()]},
  {name:'forbidden reference',body:[line('1','A'),...reason('Z22'),reference()]},
  {name:'missing wire reason',body:[line('1','A'),reference()]},
  {name:'header reference despite valid object',body:[reference(),line('1','A'),...reason(),reference()]},
  {name:'party reference despite valid object',body:[line('1','A'),...reason(),reference(),['NAD','UD','CUSTOMER'],reference()]},
  {name:'later register introduces common reference',body:[line('1','A','1'),...reason('Z22'),line('2','A','2'),reference()]},
  {name:'overlong reference',body:[line('1','A'),...reason(),reference('x'.repeat(26))]},
  {name:'non-value components',body:[line('1','A'),...reason(),['RFF',['Z07','VALID','1156-IS-NOT-USED']]]},
]
describe('Z04:319 protected actual outbound boundaries',()=>{
  for(const environment of ['test','production'] as const) for(const alphabet of alphabets) {
    for(const defect of defects) it(`${environment}/${alphabet.join('')}: ${defect.name}`,()=>{
      const row=message(defect.body,environment,alphabet)
      for(const override of [false,true]) {
        row.parsed_payload={...row.parsed_payload,rulebookAllowInvalidSend:override}
        const result=validateEdielMessageRowWithRulebook(row,'send')
        expect(result.issues.some(i=>protected319(i)&&i.blocking&&i.severity==='error')).toBe(true)
        expect(()=>assertRulebookAllowsSend(row)).toThrow(/Z04:319/)
        expect(preflightEdielMessageRow(row,'send').issues.some(i=>protected319(i)&&i.severity==='error')).toBe(true)
        expect(()=>assertEdielSendLock(row)).toThrow(/Z04:319/)
      }
    })
    it(`${environment}/${alphabet.join('')}: stale family/code cannot hide Z04D`,()=>{
      const row=message([line('1','A'),...reason()],environment,alphabet)
      row.message_family='UTILTS'; row.message_code='Z06'
      expect(validateEdielMessageRowWithRulebook(row,'send').issues.some(protected319)).toBe(true)
      expect(()=>assertRulebookAllowsSend(row)).toThrow(/Z04:319/)
      expect(()=>assertEdielSendLock(row)).toThrow(/Z04:319/)
    })
    for(const code of ['Z70','Z22','Z23','Z24','Z25','Z26']) it(`${environment}/${alphabet.join('')}: bounded positive ${code}`,()=>{
      const body=[line('1','A'),...reason(code),...(code==='Z70'?[reference("0000:+'?CONSUMPTION")]:[])]
      const row=message(body,environment,alphabet)
      expect(validateEdielMessageRowWithRulebook(row,'send').issues.filter(protected319)).toEqual([])
      expect(preflightEdielMessageRow(row,'send').issues.filter(protected319)).toEqual([])
      expect(validateProdatSubtypePayload(input(row.raw_payload!,'Z04'))).toEqual([])
    })
  }
  it('does not add outbound dependent errors to inbound parse-only preflight',()=>{
    const row={...message([line('1','A'),...reason()],'test',alphabets[0]),direction:'inbound' as const}
    expect(preflightEdielMessageRow(row,'parse').issues.filter(protected319)).toEqual([])
    expect(()=>assertRulebookAllowsSend(row)).not.toThrow()
  })
})
