import { classifyCanonicalInboundAck, type CanonicalInboundAckClassification } from '@/lib/ediel/ack/inboundAckOutcome'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'

export type AckCorrelationMessage = {
  id: string
  company_id?: string | null
  environment: string | null
  direction: string
  raw_payload: string | null
  message_family?: string | null
  message_sent_at?: string | null
}
export type AckSourceLookupReference = {type: 'UNB_REF' | 'BGM_REF' | 'IDE' | 'RFF_LI' | 'RFF_TN'; value: string}
/** Exact first-register source membership. An absent LI remains absent; the
 * physical object ID is never recast as an invented case reference. */
export type ProdatAckObjectScope={objectId:string|null;identityAgency:string|null;firstLineIndex:number;lineItemReference:string|null}
export type InboundAckSourceCorrelation = {
  classification: CanonicalInboundAckClassification | {family: 'UTILTS_ERR'; profile: null; outcome: 'negative'; code: 'ERR'; reason: null}
  lookupReferences: AckSourceLookupReference[]
  scope: 'interchange' | 'message' | 'transaction' | 'object'
  acknowledgedReferences: string[]
  /** Whole-message classification does not describe each object in a mixed
   * processed PRODAT APERAK. These results use each physical ERC/LI group. */
  scopedOutcomes?: {reference: string; outcome: 'positive' | 'negative'}[]
  prodatObjectOutcomes?: Array<ProdatAckObjectScope&{outcome:'positive'|'negative'}>
  wholeSourceOutcome?: 'positive' | 'negative'
}
export type AckSourceQualification<T extends AckCorrelationMessage> =
  | {status: 'unique'; sourceMessage: T; correlation: InboundAckSourceCorrelation; candidateIds: string[]; reason: null}
  | {status: 'invalid' | 'unresolved' | 'ambiguous'; sourceMessage: null; correlation: InboundAckSourceCorrelation | null; candidateIds: string[]; reason: string}

