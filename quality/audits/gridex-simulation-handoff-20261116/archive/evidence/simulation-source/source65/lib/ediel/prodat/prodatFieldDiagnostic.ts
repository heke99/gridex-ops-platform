import {prodatRegisterTokens} from './prodatRegisterFields'
import {prodatOwnedFailure} from './prodatOwnedFailure'
import type {ProdatFailureEvidence} from './prodatFailureEvidence'
import {PRODAT_26A_FIELD_MATRIX} from './prodat26AFieldMatrix'
import {prodatRegisterGroups, prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {segmentComposite, type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna, type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'

/** A known absent own reference must never be replaced by a cached/first object. */
export type ProdatOwnReference = {kind:'present';value:string}|{kind:'absent'|'unavailable'}
export type ProdatErrorOccurrence = {
  ownReferences?: {objectId:ProdatOwnReference;lineItemReference:ProdatOwnReference;customerId:ProdatOwnReference}
  scope: 'header' | 'object' | 'register'
  messageReference: string | null
  lineIndex: number | null
  lineNumber: string | null
  registerPosition: number | null
  objectId: string | null
  identityAgency: string | null
  lineItemReference: string | null
}
export type ProdatDiagnostic =
  | {kind: 'field'; fieldNumber: string; errorKind: 'missing' | 'invalid'; failureEvidence?:ProdatFailureEvidence; sourceRule: string; segmentPath: string; group: string; component: Record<string, string | number>; occurrence: ProdatErrorOccurrence}
  | {kind: 'application'; ercCode: '40'; applicationCode: '109'; sourceRule: string; occurrence: ProdatErrorOccurrence}
  | {kind: 'local_unknown' | 'local_evidence' | 'internal'; sourceRule: string; reason: string}
export type ProdatProcessingDisposition = {kind: 'continue' | 'internal_review'; reasons: {code: string; sourceRule: string; reason: string}[]}
export type DiagnosticInput = {rawSegments?: readonly string[] | null; una?: EdifactServiceStringAdvice; code?: string | null}

export function prodatLocalDiagnostic(kind: 'local_unknown' | 'local_evidence' | 'internal', sourceRule: string, reason: string): ProdatDiagnostic {
  return {kind, sourceRule, reason}
}

/** Caller selects the source field and the exact validated scope; no text/code parsing. */
export function prodatFieldDiagnostic(fieldNumber: string | null | undefined, errorKind: 'missing' | 'invalid', input: DiagnosticInput, scopedSegments: readonly string[], sourceRule: string, lineIndex?: number, occurrenceScope?:ProdatErrorOccurrence['scope'], failureEvidence?:ProdatFailureEvidence): ProdatDiagnostic {
  const field = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === fieldNumber)
  if (!field || ['END_USER_GROUP','INSTALLATION_GROUP','INVOICEE_GROUP'].includes(field.fieldNumber)) {
    return prodatLocalDiagnostic('internal', sourceRule, 'Source finding has no numeric field descriptor')
  }
  const occurrence = prodatErrorOccurrence(input, scopedSegments, occurrenceScope ?? (field.registerScope === 'header' ? 'header' : field.registerScope === 'local' ? 'register' : 'object'), lineIndex)
  if (!occurrence) return prodatLocalDiagnostic('internal', sourceRule, 'Source finding has no unambiguous own occurrence')
  const una=input.una??parseUna(null),message=prodatRegisterMessageSegments(input.rawSegments??[],una)
  const groups=prodatRegisterGroups(message,una,input.code).groups
  const own=groups.find(g=>g.lineIndex===occurrence.lineIndex)
  const firstLine=message.findIndex(t=>t.tag==='LIN')
  const all=prodatRegisterTokens(input.rawSegments??[],una),unh=all.findIndex(t=>t.tag==='UNH')
  const before=unh>=0?all.slice(0,unh):[]
  const scope=own?.segments??(occurrence.scope==='header'?[...before,...message.slice(0,firstLine<0?undefined:firstLine)]:[])
  return {kind:'field', fieldNumber:field.fieldNumber, errorKind, sourceRule, ...sourceFieldMetadata(field), occurrence,
    ...(errorKind==='invalid'?{failureEvidence:failureEvidence??prodatOwnedFailure(field,scope,una)}:{})}
}

function sourceFieldMetadata(field: typeof PRODAT_26A_FIELD_MATRIX[number]) {
  const component: Record<string,string|number> = {locator:field.segmentPath}
  if (field.referenceScope) component.valueElement = 'C506/1154'
  if (field.dateQualifier) { component.valueElement = 'C507/2380'; component.formatElement = 'C507/2379' }
  if (field.cavComponent !== undefined) component.composite = 'C889'
  if (field.fieldNumber === '213') component.valueElement = 'C186/6060'
  for (const key of ['linElement','linComponent','cavComponent','documentElement','dateQualifier','partyQualifier','partyElement','partyComponents','referenceScope'] as const) {
    const value = field[key]; if (value !== undefined) component[key] = value
  }
  // P45–46: header parties SG4, sender reference SG6. P54: quantity SG12.
  const group = field.referenceScope === 'sender' ? 'SG6' : field.registerScope === 'header' ? (field.partyQualifier ? 'SG4' : 'header')
    : field.cavComponent !== undefined ? 'SG8/SG14' : field.referenceScope === 'line' ? 'SG8/SG16'
    : field.partyQualifier ? 'SG8/SG17' : field.fieldNumber === '213' ? 'SG8/SG12' : 'SG8'
  return {segmentPath:field.segmentPath,group,component}
}

export function prodatErrorOccurrence(input: DiagnosticInput, scopedSegments: readonly string[], scope: ProdatErrorOccurrence['scope'], lineIndex?: number): ProdatErrorOccurrence | null {
  const una = input.una ?? parseUna(null), message = prodatRegisterMessageSegments(input.rawSegments ?? [], una)
  const unh = message.find(token => token.tag === 'UNH')
  const unavailable:ProdatOwnReference={kind:'unavailable'}
  const base = {ownReferences:{objectId:unavailable,lineItemReference:unavailable,customerId:unavailable},scope, messageReference:unh ? segmentComposite(unh,1,una)[0] ?? null : null, lineIndex:null, lineNumber:null, registerPosition:null, objectId:null, identityAgency:null, lineItemReference:null}
  if (scope === 'header') return base
  const {groups} = prodatRegisterGroups(message,una,input.code)
  if (!groups.length && !scopedSegments.length) return base
  const selected = lineIndex !== undefined ? groups.filter(g => g.lineIndex === lineIndex)
    : groups.filter(g => scopedSegments.includes(g.segments[0]?.raw))
  if (selected.length !== 1) return null
  const group = selected[0]
  // Common references belong to this object's first register, never another object.
  const first = group.validRegisterChain && group.firstLineIndex !== null ? groups.find(g => g.lineIndex === group.firstLineIndex)! : group
  const party = first.segments.findIndex(token => token.tag === 'NAD')
  const refs = first.segments.slice(0,party < 0 ? undefined : party).filter(token => token.tag === 'RFF' && segmentComposite(token,1,una)[0] === 'LI')
  const parts = refs.length === 1 ? segmentComposite(refs[0],1,una) : []
  const customers=first.segments.filter(t=>t.tag==='NAD'&&segmentComposite(t,1,una)[0]==='UD')
  const customerParts=customers.length===1?segmentComposite(customers[0],2,una):[]
  const state=(value:string|null):ProdatOwnReference=>value?{kind:'present',value}:{kind:'absent'}
  const ownReferences={objectId:state(first.itemId),lineItemReference:refs.length>1?unavailable:state(parts[1]||null),customerId:customers.length>1?unavailable:state(customerParts[0]||null)}
  return {...base,ownReferences,lineIndex:group.lineIndex,lineNumber:group.lineNumber,registerPosition:group.registerPosition,objectId:group.itemId,identityAgency:group.identityAgency,lineItemReference:parts[1] || null}
}

/** A supplied misplaced field retains its actual token location, including header. */
export function prodatTokenFieldDiagnostic(field: string | undefined, input: DiagnosticInput, token: EdifactTokenizedSegment, sourceRule: string, failureEvidence?:ProdatFailureEvidence): ProdatDiagnostic {
  const {groups} = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments??[],input.una),input.una,input.code)
  const own = groups.find(g=>g.segments.some(t=>t.index===token.index && t.raw===token.raw))
  return prodatFieldDiagnostic(field,'invalid',input,own?.segments.map(t=>t.raw)??[],sourceRule,own?.lineIndex,own?undefined:'header', failureEvidence??(()=>{
    const descriptor=PRODAT_26A_FIELD_MATRIX.find(f=>f.fieldNumber===field)
    const message=prodatRegisterMessageSegments(input.rawSegments??[],input.una),next=message.findIndex(t=>t.index===token.index&&t.raw===token.raw)
    return descriptor?prodatOwnedFailure(descriptor,token.tag==='CCI'?message.slice(next,next+2):[token],input.una??parseUna(null)):undefined
  })())
}

