import {selectedInvoiceeFact} from './fixtures/prodat-ud'
import type {EdielTgtCaseTestData} from '@/lib/ediel/testing/tgtTestData'
import type {EdielTgtDraftBuildParams} from '@/lib/ediel/testing/tgtEdifact.part-1'
import type {EdielTestRunRow,EdielMessageRow} from '@/lib/ediel/types'
import type {ProdatEndUserAddressObject} from '@/lib/ediel/prodat/prodatEndUserAddress'
// Mutable source tuples let negative cases contradict one explicit source fact.
type MutableAddress=Omit<ProdatEndUserAddressObject,'addressLines'> & {addressLines:string[]}
import {describe,it,expect} from 'vitest'
import {buildTgtRegisterFactNotes,readTgtRegisterFacts} from '@/lib/ediel/testing/tgtRegisterFacts'
import {buildEdielTgtDraft} from '@/lib/ediel/testing/tgtEdifact.part-4'
import {getPortalDataRows} from '@/lib/ediel/testing/tgtEdifact.part-2'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {preflightEdielMessageRow} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
const data=():EdielTgtCaseTestData=>({suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',title:'Synthetic',sourceNote:'Synthetic',groups:['A','B'].map(id=>{
 const column={name:'Z03D',index:0,sourceOrder:0,testCase:'1.2.5'}
 const values:Record<string,string>={'209':id,'227':'199001011234','228':'Synthetic','229-1':'','229-2':`BOX ${id}`,'229-3':"c/o :+?'",'231':'12345','232':'Town','316':'SE','223':'Z70','210':'202610010000','217':'Z03','261':'POA'}
 const fields=Object.entries(values).map(([fieldCode,value])=>({fieldCode,fieldName:fieldCode,values:{Z03D:value}}))
 return {columns:[column],fields,block:{kind:'PRODAT',sourceWorkbook:'synthetic',sourceSheet:id,entityLabel:id,entityNumbers:[id],columns:[column],fields}}
})})
const run=():EdielTestRunRow=>({id:'RUN',company_id:'tenant',role_code:'supplier',test_case_code:'1.2.5',test_suite:'PRODAT',notes:null,approval_version:null,title:'Synthetic',status:'draft',customer_id:null,site_id:null,metering_point_id:null,grid_owner_id:null,started_at:null,completed_at:null,failure_reason:null,created_at:'2026-09-19T00:00:00Z',updated_at:'2026-09-19T00:00:00Z',created_by:null,updated_by:null})
const facts=():{endUserAddressObjects:MutableAddress[]}=>({endUserAddressObjects:['A','B'].map(id=>({meteringPointId:id,identityAgency:'9',endUser:{id:'199001011234',qualifier:'SE2',agency:'260'},availability:'available',addressLines:['',`BOX ${id}`,"c/o :+?'"],source:{kind:'caller_selection',companyId:'tenant',reference:'synthetic-source'}}))})
const ctx=()=>({run:run(),testData:data(),code:'Z03',stepNo:1})
const saved=()=>{const c=ctx();c.run.notes=buildTgtRegisterFactNotes({...c,facts:{...facts(),invoiceeObjects:['A','B'].map(id=>selectedInvoiceeFact(id,'tenant','9','199001011234',['',`BOX ${id}`,"c/o :+?'"],'SE2','12345','Town'))},actorId:'ACTOR',sourceNote:'Original selected customer addresses'});return c}
describe('TGT independent address source ownership',()=>{
 it('supports address facts without inventing register inventory',()=>{
  const c=saved();const result=readTgtRegisterFacts(c)!
  expect(result.endUserAddressObjects!.map(r=>r.source)).toEqual(['A','B'].map(()=>expect.objectContaining({kind:'tgt',companyId:'tenant',runId:'RUN',stepNo:1,code:'Z03'})))
  expect(result.registerObjects).toBeUndefined()
 })
 for(const change of ['run','company','step','code','source'])it(`rejects changed ${change}`,()=>{
  const c=saved();if(change==='run')c.run.id='OTHER';if(change==='company')c.run.company_id='OTHER';if(change==='step')c.stepNo=2;if(change==='code')c.code='Z01';if(change==='source')c.testData.groups[0].fields.find(f=>f.fieldCode==='229-2')!.values.Z03D='Changed'
  if(change==='step')expect(readTgtRegisterFacts(c)).toBeUndefined();else expect(()=>readTgtRegisterFacts(c)).toThrow()
 })
 for(const change of ['wrongValue','false','wrongCustomer','wrongAgency','extra','duplicate'])it(`refuses source contradiction ${change}`,()=>{
  const c=ctx(),f=facts();if(change==='wrongValue')f.endUserAddressObjects[0].addressLines[1]='OTHER';if(change==='false'){f.endUserAddressObjects[0].availability='unavailable';f.endUserAddressObjects[0].addressLines=[]}if(change==='wrongCustomer')f.endUserAddressObjects[0].endUser.id='OTHER';if(change==='wrongAgency')f.endUserAddressObjects[0].identityAgency='89';if(change==='extra')f.endUserAddressObjects.push({...f.endUserAddressObjects[0],meteringPointId:'C'});if(change==='duplicate')f.endUserAddressObjects.push(f.endUserAddressObjects[0]);
  expect(()=>buildTgtRegisterFactNotes({...c,facts:f,actorId:'A',sourceNote:'Assertion'})).toThrow()
 })
 it('does not reinterpret absent source data as unavailable without an assertion',()=>{
  const c=ctx();for(const g of c.testData.groups)g.fields=g.fields.filter(f=>!f.fieldCode.startsWith('229'))
  const f=facts();for(const r of f.endUserAddressObjects){r.availability='unknown';r.addressLines=[]}
  c.run.notes=buildTgtRegisterFactNotes({...c,facts:f,actorId:'A',sourceNote:'No selection available'})
  expect(readTgtRegisterFacts(c)?.endUserAddressObjects?.[0].availability).toBe('unknown')
 })
 it('reads positional raw source before scalar sanitization',()=>{
  const rows=getPortalDataRows({...draftParams(),importedTestData:data()},{family:'PRODAT',code:'Z03',stepNo:1,direction:'outbound',actor:'gridex',required:true,title:'Synthetic',description:'Synthetic source fixture'})
  expect(rows[0].customerAddressLines).toEqual(['','BOX A',"c/o :+?'"])
 })
})

