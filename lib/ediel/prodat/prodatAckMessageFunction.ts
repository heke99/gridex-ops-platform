import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups,prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import {prodatErrorOccurrence,validProdatWireDiagnostic} from './prodatFieldDiagnostic'
import {prodatHeaderFieldRejection} from './prodatHeaderDateRejection'
import type {AperakEngineApplicationError,AperakEngineOutcome} from '@/lib/ediel/aperakEngine'

/** The existing source-owned P27/P34 selector and qualification, shared by
 * fresh rendering and operational preparation. No guide/clock/registry choice.
 * Protected existing originals must be read before invoking this fresh check. */
export function resolveProdatAckMessageFunction(params:{
 sourceWire:ReturnType<typeof tokenizeEdifact>|null;hasProdatWire:boolean
 messageCode?:string|null;outcome:AperakEngineOutcome
 applicationErrors?:readonly AperakEngineApplicationError[]|null
}):'27'|'34'{
 const {sourceWire,hasProdatWire}=params
  // P26.A annex 4 p.119 (P-17) rejects the entire PRODAT when LIN/314 is
  // discontinuous. A negative response for a processed object's other field
  // remains BGM 34. Require both the original physical LIN defect and its
  // source-qualified error; a caller-supplied field number alone grants nothing.
  const sequenceOwner = sourceWire ? prodatRegisterGroups(
    prodatRegisterMessageSegments(sourceWire.segments, sourceWire.una), sourceWire.una, params.messageCode
  ) : null
  const sequenceProblems = sequenceOwner?.problems.filter(problem =>
    problem.fieldNumber === '314' && problem.reason === 'global_sequence_must_increment_from_one') ?? []
  const sourceUnh = sourceWire?.segments.find(token => token.tag === 'UNH')
  const messageReference = sourceUnh && sourceWire ? segmentComposite(sourceUnh, 1, sourceWire.una)[0] || null : null
  // P26.A §2.2 and §3.3: source-owned invalid 202/204 or missing/invalid 313/205/206 in the actual
  // header rejects the entire message. The inbound consumer uses this same
  // qualification before entering any case or business writer.
  const header202=hasProdatWire ? prodatHeaderFieldRejection({field:'202',sourceWire,errors:params.applicationErrors}) : null
  const header204=hasProdatWire ? prodatHeaderFieldRejection({field:'204',sourceWire,errors:params.applicationErrors}) : null
  const header313=hasProdatWire ? prodatHeaderFieldRejection({field:'313',sourceWire,errors:params.applicationErrors}) : null
  const header205=hasProdatWire ? prodatHeaderFieldRejection({field:'205',sourceWire,errors:params.applicationErrors}) : null
  const header206=hasProdatWire ? prodatHeaderFieldRejection({field:'206',sourceWire,errors:params.applicationErrors}) : null
  if (header202 && (header202.defect || header202.hasHeaderError) &&
    (params.outcome !== 'negative' || !header202.qualified)) {
    throw new Error('aperak_prodat_header_202_response_unqualified')
  }
  if (header204 && (header204.defect || header204.hasHeaderError) &&
    (params.outcome !== 'negative' || !header204.qualified)) {
    throw new Error('aperak_prodat_header_204_response_unqualified')
  }
  if (header313 && (header313.defect || header313.hasHeaderError) &&
    (params.outcome !== 'negative' || !header313.qualified)) {
    throw new Error('aperak_prodat_header_313_response_unqualified')
  }
  if (header205 && (header205.defect || header205.hasHeaderError) &&
    (params.outcome !== 'negative' || !header205.qualified)) {
    throw new Error('aperak_prodat_header_205_response_unqualified')
  }
  if (header206 && (header206.defect || header206.hasHeaderError) &&
    (params.outcome !== 'negative' || !header206.qualified)) {
    throw new Error('aperak_prodat_header_206_response_unqualified')
  }
  if (sequenceProblems.length && (params.outcome !== 'negative' || !sequenceProblems.every(problem =>
    params.applicationErrors?.some(error => {
      const group = sequenceOwner?.groups.find(row => row.lineIndex === problem.lineIndex)
      const occurrence = error.prodatOccurrence
      return Boolean(group && error.fieldCode === '314' &&
        validProdatWireDiagnostic(error.prodatFieldDiagnostic) && error.prodatFieldDiagnostic.kind === 'field' &&
        error.prodatFieldDiagnostic.fieldNumber === '314' && isQualifiedProdatApplicationError(error) &&
        occurrence?.scope === 'register' && occurrence.lineIndex === group.lineIndex &&
        occurrence.lineNumber === group.lineNumber && occurrence.registerPosition === group.registerPosition &&
        occurrence.objectId === group.itemId && occurrence.identityAgency === group.identityAgency &&
        occurrence.messageReference === messageReference)
    })
  ))) throw new Error('aperak_prodat_sequence_response_unqualified')
  return sequenceProblems.length || header202?.qualified || header204?.qualified || header313?.qualified || header205?.qualified || header206?.qualified ? '27' : '34'
}

/** Physical first-register LI identities used by the same P34 renderer. A
 * diagnostic can select a subset only after its complete own tuple matches
 * this source. No caller object/cache/reference creates an ACK scope. */
export function prodatAckObjectReferences(params:{
 sourceWire:ReturnType<typeof tokenizeEdifact>;messageCode?:string|null
 outcome:AperakEngineOutcome;applicationErrors?:readonly AperakEngineApplicationError[]|null
 relatedTransactionReference?:string|null
}):string[]{
 const {sourceWire}=params
 const message=prodatRegisterMessageSegments(sourceWire.segments,sourceWire.una)
 const owner=prodatRegisterGroups(message,sourceWire.una,params.messageCode)
 const occurrences=owner.groups.filter(group=>group.registerPosition===1).map(group=>
  prodatErrorOccurrence({rawSegments:sourceWire.segments.map(token=>token.raw),una:sourceWire.una,code:params.messageCode},group.segments.map(token=>token.raw),'object',group.lineIndex))
 const all=occurrences.map(own=>own?.lineItemReference)
 if(!all.length||all.some(ref=>!ref)||new Set(all).size!==all.length)throw new Error('aperak_prodat_own_line_reference_required')
 if(params.relatedTransactionReference){
  if(!all.includes(params.relatedTransactionReference))throw new Error('aperak_prodat_requested_scope_unqualified')
  return [params.relatedTransactionReference]
 }
 if(params.outcome==='negative'&&params.applicationErrors?.length){
  const scoped=params.applicationErrors.filter(error=>error.prodatOccurrence?.scope!=='header')
  if(!scoped.length)return []
  const references=scoped.map(error=>{
   if(!isQualifiedProdatApplicationError(error))throw new Error('aperak_prodat_requested_scope_unqualified')
   const own=error.prodatOccurrence!
   const actual=prodatErrorOccurrence({rawSegments:sourceWire.segments.map(token=>token.raw),una:sourceWire.una,code:params.messageCode},[],own.scope,own.lineIndex??undefined)
   if(!actual||!(['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference'] as const).every(key=>own[key]===actual[key])
    ||!actual.lineItemReference||!all.includes(actual.lineItemReference))throw new Error('aperak_prodat_requested_scope_unqualified')
   return actual.lineItemReference
  })
  return [...new Set(references)]
 }
 return all as string[]
}