export function validProdatErrorOccurrence(value: ProdatErrorOccurrence | undefined): value is ProdatErrorOccurrence {
  if (!value || !['header','object','register'].includes(value.scope)) return false
  const nullableText = (v: unknown) => v === null || typeof v === 'string' && v.length > 0
  const ownReferences = [value.lineNumber,value.objectId,value.identityAgency,value.lineItemReference]
  if (![value.messageReference,...ownReferences].every(nullableText)) return false
  // Header and explicitly absent object have no physical occurrence or own refs.
  if (value.scope === 'header' || value.lineIndex === null) {
    return value.lineIndex === null && value.registerPosition === null && ownReferences.every(v => v === null)
  }
  return Number.isInteger(value.lineIndex) && value.lineIndex! >= 0
    && Number.isInteger(value.registerPosition) && value.registerPosition! >= 1
    && value.registerPosition! <= value.lineIndex! + 1
}

/** Qualify complete owned metadata, not arbitrary digits or a merely typed object. */
export function validProdatWireDiagnostic(value: ProdatDiagnostic | undefined): value is Extract<ProdatDiagnostic,{kind:'field'|'application'}> {
  if (!value || !['field','application'].includes(value.kind) || typeof value.sourceRule !== 'string' || !value.sourceRule.trim()) return false
  if (value.kind === 'application') return value.ercCode === '40' && value.applicationCode === '109' && validProdatErrorOccurrence(value.occurrence)
  if (value.kind !== 'field' || !['missing','invalid'].includes(value.errorKind) || !validProdatErrorOccurrence(value.occurrence)) return false
  const field = PRODAT_26A_FIELD_MATRIX.find(f => f.fieldNumber === value.fieldNumber && !f.fieldNumber.includes('_'))
  if (!field || !value.component || typeof value.component !== 'object' || Array.isArray(value.component)) return false
  const expected = sourceFieldMetadata(field)
  return value.segmentPath === expected.segmentPath && value.group === expected.group
    && Object.entries(expected.component).every(([key,item]) => value.component[key] === item)
}
