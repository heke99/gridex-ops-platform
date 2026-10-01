import {isDeepStrictEqual} from 'node:util'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {validProdatWireDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import type {ProdatRegisterValidationEvidence} from './prodatRegisterValidationEvidence'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ProdatApplicationObjectValidation = {
  version: 1
  owner: 'canonical-prodat-application-all-v1'
  coverage: 'canonical_own_application_only'
  headerDecision: 'accepted'|'rejected'|'held'
  objects: Array<Omit<ProdatRegisterValidationEvidence['objects'][number], 'disposition'|'reasons'> & {
    applicationDecision: 'accepted'|'rejected'|'held'
    reasonCodes: string[]
  }>
}
export type ReceivedProdatApplicationObjectValidation = ProdatApplicationObjectValidation & {sourcePayloadHash:string}

/** Called at the END of the actual complete field invocation, after every
 * selected field/register/conditional owner has run. This is application
 * guidance only. No legal, business or successful write is inferred here. */
export function projectProdatApplicationObjects(input: {
  register: ProdatRegisterValidationEvidence
  issues: readonly EdielRulebookIssue[]
  completeInvocation: boolean
}): ProdatApplicationObjectValidation {
  const objects = input.register.objects.map(({disposition,reasons,...object})=>({...object,
    applicationDecision: disposition==='accepted'?'accepted' as const:disposition==='rejected'?'rejected' as const:'held' as const,
    reasonCodes:[...reasons]}))
  let headerDecision:ProdatApplicationObjectValidation['headerDecision']=input.completeInvocation?'accepted':'held'
  const globalReasons:string[]=[]
  if(!input.completeInvocation)globalReasons.push('PRODAT_APPLICATION_INVOCATION_INCOMPLETE')
  for(const finding of input.issues.filter(item=>item.blocking||item.severity==='error')){
    const diagnostic=finding.prodatDiagnostic
    // An unscoped local/unknown condition cannot be assigned to an arbitrary
    // object. It holds the complete invocation without a national error guess.
    if(!validProdatWireDiagnostic(diagnostic)
      ||projectProdatDiagnostics([finding]).disposition.kind==='internal_review'){
      headerDecision='held';globalReasons.push(finding.code);continue
    }
    const occurrence=diagnostic.occurrence
    if(occurrence.scope==='header'){
      if(headerDecision!=='held')headerDecision='rejected'
      globalReasons.push(finding.code);continue
    }
    const own=objects.filter(object=>object.messageReference===occurrence.messageReference
      &&object.objectId===occurrence.objectId&&object.identityAgency===occurrence.identityAgency
      &&object.registers.some(register=>register.lineIndex===occurrence.lineIndex
        &&register.lineNumber===occurrence.lineNumber&&register.registerPosition===occurrence.registerPosition))
    if(own.length!==1){headerDecision='held';globalReasons.push(finding.code);continue}
    own[0].applicationDecision='rejected';own[0].reasonCodes.push(finding.code)
  }
  if(headerDecision!=='accepted')for(const object of objects){
    object.applicationDecision=headerDecision==='rejected'?'rejected':'held'
    object.reasonCodes.push(...globalReasons)
  }
  return {version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',headerDecision,
    objects:objects.map(object=>({...object,reasonCodes:[...new Set(object.reasonCodes)]}))}
}

/** Exact source/serialization parity only; this does not mint an owner. */
export function bindReceivedProdatApplicationObjects(value:unknown,raw:string):ReceivedProdatApplicationObjectValidation|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const facet=value as ReceivedProdatApplicationObjectValidation
  if(Object.keys(facet).length!==6||facet.version!==1||facet.owner!=='canonical-prodat-application-all-v1'
    ||facet.coverage!=='canonical_own_application_only'||facet.sourcePayloadHash!==evidenceHash(raw)
    ||!['accepted','rejected','held'].includes(facet.headerDecision)||!Array.isArray(facet.objects))return null
  try{
  const register={version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:facet.objects.map(object=>{
    if(!object||typeof object!=='object'||Object.keys(object).length!==7||!['accepted','rejected','held'].includes(object.applicationDecision))throw Error('prodat_application_object_shape')
    const {applicationDecision,reasonCodes,...scope}=object
    return {...scope,disposition:applicationDecision==='held'?'unavailable':applicationDecision,reasons:reasonCodes}
  })}
    if(!bindReceivedRegisterValidation(register,raw)
      ||facet.headerDecision!=='accepted'&&facet.objects.some(object=>object.applicationDecision==='accepted'))return null
    return structuredClone(facet)
  }catch{return null}
}

/** Select the exact already evaluated physical object, without choosing a
 * current profile or treating the register-only facet as application approval. */
export function qualifyReceivedProdatApplicationObject(facet:ReceivedProdatApplicationObjectValidation|undefined,object:Omit<ProdatRegisterValidationEvidence['objects'][number],'disposition'|'reasons'>):boolean{
  if(facet?.headerDecision!=='accepted')return false
  return facet.objects.some(candidate=>{
    const scope={messageIndex:candidate.messageIndex,messageReference:candidate.messageReference,objectId:candidate.objectId,identityAgency:candidate.identityAgency,registers:candidate.registers}
    return candidate.applicationDecision==='accepted'&&isDeepStrictEqual(scope,object)
  })
}
