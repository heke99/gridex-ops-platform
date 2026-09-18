import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, endUser, input, line, qty, raw, type Parts } from './fixtures/prodat-register'

// P26.A p22/79 independent parent/child oracle. Other earlier D/register
// prerequisites are supplied as actual wire data so they cannot mask UD tests.
const reason = (value = 'E34') => characteristic('Z13', value)
const udIssue = (issue: {scope?: string; code:string; description:string}) =>
  (issue.scope === 'prodat_dependent' || issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))
    && /Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/.test(issue.description)
function customer(element?:number, value=''): Parts {
  const parts = [...endUser()]
  if (element !== undefined) parts[element] = value
  return parts
}
function message(body: Parts[], code:'Z06'|'Z09', environment:'test'|'production', alphabet:readonly string[]): EdielMessageRow {
  const payload = raw(body.flatMap((part, index): Parts[] => {
    if (part[0] !== 'LIN') return [part]
    const nextLine = body.findIndex((item, position) => position > index && item[0] === 'LIN')
    const scope = body.slice(index, nextLine < 0 ? undefined : nextLine)
    const fOrG = scope.some(item => item[0] === 'CAV' && Array.isArray(item[1]) && ['E64','E32'].includes(item[1][0]))
    const laterRegister = Array.isArray(part[4]) && part[4][1] !== '1'
    if (code === 'Z06') return [part, qty('1'), ...(laterRegister ? [] : [
      ['DTM',['354','15','806']],...characteristic('Z04','Z04'),...characteristic('Z07','E22'),
      ...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
    ] as Parts[])]
    return [part,['DTM',['157','202610010000','203']],...(fOrG ? characteristic('Z04','Z04') : [])]
  }),code,alphabet)
  const wire = input(payload,code)
  const registerEvidence = createProdatRegisterEvidence({code,rawSegments:wire.rawSegments,una:wire.una,facts:{market:'electricity',meterReadingsSentInUtilts:false}})
  const row: Partial<EdielMessageRow> = {direction:'outbound',environment,message_family:'PRODAT',message_code:code,message_version:'26A',
    message_standard:'edifact',application_reference:'23-DDQ-PRODAT',company_id:'synthetic-company',raw_payload:payload,mime_type:'application/EDIFACT',
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{registerEvidence,
      dependentConditionStatuses:evaluateProdatDependentConditions({messageCode:code,facts:{canonicalSubtype:'F'}}).map(condition=>({...condition,status:'not_required'}))}}}
  return row as EdielMessageRow // Synthetic row boundary: no actual database or transport.
}
const defects: {name:string; body:Parts[]; uncertain?:boolean}[] = [
  {name:'missing E parent',body:[line('1','A'),...reason()]},
  ...[2,4,6,8,9].map(element=>({name:`missing E child element${element}`,body:[line('1','A'),...reason(),customer(element)]})),
  {name:'forbidden F parent',body:[line('1','A'),...reason('E64'),customer()]},
  {name:'forbidden empty F parent',body:[line('1','A'),...reason('E64'),['NAD','UD']]},
  {name:'header parent beside valid E object',body:[customer(),line('1','A'),...reason(),customer()]},
  {name:'duplicate E parent',body:[line('1','A'),...reason(),customer(),customer()]},
  {name:'malformed E role',body:[line('1','A'),...reason(),['NAD',['UD','EXTRA']]]},
  {name:'unused E data',body:[line('1','A'),...reason(),customer(10,'EXTRA')]},
  {name:'another object cannot supply E',body:[line('1','A'),...reason(),line('2','B'),...reason(),customer()]},
  {name:'missing reason cannot borrow snapshot',body:[line('1','A'),customer()],uncertain:true},
]
for (const code of ['Z06','Z09'] as const) for (const environment of ['test','production'] as const) for (const alphabet of alphabets) {
  describe(`${code}/${environment}/${alphabet.join('')}: actual UD outbound gates`,()=>{
    for (const defect of defects) it(defect.name,()=>{
      const row = message(defect.body,code,environment,alphabet)
      for (const override of [false,true]) for (const ackOverride of [false,true]) {
        row.parsed_payload = {...row.parsed_payload,rulebookAllowInvalidSend:override}
        row.validation_report = {systemTestAckSend:{enabled:ackOverride,source:'system_test_ack_action'}}
        const issues = validateEdielMessageRowWithRulebook(row,'send').issues
        expect(issues.filter(issue=>issue.scope==='prodat_register'&&(issue.blocking||issue.severity==='error'))).toEqual([])
        if (!defect.uncertain) expect(issues.filter(issue=>issue.scope==='prodat_dependent'&&!udIssue(issue))).toEqual([])
        expect(issues.some(issue=>udIssue(issue)&&issue.blocking&&issue.severity==='error')).toBe(true)
        expect(()=>assertRulebookAllowsSend(row)).toThrow(/Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/)
        expect(preflightEdielMessageRow(row,'send').issues.some(issue=>udIssue(issue)&&issue.severity==='error')).toBe(true)
        expect(()=>assertEdielSendLock(row)).toThrow(/Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/)
      }
    })
    it('stale persisted code/family cannot hide an E parent error',()=>{
      const row = message([line('1','A'),...reason()],code,environment,alphabet)
      row.message_family='UTILTS'; row.message_code='Z04'
      expect(validateEdielMessageRowWithRulebook(row,'send').issues.some(udIssue)).toBe(true)
      expect(()=>assertRulebookAllowsSend(row)).toThrow(/END_USER_GROUP/)
      expect(()=>assertEdielSendLock(row)).toThrow(/END_USER_GROUP/)
    })
    for (const transaction of ['E34','E64','E32']) it(`bounded positive ${transaction} retains separate production readiness`,()=>{
      const row = message([line('1','A'),...reason(transaction),...(transaction==='E34'?[customer()]:[])],code,environment,alphabet)
      const issues=validateEdielMessageRowWithRulebook(row,'send').issues
      expect(issues.filter(issue=>(issue.scope==='prodat_register'||issue.scope==='prodat_dependent')&&(issue.blocking||issue.severity==='error'))).toEqual([])
      expect(preflightEdielMessageRow(row,'send').issues.filter(udIssue)).toEqual([])
      expect(()=>assertRulebookAllowsSend(row)).not.toThrow()
      if(environment==='test') expect(()=>assertEdielSendLock(row)).not.toThrow()
      else expect(()=>assertEdielSendLock(row)).toThrow(/Produktionsmeddelande saknar/)
    })
  })
}
for(const alphabet of alphabets) it(`${alphabet.join('')}: later Z06 register parent is still protected`,()=>{
  const row=message([line('1','A','1'),...reason(),customer(),line('2','A','2'),customer()],'Z06','test',alphabet)
  expect(()=>assertRulebookAllowsSend(row)).toThrow(/END_USER_GROUP/)
  expect(()=>assertEdielSendLock(row)).toThrow(/END_USER_GROUP/)
})
for(const code of ['Z06','Z09'] as const) it(`${code}: inbound parse-only preflight does not inherit outbound UD errors`,()=>{
  const row={...message([line('1','A'),...reason()],code,'test',alphabets[0]),direction:'inbound' as const}
  expect(preflightEdielMessageRow(row,'parse').issues.filter(udIssue)).toEqual([])
  expect(()=>assertRulebookAllowsSend(row)).not.toThrow()
})