type Wire = ReturnType<typeof EdifactEnvelopeCodec.decode>
function first(wire: Wire, tag: string) { return wire.segments.find(segment => segment.tag === tag) }
function parts(wire: Wire, segment: EdifactTokenizedSegment | undefined, index: number) { return segmentComposite(segment, index, wire.una) }
function component(wire: Wire, segment: EdifactTokenizedSegment | undefined, index: number) { return parts(wire, segment, index)[0] ?? '' }
function values(wire: Wire, tag: string, element: number, qualifier?: string): string[] {
  return wire.segments.filter(segment => segment.tag === tag && (!qualifier || component(wire, segment, 1) === qualifier))
    .map(segment => qualifier && tag === 'RFF' ? parts(wire, segment, 1)[1] ?? '' : component(wire, segment, element)).filter(Boolean)
}
function references(wire: Wire, qualifier: string) { return values(wire, 'RFF', 1, qualifier) }
function one(values: string[]) { return values.length === 1 && values[0] ? values[0] : null }
function exact(a: readonly string[], b: readonly string[]) { return JSON.stringify(a) === JSON.stringify(b) }
function readWire(message: AckCorrelationMessage, allowTechnicalWithoutApplication = false): Wire {
  if (!message.raw_payload || !validateEdifactEnvelope(message.raw_payload).ok) throw Error('ack_correlation_envelope_invalid')
  const wire = EdifactEnvelopeCodec.decode(message.raw_payload)
  if (wire.segments.filter(segment => segment.tag === 'UNB').length !== 1 || wire.segments.filter(segment => segment.tag === 'UNH').length !== 1
    || !wire.sender || !wire.receiver || (!wire.applicationReference && !(allowTechnicalWithoutApplication && component(wire, first(wire,'UNH'),2)==='CONTRL'))
    || wire.environment !== message.environment) throw Error('ack_correlation_wire_context_invalid')
  return wire
}
function classify(wire: Wire, scopedErrorCodes?: string[]): InboundAckSourceCorrelation['classification'] {
  const unh = parts(wire, first(wire, 'UNH'), 2), bgm = first(wire, 'BGM')
  if (unh[0] === 'UTILTS' && component(wire, bgm, 1) === 'ERR') {
    if (!wire.segments.some(segment => segment.tag === 'STS' && component(wire, segment, 1) === 'E01' && component(wire, segment, 2) === '41')) throw Error('utilts_err_outcome_invalid')
    return {family:'UTILTS_ERR', profile:null, outcome:'negative', code:'ERR', reason:null}
  }
  const family = unh[0] === 'CONTRL' || unh[0] === 'APERAK' ? unh[0] : 'OTHER'
  return classifyCanonicalInboundAck({messageFamily: family, messageCode: component(wire, bgm, 1), messageFunctionCode: component(wire, bgm, 3),
    applicationReference: wire.applicationReference, messageTypeVersion: {syntaxIdentifier:null,directoryVersion:unh[1] ?? null,release:unh[2] ?? null,controllingAgency:unh[3] ?? null,associationAssignedCode:unh[4] ?? null},
    errorCodes: scopedErrorCodes ?? values(wire, 'ERC', 1), references: {UCI_ACTION: values(wire, 'UCI', 4)}})
}
function prodatObjectOutcomes(wire: Wire, objectReferences: string[]): NonNullable<InboundAckSourceCorrelation['scopedOutcomes']> {
  const errors = new Map<string, string[]>()
  let ownErc: string | null = null
  for (const segment of wire.segments) {
    if (segment.tag === 'ERC') ownErc = component(wire, segment, 1) || null
    if (segment.tag === 'RFF' && component(wire, segment, 1) === 'LI') {
      const reference = parts(wire, segment, 1)[1] ?? ''
      if (!reference || !ownErc) throw Error('ack_object_result_unavailable')
      errors.set(reference, [...(errors.get(reference) ?? []), ownErc])
    }
  }
  return [...new Set(objectReferences)].map(reference => {
    const ownErrors = errors.get(reference)
    if (!ownErrors?.length) throw Error('ack_object_result_unavailable')
    const result = classify(wire, ownErrors)
    if (result.outcome !== 'positive' && result.outcome !== 'negative') throw Error('ack_object_result_unavailable')
    return {reference, outcome: result.outcome}
  })
}
function prodatObjectGroups(wire:Wire){
  const groups:Array<{objectId:string|null;lineItemReference:string|null;outcome:'positive'|'negative'}>=[]
  for(const [index,segment]of wire.segments.entries()){
    if(segment.tag!=='ERC')continue
    const next=wire.segments.findIndex((part,position)=>position>index&&part.tag==='ERC')
    const own=wire.segments.slice(index,next<0?wire.segments.length:next)
    const refs=(qualifier:string)=>references({...wire,segments:own},qualifier)
    const li=refs('LI'),id=refs('Z07'),result=classify(wire,[component(wire,segment,1)])
    if(li.length>1||id.length>1||result.outcome!=='positive'&&result.outcome!=='negative'
      ||!li.length&&(!id.length||result.outcome!=='negative'))throw Error('ack_processed_negative_scope_unavailable')
    groups.push({objectId:one(id),lineItemReference:one(li),outcome:result.outcome})
  }
  return groups
}
function prodatSourceObjectOutcomes(ack:Wire,source:Wire):NonNullable<InboundAckSourceCorrelation['prodatObjectOutcomes']>{
  const originals=prodatRegisterGroups(source.segments,source.una).groups.filter(group=>group.registerPosition===1)
  const results=new Map<number,NonNullable<InboundAckSourceCorrelation['prodatObjectOutcomes']>[number]>()
  for(const own of prodatObjectGroups(ack)){
    const matches=originals.filter(group=>{
      const li=one(references({...source,segments:group.segments},'LI'))
      return (own.lineItemReference!==null?li===own.lineItemReference:group.itemId===own.objectId)
        &&(own.objectId===null||group.itemId===own.objectId)
    })
    if(matches.length!==1)throw Error('ack_prodat_original_object_scope_ambiguous')
    const original=matches[0],li=one(references({...source,segments:original.segments},'LI'))
    if(li!==own.lineItemReference||own.lineItemReference===null&&own.outcome!=='negative')throw Error('ack_prodat_original_object_scope_mismatch')
    const firstLineIndex=original.segments[0].index,prior=results.get(firstLineIndex)
    if(prior&&prior.outcome!==own.outcome)throw Error('ack_object_result_conflict')
    results.set(firstLineIndex,{objectId:original.itemId,identityAgency:original.identityAgency,firstLineIndex,lineItemReference:li,outcome:own.outcome})
  }
  return [...results.values()]
}
export function readInboundAckSourceCorrelation(message: AckCorrelationMessage): InboundAckSourceCorrelation {
  if (message.direction !== 'inbound') throw Error('ack_correlation_not_inbound')
  return readPhysicalAckSourceCorrelation(message)
}
/** Physical projection shared by inbound correlation and a protected outbound
 * original read. Direction and original authority remain each caller's gate. */
