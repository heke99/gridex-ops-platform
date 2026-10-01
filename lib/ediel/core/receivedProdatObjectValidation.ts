import type {CanonicalRuntimeDecision} from './runtimeDecision'
import {bindReceivedRegisterValidation} from './receivedRegisterValidationBinding'
import {validProdatWireDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {tokenizeEdifact,segmentComposite} from './edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'

export type ReceivedProdatObjectValidation = {
  version:1;owner:'canonical-full-prodat-object-validation-v1';coverage:'full_canonical_guide_objects_only';sharedAccepted:boolean;
  reasonCodes:string[];objects:Array<{objectId:string|null;identityAgency:string|null;messageReference:string|null;firstLineIndex:number;
    lineItemReference:string|null;disposition:'accepted'|'rejected'|'unavailable';reasons:string[];negativeFields:string[]}>;
}

/** Full canonical invocation only. The register facet alone never approves an
 * object: every blocking own/header/route/local finding remains represented. */
export function projectReceivedProdatObjectValidation(raw:string,decision:Pick<CanonicalRuntimeDecision,'syntaxDecision'|'issues'|'prodatRegisterValidation'|'responsePlan'>):ReceivedProdatObjectValidation|null {
  const register=bindReceivedRegisterValidation(decision.prodatRegisterValidation,raw)
  if(!register)return null
  const wire=tokenizeEdifact(raw),groups=prodatRegisterGroups(wire.segments,wire.una).groups
  const blocking=decision.issues.filter(issue=>issue.severity==='error'||issue.originalSeverity==='error')
  let sharedAccepted=decision.syntaxDecision==='accepted'
  const own=new Map<number,typeof blocking>()
  for(const issue of blocking){
    const diagnostic=issue.prodatDiagnostic
    if(!validProdatWireDiagnostic(diagnostic)||diagnostic.occurrence.scope==='header'){sharedAccepted=false;continue}
    const occurrence=diagnostic.occurrence,group=groups.find(g=>g.lineIndex===occurrence.lineIndex)
    if(!group||group.messageIndex!==0||group.itemId!==occurrence.objectId||group.identityAgency!==occurrence.identityAgency
      ||group.lineNumber!==occurrence.lineNumber||group.registerPosition!==occurrence.registerPosition){sharedAccepted=false;continue}
    const first=group.firstLineIndex
    if(first===null){sharedAccepted=false;continue}
    own.set(first,[...(own.get(first)??[]),issue])
  }
  const errors=decision.responsePlan.flatMap(plan=>plan.family==='APERAK'?plan.applicationErrors??[]:[]).filter(isQualifiedProdatApplicationError)
  return {version:1,owner:'canonical-full-prodat-object-validation-v1',coverage:'full_canonical_guide_objects_only',sharedAccepted,
    reasonCodes:[...new Set(decision.issues.map(issue=>issue.code))],objects:register.objects.map(object=>{
      const first=object.registers[0],group=groups.find(g=>g.lineIndex===first.lineIndex)!,findings=own.get(first.lineIndex)??[]
      const refs=group.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='LI')
      const lineItemReference=refs.length===1?segmentComposite(refs[0],1,wire.una)[1]||null:null
      const negatives=errors.filter(error=>error.prodatOccurrence?.objectId===object.objectId&&error.prodatOccurrence?.identityAgency===object.identityAgency
        &&object.registers.some(reg=>reg.lineIndex===error.prodatOccurrence?.lineIndex))
      const allOwned=findings.every(finding=>{const diagnostic=finding.prodatDiagnostic
        return validProdatWireDiagnostic(diagnostic)&&negatives.some(error=>error.prodatOccurrence?.lineIndex===diagnostic.occurrence.lineIndex
          &&error.fieldCode===(diagnostic.kind==='field'?diagnostic.fieldNumber:diagnostic.applicationCode)
          &&error.ercCode===(diagnostic.kind==='field'?(diagnostic.errorKind==='missing'?'41':'42'):'40'))})
      const disposition=!sharedAccepted||object.disposition==='unavailable'||!lineItemReference?'unavailable':findings.length&&allOwned?'rejected':
        findings.length||object.disposition!=='accepted'?'unavailable':'accepted'
      return {objectId:object.objectId,identityAgency:object.identityAgency,messageReference:object.messageReference,firstLineIndex:first.lineIndex,lineItemReference,
        disposition,reasons:disposition==='accepted'?[]:[...new Set([...object.reasons,...findings.map(issue=>issue.code),...(!sharedAccepted?['shared_source_not_qualified']:[])])],
        negativeFields:negatives.map(error=>error.fieldCode!).filter(Boolean)}
    })}
}

import {supabaseService} from '@/lib/supabase/service'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
type Rpc=(name:string,args:Record<string,unknown>)=>{abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>}
/** Bind the primary-owner result to the fresh canonical assessment. This port
 * stores guide evidence only; it cannot create any positive application result. */
export async function recordReceivedProdatObjectValidation(input:{companyId:string;environment:string;sourceMessageId:string;sourcePayloadHash:string;
  assessmentId:string;validation:ReceivedProdatObjectValidation}):Promise<boolean>{
 const facts=JSON.stringify(input.validation)
 try{
  const {data,error}=await (supabaseService.rpc.bind(supabaseService) as unknown as Rpc)('gridex_record_prodat_object_validation_v1',{
   p_company_id:input.companyId,p_environment:input.environment,p_source_message_id:input.sourceMessageId,p_source_payload_hash:input.sourcePayloadHash,
   p_assessment_id:input.assessmentId,p_facts_text:facts}).abortSignal(AbortSignal.timeout(2000))
  return !error&&isEvidenceRecord(data)&&data.assessmentId===input.assessmentId&&data.companyId===input.companyId&&data.environment===input.environment
   &&data.sourceMessageId===input.sourceMessageId&&data.sourcePayloadHash===input.sourcePayloadHash&&data.objectFactsHash===evidenceHash(facts)
 }catch{return false}
}
