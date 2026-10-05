import {registryDatabase} from './fixtures/prodat-ack-registry-db'
import {it,expect,vi} from 'vitest'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {changeRaw,changeBody,changeFields,meterChange} from './fixtures/prodat-meter-change'
import {resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({from:vi.fn<ReturnType<typeof registryDatabase>>(()=>{throw new Error('UNEXPECTED_DB')})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
const selected=(issues:{code:string;description?:string}[])=>issues.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_'))
it('actual normal/catch canonical and raw preflight use the same inbound U and false ordering',()=>{
 for(const direction of ['inbound',undefined] as const)for(const known of [false,true]){
  const rawPayload=changeRaw(changeBody(changeFields('BAD','INVALID'))),facts=known?meterChange():undefined
  const result=validateRulebookMessage({family:'PRODAT',code:'Z10',rawPayload,mode:'parse',direction,meterChange:facts})
  expect(selected(result.issues).some(i=>i.code==='PRODAT_METER_CHANGE_FIELD_INVALID')).toBe(!known)
  const preflight=preflightEdielPayload({rawPayload,mode:'parse',messageStandard:'edifact',meterChange:facts})
  expect(selected(preflight.issues).some(i=>i.code==='PRODAT_METER_CHANGE_FIELD_INVALID')).toBe(!known)
 }
})
it('incoming payload metadata cannot declare an independent false history',()=>{
 const result=validateRulebookMessage({family:'PRODAT',code:'Z10',rawPayload:changeRaw(changeBody(changeFields('BAD','INVALID'))),mode:'parse',direction:'inbound',parsedPayload:{meterChange:meterChange(),prodatEngine:{registerEvidence:{facts:{meterChange:meterChange()}}}}})
 expect(selected(result.issues).map(i=>i.code)).toContain('PRODAT_METER_CHANGE_FIELD_INVALID')
})
it('manual/TGT APERAK resolution cannot silently return positive or write with unmapped selected violations',async()=>{
 const message={message_family:'PRODAT',message_code:'Z10',raw_payload:changeRaw(changeBody(changeFields('BAD','INVALID'))),direction:'inbound',environment:'test',parsed_payload:{}} as EdielMessageRow
 const writes:{table:string;body:Record<string,unknown>}[]=[];io.from.mockImplementation(registryDatabase(writes))
 const result=await resolveAndStoreProdatAperakErrors({message})
 expect(result.errors.filter(e=>['254','242'].includes(e.fieldCode??''))).toEqual(expect.arrayContaining(['254','242'].map(fieldCode=>expect.objectContaining({ercCode:'42',fieldCode,referenceNumber:'A',lineItemReference:'EVENT-A'}))))
 expect(writes.filter(w=>w.table==='ediel_aperak_error_details').map(w=>w.body.free_text_code)).toEqual(expect.arrayContaining(['254','242']))
 expect(writes.every(w=>w.body.source_message_id===message.id||w.body.ediel_message_id===message.id)).toBe(true)
})
it('independent date/register structure remains blocking beside false ignored selected content',()=>{
 const rawPayload=changeRaw(changeBody(changeFields('BAD','INVALID'))).replace('202610010000','202602300000')
 const result=validateRulebookMessage({family:'PRODAT',code:'Z10',rawPayload,mode:'parse',direction:'inbound',meterChange:meterChange()})
 expect(result.issues.some(i=>i.fieldPath==='DTM+157'&&(i.severity==='error'||i.blocking))).toBe(true)
})
it('full canonical distinguishes ignored242 content from independent506 in the sibling component',()=>{
 // Root + independent source adjudication: p68 fourth component is242, fifth
 // is506. Shared fieldPath alone is NOT field identity. Preserve506 controls.
 for(const sibling of [false,true]){
  const normal=changeRaw(changeBody(changeFields('BAD','INVALID')))
  const rawPayload=sibling?normal.replace('CAV+:::INVALID','CAV+::::INVALID'):normal
  const result=validateRulebookMessage({family:'PRODAT',code:'Z10',rawPayload,mode:'parse',direction:'inbound',meterChange:meterChange()})
  expect(result.issues.filter(i=>i.code.startsWith('PRODAT_METER_CHANGE_')&&i.fieldPath==='CCI++Z14/CAV'&&(i.severity==='error'||i.blocking))).toEqual([])
  expect(result.issues.some(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='506')).toBe(false)
 }
})
