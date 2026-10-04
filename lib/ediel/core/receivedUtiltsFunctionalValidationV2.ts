import {canonicalUtiltsTransactions} from '@/lib/ediel/utilts/canonicalObservationScope'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {tokenizeEdifact} from './edifactTokenizer'
import {buildReceivedUtiltsTransactionValidation,bindReceivedUtiltsTransactionValidation,type ReceivedUtiltsTransactionValidation} from './receivedUtiltsTransactionValidation'
import type {UtiltsRuntimeResult} from '@/lib/ediel/utiltsEngine.part-1'

export type ReceivedUtiltsFunctionalValidationV2=Readonly<{version:2;sourcePayloadHash:string;transactions:readonly Readonly<{
 transactionIndex:number;transactionId:string;errors:readonly Readonly<{code:string;ownerIssueCodes:readonly string[];originalScope:'message'|'transaction';referenceQualifier:string|null;referenceNumber:string|null;responseReference:Readonly<{qualifier:'TN';number:string}>}>[]
}>[]}>

/** A global national detail retains its real NULL source reference. Binding a
 * required wire TN is a separate projection of an already assigned own runtime
 * disposition, never an invented original diagnostic reference or code map. */
export function buildReceivedUtiltsFunctionalValidationV2(input:{source:{raw_payload:string|null;message_family:string};runtime:UtiltsRuntimeResult}):ReceivedUtiltsFunctionalValidationV2|null {
 if(input.source.message_family!=='UTILTS' || !input.source.raw_payload)return null
 const own=buildReceivedUtiltsTransactionValidation({source:input.source,transactions:input.runtime.transactionDispositions})
 if(!own)return null
 const transactions=own.transactions.filter(transaction=>transaction.disposition==='processability_rejected'&&transaction.responseType==='utilts_err')
  .map(transaction=>({transactionIndex:transaction.transactionIndex,transactionId:transaction.transactionId!,errors:[] as Array<ReceivedUtiltsFunctionalValidationV2['transactions'][number]['errors'][number]>}))
 if(!transactions.length)return null
 for(const detail of input.runtime.ackPlan.utiltsErrDetails) {
  const messageScope=detail.referenceNumber==null&&detail.lineItemReference==null
  if(!messageScope && (!detail.referenceNumber || detail.lineItemReference!==detail.referenceNumber || !detail.referenceQualifier))return null
  const ownerIssues=input.runtime.validation.issues.filter(issue=>issue.severity==='error'&&issue.kind==='functional'&&issue.utiltsErrCode===detail.code
   && (messageScope ? issue.referenceNumber==null&&issue.lineItemReference==null : (issue.referenceNumber??issue.lineItemReference)===detail.referenceNumber))
  const ownerCodes=ownerIssues.map(issue=>issue.code)
  const targets=transactions.filter(transaction=>messageScope
   ? own.transactions[transaction.transactionIndex].issueCodes.some(code=>ownerCodes.includes(code)) : transaction.transactionId===detail.referenceNumber)
  if(!targets.length || (!messageScope&&targets.length!==1))return null
  for(const transaction of targets) {
   const ownerIssueCodes=[...new Set(own.transactions[transaction.transactionIndex].issueCodes.filter(code=>ownerCodes.includes(code)))]
   if(!ownerIssueCodes.length)return null
   transaction.errors.push({code:detail.code,ownerIssueCodes,originalScope:messageScope?'message':'transaction',referenceQualifier:detail.referenceQualifier??null,referenceNumber:detail.referenceNumber??null,responseReference:{qualifier:'TN',number:transaction.transactionId}})
  }
 }
 return bindReceivedUtiltsFunctionalValidationV2({version:2,sourcePayloadHash:own.sourcePayloadHash,transactions},input.source.raw_payload,own)
}
export function bindReceivedUtiltsFunctionalValidationV2(value:unknown,raw:string,own:ReceivedUtiltsTransactionValidation):ReceivedUtiltsFunctionalValidationV2|null {
 if(!bindReceivedUtiltsTransactionValidation(own,raw)||!isEvidenceRecord(value)||Object.keys(value).length!==3||value.version!==2||value.sourcePayloadHash!==evidenceHash(raw)
  ||!Array.isArray(value.transactions)||!value.transactions.length||value.transactions.length>999)return null
 const eligible=own.transactions.filter(transaction=>transaction.disposition==='processability_rejected'&&transaction.responseType==='utilts_err')
 if(eligible.length!==value.transactions.length)return null
 let physical:ReturnType<typeof canonicalUtiltsTransactions>
 try{const wire=tokenizeEdifact(raw);physical=canonicalUtiltsTransactions(wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='UNH')),wire.una,0)}catch{return null}
 for(const [index,item]of value.transactions.entries()) {
  const selected=eligible[index],observed=physical[selected.transactionIndex]
  if(!isEvidenceRecord(item)||Object.keys(item).length!==3||item.transactionIndex!==selected.transactionIndex||item.transactionId!==selected.transactionId||!observed||observed.identityQualifier!=='24'
   ||typeof item.transactionId!=='string'||!item.transactionId||item.transactionId.length>35||!Array.isArray(item.errors)||!item.errors.length||item.errors.length>128)return null
  const intents=new Set<string>()
  for(const error of item.errors) {
   if(!isEvidenceRecord(error)||Object.keys(error).length!==6||typeof error.code!=='string'||!/^E[A-Z0-9]{1,7}$/.test(error.code)
    ||!Array.isArray(error.ownerIssueCodes)||!error.ownerIssueCodes.length||error.ownerIssueCodes.length>128||new Set(error.ownerIssueCodes).size!==error.ownerIssueCodes.length
    ||error.ownerIssueCodes.some(code=>typeof code!=='string'||!selected.issueCodes.includes(code))
    ||!['message','transaction'].includes(String(error.originalScope))||!(error.referenceQualifier===null||(typeof error.referenceQualifier==='string'&&/^[A-Z0-9]{1,3}$/.test(error.referenceQualifier)))
    ||!isEvidenceRecord(error.responseReference)||Object.keys(error.responseReference).length!==2||error.responseReference.qualifier!=='TN'||error.responseReference.number!==item.transactionId
    ||(error.originalScope==='message' ? error.referenceNumber!==null : error.referenceQualifier!=='TN'||error.referenceNumber!==item.transactionId))return null
   const key=JSON.stringify([error.code,error.originalScope,error.referenceQualifier,error.referenceNumber])
   if(intents.has(key))return null
   intents.add(key)
  }
 }
 return structuredClone(value) as ReceivedUtiltsFunctionalValidationV2
}
