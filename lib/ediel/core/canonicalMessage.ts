import { segmentComposite,segmentUntrimmedRaw, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { prodatReferenceEntries } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
// lib/ediel/core/canonicalMessage.ts

import type { EdielMessageFamily, EdielMessageRow, EdielMessageStandard } from '@/lib/ediel/types'
import {
  parseEdifactMessageFacts,
  splitEdifactComponents,
  splitEdifactElements,
} from '@/lib/ediel/core/edifactSegments'
import { parseRulebookListPayload } from '@/lib/ediel/rulebook/messageParser'
import { processGroupForMessage } from '@/lib/ediel/rulebook/rulebook'

type ExtendedCanonicalFamily = EdielMessageFamily | 'BI_LIST' | 'DELFOR' | 'QUOTES' | 'MSCONS' | 'UNKNOWN'

export type CanonicalEdielQuantity = {
  qualifier: string | null
  value: string | null
  raw: string
}

export type CanonicalEdielReference = {
  qualifier: string
  value: string
  raw: string
}

export type CanonicalEdielMessage = {
  family: ExtendedCanonicalFamily
  messageFamilyForStorage: EdielMessageFamily
  messageStandard: EdielMessageStandard
  messageCode: string | null
  subtype: string | null
  direction: EdielMessageRow['direction'] | null
  version: string | null
  applicationReference: string | null
  sender: string | null
  receiver: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
  interchangeReference: string | null
  messageReference: string | null
  documentReference: string | null
  transactionReference: string | null
  businessReference: string | null
  relatedReference: string | null
  facilityId: string | null
  meteringPointId: string | null
  gridArea: string | null
  permissionId: string | null
  period: string | null
  quantities: CanonicalEdielQuantity[]
  statuses: string[]
  references: CanonicalEdielReference[]
  processGroup: string
  una?: EdifactServiceStringAdvice
  rawSegments: string[]
  facts: Record<string, unknown>
  parserWarnings: string[]
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function splitComposite(value: string | null | undefined): string[] {
  return splitEdifactComponents(value).map((part) => part.trim())
}

function firstComponent(value: string | null | undefined): string | null {
  return cleanString(splitComposite(value)[0] ?? null)
}

function element(rawSegment: string | null | undefined, index: number): string | null {
  const value = splitEdifactElements(rawSegment)[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function allSegments(rawSegments: readonly string[], prefix: string): string[] {
  const normalized = prefix.toUpperCase()
  return rawSegments.filter((segment) => segment.toUpperCase().startsWith(normalized))
}

function firstSegment(rawSegments: readonly string[], prefix: string): string | null {
  return allSegments(rawSegments, prefix)[0] ?? null
}

function familyFromUnhAndBgm(unh: string | null, bgmCode: string | null): ExtendedCanonicalFamily {
  const token = upper(element(unh, 2) ?? unh)
  const code = upper(bgmCode)

  if (token.includes('CONTRL')) return 'CONTRL'
  if (token.includes('APERAK')) return 'APERAK'
  if (token.includes('UTILTS') && code === 'ERR') return 'UTILTS_ERR'
  if (token.includes('UTILTS')) return 'UTILTS'
  if (token.includes('PRODAT')) return 'PRODAT'
  if (token.includes('DELFOR')) return 'DELFOR'
  if (token.includes('QUOTES')) return 'QUOTES'
  if (token.includes('MSCONS')) return 'MSCONS'
  return 'UNKNOWN'
}

function storageFamily(family: ExtendedCanonicalFamily): EdielMessageFamily {
  if (
    family === 'PRODAT' ||
    family === 'UTILTS' ||
    family === 'APERAK' ||
    family === 'CONTRL' ||
    family === 'UTILTS_ERR' ||
    family === 'AI_LIST' ||
    family === 'NBS_XML' ||
    family === 'OTHER'
  ) return family

  return 'OTHER'
}

function referenceList(segments: readonly EdifactTokenizedSegment[], una: ReturnType<typeof parseUna>): CanonicalEdielReference[] {
  return segments.filter(segment => segment.tag === 'RFF').flatMap((segment) => {
    // ACW carries the original PRODAT BGM identity into APERAK. Decode from
    // wire once: a literal release at the end is data, not a dangling escape.
    const parts = segmentComposite(segment, 1, una).map(part => part.trim())
    const qualifier = cleanString(parts[0] ?? null)
    const value = cleanString(parts.slice(1).join(':'))
    if (!qualifier || !value) return []
    return [{ qualifier, value, raw: segment.raw }]
  })
}

function referenceValue(references: readonly CanonicalEdielReference[], ...qualifiers: string[]): string | null {
  const normalized = qualifiers.map((qualifier) => qualifier.toUpperCase())
  return references.find((reference) => normalized.includes(reference.qualifier.toUpperCase()))?.value ?? null
}

function quantities(segments: readonly EdifactTokenizedSegment[], una: EdifactServiceStringAdvice): CanonicalEdielQuantity[] {
  return segments.filter(segment => segment.tag === 'QTY').map((segment) => {
    const parts = segmentComposite(segment, 1, una)
    return {
      qualifier: cleanString(parts[0] ?? null),
      value: cleanString(parts[1] ?? null),
      raw: segment.raw,
    }
  })
}

function statuses(rawSegments: readonly string[]): string[] {
  return allSegments(rawSegments, 'STS+').map((segment) => segment.trim()).filter(Boolean)
}

function dtmValue(rawSegments: readonly string[], qualifier: string): string | null {
  const hit = firstSegment(rawSegments, `DTM+${qualifier}:`)
  const parts = splitComposite(element(hit, 1))
  return cleanString(parts[1] ?? null)
}

function cciCavSubtype(rawSegments: readonly string[]): string | null {
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index]
    if (!segment?.toUpperCase().startsWith('CCI++')) continue
    const cciCode = firstComponent(element(segment, 2))
    const next = rawSegments[index + 1]
    if (!next?.toUpperCase().startsWith('CAV+')) continue
    const cavParts = splitComposite(element(next, 1))
    const value = cleanString(cavParts.find((part) => /^[A-Z0-9]{1,8}$/.test(part)) ?? cavParts[0] ?? null)
    if (cciCode && value) return value.toUpperCase()
  }
  return null
}

function parseEdifactCanonical(rawPayload: string, direction: EdielMessageRow['direction'] | null): CanonicalEdielMessage {
  const facts = parseEdifactMessageFacts(rawPayload)
  const una = parseUna(rawPayload)
  const rawSegments = facts.rawSegments
  // ACK facts use the same service alphabet and physical components as their
  // guide/correlation consumers; no literal delimiter or metadata fallback.
  if (facts.messageType === 'APERAK' || facts.messageType === 'CONTRL') {
    const family=facts.messageType, present=(value:string | undefined)=>value?.length?value:null
    const unb=(index:number)=>segmentComposite(facts.unb,index,una)
    const refs=referenceList(facts.segments,una)
    return {
      family,messageFamilyForStorage:family,messageStandard:'edifact',messageCode:family,subtype:null,direction,
      version:present(segmentComposite(facts.unh,2,una)[4]),applicationReference:present(unb(7)[0]),
      sender:present(unb(2)[0]),receiver:present(unb(3)[0]),senderSubAddress:present(unb(2)[2]),receiverSubAddress:present(unb(3)[2]),
      interchangeReference:present(unb(5)[0]),messageReference:present(segmentComposite(facts.unh,1,una)[0]),
      documentReference:present(segmentComposite(facts.bgm,2,una)[0]),transactionReference:referenceValue(refs,'LI','ACW','DM'),
      businessReference:referenceValue(refs,'LI','ACW'),relatedReference:referenceValue(refs,'ACW','Z07'),facilityId:null,meteringPointId:null,gridArea:null,permissionId:null,
      period:null,quantities:[],statuses:[],references:refs,processGroup:processGroupForMessage(family,family),una,rawSegments:facts.rawSegments,
      facts:{parsedBy:'canonicalMessage',sourceFacts:{messageType:family,messageCode:facts.messageCode,documentReference:facts.documentReference}},parserWarnings:[],
    }
  }
  if(facts.messageType==='UTILTS') {
    const present=(value:string|undefined)=>value!==undefined&&value!==''?value:null
    const components=(segment:EdifactTokenizedSegment|null|undefined,index:number)=>segmentComposite(segment?{...segment,raw:segmentUntrimmedRaw(segment)}:segment,index,una)
    const scalar=(segment:EdifactTokenizedSegment|null|undefined,index:number)=>present(components(segment,index)[0])
    const bgmCode=scalar(facts.bgm,1),family=bgmCode==='ERR'?'UTILTS_ERR':'UTILTS'
    const messageCode=family==='UTILTS_ERR'?'UTILTS_ERR':bgmCode
    const refs:CanonicalEdielReference[]=facts.segments.filter(segment=>segment.tag==='RFF').flatMap(segment=>{
      const values=components(segment,1),qualifier=present(values[0]),value=present(values[1])
      return qualifier&&value?[{qualifier,value,raw:segmentUntrimmedRaw(segment)}]:[]
    })
    const loc=(qualifier:string)=>scalar(facts.segments.find(segment=>segment.tag==='LOC'&&scalar(segment,1)===qualifier),2)
    const dtm=(qualifier:string)=>present(components(facts.segments.find(segment=>segment.tag==='DTM'&&scalar(segment,1)===qualifier),1)[1])
    const point=loc('172')
    return {
      family,messageFamilyForStorage:family,messageStandard:'edifact',messageCode,subtype:null,direction,
      version:present(components(facts.unh,2)[4]),applicationReference:scalar(facts.unb,7),una,
      sender:scalar(facts.unb,2),receiver:scalar(facts.unb,3),senderSubAddress:present(components(facts.unb,2)[2]),receiverSubAddress:present(components(facts.unb,3)[2]),
      interchangeReference:scalar(facts.unb,5),messageReference:scalar(facts.unh,1),documentReference:scalar(facts.bgm,2),
      transactionReference:referenceValue(refs,'TN','LI','ACW')??scalar(facts.segments.find(segment=>segment.tag==='IDE'),2),
      businessReference:referenceValue(refs,'LI','ACW','AGO','TN'),relatedReference:referenceValue(refs,'ACW','AGO','E31','Z07'),
      facilityId:referenceValue(refs,'Z05')??point,meteringPointId:point,gridArea:loc('239'),permissionId:referenceValue(refs,'Z07','AHL'),
      period:dtm('324')??dtm('163')??dtm('719'),quantities:facts.segments.filter(segment=>segment.tag==='QTY').map(segment=>{
        const values=components(segment,1)
        return {qualifier:present(values[0]),value:present(values[1]),raw:segmentUntrimmedRaw(segment)}
      }),statuses:facts.segments.filter(segment=>segment.tag==='STS').map(segment=>segmentUntrimmedRaw(segment)),references:refs,
      processGroup:processGroupForMessage(family,messageCode),rawSegments,
      facts:{parsedBy:'canonicalMessage',sourceFacts:{messageType:facts.messageType,messageCode:bgmCode,documentReference:scalar(facts.bgm,2),lineItemCount:facts.lineItems.length}},parserWarnings:[],
    }
  }
  const unbRaw = facts.unb?.raw ?? firstSegment(rawSegments, 'UNB+')
  const unhRaw = facts.unh?.raw ?? firstSegment(rawSegments, 'UNH+')
  const bgmRaw = facts.bgm?.raw ?? firstSegment(rawSegments, 'BGM+')
  const bgmCode = facts.messageCode
  const observedFamily = facts.messageType
  const family: ExtendedCanonicalFamily = observedFamily === 'UTILTS' ? (bgmCode === 'ERR' ? 'UTILTS_ERR' : 'UTILTS')
    : observedFamily === 'PRODAT' || observedFamily === 'CONTRL' || observedFamily === 'APERAK' || observedFamily === 'DELFOR' || observedFamily === 'QUOTES' || observedFamily === 'MSCONS' ? observedFamily
      : familyFromUnhAndBgm(unhRaw, bgmCode)
  // PRODAT policy selection must use the same UNA as its NAD field reader.
  // Read structured wire components once; decoded colon/release data cannot be
  // split again or confused with legal FR/DO identities.
  const sourceParty = (index: number) => {
    const parts = segmentComposite(facts.unb, index, una)
    return { id: cleanString(parts[0]), subAddress: cleanString(parts[2]) }
  }
  const senderParty = sourceParty(2)
  const receiverParty = sourceParty(3)
  const sourceApplication = segmentComposite(facts.unb, 7, una)
  const references = family === 'PRODAT' ? prodatReferenceEntries(facts.segments, parseUna(rawPayload)) : referenceList(facts.segments, parseUna(rawPayload))
  const transactionReference =
    referenceValue(references, 'TN', 'LI', 'ACW') ??
    facts.lineItems.find((line) => line.rffLi)?.rffLi ??
    null
  const messageCode = family === 'CONTRL'
    ? 'CONTRL'
    : family === 'APERAK'
      ? 'APERAK'
      : family === 'UTILTS_ERR'
        ? 'UTILTS_ERR'
        : bgmCode
  const meteringPointId =
    cleanString(segmentComposite(facts.segments.find(segment => segment.tag === 'LOC' && segmentComposite(segment, 1, una)[0] === '172'), 2, una)[0]) ??
    facts.lineItems.find((line) => line.itemId)?.itemId ??
    null

  return {
    family,
    messageFamilyForStorage: storageFamily(family),
    messageStandard: 'edifact',
    messageCode,
    subtype: family === 'PRODAT'
      ? prodatCharacteristicValue('223', facts.segments, parseUna(rawPayload))?.toUpperCase() ?? null
      : cciCavSubtype(rawSegments),
    direction,
    version: cleanString(segmentComposite(facts.unh, 2, una)[4]),
    applicationReference: sourceApplication.length === 1 ? cleanString(sourceApplication[0]) : null,
    una,
    sender: senderParty.id,
    receiver: receiverParty.id,
    senderSubAddress: senderParty.subAddress,
    receiverSubAddress: receiverParty.subAddress,
    interchangeReference: facts.interchangeReference ?? element(unbRaw, 5),
    messageReference: facts.messageReference ?? element(unhRaw, 1),
    documentReference: family === 'PRODAT' ? facts.documentReference : facts.documentReference ?? element(bgmRaw, 2),
    transactionReference,
    businessReference: referenceValue(references, 'LI', 'ACW', 'AGO', 'TN'),
    relatedReference: referenceValue(references, 'ACW', 'AGO', 'E31', 'Z07'),
    facilityId: referenceValue(references, 'Z05') ?? meteringPointId,
    meteringPointId,
    gridArea: cleanString(segmentComposite(facts.segments.find(segment => segment.tag === 'LOC' && segmentComposite(segment, 1, una)[0] === '239'), 2, una)[0]),
    permissionId: family === 'PRODAT' ? referenceValue(references, 'Z09') : referenceValue(references, 'Z07', 'AHL'),
    period: dtmValue(rawSegments, '324') ?? dtmValue(rawSegments, '163') ?? dtmValue(rawSegments, '719'),
    quantities: quantities(facts.segments, una),
    statuses: statuses(rawSegments),
    references,
    processGroup: processGroupForMessage(storageFamily(family), messageCode),
    rawSegments,
    facts: {
      parsedBy: 'canonicalMessage',
      sourceFacts: {
        messageType: facts.messageType,
        messageCode: facts.messageCode,
        documentReference: facts.documentReference,
        lineItemCount: facts.lineItems.length,
      },
    },
    parserWarnings: family === 'UNKNOWN' ? ['UNH message type kunde inte klassas som aktiv Ediel-familj.'] : [],
  }
}

function parseAiOrBiCanonical(rawPayload: string, direction: EdielMessageRow['direction'] | null): CanonicalEdielMessage {
  const parsed = parseRulebookListPayload(rawPayload)
  const family: ExtendedCanonicalFamily = parsed.family === 'BI_LIST' ? 'BI_LIST' : 'AI_LIST'
  return {
    family,
    messageFamilyForStorage: family === 'AI_LIST' ? 'AI_LIST' : 'OTHER',
    messageStandard: 'ai_list',
    messageCode: parsed.code,
    subtype: null,
    direction,
    version: typeof parsed.facts.formatVersion === 'string' ? parsed.facts.formatVersion : null,
    applicationReference: null,
    sender: parsed.sender,
    receiver: parsed.receiver,
    senderSubAddress: null,
    receiverSubAddress: null,
    interchangeReference: null,
    messageReference: null,
    documentReference: null,
    transactionReference: null,
    businessReference: null,
    relatedReference: null,
    facilityId: null,
    meteringPointId: null,
    gridArea: null,
    permissionId: null,
    period: null,
    quantities: [],
    statuses: [],
    references: [],
    processGroup: 'ai_list',
    rawSegments: parsed.rawSegments,
    facts: parsed.facts,
    parserWarnings: parsed.warnings,
  }
}

function parseXmlCanonical(rawPayload: string, direction: EdielMessageRow['direction'] | null): CanonicalEdielMessage {
  const documentMatch = rawPayload.match(/<\s*([A-Za-z0-9_:-]+)(\s|>)/)
  const root = documentMatch?.[1] ?? null
  const sender = rawPayload.match(/<[^>]*(Sender|sender|Sender_MarketParticipant|SenderEnergyParty)[^>]*>([^<]+)</)?.[2]?.trim() ?? null
  const receiver = rawPayload.match(/<[^>]*(Receiver|receiver|Receiver_MarketParticipant|ReceiverEnergyParty)[^>]*>([^<]+)</)?.[2]?.trim() ?? null

  return {
    family: 'NBS_XML',
    messageFamilyForStorage: 'NBS_XML',
    messageStandard: 'xml',
    messageCode: root,
    subtype: null,
    direction,
    version: null,
    applicationReference: null,
    sender,
    receiver,
    senderSubAddress: null,
    receiverSubAddress: null,
    interchangeReference: null,
    messageReference: null,
    documentReference: null,
    transactionReference: null,
    businessReference: null,
    relatedReference: null,
    facilityId: null,
    meteringPointId: null,
    gridArea: null,
    permissionId: null,
    period: null,
    quantities: [],
    statuses: [],
    references: [],
    processGroup: 'nbs_xml',
    rawSegments: [root ?? 'XML'],
    facts: {
      root,
      recognizedAs: 'NBS_XML',
      xmlParserScope: 'recognition_only',
    },
    parserWarnings: ['XML/NBS är igenkänt men full schema-validering ligger i NBS/eSett-scope.'],
  }
}

export function parseCanonicalEdielPayload(params: {
  rawPayload: string | null | undefined
  direction?: EdielMessageRow['direction'] | null
  standardHint?: EdielMessageStandard | null
}): CanonicalEdielMessage {
  const rawPayload = String(params.rawPayload ?? '').trim()
  const standardHint = params.standardHint ?? null

  if (standardHint === 'xml' || rawPayload.startsWith('<')) {
    return parseXmlCanonical(rawPayload, params.direction ?? null)
  }

  // A declared EDIFACT payload (or its UNA advice) outranks a CSV heuristic.
  // Semicolon may be the actual data separator, including inside document ids.
  const edifactDeclared = standardHint === 'edifact' || rawPayload.startsWith('UNA')
  if (standardHint === 'ai_list' || (!edifactDeclared && !rawPayload.includes("'") && rawPayload.includes(';'))) {
    return parseAiOrBiCanonical(rawPayload, params.direction ?? null)
  }

  return parseEdifactCanonical(rawPayload, params.direction ?? null)
}

export function buildCanonicalParsedPayload(canonical: CanonicalEdielMessage): Record<string, unknown> {
  return {
    canonicalVersion: '2.5B',
    family: canonical.family,
    storageFamily: canonical.messageFamilyForStorage,
    messageStandard: canonical.messageStandard,
    messageCode: canonical.messageCode,
    subtype: canonical.subtype,
    direction: canonical.direction,
    version: canonical.version,
    applicationReference: canonical.applicationReference,
    sender: canonical.sender,
    receiver: canonical.receiver,
    senderSubAddress: canonical.senderSubAddress,
    receiverSubAddress: canonical.receiverSubAddress,
    interchangeReference: canonical.interchangeReference,
    messageReference: canonical.messageReference,
    documentReference: canonical.documentReference,
    transactionReference: canonical.transactionReference,
    businessReference: canonical.businessReference,
    relatedReference: canonical.relatedReference,
    facilityId: canonical.facilityId,
    meteringPointId: canonical.meteringPointId,
    gridArea: canonical.gridArea,
    permissionId: canonical.permissionId,
    period: canonical.period,
    quantities: canonical.quantities,
    statuses: canonical.statuses,
    references: canonical.references,
    processGroup: canonical.processGroup,
    rawSegments: canonical.rawSegments,
    facts: canonical.facts,
    parserWarnings: canonical.parserWarnings,
  }
}

export function parseCanonicalMessageRow(message: EdielMessageRow): CanonicalEdielMessage {
  return parseCanonicalEdielPayload({
    rawPayload: message.raw_payload,
    direction: message.direction,
    standardHint: message.message_standard,
  })
}
