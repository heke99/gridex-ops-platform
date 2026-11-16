import {isDeepStrictEqual} from 'node:util'
import {isQualifiedDeathStatusContext,type DeathStatusValidationContext} from './prodatDeathStatusAuthority'
import type {ProdatDeathObjectCondition} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import type {ProdatRegisterValidationEvidence} from './prodatRegisterValidationEvidence'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {evidenceHash,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ReceivedProdatSourceFunctionValidation={version:1;owner:'canonical-prodat-source-function-v1';coverage:'customer_life_event_only';sourcePayloadHash:string;sourceContextReceiptId:string;sourceContextFactsHash:string;
 objects:Array<Omit<ProdatRegisterValidationEvidence['objects'][number],'disposition'|'reasons'>&{functionalDecision:'accepted'|'held'|'not_applicable';reasonCodes:string[]}>}

/** Projection of the SAME existing independent 310/source evaluation. Its
 * immutable context is not application approval, an ACK or a business effect. */
export function projectProdatSourceFunctionObjects(input:{register:ProdatRegisterValidationEvidence;conditions:readonly ProdatDeathObjectCondition[];context?:DeathStatusValidationContext}):ReceivedProdatSourceFunctionValidation|null{
 const context=input.context
 if(!isQualifiedDeathStatusContext(context)||context.direction!=='inbound'||context.code!=='Z06')return null
 const receipt=context as DeathStatusValidationContext&{sourceContextReceiptId?:string;sourceContextFactsHash?:string}
 if(!isEvidenceUuid(receipt.sourceContextReceiptId)||!receipt.sourceContextFactsHash||!/^([a-f0-9]{64})$/.test(receipt.sourceContextFactsHash)||context.sourceDigest!==evidenceHash(context.rawPayload))return null
 const objects=input.register.objects.map(({disposition,reasons,...object})=>{
  void disposition;void reasons
  const conditions=input.conditions.filter(own=>own.messageReference===object.messageReference&&own.objectId===object.objectId&&own.identityAgency===object.identityAgency&&own.firstLineIndex===object.registers[0]?.segmentIndex)
  const state=conditions.length===1?conditions[0].sourceDecision:'held'
  return {...object,functionalDecision:state,reasonCodes:state==='accepted'?[]:[state==='not_applicable'?'source_function_not_applicable':'customer_life_event_source_scope_unqualified']}
 })
 return {version:1,owner:'canonical-prodat-source-function-v1',coverage:'customer_life_event_only',sourcePayloadHash:evidenceHash(context.rawPayload),sourceContextReceiptId:receipt.sourceContextReceiptId,sourceContextFactsHash:receipt.sourceContextFactsHash,objects}
}

/** Physical shape parity only. The native writer also requires the exact
 * genuine protected source-context receipt; this does not mint that authority. */
export function bindReceivedProdatSourceFunction(value:unknown,raw:string):ReceivedProdatSourceFunctionValidation|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const facet=value as ReceivedProdatSourceFunctionValidation
 if(Object.keys(facet).length!==7||facet.version!==1||facet.owner!=='canonical-prodat-source-function-v1'||facet.coverage!=='customer_life_event_only'||facet.sourcePayloadHash!==evidenceHash(raw)
  ||!isEvidenceUuid(facet.sourceContextReceiptId)||!/^([a-f0-9]{64})$/.test(facet.sourceContextFactsHash)||!Array.isArray(facet.objects))return null
 try{
  const register={version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:facet.objects.map(object=>{
   if(!object||Object.keys(object).length!==7||!['accepted','held','not_applicable'].includes(object.functionalDecision))throw Error('source_function_shape')
   const {functionalDecision,reasonCodes,...scope}=object
   return {...scope,disposition:functionalDecision==='accepted'?'accepted':'unavailable',reasons:reasonCodes}
  })}
  if(!bindReceivedRegisterValidation(register,raw))return null
  return structuredClone(facet)
 }catch{return null}
}
export function ownProdatSourceFunctionAccepted(facet:ReceivedProdatSourceFunctionValidation,scope:Omit<ProdatRegisterValidationEvidence['objects'][number],'disposition'|'reasons'>):boolean{
 return facet.objects.some(({functionalDecision,reasonCodes,...object})=>functionalDecision==='accepted'&&reasonCodes.length===0&&isDeepStrictEqual(object,scope))
}
