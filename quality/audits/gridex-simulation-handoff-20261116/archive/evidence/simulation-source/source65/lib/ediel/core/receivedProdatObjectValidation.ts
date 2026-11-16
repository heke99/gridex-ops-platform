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
