import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { validateEdielMessageRowWithRulebook } from '@/lib/ediel/rulebook/validator'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, endUser, input, line, raw, type Parts } from './fixtures/prodat-register'

const fields = ['END_USER_GROUP','227','228','229','231','232','316']
const udIssue = (issue:{scope?:string;description:string}) => issue.scope==='prodat_dependent' && /Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/.test(issue.description)
const reasons = {Z06:['E64','E32'],Z09:['Z27','Z70','E64','E32']}
function row(payload:string, code:string, direction:'inbound'|'outbound'): EdielMessageRow {
  const partial:Partial<EdielMessageRow>={direction,environment:'test',message_family:'PRODAT',message_code:code,message_version:'26A',raw_payload:payload,application_reference:'23-DDQ-PRODAT',message_standard:'edifact'}
  return partial as EdielMessageRow
}
function inboundFields(payload:string, code:string) {
  const wire=input(payload,code)
  const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:'F',direction:'inbound',referenceDate:'2026-09-18',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
  return validateCanonicalPolicyFields({policy:{...policy,fieldRules:canonicalProdat26AFieldRules(code).filter(rule=>fields.includes(rule.fieldNumber!))},rawSegments:wire.rawSegments,una:wire.una})
}
it('retains P-02/SC-031: valid extra national fields are ignored on reception, not allowed for sending',()=>{
  const rules=JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/rules.json','utf8')) as {id:string;condition:string;on_pass:string}[]
  expect(rules.find(rule=>rule.id==='P-02')).toMatchObject({condition:'Nationell extra information som ska ignoreras får inte utlösa negativ APERAK.',on_pass:'Ignorera för affärsprojektion; bevara råpayload.'})
})
for (const code of ['Z06','Z09'] as const) for (const alphabet of alphabets) {
  for (const transaction of reasons[code]) it(`${code}/${transaction}/${alphabet.join('')}: inbound extra UD is not an outbound violation`,()=>{
    const body=[line('1','A'),...characteristic('Z13',transaction),endUser()]
    const payload=raw(body,code,alphabet), wire=input(payload,code)
    for (const direction of ['inbound','outbound'] as const) {
      const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:transaction,direction,referenceDate:'2026-09-18',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence'})
      for(const scope of ['all','dependent_only'] as const){
        const result=validateCanonicalPolicyFields({policy:{...policy,fieldRules:canonicalProdat26AFieldRules(code).filter(rule=>fields.includes(rule.fieldNumber!))},rawSegments:wire.rawSegments,una:wire.una,scope})
        expect(result.filter(udIssue).some(issue=>issue.blocking)).toBe(direction==='outbound')
      }
      const message=row(payload,code,direction), before=JSON.stringify(message)
      const actual=validateEdielMessageRowWithRulebook(message,direction==='inbound'?'parse':'send')
      expect(actual.issues.filter(udIssue).some(issue=>issue.blocking)).toBe(direction==='outbound')
      expect(JSON.stringify(message)).toBe(before)
    }
  })
  it(`${code}/${alphabet.join('')}: reception still requires E parent and five fields`,()=>{
    for(const missing of [-1,2,4,6,8,9]){
      const ud=[...endUser()]; if(missing>=0)ud[missing]=''
      const payload=raw([line('1','A'),...characteristic('Z13','E34'),...(missing<0?[]:[ud])],code,alphabet)
      expect(inboundFields(payload,code).filter(udIssue).some(issue=>issue.blocking)).toBe(true)
    }
    const payload=raw([line('1','A'),...characteristic('Z13','E34'),endUser()],code,alphabet)
    expect(inboundFields(payload,code).filter(udIssue)).toEqual([])
  })
  it(`${code}/${alphabet.join('')}: inactive extra in one object cannot satisfy active E in another`,()=>{
    const payload=raw([line('1','A'),...characteristic('Z13','E64'),endUser(),line('2','B'),...characteristic('Z13','E34')],code,alphabet)
    const issues=validateEdielMessageRowWithRulebook(row(payload,code,'inbound'),'parse').issues.filter(udIssue)
    expect(issues.some(issue=>issue.description.includes('Objekt A / 89'))).toBe(false)
    expect(issues.some(issue=>issue.description.includes('Objekt B / 89')&&issue.blocking)).toBe(true)
  })
  it(`${code}/${alphabet.join('')}: reception tolerance does not disable real NAD component syntax checks`,()=>{
    const invalid:Parts=[...endUser(),'EXCESS']
    const payload=raw([line('1','A'),...characteristic('Z13','E34'),invalid],code,alphabet)
    expect(inboundFields(payload,code).some(issue=>udIssue(issue)&&issue.blocking)).toBe(true)
    const dangling=payload+alphabet[2]
    expect(()=>preflightEdielMessageRow(row(dangling,code,'inbound'),'parse')).toThrow(/edifact_dangling_release_character/)
  })
}