const draftParams=():EdielTgtDraftBuildParams & {importedTestData:EdielTgtCaseTestData}=>{const c=saved();return {actorUserId:'actor',testRunId:'RUN',testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',stepNo:1,importedTestData:c.testData,registerFacts:readTgtRegisterFacts(c),
 systemTestContext:{companyId:'tenant',testSuite:'PRODAT',actorSettingId:null,actorEdielId:'12345',actorName:null,senderSubaddress:null,testPortalEdielId:'54321',testPortalName:null,testPortalEmail:null,defaultReceiverSubaddress:'PRODAT',testBrpEdielId:'11111',testBrpName:null,settings:null}}}
describe('actual authorized TGT draft and persisted row',()=>{
 it('carries distinct sparse addresses and source/run evidence for both objects',()=>{
  const d=buildEdielTgtDraft(draftParams());
  expect(d.validationIssues.filter(i=>i.code.includes('ADDRESS')||i.code.includes('UNDETERMINED'))).toEqual([])
  expect(parseProdatMessage(d.rawPayload).lineItems.map(l=>l.endUserAddressLines)).toEqual(['A','B'].map(id=>['.',`BOX ${id}`,"c/o :+?'"]))
  const m={company_id:'tenant',message_family:'PRODAT',message_code:'Z03',message_standard:'edifact',direction:'outbound',environment:'test',mime_type:'application/EDIFACT',raw_payload:d.rawPayload,parsed_payload:d.messageInput.parsedPayload} as EdielMessageRow
  expect(preflightEdielMessageRow(m).issues.filter(i=>i.code.includes('ADDRESS')||i.code.includes('EVIDENCE_INVALID'))).toEqual([])
  m.parsed_payload={...m.parsed_payload,testRunId:'OTHER'}
  expect(preflightEdielMessageRow(m).issues.some(i=>i.code.includes('EVIDENCE_INVALID'))).toBe(true)
 })
 for(const mutation of ['run','company','source','caller'])it(`rejects draft ${mutation} ownership drift`,()=>{
  const p=draftParams();if(mutation==='run')p.testRunId='OTHER';if(mutation==='company')p.systemTestContext.companyId='OTHER';
  if(mutation==='source')p.importedTestData.groups[0].fields.find(f=>f.fieldCode==='228')!.values.Z03D='Changed';
  if(mutation==='caller')p.registerFacts=facts();
  expect(()=>buildEdielTgtDraft(p)).toThrow()
 })
})

it('retains the existing 2000-character source-note contract in persisted address provenance',()=>{
 const c=ctx();c.run.notes=buildTgtRegisterFactNotes({...c,facts:facts(),actorId:'ACTOR',sourceNote:'S'.repeat(2000)})
 expect(readTgtRegisterFacts(c)?.endUserAddressObjects?.[0].source.reference).toHaveLength(2000)
})
