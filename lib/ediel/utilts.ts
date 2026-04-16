import type {
  CreateEdielMessageInput,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import { deriveEdielAckDefaults } from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'

export type UtiltsMessageCode = 'S01' | 'S02' | 'S03' | 'S04' | 'E31' | 'E66'

export type ParsedUtiltsMessage = {
  messageFamily: Extract<EdielMessageFamily, 'UTILTS'>
  messageCode: UtiltsMessageCode | EdielKnownMessageCode | null
  transactionReference: string | null
  externalReference: string | null
  applicationReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  rawSegments: string[]
  parsedPayload: Record<string, unknown>
}

export type UtiltsInboundDraftInput = {
  actorUserId?: string | null
  code: UtiltsMessageCode
  communicationRouteId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  mailbox?: string | null
  mailboxMessageId?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  senderEmail?: string | null
  receiverEmail?: string | null
  rawPayload: string
}

function splitEdifactSegments(rawPayload: string): string[] {
  return rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function firstSegmentValue(
  segments: string[],
  prefix: string
): string | null {
  const hit = segments.find((segment) => segment.startsWith(prefix))
  return hit ?? null
}

function extractUnbEdielIds(unb: string | null): {
  senderEdielId: string | null
  receiverEdielId: string | null
} {
  if (!unb) {
    return { senderEdielId: null, receiverEdielId: null }
  }

  const parts = unb.split('+')
  const senderRaw = parts[2] ?? ''
  const receiverRaw = parts[3] ?? ''

  return {
    senderEdielId: senderRaw.split(':')[0]?.trim() || null,
    receiverEdielId: receiverRaw.split(':')[0]?.trim() || null,
  }
}

function extractApplicationReference(rawPayload: string): string | null {
  const unb = rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith('UNB+'))

  if (!unb) return null

  const parts = unb.split('+')
  return parts[6]?.trim() || null
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const regex = new RegExp(`RFF\\+${qualifier}:([A-Za-z0-9\\-_/.:]+)`, 'i')
  return rawPayload.match(regex)?.[1] ?? null
}

function extractDateFromDtm(segment: string | null): string | null {
  const raw = segment?.split(':')[1]?.trim() ?? ''
  if (!raw) return null
  return raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
}

function extractQty(segment: string | null): number | null {
  const parts = segment?.split(':') ?? []
  const value = Number(parts[1] ?? '')
  return Number.isFinite(value) ? value : null
}

export function parseInboundUtilts(rawPayload: string): ParsedUtiltsMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const unh = firstSegmentValue(rawSegments, 'UNH+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const loc172 = firstSegmentValue(rawSegments, 'LOC+172')
  const loc64 = firstSegmentValue(rawSegments, 'LOC+64')
  const dtm137 = firstSegmentValue(rawSegments, 'DTM+137')
  const dtm163 = firstSegmentValue(rawSegments, 'DTM+163')
  const qty = firstSegmentValue(rawSegments, 'QTY+')
  const cci = firstSegmentValue(rawSegments, 'CCI+')
  const ids = extractUnbEdielIds(unb)

  const bgmParts = bgm?.split('+') ?? []
  const bgmCode = (bgmParts[1]?.trim() || inferred.messageCode || null) as
    | UtiltsMessageCode
    | EdielKnownMessageCode
    | null

  const meterPointId = loc172?.split('+')[2]?.trim() || null
  const facilityId = loc64?.split('+')[2]?.trim() || null
  const periodStart = extractDateFromDtm(dtm137)
  const periodEnd = extractDateFromDtm(dtm163)
  const quantity = extractQty(qty)

  return {
    messageFamily: 'UTILTS',
    messageCode: bgmCode,
    transactionReference:
      extractReference(rawPayload, 'TN') || extractReference(rawPayload, 'CR'),
    externalReference:
      bgmParts[2]?.trim() ||
      extractReference(rawPayload, 'ON') ||
      extractReference(rawPayload, 'AAS') ||
      extractReference(rawPayload, 'ACE'),
    applicationReference: extractApplicationReference(rawPayload),
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    rawSegments,
    parsedPayload: {
      unb,
      unh,
      bgm,
      meterPointId,
      meteringPointId: meterPointId,
      facilityId,
      installationId: facilityId,
      siteFacilityId: facilityId,
      readingType: cci ?? null,
      periodStart,
      periodEnd,
      quantity,
      segmentCount: rawSegments.length,
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
      hasUtiltsErrPattern:
        rawPayload.toUpperCase().includes('UTILTS-ERR') ||
        rawPayload.toUpperCase().includes('UTILTS_ERR'),
    },
  }
}

export function buildInboundUtiltsMessageInput(
  input: UtiltsInboundDraftInput
): CreateEdielMessageInput {
  const ack = deriveEdielAckDefaults({
    family: 'UTILTS',
    code: input.code,
  })

  const parsed = parseInboundUtilts(input.rawPayload)

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'inbound',
    messageFamily: 'UTILTS',
    messageCode: parsed.messageCode ?? input.code,
    status: 'received',
    transportType: 'imap',
    mailbox: input.mailbox ?? null,
    mailboxMessageId: input.mailboxMessageId ?? null,
    senderEdielId: parsed.senderEdielId ?? input.senderEdielId ?? null,
    receiverEdielId: parsed.receiverEdielId ?? input.receiverEdielId ?? null,
    senderEmail: input.senderEmail ?? null,
    receiverEmail: input.receiverEmail ?? null,
    fileName: inferEdielFileName({
      family: 'UTILTS',
      code: parsed.messageCode ?? input.code,
      direction: 'inbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    externalReference: parsed.externalReference,
    transactionReference: parsed.transactionReference,
    applicationReference: parsed.applicationReference,
    communicationRouteId: input.communicationRouteId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    rawPayload: input.rawPayload,
    parsedPayload: parsed.parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: ack.utiltsErrStatus,
    messageReceivedAt: new Date().toISOString(),
  }
}