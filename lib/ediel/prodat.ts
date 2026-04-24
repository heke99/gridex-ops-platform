// lib/ediel/prodat.ts

import type {
  CreateEdielMessageInput,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import { buildDefaultApplicationReference } from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import { computeOutboundAckDueAt, deriveEdielAckDefaults } from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'
import { buildCanonicalOutboundReferences } from '@/lib/ediel/core/referenceRegistry'
import { resolveCanonicalOutboundVersion } from '@/lib/ediel/core/versionRegistry'

export type ProdatSwitchCode = 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z09' | 'Z10'

export type ParsedProdatMessage = {
  messageFamily: Extract<EdielMessageFamily, 'PRODAT'>
  messageCode: ProdatSwitchCode | EdielKnownMessageCode | null
  messageVersion: string | null
  transactionReference: string | null
  externalReference: string | null
  applicationReference: string | null
  senderEdielId: string | null
  receiverEdielId: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
  rawSegments: string[]
  parsedPayload: Record<string, unknown>
}

type BaseSwitchOutboundInput = {
  actorUserId?: string | null
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
  subject?: string | null
  applicationReference?: string | null
  externalReference?: string | null
  transactionReference?: string | null
  correlationReference?: string | null
  routeDefaultMessageVersion?: string | null
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function splitEdifactSegments(rawPayload: string): string[] {
  return rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function firstSegmentValue(segments: string[], prefix: string): string | null {
  const hit = segments.find((segment) => segment.startsWith(prefix))
  return hit ?? null
}

function extractUnbIds(unb: string | null): {
  senderEdielId: string | null
  receiverEdielId: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
} {
  if (!unb) {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      senderSubAddress: null,
      receiverSubAddress: null,
    }
  }

  const parts = unb.split('+')
  const senderRaw = parts[2] ?? ''
  const receiverRaw = parts[3] ?? ''

  const senderParts = senderRaw.split(':')
  const receiverParts = receiverRaw.split(':')

  return {
    senderEdielId: senderParts[0]?.trim() || null,
    senderSubAddress: senderParts[1]?.trim() || null,
    receiverEdielId: receiverParts[0]?.trim() || null,
    receiverSubAddress: receiverParts[1]?.trim() || null,
  }
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const regex = new RegExp(`RFF\\+${qualifier}:([A-Za-z0-9\\-_/.:]+)`, 'i')
  return rawPayload.match(regex)?.[1] ?? null
}

function extractApplicationReference(rawPayload: string): string | null {
  const unb = rawPayload
    .split("'")
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith('UNB+'))

  if (!unb) return null

  const parts = unb.split('+')
  return parts[7]?.trim() || null
}

function extractDateFromDtm(segment: string | null): string | null {
  if (!segment) return null
  const match = segment.match(/:(\d{8,12})/)
  if (!match) return null
  const raw = match[1]
  if (raw.length >= 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }
  return null
}

function normalizeDate(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00`
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed
  }
  return trimmed
}

function formatDate102(value?: string | null): string | null {
  const normalized = normalizeDate(value)
  if (!normalized) return null
  return normalized.slice(0, 10).replace(/-/g, '')
}

function inferCustomerName(
  switchRequest: SupplierSwitchRequestRow,
  site: CustomerSiteRow
): string {
  return sanitize(
    site.site_name ||
      site.current_supplier_name ||
      switchRequest.current_supplier_name ||
      'Kund'
  )
}

function inferMeterPointIdentifier(meteringPoint: MeteringPointRow): string {
  return sanitize(meteringPoint.ediel_reference || meteringPoint.meter_point_id || 'UNKNOWN')
}

function inferGridArea(gridOwner?: GridOwnerRow | null): string | null {
  return sanitize(gridOwner?.owner_code || gridOwner?.ediel_id || '') || null
}

function deriveProcessLabel(code: 'Z03' | 'Z05' | 'Z09'): string {
  if (code === 'Z03') return 'supplier_switch_request'
  if (code === 'Z05') return 'supplier_switch_completion'
  return 'masterdata_update'
}

function renderProdatSegments(params: {
  code: 'Z03' | 'Z05' | 'Z09'
  bgmReference: string
  transactionReference: string
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): string[] {
  const customerName = inferCustomerName(params.switchRequest, params.site)
  const meterPointId = inferMeterPointIdentifier(params.meteringPoint)
  const gridArea = inferGridArea(params.gridOwner)
  const startDate =
    formatDate102(params.switchRequest.requested_start_date) ||
    formatDate102(params.site.move_in_date)

  const address = sanitize(params.site.street)
  const postalCode = sanitize(params.site.postal_code)
  const city = sanitize(params.site.city)
  const siteType = sanitize(params.site.site_type)
  const incomingSupplierName = sanitize(params.switchRequest.incoming_supplier_name)
  const currentSupplierName = sanitize(
    params.switchRequest.current_supplier_name ||
      params.site.current_supplier_name
  )
  const externalReference = sanitize(params.bgmReference)
  const transactionReference = sanitize(params.transactionReference)

  const segments: string[] = []
  segments.push(`BGM+${params.code}::260+${externalReference}+9`)
  segments.push(`DTM+137:${formatDate102(new Date().toISOString())}:102`)
  segments.push(`RFF+TN:${transactionReference}`)
  segments.push(`LOC+172+${meterPointId}::9`)

  if (gridArea) {
    segments.push(`LOC+239+${gridArea}:SVK:260`)
  }

  if (startDate) {
    segments.push(`DTM+7:${startDate}:102`)
  }

  segments.push(`NAD+BY+++${customerName}`)

  if (address || postalCode || city) {
    segments.push(`ADR+${address}+${postalCode}+${city}`)
  }

  if (incomingSupplierName) {
    segments.push(`FTX+AAI+++${incomingSupplierName}`)
  }

  if (currentSupplierName) {
    segments.push(`FTX+AAO+++${currentSupplierName}`)
  }

  if (siteType) {
    segments.push(`FTX+ZZZ+++${siteType}`)
  }

  if (params.code === 'Z05') {
    segments.push(`STS+7++Z05::260`)
  }

  if (params.code === 'Z09') {
    if (params.site.facility_id) {
      segments.push(`RFF+AVC:${sanitize(params.site.facility_id)}`)
    }
    if (params.meteringPoint.ediel_reference) {
      segments.push(`RFF+Z13:${sanitize(params.meteringPoint.ediel_reference)}`)
    }
  }

  return segments
}

function buildProdatSwitchOutboundDraft(
  input: BaseSwitchOutboundInput,
  code: 'Z03' | 'Z05' | 'Z09'
): Promise<CreateEdielMessageInput> {
  return (async () => {
    const refs = buildCanonicalOutboundReferences({
      family: 'PRODAT',
      code,
      relatedMessageId: input.switchRequest.id,
      preferredExternalReference: input.externalReference ?? null,
      preferredTransactionReference: input.transactionReference ?? null,
      correlationReference: input.correlationReference ?? null,
    })

    const externalReference = refs.externalReference ?? input.switchRequest.id
    const transactionReference = refs.transactionReference ?? input.switchRequest.id

    const messageVersion =
      (await resolveCanonicalOutboundVersion({
        family: 'PRODAT',
        code,
        fallback: 'E5SE5A',
        standard: 'edifact',
        routeDefaultMessageVersion: input.routeDefaultMessageVersion ?? null,
        environment: 'test',
      })) ?? 'E5SE5A'

    const applicationReference =
      input.applicationReference ??
      buildDefaultApplicationReference({
        actorSubAddress: input.senderSubAddress ?? 'GRIDEX',
        process: 'PRODAT',
      })

    const segments = renderProdatSegments({
      code,
      bgmReference: externalReference,
      transactionReference,
      switchRequest: input.switchRequest,
      site: input.site,
      meteringPoint: input.meteringPoint,
      gridOwner: input.gridOwner ?? null,
    })

    const envelope = buildEdifactEnvelope({
      senderEdielId: input.senderEdielId,
      senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
      receiverEdielId: input.receiverEdielId,
      receiverSubAddress: input.receiverSubAddress ?? 'PRODAT',
      applicationReference,
      testFlag: 1,
      messageTypeToken: `PRODAT:D:03A:UN:${messageVersion}`,
      segments,
    })

    const ack = deriveEdielAckDefaults({
      family: 'PRODAT',
      code,
    })

    const parsedPayload: Record<string, unknown> = {
      draftType: 'prodat_switch_outbound',
      processLabel: deriveProcessLabel(code),
      switchRequestId: input.switchRequest.id,
      switchRequestType: input.switchRequest.request_type,
      switchRequestStatus: input.switchRequest.status,
      requestedStartDate: input.switchRequest.requested_start_date,
      currentSupplierName:
        input.switchRequest.current_supplier_name ?? input.site.current_supplier_name ?? null,
      incomingSupplierName: input.switchRequest.incoming_supplier_name ?? null,
      siteType: input.site.site_type ?? null,
      facilityId: input.site.facility_id ?? null,
      meterPointId: input.meteringPoint.meter_point_id ?? null,
      edielReference: input.meteringPoint.ediel_reference ?? null,
      gridOwnerEdielId: input.gridOwner?.ediel_id ?? null,
      gridOwnerOwnerCode: input.gridOwner?.owner_code ?? null,
    }

    return {
      actorUserId: input.actorUserId ?? 'system',
      direction: 'outbound',
      messageStandard: 'edifact',
      messageFamily: 'PRODAT',
      messageCode: code,
      messageVersion,
      processType: deriveProcessLabel(code),
      environment: 'test',
      testFlag: 1,
      status: 'draft',
      transportType: 'smtp',
      mailbox: input.mailbox ?? null,
      senderEdielId: input.senderEdielId,
      senderName: input.senderName ?? null,
      receiverEdielId: input.receiverEdielId,
      receiverName: input.receiverName ?? null,
      senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
      receiverSubAddress: input.receiverSubAddress ?? 'PRODAT',
      receiverEmail: input.receiverEmail ?? null,
      subject: input.subject ?? `PRODAT ${code} ${externalReference}`.trim(),
      fileName: inferEdielFileName({
        family: 'PRODAT',
        code,
        direction: 'outbound',
        extension: 'edi',
      }),
      mimeType: 'application/edifact',
      interchangeReference: envelope.interchangeReference,
      applicationReference,
      externalReference,
      correlationReference: refs.correlationReference ?? input.correlationReference ?? null,
      transactionReference,
      communicationRouteId: input.communicationRouteId ?? null,
      switchRequestId: input.switchRequest.id,
      customerId: input.switchRequest.customer_id,
      siteId: input.switchRequest.site_id,
      meteringPointId: input.switchRequest.metering_point_id,
      gridOwnerId: input.switchRequest.grid_owner_id,
      rawPayload: envelope.raw,
      parsedPayload,
      requiresContrl: ack.requiresContrl,
      requiresAperak: ack.requiresAperak,
      contrlStatus: ack.contrlStatus,
      aperakStatus: ack.aperakStatus,
      utiltsErrStatus: ack.utiltsErrStatus,
      ackDueAt: computeOutboundAckDueAt({
        requiresContrl: ack.requiresContrl,
        requiresAperak: ack.requiresAperak,
        contrlStatus: ack.contrlStatus,
        aperakStatus: ack.aperakStatus,
        utiltsErrStatus: ack.utiltsErrStatus,
      }),
      syntaxCheckStatus: 'not_checked',
      functionalCheckStatus: 'not_checked',
    }
  })()
}

export function parseInboundProdat(rawPayload: string): ParsedProdatMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const unh = firstSegmentValue(rawSegments, 'UNH+')
  const dtm7 = firstSegmentValue(rawSegments, 'DTM+7')
  const dtm137 = firstSegmentValue(rawSegments, 'DTM+137')
  const loc172 = firstSegmentValue(rawSegments, 'LOC+172')
  const loc239 = firstSegmentValue(rawSegments, 'LOC+239')
  const nadBy = firstSegmentValue(rawSegments, 'NAD+BY')
  const adr = firstSegmentValue(rawSegments, 'ADR+')
  const ids = extractUnbIds(unb)

  const bgmParts = bgm?.split('+') ?? []
  const bgmCode = (bgmParts[1]?.split(':')[0]?.trim() ||
    inferred.messageCode ||
    null) as ProdatSwitchCode | EdielKnownMessageCode | null

  const meterPointId = loc172?.split('+')[2]?.split(':')[0]?.trim() || null
  const gridAreaId = loc239?.split('+')[2]?.split(':')[0]?.trim() || null
  const customerName = nadBy?.split('+++')[1]?.trim() || null
  const adrParts = adr?.split('+') ?? []
  const messageVersion = unh?.split('+')[2]?.trim() || null

  return {
    messageFamily: 'PRODAT',
    messageCode: bgmCode,
    messageVersion,
    transactionReference:
      extractReference(rawPayload, 'TN') ||
      extractReference(rawPayload, 'CR') ||
      extractReference(rawPayload, 'AAS'),
    externalReference:
      bgmParts[2]?.trim() ||
      extractReference(rawPayload, 'ON') ||
      extractReference(rawPayload, 'ACE'),
    applicationReference: extractApplicationReference(rawPayload),
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    senderSubAddress: ids.senderSubAddress,
    receiverSubAddress: ids.receiverSubAddress,
    rawSegments,
    parsedPayload: {
      meterPointId,
      meteringPointId: meterPointId,
      gridAreaId,
      customerName,
      requestedStartDate: extractDateFromDtm(dtm7),
      createdDate: extractDateFromDtm(dtm137),
      street: adrParts[1]?.trim() || null,
      postalCode: adrParts[2]?.trim() || null,
      city: adrParts[3]?.trim() || null,
      segmentCount: rawSegments.length,
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
    },
  }
}

export async function buildProdatOutboundDraft(params: {
  actorUserId?: string | null
  switchRequestId: string
  messageCode: 'Z03' | 'Z05' | 'Z09'
  communicationRouteId?: string | null
}) {
  throw new Error(
    'buildProdatOutboundDraft är inte längre den primära vägen. Använd buildProdatZ03FromSwitch, buildProdatZ05FromSwitch eller buildProdatZ09FromSwitch.'
  )
}

export async function buildProdatZ03FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z03')
}

export async function buildProdatZ05FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z05')
}

export async function buildProdatZ09FromSwitch(
  input: BaseSwitchOutboundInput
): Promise<CreateEdielMessageInput> {
  return buildProdatSwitchOutboundDraft(input, 'Z09')
}