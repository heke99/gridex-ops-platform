import {isDeepStrictEqual} from 'node:util'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {observeAssignedProdatHeaderNegativeField} from '@/lib/inbound-mail/prodatAssignedHeaderRejectionIntake'
import {readProdatCommonHeaderRejectionEvidence,commonHeaderRejectionField,type ProdatCommonHeaderRejectionEvidence} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatFieldDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics,isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import {evaluateProdatTransactionReason} from './prodatTransactionReason'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'

declare const rejectionBrand:unique symbol
/** Source-bound national negative only; never a positive application/function,
 * code profile, legal mandate or business/source capability. */
export type ReceivedProdatHeaderRejection=Readonly<{[rejectionBrand]:true}>
const reads=new WeakMap<ReceivedProdatHeaderRejection,{identity:string;actor:string;readAt:number;
 evidence:ProdatCommonHeaderRejectionEvidence;errors:EdielAperakApplicationError[]}>()
const owners=new WeakMap<object,{identity:string;actor:string;decisionHash:string}>()
function identity(source:unknown):string|null{
 if(!isEvidenceRecord(source)||!isEvidenceUuid(source.id)||!isEvidenceUuid(source.company_id)||source.direction!=='inbound'
  ||source.message_standard!=='edifact'||source.message_family!=='PRODAT'||typeof source.raw_payload!=='string'
  ||!['test','production'].includes(String(source.environment))||parseSourceReceiptInstant(source.message_received_at)===null
  ||!isEvidenceRecord(source.execution_context_snapshot))return null
 const context=source.execution_context_snapshot.receivedProdatContext
 if(!isEvidenceRecord(context)||context.version!==1||context.contextOrigin!=='database_insert'||context.sourceMessageId!==source.id
  ||context.companyId!==source.company_id||context.environment!==source.environment||context.messageCode!==source.message_code
  ||context.payloadHash!==evidenceHash(source.raw_payload)||parseSourceReceiptInstant(context.sourceReceivedAt)!==parseSourceReceiptInstant(source.message_received_at)
  ||parseSourceReceiptInstant(context.capturedAt)===null)return null
 const columns=['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum']
 if(columns.some(key=>source[key]!==null)||!isEvidenceRecord(source.rule_pack_snapshot)||Object.keys(source.rule_pack_snapshot).length)return null
 return evidenceHash(JSON.stringify([source.id,source.company_id,source.environment,source.direction,source.message_standard,source.message_family,
  source.message_code,source.message_version,source.application_reference,source.raw_payload,parseSourceReceiptInstant(source.message_received_at)!.toString(),context]))
}
/** The same real physical typed diagnostics drive runtime and rendering. 223
 * remains its own SG14 object with genuine LIN/LI/Z07, rather than a header. */
export function observeReceivedProdatHeaderRejection(raw:string):EdielAperakApplicationError[]{
 const field=observeAssignedProdatHeaderNegativeField(raw)
 if(!field)return []
 const wire=tokenizeEdifact(raw),input={rawSegments:wire.segments.map(row=>row.raw),una:wire.una,code:field==='202'?'PRODAT_UNKNOWN':'Z04'}
 if(field==='223')return evaluateProdatTransactionReason(input).applicationErrors
 const sourceRule=`PRODAT26A:§2.2:ALL:${field}`
 const diagnostic=prodatFieldDiagnostic(field,'missing',input,input.rawSegments,sourceRule,undefined,'header')
 return projectProdatDiagnostics([{severity:'error',blocking:true,code:`PRODAT_HEADER_${field}_MISSING`,
  title:'Obligatoriskt PRODAT-huvudfält saknas',description:'Det egna fysiska originalets obligatoriska fält saknas.',prodatDiagnostic:diagnostic}]).applicationErrors
}
export function qualifiedReceivedProdatHeaderRejectionErrors(raw:string,errors:readonly EdielAperakApplicationError[]|null|undefined):boolean{
 const expected=observeReceivedProdatHeaderRejection(raw)
 return expected.length===1&&Boolean(errors?.length===1&&errors.every(isQualifiedProdatApplicationError)&&isDeepStrictEqual(errors,expected))
}
export async function loadReceivedProdatHeaderRejection(source:EdielMessageRow,actor:string):Promise<ReceivedProdatHeaderRejection|null>{
 const started=Date.now(),companyId=source.company_id
 let principal:{sourceId:string;environment:'test'|'production';raw:string;identity:string|null}|null=null
 try{principal={sourceId:source.id,environment:source.environment,raw:source.raw_payload!,identity:identity(source)}}catch{/* Denial remains owned by the authenticated READ. */}
 if(!companyId)return null
 await assertEdielTenantActor({companyId,actorUserId:actor,permissionAnyOf:principal?.environment==='test'?['communication.write','ediel_testing.write']:['communication.write']})
 if(!principal)return null
 const errors=observeReceivedProdatHeaderRejection(principal.raw)
 if(errors.length!==1)return null
 try{
  const result=await readProdatCommonHeaderRejectionEvidence({companyId,environment:principal.environment,sourceMessageId:principal.sourceId,
   expectedRawPayload:principal.raw,actorUserId:actor})
  const field=commonHeaderRejectionField(result.evidence),error=errors[0]
  if(!principal.identity||identity(result.sourceMessage)!==principal.identity||Date.now()<started||Date.now()-started>2000
   ||!field||field.fieldCode!==error.fieldCode||field.ercCode!==error.ercCode||field.text!==error.text)return null
  const token=Object.freeze({}) as ReceivedProdatHeaderRejection
  reads.set(token,{identity:principal.identity,actor,readAt:started,evidence:result.evidence,errors});return token
 }catch(error){if(error instanceof EdielExecutionFailure&&error.disposition.kind==='security_quarantine')throw error;return null}
}
export function readReceivedProdatHeaderRejectionErrors(token:ReceivedProdatHeaderRejection,source:EdielMessageRow,actor:string):EdielAperakApplicationError[]|null{
 const read=reads.get(token)
 return read&&read.actor===actor&&read.identity===identity(source)&&Date.now()>=read.readAt&&Date.now()-read.readAt<=2000?structuredClone(read.errors):null
}
export function ownReceivedProdatHeaderRejection(decision:CanonicalRuntimeDecision,source:EdielMessageRow,actor:string,token:ReceivedProdatHeaderRejection):boolean{
 const read=reads.get(token);reads.delete(token)
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK')
 if(!read||read.actor!==actor||read.identity!==identity(source)||Date.now()<read.readAt||Date.now()-read.readAt>2000
  ||decision.policy!==null||decision.syntaxDecision!=='accepted'||decision.applicationDecision!=='rejected'||decision.functionalDecision!=='not_applicable'
  ||plans.length!==1||plans[0].outcome!=='negative'||!isDeepStrictEqual(plans[0].applicationErrors,read.errors)
  ||!qualifiedReceivedProdatHeaderRejectionErrors(source.raw_payload!,read.errors))return false
 owners.set(decision,{identity:read.identity,actor,decisionHash:evidenceHash(JSON.stringify(decision))});return true
}
export function hasReceivedProdatHeaderRejection(decision:object,source:unknown,actor?:string):boolean{
 const owner=owners.get(decision)
 return Boolean(owner&&(actor===undefined||owner.actor===actor)&&owner.identity===identity(source)&&owner.decisionHash===evidenceHash(JSON.stringify(decision)))
}
