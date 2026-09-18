import { describe, expect, it } from 'vitest'
import { buildEdielTgtDraft, validateEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4'
import { getPortalDataRows } from '@/lib/ediel/testing/tgtEdifact.part-2'
import type { EdielTgtDraftBuildParams } from '@/lib/ediel/testing/tgtEdifact.part-1'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'

// Actual public draft entry point and existing 1.2.5 step definition. Source
// cells are synthetic; this is not an execution against the external portal.
function testData(): EdielTgtCaseTestData {
 const first=(id:string,n:string)=>({'209':id,'210':'202610010000','508':'15:806','213':n,'214':'1','218':'6','259':'201','217':'Z03','222':'D','223':'Z70','224':`M-${id}`,'260':`N-${id}`,'227':'199001011234','228':`Customer ${id}`,'229':'Street','231':'12345','232':'Town','316':'SE','233':id,'234':'Street','262':'12345'})
 const source=[[{name:'Z04D register 1',fields:first('A','10')},{name:'Z04D register 2',fields:{'209':'A','213':'20','214':'2','218':'7','259':'202'}}],[{name:'Z04D',fields:first('B','30')}]]
 return {suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',title:'Synthetic',sourceNote:'Not external certification',groups:source.map((rows,i)=>{
  const columns=rows.map((r,n)=>({name:r.name,index:n,sourceOrder:n,testCase:'1.2.5'}))
  const fields=[...new Set(rows.flatMap(r=>Object.keys(r.fields)))].map(fieldCode=>({fieldCode,fieldName:fieldCode,values:Object.fromEntries(rows.map(r=>[r.name,(r.fields as Record<string,string>)[fieldCode]??'']))}))
  const block={kind:'PRODAT' as const,sourceWorkbook:'synthetic',sourceSheet:`sheet-${i}`,entityLabel:`object-${i}`,entityNumbers:[String(i)],columns,fields}
  return {block,columns,fields}
 })}
}
const facts:ProdatDependentConditionFacts={market:'electricity',registerObjects:[{meteringPointId:'A',identityAgency:'9',expectedRegisterCount:2,meterReadingsSentInUtilts:true},{meteringPointId:'B',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:true}]}
function params(data=testData(),registerFacts:ProdatDependentConditionFacts|undefined=facts):EdielTgtDraftBuildParams & {registerFacts?:ProdatDependentConditionFacts} {
 return {actorUserId:'actor',testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',stepNo:4,importedTestData:data,registerFacts,
 systemTestContext:{companyId:'tenant-A',testSuite:'PRODAT',actorSettingId:null,actorEdielId:'12345',actorName:null,senderSubaddress:null,testPortalEdielId:'54321',testPortalName:null,testPortalEmail:null,defaultReceiverSubaddress:'PRODAT',testBrpEdielId:'11111',testBrpName:null,settings:null}}
}
function remove(data:EdielTgtCaseTestData,group:number,field:string) {
 const g=data.groups[group]; g.fields=g.fields.filter(f=>f.fieldCode!==field);g.block={...g.block,fields:g.fields}; return data
}
const row=(draft:ReturnType<typeof buildEdielTgtDraft>):EdielMessageRow=>({message_family:'PRODAT',message_code:'Z04',message_standard:'edifact',direction:'outbound',environment:'test',mime_type:'application/EDIFACT',raw_payload:draft.rawPayload,parsed_payload:draft.messageInput.parsedPayload} as EdielMessageRow)

describe('TGT full draft retains all source objects and validates before readiness',()=>{
 it('saves all object/register source rows and bound fact evidence, not just a first-row projection',()=>{
  const draft=buildEdielTgtDraft(params())
  const metadata=draft.messageInput.parsedPayload as Record<string,unknown>
  expect(metadata.portalRows).toHaveLength(2)
  expect((metadata.prodatEngine as {registerEvidence:{facts:ProdatDependentConditionFacts}})?.registerEvidence?.facts.registerObjects).toEqual(facts.registerObjects)
  expect(parseProdatMessage(draft.rawPayload).lineItems.map(l=>[l.meteringPointId,l.registerIndex])).toEqual([['A','1'],['A','2'],['B',null]])
 })
 it('a fully supplied register contract remains processable in row preflight',()=>{
  const draft=buildEdielTgtDraft(params())
  expect(preflightEdielMessageRow(row(draft),'send').issues.filter(i=>i.code.startsWith('PRODAT_REGISTER_'))).toEqual([])
 })
 it('validates missing required values on the second object, not only object A',()=>{
  const draft=buildEdielTgtDraft(params(remove(testData(),1,'214')))
  expect(draft.validationIssues.some(i=>i.severity==='error' && i.description.includes('214'))).toBe(true)
  expect(draft.messageInput.status).toBe('draft')
 })
 it('does not mark a missing-reading-evidence draft prepared merely because all fields exist',()=>{
  const p=params();delete p.registerFacts
  const draft=buildEdielTgtDraft(p)
  expect(draft.validationIssues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(true)
  expect(draft.messageInput.status).toBe('draft')
 })
 it('does not force optional constants/digits or forbidden time-frame codes into a no-readings draft',()=>{
  let data=testData(); for(const g of [0,1]) for(const field of ['214','218','259']) data=remove(data,g,field)
  const noReadings={...facts,registerObjects:facts.registerObjects!.map(r=>({...r,meterReadingsSentInUtilts:false}))}
  const draft=buildEdielTgtDraft(params(data,noReadings))
  expect(draft.validationIssues.filter(i=>i.code.startsWith('missing_register_') || i.code==='FIELD_MATRIX_REQUIRED_FIELD_MISSING' || i.code==='PRODAT_DEPENDENT_FIELD_MISSING')).toEqual([])
  expect(preflightEdielMessageRow(row(draft),'send').issues.filter(i=>i.code.startsWith('PRODAT_REGISTER_'))).toEqual([])
 })
 it('can detect a whole missing object from the original source, not from an already filtered payload inventory',()=>{
  const p=params(); const draft=buildEdielTgtDraft(p)
  const withoutB=draft.rawPayload.replace(/LIN\+3[^]*?(?=UNT\+)/,'')
  const options={actorEdielId:'12345',testPortalEdielId:'54321',receiverSubaddress:'PRODAT',applicationReference:'23-DDQ-PRODAT',sourceTestData:p.importedTestData!,registerFacts:facts,portalRows:getPortalDataRows(p,draft.step)}
  const issues=validateEdielTgtDraft(withoutB,draft.step,null,options)
  expect(issues.some(i=>i.code==='PRODAT_REGISTER_EXPECTED_OBJECT_MISSING')).toBe(true)
 })
 it('does not silently build an empty PRODAT when all supplied columns are for another function',()=>{
  const p=params(); p.importedTestData!.groups=p.importedTestData!.groups.map(g=>({...g,columns:g.columns.map(c=>({...c,name:c.name.replace('Z04D','Z06F')}))}))
  expect(()=>buildEdielTgtDraft(p)).toThrow(/source|register/)
 })
})
