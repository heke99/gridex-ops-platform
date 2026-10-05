import {it,expect} from 'vitest'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {preflightEdielMessageRow,preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {validateEdielMessageRowWithRulebook} from '@/lib/ediel/rulebook/validator'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {assertEdielSendLock} from '@/lib/ediel/transport/sendLock'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {changeRaw,changeBody,changeFields,meterChange} from './fixtures/prodat-meter-change'
import {alphabets} from './fixtures/prodat-register'
const row=(payload:string,code='Z10',parsed:Record<string,unknown>={})=>({id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction:'outbound',environment:'test',message_family:'PRODAT',message_code:code,message_standard:'edifact',raw_payload:payload,parsed_payload:{rulebookAllowInvalidSend:true,...parsed}} as unknown as EdielMessageRow)
for(const alphabet of alphabets){
 it(`actual APERAK p122 U invalid codes ${alphabet.join('')}`,()=>{
  const result=decideProdatAperak({rawPayload:changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet),testKind:'production'})
  expect(result).toMatchObject({kind:'ack',outcome:'negative'})
  expect(result.applicationErrors?.map(e=>e.fieldCode)).toEqual(expect.arrayContaining(['254','242']))
 })
 it(`actual APERAK p119 false extra content ${alphabet.join('')}`,()=>{
  const result=decideProdatAperak({rawPayload:changeRaw(changeBody(changeFields('BAD','INVALID')),alphabet),testKind:'production',meterChange:meterChange()} as Parameters<typeof decideProdatAperak>[0])
  expect(result).toMatchObject({kind:'ack',outcome:'positive',applicationErrors:[]})
 })
 it(`actual APERAK unresolved absent is positive ${alphabet.join('')}`,()=>expect(decideProdatAperak({rawPayload:changeRaw(changeBody(),alphabet),testKind:'production'})).toMatchObject({kind:'ack',outcome:'positive'}))
 it(`raw send preflight explicitly unqualified ${alphabet.join('')}`,()=>expect(preflightEdielPayload({rawPayload:changeRaw(changeBody(),alphabet),mode:'send',messageStandard:'edifact'}).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED'))
 for(const [rawCode,rowCode] of [['Z10','Z10'],['Z10','Z04'],['Z04','Z10']])it(`raw OR row ${rawCode}/${rowCode} fail closed ${alphabet.join('')}`,()=>{
  const payload=changeRaw(changeBody(),alphabet).replace(`${alphabet[1]}Z10${alphabet[1]}`,`${alphabet[1]}${rawCode}${alphabet[1]}`),message=row(payload,rowCode)
  expect(validateEdielMessageRowWithRulebook(message,'send').issues.map(i=>i.code)).toContain('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(preflightEdielMessageRow(message).issues.map(i=>i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
 })
}
it('rejects forged saved evidence, malformed evidence and catch-path metadata before intentional-invalid bypass',()=>{
 for(const parsed of [{prodatEngine:{registerEvidence:{version:1,code:'Z10',bodyBinding:'forged',facts:{meterChange:{source:{kind:'tgt'}}}}}},{prodatEngine:{registerEvidence:null}},{canonicalPolicy:{direction:'INVALID'}}]){
  const message=row(changeRaw(),'Z10',parsed)
  expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
  expect(()=>assertEdielSendLock(message)).toThrow('PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
 }
})
it('body serialization does not manufacture persisted authority from pure facts',()=>{
 const evidence=createProdatRegisterEvidence({code:'Z10',rawSegments:[],facts:{meterChange:meterChange()}})
 expect(evidence.facts.meterChange?.source.kind).toBe('caller_selection')
})
it('actual APERAK identifies the failing second object rather than borrowing first LIN/LI',()=>{
 const payload=changeRaw([...changeBody(),...changeBody(changeFields('BAD','INVALID'),'B','2')])
 const result=decideProdatAperak({rawPayload:payload,testKind:'production'})
 expect(result.applicationErrors?.filter(e=>['254','242'].includes(e.fieldCode??''))).toEqual(expect.arrayContaining([expect.objectContaining({referenceNumber:'B',lineItemReference:'EVENT-B'})]))
 expect(result.applicationErrors?.some(e=>['254','242'].includes(e.fieldCode??'')&&e.referenceNumber==='A')).toBe(false)
})
