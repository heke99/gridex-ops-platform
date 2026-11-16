import {tokenizeEdifact} from './edifactTokenizer'
import {canonicalUtiltsTransactions} from '@/lib/ediel/utilts/canonicalObservationScope'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {UtiltsTransactionDisposition} from '@/lib/ediel/utiltsEngine.part-1'

export type ReceivedUtiltsTransactionValidation=Readonly<{version:1;sourcePayloadHash:string;transactions:readonly Readonly<{
  transactionIndex:number;transactionId:string|null;disposition:UtiltsTransactionDisposition['disposition'];responseType:UtiltsTransactionDisposition['responseType'];issueCodes:readonly string[]
}>[]}>
const pairs:Record<UtiltsTransactionDisposition['disposition'],UtiltsTransactionDisposition['responseType']>={accepted:'positive_aperak',syntax_rejected:'negative_contrl',guide_rejected:'negative_aperak',processability_rejected:'utilts_err',internal_review:'none'}

/** Called by the real runtime immediately after its own selected-policy pass.
 * This projection never re-runs rules or treats parsed/status JSON as authority. */
export function buildReceivedUtiltsTransactionValidation(input:{source:{raw_payload:string|null;message_family:string};transactions:readonly UtiltsTransactionDisposition[]}):ReceivedUtiltsTransactionValidation|null {
  if(input.source.message_family!=='UTILTS' || !input.source.raw_payload) return null
  let physical:ReturnType<typeof canonicalUtiltsTransactions>
  try {const wire=tokenizeEdifact(input.source.raw_payload);physical=canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='UNH')),wire.una,0)} catch {return null}
  if(physical.length!==input.transactions.length || physical.length>999) return null
  const transactions=input.transactions.map((decision,index)=>({transactionIndex:index,transactionId:physical[index].transactionId,disposition:decision.disposition,responseType:decision.responseType,issueCodes:[...decision.issueCodes]}))
  if(input.transactions.some((decision,index)=>decision.transactionId!==(physical[index].transactionId ?? `transaction-${index+1}`))) return null
  return bindReceivedUtiltsTransactionValidation({version:1,sourcePayloadHash:evidenceHash(input.source.raw_payload),transactions},input.source.raw_payload)
}

/** Bind exact complete own physical membership before append. It verifies a
 * projection's shape and source scope, not whether its claimed rule pass ran. */
export function bindReceivedUtiltsTransactionValidation(value:unknown,raw:string):ReceivedUtiltsTransactionValidation|null {
  if(!isEvidenceRecord(value) || Object.keys(value).length!==3 || value.version!==1 || value.sourcePayloadHash!==evidenceHash(raw) || !Array.isArray(value.transactions) || value.transactions.length>999) return null
  let physical:ReturnType<typeof canonicalUtiltsTransactions>
  try {const wire=tokenizeEdifact(raw);physical=canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='UNH')),wire.una,0)} catch {return null}
  if(physical.length!==value.transactions.length) return null
  for(const [index,item] of value.transactions.entries()) {
    if(!isEvidenceRecord(item) || Object.keys(item).length!==5 || item.transactionIndex!==index || item.transactionId!==physical[index].transactionId
      || !Object.hasOwn(pairs,String(item.disposition)) || item.responseType!==pairs[item.disposition as keyof typeof pairs]
      || !Array.isArray(item.issueCodes) || item.issueCodes.length>128 || item.issueCodes.some(code=>typeof code!=='string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(code))) return null
    if(item.disposition==='accepted' && (physical[index].identityQualifier!=='24' || !physical[index].transactionId || physical[index].transactionId!.length>35 || item.issueCodes.length!==0)) return null
  }
  return structuredClone(value) as ReceivedUtiltsTransactionValidation
}
