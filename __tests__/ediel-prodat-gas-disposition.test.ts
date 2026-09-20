import {registryDatabase} from './fixtures/prodat-ack-registry-db'
import {it,expect,vi,beforeEach} from 'vitest'
import {payload,characteristic,selection,alphabets} from './fixtures/prodat-gas'
import {deriveProdatAperakValidationIssues,resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
import {compareInboundPayloadToTgtTestData} from '@/lib/ediel/testing/tgtAutoMatcher'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({from:vi.fn<ReturnType<typeof registryDatabase>>(()=>{throw new Error('UNEXPECTED_DB')}),provider:vi.fn(()=>{throw new Error('UNEXPECTED_PROVIDER')}),route:vi.fn(),event:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:io.provider}))
vi.mock('@/lib/ediel/db',()=>({getEdielRouteProfileByCommunicationRouteId:io.route,createEdielMessageEvent:io.event,updateEdielMessageStatus:io.update}))
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
beforeEach(()=>vi.clearAllMocks())
const row=(wire:string,direction:'inbound'|'outbound'='inbound')=>({id:'00000000-0000-4000-8000-000000000001',company_id:'00000000-0000-4000-8000-000000000002',direction,environment:'test',message_family:'PRODAT',message_code:'Z04',message_standard:'edifact',raw_payload:wire,parsed_payload:{rulebookAllowInvalidSend:true},application_reference:'23-DDQ-PRODAT'} as unknown as EdielMessageRow)
function source(){
 const columns=[{name:'Z04L',index:1,sourceOrder:1,testCase:'SYNTHETIC'}]
 const fields=Object.entries({'209':'A','320':'EXPECTED','240':'EXPECTED'}).map(([fieldCode,v])=>({fieldCode,fieldName:fieldCode,values:{Z04L:v}}))
 return {suite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC',title:'Synthetic',sourceNote:'Synthetic',groups:[{columns,fields,block:{kind:'PRODAT',sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'A',entityNumbers:['1'],columns,fields}}]} as never
}
it('source comparison ignores inapplicable EL descriptors and grey240 without fabricating errors',()=>{
 expect(compareInboundPayloadToTgtTestData({message:row(payload()),testData:source()})).toEqual([])
 const gas=compareInboundPayloadToTgtTestData({message:row(payload('Z04','Z22',[],'gas')),testData:source()})
 expect(gas.map(i=>i.fieldCode)).toEqual(['320'])
})
it('manual historical GAS320 missing requires review before unmapped ERC fallback or DB',async()=>{
 const message={...row(payload('Z06','E32',[...characteristic('Z02','1',3),...characteristic('Z05','6',3)],'gas').replace('LIN+1++A:::89','LIN+1++735123456789012345:::89')),message_code:'Z06'}
 const writes:{table:string;body:Record<string,unknown>}[]=[];io.from.mockImplementation(registryDatabase(writes))
 expect(deriveProdatAperakValidationIssues({message})).toContainEqual(expect.objectContaining({selectedApplicationError:expect.objectContaining({ercCode:'41',fieldCode:'320'})}))
 const result=await resolveAndStoreProdatAperakErrors({message})
 expect(result.errors).toContainEqual(expect.objectContaining({ercCode:'41',fieldCode:'320',referenceNumber:'735123456789012345',lineItemReference:'EVENT-A'}))
 expect(writes.filter(w=>w.table==='ediel_aperak_error_details').map(w=>w.body)).toContainEqual(expect.objectContaining({source_message_id:message.id,application_error:'41',free_text_code:'320'}))
})
it('final actual EL ACK and manual resolution ignore false fields even malformed content',async()=>{
 const rawPayload=payload('Z06','E32',[...characteristic('Z02','1',3),...characteristic('Z05','6',3),['RFF',['Z08','']],['RFF',['Z06','å'.repeat(36),'unused']]])
 expect(decideProdatAperak({rawPayload,testKind:'production'})).toMatchObject({kind:'ack',outcome:'positive'})
 const message={...row(rawPayload.replace('LIN+1++A:::89','LIN+1++735123456789012345:::89')),message_code:'Z06'}
 expect(await resolveAndStoreProdatAperakErrors({message})).toMatchObject({errors:[],issueCount:0})
 expect(io.from).not.toHaveBeenCalled()
})
it('malformed receiver evidence leaves ordinary diagnostics intact on normal and catch paths',()=>{
 const bad={...selection(true),objects:[null]} as never
 for(const applicationReference of [undefined,'BAD']){
  const params={family:'PRODAT',code:'Z06',rawPayload:payload('Z06','E64'),mode:'parse' as const,direction:'inbound' as const,applicationReference}
  const baseline=validateRulebookMessage(params),actual=validateRulebookMessage({...params,gasSerialChange:bad})
  expect(actual.issues.filter(i=>!i.code.startsWith('PRODAT_GAS_'))).toEqual(baseline.issues.filter(i=>!i.code.startsWith('PRODAT_GAS_')))
  expect(actual.issues.filter(i=>i.code==='PRODAT_GAS_EVIDENCE_INVALID')).toEqual([expect.objectContaining({severity:'warning',blocking:false})])
 }
})
it('actual SMTP holds GAS before route/storage/provider work',async()=>{
 await expect(sendEdielMessageViaSmtp({...row(payload('Z04','Z70',[],'gas'),'outbound'),communication_route_id:'route'},{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow('PRODAT_GAS_SOURCE_UNQUALIFIED')
 for(const mock of Object.values(io))expect(mock).not.toHaveBeenCalled()
})
it('actual loaded route mismatch holds coherent EL before provider/storage work',async()=>{
 io.route.mockResolvedValue({application_reference:'27-DDQ-PRODAT'})
 await expect(sendEdielMessageViaSmtp({...row(payload(),'outbound'),receiver_email:'synthetic@example.test',communication_route_id:'route'},{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow('PRODAT_GAS_SOURCE_UNQUALIFIED')
 expect(io.route).toHaveBeenCalledOnce();for(const mock of [io.from,io.provider,io.event,io.update])expect(mock).not.toHaveBeenCalled()
})
for(const alphabet of alphabets)it(`direct SMTP enforces each EL Z04 exclusion before all external work ${alphabet}`,async()=>{
 for(const [qualifier,field] of [['Z08','320'],['Z06','240']]){
  const message={...row(payload('Z04','Z22',[['NAD','UD'],['RFF',[qualifier,'']]],'electricity',alphabet),'outbound'),receiver_email:'synthetic@example.test',communication_route_id:'route'}
  await expect(sendEdielMessageViaSmtp(message,{actorUserId:'00000000-0000-4000-8000-000000000003'})).rejects.toThrow(`PRODAT_GAS_${field}_FORBIDDEN`)
  for(const mock of Object.values(io))expect(mock).not.toHaveBeenCalled()
 }
})
it('SMTP field exclusion preserves the existing protected date-event diagnostic',async()=>{
 const message={...row(payload('Z06','E64',[['RFF',['Z08','HEAT']],['DTM',['92','202602300000','203']]]),'outbound'),message_code:'Z06',receiver_email:'synthetic@example.test'}
 const result=sendEdielMessageViaSmtp(message,{actorUserId:'00000000-0000-4000-8000-000000000003'})
 await expect(result).rejects.toThrow('PRODAT_GAS_320_FORBIDDEN')
 await expect(result).rejects.toThrow('PRODAT_DATE_EVENT_FORMAT_INVALID')
 for(const mock of Object.values(io))expect(mock).not.toHaveBeenCalled()
})
