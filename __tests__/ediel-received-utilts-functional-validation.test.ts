import {describe,expect,it} from 'vitest'
import {buildReceivedUtiltsFunctionalValidation,bindReceivedUtiltsFunctionalValidation} from '@/lib/ediel/core/receivedUtiltsFunctionalValidation'
import {buildReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

function mixed(){
 const source=energyHandoffMessage(),lines=source.raw_payload!.split('\n'),start=lines.findIndex(line=>line.startsWith('IDE+')),end=lines.findIndex(line=>line.startsWith('UNT+'))
 source.raw_payload=recountEdifactUnt([...lines.slice(0,end),...lines.slice(start,end).map(line=>line.replaceAll('GRIDEX2607E66001','SECOND').replace('QTY+136:500','QTY+136:500.0000')),...lines.slice(end)].join('\n'))
 return {source,runtime:runUtiltsRuntimeForMessage(source)}
}
describe('canonical actual own-IDE national functional response facet',()=>{
 it('projects genuine E51/TN for only its own rejected transaction, preserving the accepted sibling',()=>{
  const {source,runtime}=mixed(),facet=buildReceivedUtiltsFunctionalValidation({source,runtime})!
  expect(facet.transactions).toEqual([{transactionIndex:1,transactionId:'SECOND',errors:[{code:'E51',referenceQualifier:'TN',referenceNumber:'SECOND'}]}])
  expect(runtime.transactionDispositions[0].disposition).toBe('accepted')
 })
 it('does not infer a national code from internal diagnostic IDs, catalog membership or another own outcome',()=>{
  const {source,runtime}=mixed();runtime.ackPlan.utiltsErrDetails=[]
  expect(runtime.transactionDispositions[1].issueCodes).toContain('UTILTS_QUANTITY_PRECISION_INVALID')
  expect(buildReceivedUtiltsFunctionalValidation({source,runtime})).toBeNull()
  runtime.ackPlan.utiltsErrDetails=[{code:'E51',referenceQualifier:'TN',referenceNumber:'GRIDEX2607E66001',lineItemReference:'GRIDEX2607E66001'}]
  expect(buildReceivedUtiltsFunctionalValidation({source,runtime})).toBeNull()
 })
 it('binds original hash, complete own subset/order, physical id and exact original response reference',()=>{
  const {source,runtime}=mixed(),facet=buildReceivedUtiltsFunctionalValidation({source,runtime})!,own=buildReceivedUtiltsTransactionValidation({source,transactions:runtime.transactionDispositions})!
  expect(bindReceivedUtiltsFunctionalValidation(facet,source.raw_payload!+' ',own)).toBeNull()
  for(const mutate of [p=>p.transactions[0].transactionIndex=0,p=>p.transactions[0].transactionId='OTHER',p=>p.transactions[0].errors[0].referenceNumber='GRIDEX2607E66001',p=>p.transactions[0].errors.push(p.transactions[0].errors[0]),p=>p.transactions[0].errors=[]]){
    const altered=structuredClone(facet) as {transactions:Array<{transactionIndex:number;transactionId:string;errors:Array<{code:string;referenceNumber:string}>}>};mutate(altered)
    expect(bindReceivedUtiltsFunctionalValidation(altered,source.raw_payload!,own)).toBeNull()
  }
 })
 it('requires an actual explicit own source reference and emits no facet for accepted-only input',()=>{
  const source=energyHandoffMessage(),runtime=runUtiltsRuntimeForMessage(source)
  expect(buildReceivedUtiltsFunctionalValidation({source,runtime})).toBeNull()
  const m=mixed();m.runtime.ackPlan.utiltsErrDetails[0].lineItemReference='OTHER'
  expect(buildReceivedUtiltsFunctionalValidation(m)).toBeNull()
 })
})
