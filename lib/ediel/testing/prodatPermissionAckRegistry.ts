import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterMessageSegments,prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {permissionAckFieldsFromPayload,assertPermissionAckFieldsReady} from '@/lib/ediel/prodat/prodatPermissionAckFields'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielAperakValidationIssue} from './aperakErrorRuleRegistry'

/** Stable physical identity is part of both existing upsert keys, since neither
 * key contains source_order and details do not contain field_path. */
export function permissionAckRegistryIssues(message:EdielMessageRow):EdielAperakValidationIssue[]{
 if(message.message_family!=='PRODAT'||message.direction!=='inbound')return []
 const assessment=permissionAckFieldsFromPayload(message.raw_payload)
 assertPermissionAckFieldsReady(assessment)
 return assessment.applicationErrors.map((error,index)=>{
  const diagnostic=error.prodatFieldDiagnostic!
  const line=error.prodatOccurrence!.lineIndex
  return {ruleKey:`permission_${error.fieldCode==='322'?'status':'end_reason'}_${error.ercCode==='41'?'missing':'invalid'}:LIN=${line}`,
   severity:'error',fieldPath:`SG8[${line}]/${diagnostic.kind==='field'?diagnostic.segmentPath:''}`,
   fieldValue:diagnostic.kind==='field'?diagnostic.failureEvidence?.map(e=>e.content).join(' / ')??null:null,
   expectedValue:null,meteringPointId:error.referenceNumber??null,transactionReference:error.lineItemReference??null,
   sourceOrder:index,fallbackText:error.text??'',permissionApplicationError:error}
 })
}
export function isLegacyPermissionFieldIssue(issue:EdielAperakValidationIssue):boolean{
 return ['permission_status_missing','permission_status_invalid','permission_end_reason_missing','permission_end_reason_invalid'].includes(issue.ruleKey)
}

/** Approved registry-only P47/114 boundary. Equal permission business refs do
 * not establish a register chain. Shared grouping and national258 stay intact. */
export function permissionRegistryRegisterFailures(message:EdielMessageRow,issues:readonly EdielRulebookIssue[]):EdielRulebookIssue[]{
 if(message.message_family!=='PRODAT'||message.direction!=='inbound')return [...issues]
 const wire=tokenizeEdifact(message.raw_payload??''),tokens=prodatRegisterMessageSegments(wire.segments,wire.una)
 const bgms=tokens.filter(t=>t.tag==='BGM'),firstLin=tokens.findIndex(t=>t.tag==='LIN')
 if(bgms.length!==1||firstLin<0||tokens.indexOf(bgms[0])>firstLin)return [...issues]
 const code=segmentComposite(bgms[0],1,wire.una)[0]
 if(!['Z14','Z15','Z18'].includes(code))return [...issues]
 const {groups,problems}=prodatRegisterGroups(tokens,wire.una,code)
 if(groups.some(g=>prodatRegisterFieldState('258',g.segments,wire.una)?.present))return [...issues]
 const derivative=new Set(problems.filter(p=>p.fieldNumber==='258'&&p.reason==='per_object_register_sequence_invalid').filter(p=>{
  const own=groups[p.lineIndex]
  return own?.itemId&&groups.some(g=>g.lineIndex!==own.lineIndex&&g.itemId===own.itemId&&g.identityAgency===own.identityAgency)
 }).map(p=>p.lineIndex))
 return issues.filter(issue=>{
  const d=issue.prodatDiagnostic
  return !(issue.code==='PRODAT_REGISTER_STRUCTURE_INVALID'&&d?.kind==='field'&&d.fieldNumber==='258'&&d.errorKind==='missing'&&d.occurrence.lineIndex!==null&&derivative.has(d.occurrence.lineIndex))
 })
}
