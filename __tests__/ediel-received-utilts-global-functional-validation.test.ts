import {describe,expect,it} from 'vitest'
import {buildReceivedUtiltsFunctionalValidation,bindReceivedUtiltsFunctionalValidation} from '@/lib/ediel/core/receivedUtiltsFunctionalValidation'
import {buildReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

type ForgedGlobalFacet={transactions:Array<{transactionIndex:number;errors:Array<{referenceNumber:string|null;referenceQualifier:string|null;responseReference:{number:string};ownerIssueCodes:string[];originalScope:string}>}>}

// Unit owner-port fixture only. Synthetic runtime mutation is not the opaque
// runtime capability required by final production consumers or legal evidence.
function fixture(){
 const source=energyHandoffMessage(),lines=source.raw_payload!.split('\n'),start=lines.findIndex(line=>line.startsWith('IDE+')),end=lines.findIndex(line=>line.startsWith('UNT+'))
 source.raw_payload=recountEdifactUnt([...lines.slice(0,end),...lines.slice(start,end).map(line=>line.replaceAll('GRIDEX2607E66001','SECOND').replace('QTY+136:500','QTY+136:500.0000')),...lines.slice(end)].join('\n'))
 const runtime=runUtiltsRuntimeForMessage(source)
 runtime.validation.issues.push({kind:'functional',severity:'error',code:'ACTUAL_GLOBAL_OWNER_FAULT',utiltsErrCode:'E55',title:'Owner port',description:'Explicit global unit fixture',referenceNumber:null,lineItemReference:null})
 runtime.transactionDispositions[1].issueCodes.push('ACTUAL_GLOBAL_OWNER_FAULT')
 runtime.ackPlan.utiltsErrDetails.push({code:'E55',referenceQualifier:'TN',referenceNumber:null,lineItemReference:null})
 return {source,runtime}
}
describe('additive global functional original scope and separate bound response TN',()=>{
 it('preserves real NULL provenance and applies only assigned own processability ERR outcomes',()=>{
  const f=fixture(),facet=buildReceivedUtiltsFunctionalValidation(f)!
  expect(facet.version).toBe(2);expect(facet.transactions).toHaveLength(1)
  expect(facet.transactions[0].transactionId).toBe('SECOND')
  expect(facet.transactions[0].errors[1]).toEqual({code:'E55',ownerIssueCodes:['ACTUAL_GLOBAL_OWNER_FAULT'],originalScope:'message',referenceQualifier:'TN',referenceNumber:null,responseReference:{qualifier:'TN',number:'SECOND'}})
  expect(f.runtime.transactionDispositions[0].disposition).toBe('accepted')
  expect(facet.transactions[0].errors[0]).toMatchObject({code:'E51',originalScope:'transaction',referenceNumber:'SECOND',responseReference:{qualifier:'TN',number:'SECOND'}})
 })
 it('holds a global detail without the actual matching assigned owner issue',()=>{
  const f=fixture();f.runtime.transactionDispositions[1].issueCodes=f.runtime.transactionDispositions[1].issueCodes.filter(code=>code!=='ACTUAL_GLOBAL_OWNER_FAULT')
  expect(buildReceivedUtiltsFunctionalValidation(f)).toBeNull()
  const missing=fixture();missing.runtime.validation.issues=missing.runtime.validation.issues.filter(issue=>issue.code!=='ACTUAL_GLOBAL_OWNER_FAULT')
  expect(buildReceivedUtiltsFunctionalValidation(missing)).toBeNull()
 })
 it('rejects fabricated original/TN scope, owner issue membership and accepted sibling assignments',()=>{
  const f=fixture(),facet=buildReceivedUtiltsFunctionalValidation(f)!,own=buildReceivedUtiltsTransactionValidation({source:f.source,transactions:f.runtime.transactionDispositions})!
  const mutations:Array<(p:ForgedGlobalFacet)=>unknown>=[p=>p.transactions[0].errors[1].referenceNumber='SECOND',p=>p.transactions[0].errors[1].responseReference.number='GRIDEX2607E66001',p=>p.transactions[0].errors[1].ownerIssueCodes=['FOREIGN_CODE'],p=>p.transactions[0].transactionIndex=0,p=>p.transactions[0].errors[1].originalScope='unknown',p=>p.transactions[0].errors[0].referenceQualifier='ACW']
  if(facet.version!==2)throw Error('expected_actual_global_functional_v2_facet')
  for(const mutate of mutations){
   // Copy the genuine owner projection; widen only the forged negative DTO.
   const projection:ForgedGlobalFacet={...facet,transactions:facet.transactions.map(transaction=>({...transaction,errors:transaction.errors.map(error=>({...error,responseReference:{...error.responseReference},ownerIssueCodes:[...error.ownerIssueCodes]}))}))};mutate(projection)
   expect(bindReceivedUtiltsFunctionalValidation(projection,f.source.raw_payload!,own)).toBeNull()
  }
 })
})
