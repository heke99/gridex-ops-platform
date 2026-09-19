import {PRODAT_26A_FIELD_MATRIX} from './prodat26AFieldMatrix'
import {prodatRegisterGroups, prodatRegisterMessageSegments} from './prodatRegisterGroups'
import {segmentComposite, type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna, type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'

/** A known absent own reference must never be replaced by a cached/first object. */
export type ProdatErrorOccurrence = {
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
  | {kind: 'field'; fieldNumber: string; errorKind: 'missing' | 'invalid'; sourceRule: string; segmentPath: string; group: string; component: Record<string, string | number>; occurrence: ProdatErrorOccurrence}
  | {kind: 'application'; ercCode: '40'; applicationCode: '109'; sourceRule: string; occurrence: ProdatErrorOccurrence}
  | {kind: 'local_unknown' | 'local_evidence' | 'internal'; sourceRule: string; reason: string}
export type ProdatProcessingDisposition = {kind: 'continue' | 'internal_review'; reasons: {code: string; sourceRule: string; reason: string}[]}
export type DiagnosticInput = {rawSegments?: readonly string[] | null; una?: EdifactServiceStringAdvice; code?: string | null}

export function prodatLocalDiagnostic(kind: 'local_unknown' | 'local_evidence' | 'internal', sourceRule: string, reason: string): ProdatDiagnostic {
  return {kind, sourceRule, reason}
}

/** Caller selects the source field and the exact validated scope; no text/code parsing. */
export function prodatFieldDiagnostic(fieldNumber: string | null | undefined, errorKind: 'missing' | 'invalid', input: DiagnosticInput, scopedSegments: readonly string[], sourceRule: string, lineIndex?: number, occurrenceScope?:ProdatErrorOccurrence['scope']): ProdatDiagnostic {
  const field = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === fieldNumber)
  if (!field || ['END_USER_GROUP','INSTALLATION_GROUP','INVOICEE_GROUP'].includes(field.fieldNumber)) {
    return prodatLocalDiagnostic('internal', sourceRule, 'Source finding has no numeric field descriptor')
  }
  const occurrence = prodatErrorOccurrence(input, scopedSegments, occurrenceScope ?? (field.registerScope === 'header' ? 'header' : field.registerScope === 'local' ? 'register' : 'object'), lineIndex)
  if (!occurrence) return prodatLocalDiagnostic('internal', sourceRule, 'Source finding has no unambiguous own occurrence')
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
  return {kind:'field', fieldNumber:field.fieldNumber, errorKind, sourceRule, segmentPath:field.segmentPath, group, component, occurrence}
}

export function prodatErrorOccurrence(input: DiagnosticInput, scopedSegments: readonly string[], scope: ProdatErrorOccurrence['scope'], lineIndex?: number): ProdatErrorOccurrence | null {
  const una = input.una ?? parseUna(null), message = prodatRegisterMessageSegments(input.rawSegments ?? [], una)
  const unh = message.find(token => token.tag === 'UNH')
  const base = {scope, messageReference:unh ? segmentComposite(unh,1,una)[0] ?? null : null, lineIndex:null, lineNumber:null, registerPosition:null, objectId:null, identityAgency:null, lineItemReference:null}
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
  return {...base,lineIndex:group.lineIndex,lineNumber:group.lineNumber,registerPosition:group.registerPosition,objectId:group.itemId,identityAgency:group.identityAgency,lineItemReference:parts[1] || null}
}

/** A supplied misplaced field retains its actual token location, including header. */
export function prodatTokenFieldDiagnostic(field: string | undefined, input: DiagnosticInput, token: EdifactTokenizedSegment, sourceRule: string): ProdatDiagnostic {
  const {groups} = prodatRegisterGroups(prodatRegisterMessageSegments(input.rawSegments??[],input.una),input.una,input.code)
  const own = groups.find(g=>g.segments.some(t=>t.index===token.index && t.raw===token.raw))
  return prodatFieldDiagnostic(field,'invalid',input,own?.segments.map(t=>t.raw)??[],sourceRule,own?.lineIndex,own?undefined:'header')
}

export function validProdatErrorOccurrence(value: ProdatErrorOccurrence | undefined): value is ProdatErrorOccurrence {
  if (!value || !['header','object','register'].includes(value.scope)) return false
  const nullableText = (v: unknown) => v === null || typeof v === 'string'
  const nullableNumber = (v: unknown) => v === null || typeof v === 'number' && Number.isInteger(v)
  return [value.messageReference,value.lineNumber,value.objectId,value.identityAgency,value.lineItemReference].every(nullableText)
    && [value.lineIndex,value.registerPosition].every(nullableNumber)
    && (value.scope !== 'header' || value.objectId === null && value.lineItemReference === null && value.lineIndex === null)
}
