import { describe, expect, it } from 'vitest'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateEdielMessageRowWithRulebook, validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// P26.A r3 §2.6 pp49/51/52: C507/2005 is exactly90/354/693.
// Padding INSIDE the qualifier survives the unchanged tokenizer. This is not
// the previously withdrawn segment-boundary whitespace assertion.
const dates = [['302','90','202610010000','203'],['508','354','15','806'],['326','693','202609191200','203']] as const
const negative = (): Parts[] => [['LIN','1'],...characteristic('Z13','Z96')]
const positive = (): Parts[] => [line('1','A'), ...dates.map(([,q,value,format]):Parts=>['DTM',[q,value,format]]),
  ...characteristic('Z13','S17'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),
  ...characteristic('Z14','8716867000030',4),...characteristic('Z22','E17'),
  ['RFF',['Z05','ABC']],['RFF',['Z09','PERMISSION']],
  ['NAD','UD',['ID','','89'],'','User','','','','','SE'],['NAD','IT',['A','','89'],'','','Site'],
]
const target = (issue:{scope?:string;description:string;code:string}) =>
  (issue.scope==='prodat_dependent'||issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_')) && /Z14:(302|508|326)\b/.test(issue.description)
function row(body:Parts[],alphabet:readonly string[]):EdielMessageRow {
  return {message_family:'PRODAT',message_code:'Z14',direction:'outbound',environment:'test',message_standard:'edifact',company_id:'synthetic',
    raw_payload:raw(body,'Z14',alphabet),application_reference:'23-DDQ-PRODAT',mime_type:'application/EDIFACT',
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{dependentConditionStatuses:[]}}} as unknown as EdielMessageRow
}
for(const alphabet of alphabets) for(const subtype of ['N','V'] as const) describe(`Z14 ${subtype} padded DTM ${alphabet.join('')}`,()=>{
  const body = subtype==='N'?negative:positive
  it('accepts its valid control before inserting the malformed additional field',()=>{
    const message=row(body(),alphabet)
    expect(validateProdatSubtypePayload(input(message.raw_payload!,'Z14'))).toEqual([])
    expect(preflightEdielMessageRow(message,'send').issues.filter(target)).toEqual([])
    if(subtype==='N')expect(()=>assertEdielSendLock(message)).not.toThrow()
    else expect(()=>assertEdielSendLock(message)).toThrow(/SOURCE_UNQUALIFIED/)
  })
  for(const [field,q,value,format] of dates) for(const padding of ['leading','trailing'] as const) for(const placement of ['header','object','party'] as const) {
    it(`${field}/${padding}/${placement} cannot hide behind a valid field or test-send override`,()=>{
      const malformed:Parts=['DTM',[padding==='leading'?` ${q}`:`${q} `,value,format]]
      const parts=body();parts.splice(placement==='header'?0:placement==='object'?1:parts.length,0,malformed)
      const message=row(parts,alphabet), wire=input(message.raw_payload!,'Z14')
      expect(()=>assertEdielSendLock(message)).toThrow(/Z14:(302|508|326)/)
      const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:subtype==='N'?'V':'N',direction:'outbound',referenceDate:'2026-09-19',mode:'catalog_evidence'})
      for(const scope of ['all','dependent_only'] as const) {
        expect(validateCanonicalPolicyFields({policy,rawSegments:wire.rawSegments,una:wire.una,scope}).some(i=>target(i)&&i.description.includes(`Z14:${field}`))).toBe(true)
      }
      expect(validateProdatSubtypePayload(wire).some(i=>target(i)&&i.description.includes(`Z14:${field}`))).toBe(true)
      expect(validateEdielMessageRowWithRulebook(message,'send').issues.some(i=>target(i)&&i.blocking)).toBe(true)
      expect(preflightEdielMessageRow(message,'send').issues.some(target)).toBe(true)
      expect(()=>assertRulebookAllowsSend(message)).toThrow(/Z14:(302|508|326)/)
      const incoming={...message,direction:'inbound' as const}
      expect(preflightEdielMessageRow(incoming,'parse').issues.filter(target)).toEqual([])
      expect(validateRulebookMessage({rawPayload:incoming.raw_payload!,family:'PRODAT',code:'Z14',direction:'inbound',mode:'parse',environment:'test'}).issues.filter(target)).toEqual([])
    })
  }
})
it('does not reinterpret unowned or different qualifier codes as the three migrated fields',()=>{
  for(const q of [' 91',' 90X','903','6930']) {
    const wire=input(raw([...negative(),['DTM',[q,'202610010000','203']]],'Z14'),'Z14')
    expect(validateProdatSubtypePayload(wire).filter(target)).toEqual([])
  }
})