export function readPhysicalAckSourceCorrelation(message: AckCorrelationMessage,actualSource?:AckCorrelationMessage): InboundAckSourceCorrelation {
  const wire = readWire(message,true), classification = classify(wire)
  if (classification.outcome !== 'positive' && classification.outcome !== 'negative') throw Error(classification.reason ?? 'ack_correlation_outcome_invalid')
  if (message.message_family && message.message_family !== classification.family) throw Error('ack_correlation_stored_family_mismatch')
  let scope: InboundAckSourceCorrelation['scope'], acknowledgedReferences: string[], lookupReferences: AckSourceLookupReference[]
  if (classification.family === 'CONTRL') {
    const original = one(values(wire, 'UCI', 1)); if (!original) throw Error('ack_correlation_original_interchange_required')
    scope = 'interchange'; acknowledgedReferences = [original]; lookupReferences = [{type:'UNB_REF',value:original}]
  } else if (classification.family === 'UTILTS_ERR') {
    acknowledgedReferences = references(wire, 'TN'); if (!acknowledgedReferences.length) throw Error('ack_correlation_original_transaction_required')
    scope = 'transaction'; lookupReferences = acknowledgedReferences.map(value => ({type:'IDE',value}))
  } else if (classification.profile === 'UTILTS_25_A') {
    const docs = wire.segments.filter(segment => segment.tag === 'DOC'), original = docs.length === 1 ? component(wire, docs[0], 2) : null
    if (!original) throw Error('ack_correlation_original_document_required')
    acknowledgedReferences = references(wire, 'ACW'); scope = acknowledgedReferences.length ? 'transaction' : 'message'
    if (classification.outcome === 'positive' && !acknowledgedReferences.length) throw Error('ack_correlation_original_transaction_required')
    lookupReferences = [{type:'BGM_REF',value:original}, ...acknowledgedReferences.map(value => ({type:'IDE' as const,value}))]
  } else {
    const original = one(references(wire, 'ACW')); if (!original) throw Error('ack_correlation_original_document_required')
    const objects = references(wire, 'LI'),processed=component(wire,first(wire,'BGM'),3)==='34'
    // P pp85-87 allows a source-owned negative object response when LI itself
    // is missing. Only its actual Z07 remains; no surrogate LI is generated.
    if(processed)prodatObjectGroups(wire)
    scope = processed||objects.length ? 'object' : 'message'; acknowledgedReferences = objects
    lookupReferences = [{type:'BGM_REF',value:original}, ...objects.map(value => ({type:'RFF_LI' as const,value}))]
  }
  const scopedOutcomes = classification.family === 'APERAK' && classification.profile === 'PRODAT_16_B' && scope === 'object'
    ? prodatObjectOutcomes(wire, acknowledgedReferences) : undefined
  let sourceObjectOutcomes:InboundAckSourceCorrelation['prodatObjectOutcomes']
  if(actualSource&&classification.family==='APERAK'&&classification.profile==='PRODAT_16_B'&&scope==='object'){
    const source=readWire(actualSource)
    if(!qualifies(wire,source,{classification,scope,acknowledgedReferences,lookupReferences}))throw Error('ack_prodat_original_object_scope_mismatch')
    sourceObjectOutcomes=prodatSourceObjectOutcomes(wire,source)
  }
  const wholeSourceOutcome = classification.family === 'CONTRL' ? classification.outcome
    : scope === 'message' && classification.family === 'APERAK' && classification.outcome === 'negative'
      && (classification.profile === 'UTILTS_25_A' && classification.code === '313'
        || classification.profile === 'PRODAT_16_B' && component(wire, first(wire, 'BGM'), 3) === '27') ? 'negative' : undefined
  return {classification, scope, acknowledgedReferences, lookupReferences, ...(scopedOutcomes ? {scopedOutcomes} : {}),...(sourceObjectOutcomes?{prodatObjectOutcomes:sourceObjectOutcomes}:{}), ...(wholeSourceOutcome ? {wholeSourceOutcome} : {})}
}
function qualifies(ack: Wire, source: Wire, correlation: InboundAckSourceCorrelation): boolean {
  const ackUnb = first(ack, 'UNB'), sourceUnb = first(source, 'UNB')
  if (!exact(parts(ack, ackUnb, 2), parts(source, sourceUnb, 3)) || !exact(parts(ack, ackUnb, 3), parts(source, sourceUnb, 2))
    || ack.environment !== source.environment || ack.applicationReference !== source.applicationReference) return false
  const sourceType = parts(source, first(source, 'UNH'), 2)[0]
  if (correlation.classification.family === 'CONTRL') {
    if (sourceType === 'CONTRL') return false
    const uci = first(ack, 'UCI')
    // T §16 projects the first 14 logical characters into UCI. All matching
    // sealed originals remain candidates: a shared prefix is ambiguous.
    return component(ack, uci, 1) === source.interchangeReference?.slice(0,14)
      && exact(parts(ack, uci, 2), parts(source, sourceUnb, 2)) && exact(parts(ack, uci, 3), parts(source, sourceUnb, 3))
      && values(ack, 'UCM', 1).every(reference => reference === component(source, first(source, 'UNH'), 1))
  }
  if (correlation.classification.family === 'UTILTS_ERR' || correlation.classification.profile === 'UTILTS_25_A') {
    if (sourceType !== 'UTILTS' || (component(source, first(source, 'BGM'), 1) === 'ERR' && correlation.classification.family === 'UTILTS_ERR')) return false
    const sourceIde = values(source, 'IDE', 2)
    if (!correlation.acknowledgedReferences.every(reference => sourceIde.includes(reference))) return false
    if (correlation.classification.family === 'APERAK') {
      const doc = first(ack, 'DOC')
      if (component(ack, doc, 1) !== component(source, first(source, 'BGM'), 1)
        || component(ack, doc, 2) !== component(source, first(source, 'BGM'), 2)) return false
    } else {
      const code = component(source, first(source, 'BGM'), 1)
      if (!references(ack, code).includes(component(source, first(source, 'BGM'), 2))) return false
    }
    return legalMirror(ack, source, 'MS', 'MR')
  }
  if (sourceType !== 'PRODAT' || one(references(ack, 'ACW')) !== component(source, first(source, 'BGM'), 2)) return false
  const lineRefs = references(source,'LI')
  if(!correlation.acknowledgedReferences.every(reference => lineRefs.includes(reference))||!legalMirror(ack,source,'FR','DO','FR','DO'))return false
  if(component(ack,first(ack,'BGM'),3)==='34')try{prodatSourceObjectOutcomes(ack,source)}catch{return false}
  return true
}
function legalMirror(ack: Wire, source: Wire, ackSender: string, ackReceiver: string, sourceSenderQualifier = 'MS', sourceReceiverQualifier = 'MR'): boolean {
  const legal = (wire: Wire, qualifier: string) => one(wire.segments.filter(segment => segment.tag === 'NAD' && component(wire,segment,1) === qualifier).map(segment => component(wire,segment,2)))
  const sourceSender = legal(source,sourceSenderQualifier), sourceReceiver = legal(source,sourceReceiverQualifier)
  return Boolean(sourceSender && sourceReceiver && legal(ack,ackSender) === sourceReceiver && legal(ack,ackReceiver) === sourceSender)
}
/** Pure physical candidate qualification. Durable received-source assessment,
 * sent-source sealing, concurrency and immutable outcome checks belong to the
 * atomic persistence authority; parsed payload and row references grant nothing. */
