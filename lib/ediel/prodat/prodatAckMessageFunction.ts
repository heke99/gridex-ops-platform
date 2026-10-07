import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups,prodatRegisterMessageSegments,type ProdatRegisterGroup} from './prodatRegisterGroups'
import {isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import {prodatErrorOccurrence,validProdatWireDiagnostic} from './prodatFieldDiagnostic'
import {prodatHeaderFieldRejection} from './prodatHeaderDateRejection'
import {isProdatIdentityOmissionScope} from './prodatIdentityOmissionScope'
import {hasProdatRejectedIdentityDiagnostic} from './prodatRejectedIdentityScope'
import type {ProdatAckObjectScope} from '@/lib/ediel/ack/sourceCorrelation'
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

/** Selected positive objects are named by their actual first LIN token index,
 * never by parsed cache/array ordinal or a later register's reference. */
export function selectProdatAckFirstRegisterGroups(groups:readonly ProdatRegisterGroup[],indices?:readonly number[]):ProdatRegisterGroup[]{
 const first=groups.filter(group=>group.registerPosition===1)
 if(indices===undefined)return first
 if(!indices.length||indices.some(index=>!Number.isInteger(index)||index<0)||new Set(indices).size!==indices.length)throw new Error('aperak_prodat_selected_scope_invalid')
 const selected=first.filter(group=>indices.includes(group.segments[0].index))
 if(selected.length!==indices.length||selected.some(group=>!group.validRegisterChain))throw new Error('aperak_prodat_selected_scope_invalid')
 return selected
}

/** Physical first-register LI identities used by the same P34 renderer. A
 * diagnostic can select a subset only after its complete own tuple matches
 * this source. Rejected siblings cannot supply or suppress its own LI. */
export function prodatAckObjectScopes(params:{
 sourceWire:ReturnType<typeof tokenizeEdifact>;messageCode?:string|null
 outcome:AperakEngineOutcome;applicationErrors?:readonly AperakEngineApplicationError[]|null
 relatedTransactionReference?:string|null;prodatAcknowledgementLineIndices?:readonly number[]
}):ProdatAckObjectScope[]{
 const {sourceWire}=params
 const message=prodatRegisterMessageSegments(sourceWire.segments,sourceWire.una)
 const bgm=message.find(segment=>segment.tag==='BGM')
 const sourceCode=bgm?segmentComposite(bgm,1,sourceWire.una)[0]:''
 const owner=prodatRegisterGroups(message,sourceWire.una,params.messageCode)
 const first=owner.groups.filter(group=>group.registerPosition===1)
 const occurrences=first.map(group=>prodatErrorOccurrence({rawSegments:sourceWire.segments.map(token=>token.raw),una:sourceWire.una,code:params.messageCode},group.segments.map(token=>token.raw),'object',group.lineIndex))
 const all=occurrences.map(own=>own?.lineItemReference)
 const uniqueOwn=(ref:string|null|undefined)=>Boolean(ref&&all.filter(candidate=>candidate===ref).length===1)
 const scopeFor=(group:ProdatRegisterGroup):ProdatAckObjectScope=>({objectId:group.itemId,identityAgency:group.identityAgency,firstLineIndex:group.segments[0].index,lineItemReference:occurrences[first.indexOf(group)]?.lineItemReference??null})
 if(params.relatedTransactionReference){
  if(!uniqueOwn(params.relatedTransactionReference))throw new Error('aperak_prodat_requested_scope_unqualified')
  return [scopeFor(first[all.indexOf(params.relatedTransactionReference)])]
 }
 if(params.outcome==='negative'&&params.applicationErrors?.length){
  const scoped=params.applicationErrors.filter(error=>error.prodatOccurrence?.scope!=='header')
  if(!scoped.length)return []
  const references=scoped.map(error=>{
   // A complete mixed reply carries ERC 100 for each committed own sibling:
   // exactly its own first LIN by unique LI and object identity.
   if(error.ercCode==='100'&&!error.prodatOccurrence){
    const index=error.lineItemReference&&uniqueOwn(error.lineItemReference)?all.indexOf(error.lineItemReference):-1
    const own=index<0?undefined:first[index]
    if(!own||(own.itemId??null)!==(error.referenceNumber??null))throw new Error('aperak_prodat_requested_scope_unqualified')
    return scopeFor(own)
   }
   if(!isQualifiedProdatApplicationError(error))throw new Error('aperak_prodat_requested_scope_unqualified')
   const own=error.prodatOccurrence!
   const actual=prodatErrorOccurrence({rawSegments:sourceWire.segments.map(token=>token.raw),una:sourceWire.una,code:params.messageCode},[],own.scope,own.lineIndex??undefined)
   if(!actual||!(['scope','messageReference','lineIndex','lineNumber','registerPosition','objectId','identityAgency','lineItemReference'] as const).every(key=>own[key]===actual[key])
    )throw new Error('aperak_prodat_requested_scope_unqualified')
   const group=owner.groups.find(group=>group.lineIndex===actual.lineIndex)
   const firstGroup=group?.validRegisterChain&&group.firstLineIndex!==null?owner.groups.find(candidate=>candidate.lineIndex===group.firstLineIndex):group
   // Field209's sole matrix/subtype owner may permit an absent identity.
   // Such a negative scope is still its actual first LIN and unique own LI;
   // two absent identities never become one global null object or fake Z07.
   // Required invalid Z05 identities need their separate typed209 rejection.
   const qualifiedIdentity=firstGroup&&(firstGroup.itemId
    ?first.filter(candidate=>candidate.itemId===firstGroup.itemId&&candidate.identityAgency===firstGroup.identityAgency).length===1
    :(isProdatIdentityOmissionScope(sourceCode,firstGroup,sourceWire.una)
      || hasProdatRejectedIdentityDiagnostic({code: sourceCode, group: firstGroup,
        rawSegments: sourceWire.segments.map(token=>token.raw), una: sourceWire.una}, error.prodatFieldDiagnostic))&&uniqueOwn(actual.lineItemReference))
   if(!firstGroup||firstGroup.registerPosition!==1||!qualifiedIdentity
    ||(actual.lineItemReference?!uniqueOwn(actual.lineItemReference):actual.ownReferences?.lineItemReference.kind!=='absent'))throw new Error('aperak_prodat_requested_scope_unqualified')
   return scopeFor(firstGroup)
  })
  return references.filter((scope,index)=>references.findIndex(own=>own.firstLineIndex===scope.firstLineIndex)===index)
 }
 const selected=selectProdatAckFirstRegisterGroups(owner.groups,params.prodatAcknowledgementLineIndices)
 const references=selected.map(group=>all[first.indexOf(group)])
 if(!references.length||references.some(ref=>!uniqueOwn(ref)))throw new Error('aperak_prodat_own_line_reference_required')
 return selected.map(scopeFor)
}

/** Compatibility reference projection. Missing original LI remains an explicit
 * source object tuple in prodatAckObjectScopes; it is never an invented alias. */
export function prodatAckObjectReferences(params:Parameters<typeof prodatAckObjectScopes>[0]):string[]{
 return prodatAckObjectScopes(params).flatMap(scope=>scope.lineItemReference?[scope.lineItemReference]:[])
}
