import {permissionAckFieldsFromPayload} from '@/lib/ediel/prodat/prodatPermissionAckFields'
import {selectedProdatAckFromPayload,assertSelectedProdatAckReady} from '@/lib/ediel/prodat/prodatIncomingSelectedAck'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielAperakValidationIssue} from './aperakErrorRuleRegistry'

/** Physical LIN and source finding form both immutable existing upsert keys. */
export function selectedProdatAckRegistryIssues(message:EdielMessageRow):EdielAperakValidationIssue[]{
 if(message.message_family!=='PRODAT'||message.direction!=='inbound')return []
 const assessment=selectedProdatAckFromPayload(message.raw_payload)
 try { assertSelectedProdatAckReady(assessment) } catch(error) {
  throw Object.assign(error instanceof Error ? error : new Error(String(error)), {permissionFieldAssessment:permissionAckFieldsFromPayload(message.raw_payload)})
 }
 return assessment.applicationErrors.map((error,index)=>{
  const diagnostic=error.prodatFieldDiagnostic!,line=error.prodatOccurrence!.lineIndex
  return {ruleKey:`selected_${error.fieldCode}_${error.ercCode}:LIN=${line}:finding=${index}`,
   severity:'error',fieldPath:`SG8[${line}]/${diagnostic.kind==='field'?diagnostic.segmentPath:''}`,
   fieldValue:diagnostic.kind==='field'?diagnostic.failureEvidence?.map(e=>e.content).join(' / ')??null:null,
   expectedValue:null,meteringPointId:error.referenceNumber??null,transactionReference:error.lineItemReference??null,
   sourceOrder:index,fallbackText:error.text??'',selectedApplicationError:error}
 })
}
