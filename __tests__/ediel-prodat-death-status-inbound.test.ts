import {registryDatabase} from './fixtures/prodat-ack-registry-db'
import {it,expect,vi} from 'vitest'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {decideProdatAperakOutcome} from '@/lib/ediel/prodat/prodatAperak'
import {resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {alphabets,characteristic} from './fixtures/prodat-register'
const io=vi.hoisted(()=>({from:vi.fn<ReturnType<typeof registryDatabase>>(()=>{throw new Error('UNEXPECTED_DB')})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
const selected=(issues:{code:string;severity?:string;blocking?:boolean}[])=>issues.filter(i=>i.code.startsWith('PRODAT_DEATH_STATUS_'))
for(const alphabet of alphabets)it(`actual normal/catch/preflight/APerak matrix ${alphabet.join('')}`,()=>{
 for(const value of ['death','not_death',null] as const)for(const variant of ['missing','bad','qualifier','residual'] as const){
  const extra=variant==='missing'?[]:variant==='bad'?characteristic('Z17','BAD'):variant==='qualifier'?[['CCI','','Z17'],['CAV',['Z41','X']]]:[['CCI','X','Z17'],['CAV',['Z41','','','ignored']]]
  const rawPayload=deathRaw('Z06',deathBody('E34',extra),alphabet),deathStatus=value?deathSelection(value):undefined
  const negative=value!=='not_death'&&(variant==='bad'||variant==='qualifier'||variant==='missing'&&value==='death')
  for(const direction of ['inbound',undefined] as const){
   const result=validateRulebookMessage({family:'PRODAT',code:'Z06',rawPayload,mode:'parse',direction,deathStatus})
   expect(selected(result.issues).some(i=>i.blocking||i.severity==='error')).toBe(negative)
  }
  expect(selected(preflightEdielPayload({rawPayload,mode:'parse',messageStandard:'edifact',deathStatus}).issues).some(i=>i.blocking||i.severity==='error')).toBe(negative)
  const result=decideProdatAperak({rawPayload,testKind:'production',deathStatus})
  expect(result).toMatchObject({kind:'ack',outcome:negative?'negative':'positive'})
  if(negative)expect(result.applicationErrors).toContainEqual(expect.objectContaining({fieldCode:'310',ercCode:variant==='missing'?'41':'42',referenceNumber:'A',lineItemReference:'LI-A'}))
 }
})
it('malformed or saved local input cannot establish false or require U absence',()=>{
 const rawPayload=deathRaw('Z06',deathBody('E34',characteristic('Z17','BAD')))
 const result=validateRulebookMessage({family:'PRODAT',code:'Z06',rawPayload,mode:'parse',direction:'inbound',parsedPayload:{deathStatus:deathSelection('not_death'),prodatEngine:{registerEvidence:{facts:{deathStatus:deathSelection('not_death')}}}}})
 expect(selected(result.issues).map(i=>i.code)).toContain('PRODAT_DEATH_STATUS_VALUE_INVALID')
 const malformed={source:{kind:'caller_selection'},objects:[]} as unknown as ReturnType<typeof deathSelection>
 expect(decideProdatAperak({rawPayload:deathRaw(),deathStatus:malformed,testKind:'production'})).toMatchObject({kind:'ack',outcome:'positive'})
})
it('wrapper and manual/TGT resolver consume the selected policy before positive shortcuts or DB writes',async()=>{
 expect(decideProdatAperakOutcome(deathRaw('Z09'),{testKind:'production'})).toMatchObject({outcome:'negative',applicationErrors:[expect.objectContaining({fieldCode:'310',ercCode:'41'})]})
 const message={message_family:'PRODAT',message_code:'Z09',raw_payload:deathRaw('Z09'),direction:'inbound',environment:'test',parsed_payload:{}} as EdielMessageRow
 const writes:{table:string;body:Record<string,unknown>}[]=[];io.from.mockImplementation(registryDatabase(writes))
 const result=await resolveAndStoreProdatAperakErrors({message})
 expect(result.errors).toContainEqual(expect.objectContaining({ercCode:'41',fieldCode:'310',referenceNumber:'A',lineItemReference:'LI-A'}))
 expect(writes.filter(w=>w.table==='ediel_aperak_error_details').map(w=>w.body)).toContainEqual(expect.objectContaining({source_message_id:message.id,application_error:'41',free_text_code:'310',metering_point_id:'A',transaction_reference:'LI-A'}))
})
import {prodatIssuesToAperakErrors} from '@/lib/ediel/prodat/prodatAperak'
it('legacy error wrapper preserves own310 attribution',()=>{
 expect(prodatIssuesToAperakErrors(deathRaw('Z09'))).toContainEqual(expect.objectContaining({fieldCode:'310',ercCode:'41',referenceNumber:'A',lineItemReference:'LI-A'}))
})
