import {tokenizeEdifact} from './edifactTokenizer'
import {canonicalUtiltsTransactions} from '@/lib/ediel/utilts/canonicalObservationScope'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {buildReceivedUtiltsTransactionValidation,bindReceivedUtiltsTransactionValidation,type ReceivedUtiltsTransactionValidation} from './receivedUtiltsTransactionValidation'
import {buildReceivedUtiltsFunctionalValidationV2,bindReceivedUtiltsFunctionalValidationV2,type ReceivedUtiltsFunctionalValidationV2} from './receivedUtiltsFunctionalValidationV2'
import type {UtiltsRuntimeResult} from '@/lib/ediel/utiltsEngine.part-1'

export type ReceivedUtiltsFunctionalValidationV1=Readonly<{version:1;sourcePayloadHash:string;transactions:readonly Readonly<{
  transactionIndex:number;transactionId:string;errors:readonly Readonly<{code:string;referenceQualifier:string;referenceNumber:string}>[]
}>[]}>
export type ReceivedUtiltsFunctionalValidation=ReceivedUtiltsFunctionalValidationV1|ReceivedUtiltsFunctionalValidationV2

/** Only the actual runtime's existing national response projection supplies
 * code/ref. Internal diagnostic IDs, a catalog or parsed JSON never infer it. */
export function buildReceivedUtiltsFunctionalValidation(input:{source:{raw_payload:string|null;message_family:string};runtime:UtiltsRuntimeResult}):ReceivedUtiltsFunctionalValidation|null {
  if(input.source.message_family!=='UTILTS' || !input.source.raw_payload) return null
  const own=buildReceivedUtiltsTransactionValidation({source:input.source,transactions:input.runtime.transactionDispositions})
  if(!own) return null
  const eligible=own.transactions.filter(transaction=>transaction.disposition==='processability_rejected'&&transaction.responseType==='utilts_err')
  if(!eligible.length) return null
  if(input.runtime.ackPlan.utiltsErrDetails.some(detail=>detail.referenceNumber==null&&detail.lineItemReference==null))return buildReceivedUtiltsFunctionalValidationV2(input)
  const transactions=eligible.map(transaction=>({transactionIndex:transaction.transactionIndex,transactionId:transaction.transactionId,errors:[] as Array<{code:string;referenceQualifier:string;referenceNumber:string}>}))
  for(const detail of input.runtime.ackPlan.utiltsErrDetails) {
    if(!detail.referenceNumber || detail.lineItemReference!==detail.referenceNumber || !detail.referenceQualifier) return null
    const matches=transactions.filter(transaction=>transaction.transactionId===detail.referenceNumber)
    if(matches.length!==1) return null
    matches[0].errors.push({code:detail.code,referenceQualifier:detail.referenceQualifier,referenceNumber:detail.referenceNumber})
  }
  return bindReceivedUtiltsFunctionalValidation({version:1,sourcePayloadHash:own.sourcePayloadHash,transactions},input.source.raw_payload,own)
}

/** Original bytes and complete canonical own-IDE facet bind the exact national
 * response subset. No rule pass or allowed national code table is recreated. */
export function bindReceivedUtiltsFunctionalValidation(value:unknown,raw:string,own:ReceivedUtiltsTransactionValidation):ReceivedUtiltsFunctionalValidation|null {
  if(isEvidenceRecord(value)&&value.version===2)return bindReceivedUtiltsFunctionalValidationV2(value,raw,own)
  if(!bindReceivedUtiltsTransactionValidation(own,raw) || !isEvidenceRecord(value) || Object.keys(value).length!==3 || value.version!==1 || value.sourcePayloadHash!==evidenceHash(raw)
    || !Array.isArray(value.transactions) || !value.transactions.length || value.transactions.length>999) return null
  const eligible=own.transactions.filter(transaction=>transaction.disposition==='processability_rejected'&&transaction.responseType==='utilts_err')
  if(eligible.length!==value.transactions.length) return null
  let physical:ReturnType<typeof canonicalUtiltsTransactions>
  try {const wire=tokenizeEdifact(raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH');physical=canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0)} catch {return null}
  for(const [index,item] of value.transactions.entries()) {
    const selected=eligible[index],observed=physical[selected.transactionIndex]
    if(!isEvidenceRecord(item) || Object.keys(item).length!==3 || item.transactionIndex!==selected.transactionIndex || item.transactionId!==selected.transactionId
      || !observed || observed.identityQualifier!=='24' || typeof item.transactionId!=='string' || !item.transactionId || item.transactionId.length>35
      || !Array.isArray(item.errors) || !item.errors.length || item.errors.length>128) return null
    const codes=new Set<string>()
    for(const error of item.errors) {
      if(!isEvidenceRecord(error) || Object.keys(error).length!==3 || typeof error.code!=='string' || !/^E[A-Z0-9]{1,7}$/.test(error.code)
        || typeof error.referenceQualifier!=='string' || !/^[A-Z0-9]{1,3}$/.test(error.referenceQualifier) || error.referenceNumber!==item.transactionId || codes.has(error.code)) return null
      codes.add(error.code)
    }
  }
  return structuredClone(value) as ReceivedUtiltsFunctionalValidationV1
}
