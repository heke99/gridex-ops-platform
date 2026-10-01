import {describe,expect,it} from 'vitest'
import {buildReceivedUtiltsTransactionValidation,bindReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

describe('canonical own UTILTS transaction facet',()=>{
  it('binds actual runtime order/hash and refuses copied source or altered scope/outcome',()=>{
    const source=energyHandoffMessage(),runtime=runUtiltsRuntimeForMessage(source)
    const facet=buildReceivedUtiltsTransactionValidation({source,transactions:runtime.transactionDispositions})!
    expect(facet.transactions[0]).toMatchObject({transactionIndex:0,transactionId:'GRIDEX2607E66001',disposition:'accepted',responseType:'positive_aperak',issueCodes:[]})
    expect(bindReceivedUtiltsTransactionValidation(facet,source.raw_payload!+' ')).toBeNull()
    for(const change of [{transactionId:'OTHER'},{transactionIndex:1},{responseType:'negative_aperak'},{issueCodes:['FORGED_ERROR']}]) {
      const altered=structuredClone(facet) as {transactions:Array<Record<string,unknown>>}
      Object.assign(altered.transactions[0],change)
      expect(bindReceivedUtiltsTransactionValidation(altered,source.raw_payload!)).toBeNull()
    }
  })
  it('preserves one negative functional own scope and an accepted sibling without whole positivity',()=>{
    const source=energyHandoffMessage(),lines=source.raw_payload!.split('\n'),start=lines.findIndex(line=>line.startsWith('IDE+')),end=lines.findIndex(line=>line.startsWith('UNT+'))
    source.raw_payload=recountEdifactUnt([...lines.slice(0,end),...lines.slice(start,end).map(line=>line.replaceAll('GRIDEX2607E66001','SECOND').replace('QTY+136:500',"QTY+136:500'\nQTY+136:500")),...lines.slice(end)].join('\n'))
    const runtime=runUtiltsRuntimeForMessage(source),facet=buildReceivedUtiltsTransactionValidation({source,transactions:runtime.transactionDispositions})!
    expect(runtime.validation.classification).toBe('functional_rejected')
    expect(facet.transactions.map(item=>[item.transactionId,item.disposition])).toEqual([['GRIDEX2607E66001','accepted'],['SECOND','processability_rejected']])
  })
  it('does not omit a physical negative sibling or invent accepted membership',()=>{
    const source=energyHandoffMessage(),runtime=runUtiltsRuntimeForMessage(source)
    expect(buildReceivedUtiltsTransactionValidation({source,transactions:[]})).toBeNull()
    const wrong=structuredClone(runtime.transactionDispositions);wrong[0].transactionId='SECOND'
    expect(buildReceivedUtiltsTransactionValidation({source,transactions:wrong})).toBeNull()
  })
})
