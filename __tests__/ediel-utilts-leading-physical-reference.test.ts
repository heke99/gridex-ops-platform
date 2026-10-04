import {describe,expect,it} from 'vitest'
import {physicalUtiltsReference,isValidUtiltsTransactionReference} from '@/lib/ediel/utilts/physicalReference'
import {validateUtiltsMessage,renderCanonicalUtiltsBody,type UtiltsMessage,type UtiltsTransaction} from '@/lib/ediel/utilts/canonicalMessageEngine'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {preflightEdielPayload} from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

describe('national UTILTS physical an..35 reference semantics',()=>{
 it('separates lossless observation from source shape admission',()=>{
  for(const reference of [' OWN A','OWN+A:B?C','X'.repeat(35)]) {
   expect(physicalUtiltsReference(reference)).toBe(reference)
   expect(isValidUtiltsTransactionReference(reference)).toBe(true)
  }
  for(const reference of ['OWN ',' ','X'.repeat(36),'OWN\tA','OWN\u0100']) {
   expect(physicalUtiltsReference(reference)).toBe(reference)
   expect(isValidUtiltsTransactionReference(reference)).toBe(false)
  }
  expect(physicalUtiltsReference(null)).toBeNull()
 })
 it('does not merge two physically distinct leading-ID transactions in canonical semantics or rendering',()=>{
  const transaction={transactionId:' OWN A+B',meteringPointId:null,gridAreaId:null,timeSeriesProduct:'',deliveryPeriod:{start:'',end:''},resolution:'',registrationTimestamp:null,latestUpdateTimestamp:null,reasonForTransaction:'',unit:'',direction:null,settlementMethod:null,meterNumber:null,registers:[],observations:[],references:{}} satisfies UtiltsTransaction
  const message={code:'S07',phase:'settlement',transactions:[transaction,{...transaction,transactionId:'OWN A+B'}]} satisfies UtiltsMessage
  // These incomplete observations do not claim market/guide acceptance. This
  // assertion isolates exact identity deduplication from unrelated requirements.
  const validation=validateUtiltsMessage({message,businessDate:'2026-10-01',version:'E5SE5A',senderRole:'dso',receiverRole:'electricity_supplier',applicationReference:'23-DDQ-S07-T'})
  expect(validation.issues.map(issue=>issue.code)).not.toContain('UTILTS_TRANSACTION_ID_DUPLICATE')
  const body=renderCanonicalUtiltsBody({message,documentReference:'DOC',generatedAt:'2026-10-01T00:00:00Z'})
  const wire=tokenizeEdifact(body.join("'")+"'")
  expect(wire.segments.filter(s=>s.tag==='IDE').map(s=>segmentComposite(s,2,wire.una)[0])).toEqual([' OWN A+B','OWN A+B'])
 })
 it('applies source an spaces only at own UTILTS IDE positions while retaining UNB restrictions and trailing holds',()=>{
  const source=energyHandoffMessage(),reference=' OWN A+B:C?D'
  const raw=source.raw_payload!.replace('IDE+24+GRIDEX2607E66001',`IDE+24+${escapeEdifactValue(reference)}`)
  const run=(wire:string)=>preflightEdielPayload({rawPayload:wire,messageStandard:'edifact',mode:'parse'}).issues
  expect(run(raw).filter(issue=>['IDENTIFIER_INVALID_CHARACTERS','UTILTS_PHYSICAL_TRANSACTION_REFERENCE_INVALID'].includes(issue.code))).toEqual([])
  expect(run(raw.replace(escapeEdifactValue(reference),`${escapeEdifactValue(reference)} `)).map(issue=>issue.code)).toContain('UTILTS_PHYSICAL_TRANSACTION_REFERENCE_INVALID')
  expect(run(raw.replace('UNB+UNOC:3+','UNB+UNOC:3+ BAD ')).map(issue=>issue.code)).toContain('IDENTIFIER_INVALID_CHARACTERS')
 })
})