export function qualifyInboundAckSourceCandidates<T extends AckCorrelationMessage>(input: {ackMessage: AckCorrelationMessage; candidates: readonly T[]; expectedCompanyId?: string | null}): AckSourceQualification<T> {
  let correlation: InboundAckSourceCorrelation, ack: Wire
  try {correlation = readInboundAckSourceCorrelation(input.ackMessage); ack = readWire(input.ackMessage)} catch (error) {
    return {status:'invalid',sourceMessage:null,correlation:null,candidateIds:[],reason:error instanceof Error ? error.message : 'ack_correlation_invalid'}
  }
  const matching = new Map<string,T>()
  for (const candidate of input.candidates) {
    if (candidate.direction !== 'outbound' || !candidate.company_id || !candidate.message_sent_at) continue
    try {if (qualifies(ack,readWire(candidate),correlation)) matching.set(candidate.id,candidate)} catch { /* Unaddressable physical source cannot authorize a match. */ }
  }
  const candidateIds = [...matching.keys()]
  if (candidateIds.length !== 1) return {status:candidateIds.length ? 'ambiguous' : 'unresolved',sourceMessage:null,correlation,candidateIds,reason:candidateIds.length ? 'ack_source_ambiguous' : 'ack_source_unresolved'}
  const sourceMessage = matching.get(candidateIds[0])!
  if (input.expectedCompanyId && sourceMessage.company_id !== input.expectedCompanyId) return {status:'unresolved',sourceMessage:null,correlation,candidateIds,reason:'ack_source_company_mismatch'}
  return {status:'unique',sourceMessage,correlation,candidateIds,reason:null}
}
