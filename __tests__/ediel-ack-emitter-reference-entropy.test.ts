import {describe,expect,it} from 'vitest'
import {buildAperakDraft,buildUtiltsErrDraft} from '@/lib/ediel/ack'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {utiltsErrGatewayFixture} from './helpers/utiltsErrGatewayFixture'
import {edielDraftWire} from './helpers/edielDraftWire'
// Genuine renderer inputs are declared physical fixtures only; they establish
// no historical source receipt, actor mandate or SEND/production capability.
const ownPattern=/^[A-Z0-9]{1,3}[A-F0-9]{32}$/
describe('fresh ACK emitters preserve full independently allocated own identity',()=>{
 it.each(['APERAK','UTILTS_ERR'] as const)('retains own document entropy with a long source sequence in %s',family=>{
  const originalTransaction='T'.repeat(35)
  const source=utiltsErrGatewayFixture({company:'00000000-0000-4000-8000-000000000001',transactions:[{reference:originalTransaction,outcome:'guide_rejected'}]})
  const documents=new Set<string>(),transactions=new Set<string>()
  for(let attempt=0;attempt<3;attempt++){
   const draft=family==='APERAK'?buildAperakDraft({sourceMessage:source,outcome:'negative',applicationErrors:[{ercCode:'41',fieldCode:'512',text:'MANDATORY FIELD MISSING',referenceNumber:originalTransaction}],relatedTransactionReference:originalTransaction}):buildUtiltsErrDraft({sourceMessage:source,messageText:'E51',relatedTransactionReference:originalTransaction})
   const wire=tokenizeEdifact(edielDraftWire(draft)),bgm=wire.segments.find(s=>s.tag==='BGM')!
   expect(draft.externalReference).toMatch(ownPattern);expect(draft.transactionReference).toMatch(ownPattern)
   expect(draft.externalReference).not.toBe(draft.transactionReference)
   expect(segmentComposite(bgm,2)[0]).toBe(draft.externalReference)
   documents.add(draft.externalReference!);transactions.add(draft.transactionReference!)
   const tn=wire.segments.filter(s=>s.tag==='RFF'&&segmentComposite(s,1)[0]===(family==='APERAK'?'ACW':'TN'))
   expect(tn.map(s=>segmentComposite(s,1)[1])).toEqual([originalTransaction])
   if(family==='UTILTS_ERR'){
    const ide=wire.segments.filter(s=>s.tag==='IDE')
    expect(ide).toHaveLength(1);expect(segmentComposite(ide[0],2)[0]).toMatch(ownPattern)
    expect(segmentComposite(ide[0],2)[0]).not.toBe(originalTransaction)
   }
  }
  expect(documents.size).toBe(3);expect(transactions.size).toBe(3)
 })
})
