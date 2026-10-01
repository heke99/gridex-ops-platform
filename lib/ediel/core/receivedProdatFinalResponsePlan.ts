import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {bindReceivedProdatResponseValidation} from './receivedProdatResponseValidation'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ReceivedProdatFinalResponsePlan=Readonly<{
 outcome:'positive';objectLineIndices:readonly number[];acknowledgedReferences:readonly string[];
 canonicalAssessmentId:string;objectAssessmentId:string;effectAppliedAt:string;effectKind:'structural'|'customer_version';
}>
const owners=new WeakMap<ReceivedProdatFinalResponsePlan,{companyId:string;environment:string;sourceMessageId:string;sourceHash:string}>()

/** Existing immutable primary effects qualify final positive scopes. A national
 * ACK or application facet alone never authorizes this protected read. */
export async function readReceivedProdatFinalResponsePlan(input:{companyId:string;sourceMessageId:string;rawPayload:string;objectLineIndices?:readonly number[]}):Promise<{sourceMessage:EdielMessageRow;plans:readonly ReceivedProdatFinalResponsePlan[];totalObjectCount:number}|null>{
 if(!isEvidenceUuid(input.companyId)||!isEvidenceUuid(input.sourceMessageId)||!input.rawPayload)return null
 const {data,error}=await supabaseService.rpc('ediel_read_prodat_structural_final_response_v1',{
  p_company_id:input.companyId,p_source_message_id:input.sourceMessageId,p_object_line_indices:input.objectLineIndices??null,
 }).abortSignal(AbortSignal.timeout(3000))
 if(error)throw error
 if(!isEvidenceRecord(data)||data.version!==1||!isEvidenceRecord(data.sourceMessage)||!isEvidenceRecord(data.responseFacet))return null
 const source=data.sourceMessage as unknown as EdielMessageRow
 if(source.id!==input.sourceMessageId||source.company_id!==input.companyId||source.raw_payload!==input.rawPayload
  ||source.direction!=='inbound'||source.message_standard!=='edifact'||source.message_family!=='PRODAT'
  ||!['Z06','Z10'].includes(source.message_code)||!['test','production'].includes(source.environment))return null
 const {assessmentId,effectScopes,...candidate}=data.responseFacet
 if(!isEvidenceUuid(assessmentId)||!Array.isArray(effectScopes)||!effectScopes.length)return null
 const facet=bindReceivedProdatResponseValidation(candidate,input.rawPayload)
 if(!facet)return null
 const plans:ReceivedProdatFinalResponsePlan[]=[]
 for(const effect of effectScopes){
  if(!isEvidenceRecord(effect)||!Number.isSafeInteger(effect.lineIndex)||!isEvidenceUuid(effect.canonicalAssessmentId)||!isEvidenceUuid(effect.objectAssessmentId)
   ||typeof effect.appliedAt!=='string'||!Number.isFinite(Date.parse(effect.appliedAt))||effect.effectKind!==undefined&&effect.effectKind!=='structural'&&effect.effectKind!=='customer_version'||plans.some(plan=>plan.objectLineIndices[0]===effect.lineIndex))return null
  const own=facet.objects.find(object=>object.lineIndex===effect.lineIndex),responses=facet.responses.filter(response=>response.lineIndex===effect.lineIndex)
  if(!own||own.outcome!=='positive'||!own.li||responses.length!==1||responses[0].scope!=='object'||responses[0].ercCode!=='100'
   ||responses[0].id!==own.id||responses[0].li!==own.li||responses[0].fieldCode!==null)return null
  const plan:ReceivedProdatFinalResponsePlan=Object.freeze({outcome:'positive',objectLineIndices:Object.freeze([own.lineIndex]),acknowledgedReferences:Object.freeze([own.li]),
   canonicalAssessmentId:effect.canonicalAssessmentId,objectAssessmentId:effect.objectAssessmentId,effectAppliedAt:effect.appliedAt,effectKind:effect.effectKind==='customer_version'?'customer_version':'structural'})
  owners.set(plan,{companyId:input.companyId,environment:source.environment,sourceMessageId:source.id,sourceHash:evidenceHash(input.rawPayload)})
  plans.push(plan)
 }
 if(input.objectLineIndices&&!isDeepStrictEqual([...input.objectLineIndices].sort((a,b)=>a-b),plans.map(plan=>plan.objectLineIndices[0]).sort((a,b)=>a-b)))return null
 return {sourceMessage:structuredClone(source),plans:Object.freeze(plans),totalObjectCount:facet.objects.length}
}

/** Only the actual protected-read capability can scope the live renderer. */
export function receivedProdatFinalResponseQualification(input:{plan:ReceivedProdatFinalResponsePlan;sourceMessage:EdielMessageRow}):readonly number[]|null{
 const owner=owners.get(input.plan),source=input.sourceMessage
 return owner&&source.company_id===owner.companyId&&source.environment===owner.environment&&source.id===owner.sourceMessageId
  &&source.direction==='inbound'&&source.message_family==='PRODAT'&&source.raw_payload&&evidenceHash(source.raw_payload)===owner.sourceHash
  ?input.plan.objectLineIndices:null
}
