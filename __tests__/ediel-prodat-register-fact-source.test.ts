import { describe, expect, it } from 'vitest'
import { buildTgtRegisterFactNotes, readTgtRegisterFacts } from '@/lib/ediel/testing/tgtRegisterFacts'
import type { EdielTestRunRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
const run={id:'run-A',company_id:'tenant-A',test_suite:'PRODAT',role_code:'supplier',test_case_code:'1.2.5',notes:'Operator notes'} as EdielTestRunRow
const columns=['Z04D register 1','Z04D register 2'].map((name,index)=>({name,index,sourceOrder:index,testCase:'1.2.5'}))
const fields=[{fieldCode:'209',fieldName:'Object',values:{'Z04D register 1':'A','Z04D register 2':'A'}},{fieldCode:'213',fieldName:'Annual',values:{'Z04D register 1':'10','Z04D register 2':'20'}}]
const data={suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',title:'Synthetic',sourceNote:'Synthetic',groups:[{columns,fields,block:{kind:'PRODAT',sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'A',entityNumbers:['A'],columns,fields}}]} as EdielTgtCaseTestData
const facts:ProdatDependentConditionFacts={market:'electricity',registerObjects:[{meteringPointId:'A',identityAgency:'9',expectedRegisterCount:2,meterReadingsSentInUtilts:false}]}
const saved=()=>({...run,notes:buildTgtRegisterFactNotes({run,stepNo:4,code:'Z04',testData:data,facts,actorId:'operator-A',sourceNote:'Reviewed reporting agreement'})})
const read=(r:EdielTestRunRow=saved(),d=data,stepNo=4,code='Z04')=>readTgtRegisterFacts({run:r,stepNo,code,testData:d})
describe('operator register facts are bound to a tenant/run/step/source, never to field presence',()=>{
 it('missing metadata supplies no guessed facts',()=>expect(read(run)).toBeUndefined())
 it('retains independent false values and the original notes',()=>{
  const r=saved();expect(read(r)?.registerObjects).toEqual(facts.registerObjects)
  expect(JSON.parse(r.notes!).text).toBe('Operator notes')
 })
 it('does not borrow another step facts',()=>expect(read(saved(),data,5)).toBeUndefined())
 for(const [key,value] of [['company_id','tenant-B'],['id','run-B'],['role_code','esco'],['test_case_code','1.2.6']] as const)it(`blocks mismatched ${key}`,()=>expect(()=>read({...saved(),[key]:value})).toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID'))
 it('blocks another function on the same step',()=>expect(()=>read(saved(),data,4,'Z06')).toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID'))
 it('invalidates facts when source measurements change',()=>{
  const changed=structuredClone(data);changed.groups[0].fields[1].values['Z04D register 2']='21'
  expect(()=>read(saved(),changed)).toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')
 })
 it('does not invalidate on JSONB object key order alone',()=>{
  const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v
  expect(read(saved(),reorder(data) as EdielTgtCaseTestData)?.registerObjects).toEqual(facts.registerObjects)
 })
 for(const bad of [[],[facts.registerObjects![0],facts.registerObjects![0]],[{...facts.registerObjects![0],meteringPointId:'B'}],[{...facts.registerObjects![0],expectedRegisterCount:1}],[{...facts.registerObjects![0],meterReadingsSentInUtilts:'false'}]])it(`rejects malformed/ambiguous/nonmatching facts ${JSON.stringify(bad)}`,()=>{
  expect(()=>buildTgtRegisterFactNotes({run,stepNo:4,code:'Z04',testData:data,facts:{...facts,registerObjects:bad} as ProdatDependentConditionFacts,actorId:'operator-A',sourceNote:'Evidence'})).toThrow(/PRODAT_REGISTER|prodat_register/)
 })
 it('retains unknown readings rather than coercing them to false',()=>{
  const r={...run,notes:buildTgtRegisterFactNotes({run,stepNo:4,code:'Z04',testData:data,facts:{...facts,registerObjects:[{...facts.registerObjects![0],meterReadingsSentInUtilts:null}]},actorId:'operator-A',sourceNote:'Not yet confirmed'})}
  expect(read(r)?.registerObjects?.[0].meterReadingsSentInUtilts).toBeNull()
 })
 it('requires a source description and authenticated actor attribution',()=>{
  for(const changes of [{sourceNote:''},{actorId:''}])expect(()=>buildTgtRegisterFactNotes({run,stepNo:4,code:'Z04',testData:data,facts,actorId:'operator-A',sourceNote:'Evidence',...changes})).toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')
 })
 it('does not accept a scalar pretending to be a versioned envelope',()=>{
  expect(()=>read({...run,notes:JSON.stringify({prodatRegisterFacts:'trusted'})})).toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')
 })
})
