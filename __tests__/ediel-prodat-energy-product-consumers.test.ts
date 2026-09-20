import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {beforeEach,it,expect,vi} from 'vitest'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {validateProdatPermissionMessage,type ProdatPermissionContext} from '@/lib/ediel/testing/prodatPermissionEngine'
import {assertIncomingProdatEnergyProductReview} from '@/lib/ediel/prodat/prodatEnergyProduct'
import {permissionMessage,z18Message} from './fixtures/prodat-energy-product'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({db:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(name:string)=>{state.db.push(name);throw Error('EXTERNAL_DB')}}}))
import {deriveProdatAperakValidationIssues,resolveAndStoreProdatAperakErrors} from '@/lib/ediel/testing/aperakErrorRuleRegistry'
// Execute the actual exported resolver body with only its external dependencies
// replaced. Permission validation and the incoming506 owner are real modules.
const path='app/admin/ediel/actions.part-3.ts',file=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true)
const declaration=file.statements.find((s):s is ts.FunctionDeclaration=>ts.isFunctionDeclaration(s)&&s.name?.text==='resolveBackendAperakDecision')!
const js=ts.transpileModule(declaration.getText(file).replace('export ',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const events:Record<string,unknown>[]=[],effects:string[]=[]
let context:ProdatPermissionContext={hasMatchingPriorPermissionFlow:true,matchReason:'synthetic matching context'}
const deps={assertIncomingProdatEnergyProductReview,validateProdatPermissionMessage,resolveAndStoreProdatAperakErrors,
 resolveTgtTestDataForAckAction:async()=>{effects.push('tgt');return {testData:null,selectedRow:null}},
 resolveProdatPermissionContextForAck:async()=>{effects.push('context');return context},
 createEdielMessageEvent:async(event:Record<string,unknown>)=>{events.push(event)},
}
const resolver=new Function(...Object.keys(deps),`${js};return resolveBackendAperakDecision`)(...Object.values(deps)) as (params:{actorUserId:string;sourceMessage:EdielMessageRow;roleCode:string})=>Promise<{outcome:string;applicationErrors:{ercCode:string;fieldCode:string}[]|null}>
const run=(message:EdielMessageRow)=>resolver({actorUserId:'synthetic-actor',sourceMessage:message,roleCode:'supplier'})
beforeEach(()=>{state.db=[];events.length=0;effects.length=0;context={hasMatchingPriorPermissionFlow:true,matchReason:'synthetic matching context'}})
for(const code of ['Z13','Z14'])for(const energy of [null,'INVALID']){
 it(`actual manual ${code}/${energy} stops before TGT, permission success/event or draft progression`,async()=>{
  let progressed=false
  await expect(run(permissionMessage(code,'S17',energy)).then(()=>{progressed=true})).rejects.toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
  expect(progressed).toBe(false);expect(events).toEqual([]);expect(effects).toEqual([]);expect(state.db).toEqual([])
 })
 it(`independent registry ${code}/${energy} stops before validation/detail writes`,async()=>{
  const message=permissionMessage(code,'S17',energy)
  expect(()=>deriveProdatAperakValidationIssues({message})).toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
  await expect(resolveAndStoreProdatAperakErrors({message,testData:null})).rejects.toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED');expect(state.db).toEqual([])
 })
 it(`direct ${code}/${energy} emits own typed506 before positive/deferred selection`,()=>{
  const d=decideProdatAperak({message:permissionMessage(code,'S17',energy)})
  expect(d.outcome).toBe('negative');expect(d.applicationErrors.filter(e=>e.fieldCode==='506')).toMatchObject([{ercCode:energy===null?'41':'42',lineItemReference:'CASE:A+B?C',referenceNumber:code==='Z13'?null:'735123456789012345',prodatFieldDiagnostic:{fieldNumber:'506',component:{cavComponent:4}}}])
 })
}
for(const code of ['Z13','Z14'])it(`valid506 ${code} preserves actual permission positive and success event`,async()=>{
 expect((await run(permissionMessage(code))).outcome).toBe('positive');expect(events.map(e=>e.eventStatus)).toEqual(['success']);expect(effects).toEqual(['tgt','context'])
})
it('valid506 preserves independent unmatched-context40/105 and warning event',async()=>{
 context={hasMatchingPriorPermissionFlow:false,matchReason:'synthetic unmatched context'};const d=await run(permissionMessage())
 expect(d.outcome).toBe('negative');expect(d.applicationErrors).toMatchObject([{ercCode:'40',fieldCode:'105'}]);expect(events.map(e=>e.eventStatus)).toEqual(['warning'])
})
it('valid506 preserves independent invalid-status error and warning event',async()=>{
 const message=permissionMessage();message.raw_payload=message.raw_payload!.replace('CAV+A74','CAV+INVALID')
 const d=await run(message);expect(d.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'322'}]);expect(events.map(e=>e.eventStatus)).toEqual(['warning'])
})
it('false Z14N extra adds no hold and retains the existing A76 status negative',async()=>{
 const d=await run(permissionMessage('Z14','Z96','INVALID'))
 expect(d.applicationErrors).toMatchObject([{ercCode:'41',fieldCode:'322'}]);expect(events.map(e=>e.eventStatus)).toEqual(['warning'])
})
it('valid handled Z18 false extra and unknown Z14 reason add no hold',async()=>{
 const z18=z18Message('INVALID')
 expect((await run(z18)).outcome).toBe('positive')
 expect((await run(permissionMessage('Z14','UNKNOWN','INVALID'))).outcome).toBe('positive');expect(events.map(e=>e.eventStatus)).toEqual(['success','success'])
})
it('registry valid/false/unknown pass through existing independent outcomes',async()=>{
 for(const message of [permissionMessage(),permissionMessage('Z13'),permissionMessage('Z14','Z96','INVALID'),permissionMessage('Z14','UNKNOWN','INVALID')]){
  expect(()=>deriveProdatAperakValidationIssues({message})).not.toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
  try{await resolveAndStoreProdatAperakErrors({message})}catch(e){expect(String(e)).not.toContain('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')}
 }
})

it('positive TGT data cannot bypass the independently callable registry guard',async()=>{
 const testData={suite:'PRODAT' as const,roleCode:'supplier' as const,testCaseCode:'1.2.1',title:'Synthetic source',sourceNote:'No portal claim',groups:[]}
 for(const code of ['Z13','Z14'])for(const energy of [null,'INVALID'])await expect(resolveAndStoreProdatAperakErrors({message:permissionMessage(code,'S17',energy),testData})).rejects.toThrow('PRODAT_ENERGY_PRODUCT_ACK_REVIEW_REQUIRED')
 expect(state.db).toEqual([])
})
