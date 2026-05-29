// lib/ediel/core/canonicalMessage.ts

import type { EdielMessageFamily, EdielMessageRow, EdielMessageStandard } from '@/lib/ediel/types'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
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
  return String(value ?? '').split(':').map((part) => part.trim())
}

function firstComponent(value: string | null | undefined): string | null {
  return cleanString(splitComposite(value)[0] ?? null)
}

function element(rawSegment: string | null | undefined, index: number): string | null {
  const value = rawSegment?.split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function allSegments(rawSegments: readonly string[], prefix: string): string[] {
  const normalized = prefix.toUpperCase()
  return rawSegments.filter((segment) => segment.toUpperCase().startsWith(normalized))
}

function firstSegment(rawSegments: readonly string[], prefix: string): string | null {
  return allSegments(rawSegments, prefix)[0] ?? null
}

function partyIdAndSubAddress(composite: string | null): { id: string | null; subAddress: string | null } {
  const parts = splitComposite(composite)
  return {
    id: cleanString(parts[0] ?? null),
    subAddress: cleanString(parts[2] ?? null),
  }
}

function versionFromUnh(unh: string | null): string | null {
  const parts = splitComposite(element(unh, 2))
  return cleanString(parts[4] ?? null)
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

function referenceList(rawSegments: readonly string[]): CanonicalEdielReference[] {
  return allSegments(rawSegments, 'RFF+').flatMap((segment) => {
    const composite = element(segment, 1)
    const parts = splitComposite(composite)
    const qualifier = cleanString(parts[0] ?? null)
    const value = cleanString(parts.slice(1).join(':'))
    if (!qualifier || !value) return []
    return [{ qualifier, value, raw: segment }]
  })
}

function referenceValue(references: readonly CanonicalEdielReference[], ...qualifiers: string[]): string | null {
  const normalized = qualifiers.map((qualifier) => qualifier.toUpperCase())
  return references.find((reference) => normalized.includes(reference.qualifier.toUpperCase()))?.value ?? null
}

function quantities(rawSegments: readonly string[]): CanonicalEdielQuantity[] {
  return allSegments(rawSegments, 'QTY+').map((segment) => {
    const parts = splitComposite(element(segment, 1))
    return {
      qualifier: cleanString(parts[0] ?? null),
      value: cleanString(parts[1] ?? null),
      raw: segment,
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
  const rawSegments = facts.rawSegments
  const unbRaw = facts.unb?.raw ?? firstSegment(rawSegments, 'UNB+')
  const unhRaw = facts.unh?.raw ?? firstSegment(rawSegments, 'UNH+')
  const bgmRaw = facts.bgm?.raw ?? firstSegment(rawSegments, 'BGM+')
  const bgmCode = firstComponent(element(bgmRaw, 1))
  const family = familyFromUnhAndBgm(unhRaw, bgmCode)
  const senderParty = partyIdAndSubAddress(element(unbRaw, 2))
  const receiverParty = partyIdAndSubAddress(element(unbRaw, 3))
  const references = referenceList(rawSegments)
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
    firstComponent(element(firstSegment(rawSegments, 'LOC+172+'), 2)) ??
    facts.lineItems.find((line) => line.itemId)?.itemId ??
    null

  return {
    family,
    messageFamilyForStorage: storageFamily(family),
    messageStandard: 'edifact',
    messageCode,
    subtype: cciCavSubtype(rawSegments),
    direction,
    version: versionFromUnh(unhRaw),
    applicationReference: element(unbRaw, 7),
    sender: senderParty.id,
    receiver: receiverParty.id,
    senderSubAddress: senderParty.subAddress,
    receiverSubAddress: receiverParty.subAddress,
    interchangeReference: facts.interchangeReference ?? element(unbRaw, 5),
    messageReference: facts.messageReference ?? element(unhRaw, 1),
    documentReference: facts.documentReference ?? element(bgmRaw, 2),
    transactionReference,
    businessReference: referenceValue(references, 'LI', 'ACW', 'AGO', 'TN'),
    relatedReference: referenceValue(references, 'ACW', 'AGO', 'E31', 'Z07'),
    facilityId: referenceValue(references, 'Z05') ?? firstComponent(element(firstSegment(rawSegments, 'LOC+172+'), 2)),
    meteringPointId,
    gridArea: firstComponent(element(firstSegment(rawSegments, 'LOC+239+'), 2)),
    permissionId: referenceValue(references, 'Z07', 'AHL'),
    period: dtmValue(rawSegments, '324') ?? dtmValue(rawSegments, '163') ?? dtmValue(rawSegments, '719'),
    quantities: quantities(rawSegments),
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

  if (standardHint === 'ai_list' || (!rawPayload.includes("'") && rawPayload.includes(';'))) {
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
