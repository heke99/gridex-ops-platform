import type {
  CreateEdielMessageInput,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import {
  buildDefaultApplicationReference,
  resolveMessageVersion,
} from '@/lib/ediel/config'
import { buildEdifactEnvelope } from '@/lib/ediel/messages'
import {
  buildEdielExternalReference,
  buildEdielTransactionReference,
  deriveEdielAckDefaults,
} from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'

export type ProdatOutboundCode = 'Z01' | 'Z03' | 'Z05' | 'Z09' | 'Z13' | 'Z18'
export type ParsedProdatCode =
  | 'Z01'
  | 'Z02'
  | 'Z03'
  | 'Z04'
  | 'Z05'
  | 'Z06'
  | 'Z09'
  | 'Z10'
  | 'Z13'
  | 'Z14'
  | 'Z15'
  | 'Z18'
  | null

export type ProdatOutboundDraftInput = {
  actorUserId?: string | null
  code: ProdatOutboundCode
  communicationRouteId?: string | null
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  gridOwnerId?: string | null
  outboundRequestId?: string | null
  switchRequestId?: string | null
  gridOwnerDataRequestId?: string | null

  senderEdielId?: string | null
  senderName?: string | null
  receiverEdielId?: string | null
  receiverName?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  mailbox?: string | null
  receiverEmail?: string | null
  subject?: string | null

  applicationReference?: string | null
  externalReference?: string | null
  correlationReference?: string | null
  transactionReference?: string | null

  reasonForTransaction?: string | null
  referenceToLineItem?: string | null
  payload?: Record<string, unknown>
}

export type ParsedProdatMessage = {
  messageFamily: Extract<EdielMessageFamily, 'PRODAT'>
  messageCode: ParsedProdatCode | EdielKnownMessageCode | null
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

function extractUnb(unb: string | null): {
  senderEdielId: string | null
  receiverEdielId: string | null
  senderSubAddress: string | null
  receiverSubAddress: string | null
  applicationReference: string | null
} {
  if (!unb) {
    return {
      senderEdielId: null,
      receiverEdielId: null,
      senderSubAddress: null,
      receiverSubAddress: null,
      applicationReference: null,
    }
  }

  const parts = unb.split('+')
  const senderRaw = parts[2] ?? ''
  const receiverRaw = parts[3] ?? ''

  const senderParts = senderRaw.split(':')
  const receiverParts = receiverRaw.split(':')

  return {
    senderEdielId: senderParts[0]?.trim() || null,
    receiverEdielId: receiverParts[0]?.trim() || null,
    senderSubAddress: senderParts[2]?.trim() || null,
    receiverSubAddress: receiverParts[2]?.trim() || null,
    applicationReference: parts[7]?.trim() || null,
  }
}

function extractReference(rawPayload: string, qualifier: string): string | null {
  const match = rawPayload.match(
    new RegExp(`RFF\\+${qualifier}:([A-Za-z0-9\\-_/.:]+)`, 'i')
  )

  return match?.[1]?.trim() ?? null
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function getPayloadString(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return ''
}

function formatDateYYYYMMDD(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.replace(/-/g, '')
}

function buildDocumentName(code: ProdatOutboundCode): string {
  switch (code) {
    case 'Z01':
      return 'PRODAT_Z01'
    case 'Z03':
      return 'PRODAT_Z03'
    case 'Z05':
      return 'PRODAT_Z05'
    case 'Z09':
      return 'PRODAT_Z09'
    case 'Z13':
      return 'PRODAT_Z13'
    case 'Z18':
      return 'PRODAT_Z18'
  }
}

function defaultReasonForTransaction(code: ProdatOutboundCode): string {
  switch (code) {
    case 'Z03':
      return 'E01'
    case 'Z05':
      return 'E01'
    case 'Z09':
      return 'A08'
    default:
      return 'E01'
  }
}

function buildBgmReference(input: ProdatOutboundDraftInput): string {
  return (
    input.externalReference ??
    buildEdielExternalReference({
      family: 'PRODAT',
      code: input.code,
      switchRequestId: input.switchRequestId,
      gridOwnerDataRequestId: input.gridOwnerDataRequestId,
      outboundRequestId: input.outboundRequestId,
    })
  )
}

function buildTransactionReference(input: ProdatOutboundDraftInput): string {
  return (
    input.transactionReference ??
    buildEdielTransactionReference({
      family: 'PRODAT',
      code: input.code,
    })
  )
}

function renderBodySegments(input: {
  code: ProdatOutboundCode
  bgmReference: string
  transactionReference: string
  payload: Record<string, unknown>
}): string[] {
  const payload = input.payload
  const reasonForTransaction = sanitize(
    getPayloadString(payload, 'reasonForTransaction') ||
      defaultReasonForTransaction(input.code)
  )

  const referenceToLineItem = sanitize(
    getPayloadString(payload, 'referenceToLineItem') || input.transactionReference
  )

  const meterPointId = sanitize(
    getPayloadString(payload, 'meterPointId', 'meteringPointId')
  )

  const facilityId = sanitize(
    getPayloadString(payload, 'facilityId', 'installationId', 'siteFacilityId')
  )

  const gridOwnerEdielId = sanitize(
    getPayloadString(payload, 'gridOwnerEdielId', 'gridAreaId')
  )

  const customerName = sanitize(
    getPayloadString(payload, 'customerName', 'fullName', 'siteName')
  )

  const street = sanitize(getPayloadString(payload, 'street'))
  const postalCode = sanitize(getPayloadString(payload, 'postalCode'))
  const city = sanitize(getPayloadString(payload, 'city'))
  const requestedStartDate = formatDateYYYYMMDD(
    getPayloadString(payload, 'requestedStartDate', 'startDate')
  )

  const incomingSupplierName = sanitize(getPayloadString(payload, 'incomingSupplierName'))
  const incomingSupplierOrgNumber = sanitize(
    getPayloadString(payload, 'incomingSupplierOrgNumber')
  )

  const currentSupplierName = sanitize(getPayloadString(payload, 'currentSupplierName'))
  const currentSupplierOrgNumber = sanitize(
    getPayloadString(payload, 'currentSupplierOrgNumber')
  )

  const segments: string[] = []

  segments.push(`BGM+${input.code}+${sanitize(input.bgmReference)}+9`)
  segments.push(`DTM+137:${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}:203`)
  segments.push(`RFF+TN:${sanitize(input.transactionReference)}`)
  segments.push(`RFF+CR:${referenceToLineItem}`)
  segments.push(`FTX+ACB+++${reasonForTransaction}`)

  if (meterPointId) {
    segments.push(`LOC+172+${meterPointId}`)
  }

  if (facilityId) {
    segments.push(`LOC+64+${facilityId}`)
  }

  if (gridOwnerEdielId) {
    segments.push(`LOC+322+${gridOwnerEdielId}`)
  }

  if (requestedStartDate) {
    segments.push(`DTM+7:${requestedStartDate}:102`)
  }

  if (customerName) {
    segments.push(`NAD+BY+++${customerName}`)
  }

  if (street || postalCode || city) {
    const addressParts = [street, postalCode, city].filter(Boolean).join(':')
    segments.push(`ADR+${addressParts}`)
  }

  if (incomingSupplierName || incomingSupplierOrgNumber) {
    segments.push(
      `NAD+SU+${incomingSupplierOrgNumber || ''}+++${incomingSupplierName || ''}`.replace(
        /\+$/,
        ''
      )
    )
  }

  if (currentSupplierName || currentSupplierOrgNumber) {
    segments.push(
      `NAD+MS+${currentSupplierOrgNumber || ''}+++${currentSupplierName || ''}`.replace(
        /\+$/,
        ''
      )
    )
  }

  return segments
}

export async function buildProdatOutboundDraft(
  input: ProdatOutboundDraftInput
): Promise<CreateEdielMessageInput> {
  const bgmReference = buildBgmReference(input)
  const transactionReference = buildTransactionReference(input)
  const messageVersion =
    (await resolveMessageVersion({
      family: 'PRODAT',
      code: input.code,
      fallback: 'PENDING',
      standard: 'edifact',
    })) ?? 'PENDING'

  const applicationReference =
    input.applicationReference ??
    buildDefaultApplicationReference({
      actorSubAddress: input.senderSubAddress ?? 'GRIDEX',
      process: 'PRODAT',
    })

  const parsedPayload = {
    ...(input.payload ?? {}),
    reasonForTransaction: input.reasonForTransaction ?? null,
    referenceToLineItem: input.referenceToLineItem ?? null,
    draftType: 'prodat_outbound',
    documentName: buildDocumentName(input.code),
  }

  const envelope = buildEdifactEnvelope({
    senderEdielId: input.senderEdielId ?? '00000',
    senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
    receiverEdielId: input.receiverEdielId ?? '00000',
    receiverSubAddress: input.receiverSubAddress ?? 'PRODAT',
    applicationReference,
    testFlag: 1,
    messageTypeToken: 'PRODAT:D:03A:UN:1.0',
    segments: renderBodySegments({
      code: input.code,
      bgmReference,
      transactionReference,
      payload: parsedPayload,
    }),
  })

  const ack = deriveEdielAckDefaults({
    family: 'PRODAT',
    code: input.code,
  })

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageStandard: 'edifact',
    messageFamily: 'PRODAT',
    messageCode: input.code,
    messageVersion,
    processType: 'supplier_switch',
    environment: 'test',
    testFlag: 1,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.mailbox ?? null,
    senderEdielId: input.senderEdielId ?? null,
    senderName: input.senderName ?? null,
    receiverEdielId: input.receiverEdielId ?? null,
    receiverName: input.receiverName ?? null,
    senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
    receiverSubAddress: input.receiverSubAddress ?? 'PRODAT',
    receiverEmail: input.receiverEmail ?? null,
    subject:
      input.subject ??
      `${buildDocumentName(input.code)} ${bgmReference}`.trim(),
    fileName: inferEdielFileName({
      family: 'PRODAT',
      code: input.code,
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    interchangeReference: envelope.interchangeReference,
    applicationReference,
    externalReference: bgmReference,
    correlationReference: input.correlationReference ?? null,
    transactionReference,
    communicationRouteId: input.communicationRouteId ?? null,
    outboundRequestId: input.outboundRequestId ?? null,
    switchRequestId: input.switchRequestId ?? null,
    gridOwnerDataRequestId: input.gridOwnerDataRequestId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    rawPayload: envelope.raw,
    parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: 'not_required',
    ackDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }
}

function getMeterPointIdentifier(point: MeteringPointRow): string {
  return sanitize(point.meter_point_id ?? '')
}

function getFacilityIdentifier(point: MeteringPointRow, site: CustomerSiteRow): string {
  return sanitize(point.site_facility_id ?? site.facility_id ?? '')
}

function getCustomerDisplayName(site: CustomerSiteRow): string {
  return sanitize(site.site_name || 'GRIDEX CUSTOMER')
}

export async function buildProdatZ03FromSwitch(params: {
  actorUserId?: string | null
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): Promise<CreateEdielMessageInput> {
  return buildProdatOutboundDraft({
    actorUserId: params.actorUserId ?? null,
    code: 'Z03',
    communicationRouteId: params.communicationRouteId ?? null,
    customerId: params.switchRequest.customer_id,
    siteId: params.switchRequest.site_id,
    meteringPointId: params.switchRequest.metering_point_id,
    gridOwnerId: params.switchRequest.grid_owner_id,
    switchRequestId: params.switchRequest.id,
    senderEdielId: params.senderEdielId,
    senderName: params.senderName ?? null,
    receiverEdielId: params.receiverEdielId,
    receiverName: params.receiverName ?? null,
    senderSubAddress: 'GRIDEX',
    receiverSubAddress: 'PRODAT',
    mailbox: params.mailbox ?? null,
    receiverEmail: params.receiverEmail ?? null,
    externalReference:
      params.switchRequest.external_reference ?? `SWITCH-${params.switchRequest.id}`,
    transactionReference:
      params.switchRequest.external_reference ?? `SWITCH-${params.switchRequest.id}`,
    payload: {
      reasonForTransaction: 'E01',
      referenceToLineItem:
        params.switchRequest.external_reference ?? `SWITCH-${params.switchRequest.id}`,
      meterPointId: getMeterPointIdentifier(params.meteringPoint),
      facilityId: getFacilityIdentifier(params.meteringPoint, params.site),
      gridOwnerEdielId: params.gridOwner?.ediel_id ?? '',
      customerName: getCustomerDisplayName(params.site),
      street: params.site.street,
      postalCode: params.site.postal_code,
      city: params.site.city,
      requestedStartDate: params.switchRequest.requested_start_date,
      incomingSupplierName: params.switchRequest.incoming_supplier_name,
      incomingSupplierOrgNumber: params.switchRequest.incoming_supplier_org_number,
      currentSupplierName: params.switchRequest.current_supplier_name,
      currentSupplierOrgNumber: params.switchRequest.current_supplier_org_number,
    },
  })
}

export async function buildProdatZ05FromSwitch(params: {
  actorUserId?: string | null
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): Promise<CreateEdielMessageInput> {
  return buildProdatOutboundDraft({
    actorUserId: params.actorUserId ?? null,
    code: 'Z05',
    communicationRouteId: params.communicationRouteId ?? null,
    customerId: params.switchRequest.customer_id,
    siteId: params.switchRequest.site_id,
    meteringPointId: params.switchRequest.metering_point_id,
    gridOwnerId: params.switchRequest.grid_owner_id,
    switchRequestId: params.switchRequest.id,
    senderEdielId: params.senderEdielId,
    senderName: params.senderName ?? null,
    receiverEdielId: params.receiverEdielId,
    receiverName: params.receiverName ?? null,
    senderSubAddress: 'GRIDEX',
    receiverSubAddress: 'PRODAT',
    mailbox: params.mailbox ?? null,
    receiverEmail: params.receiverEmail ?? null,
    externalReference:
      params.switchRequest.external_reference ?? `SWITCH-DONE-${params.switchRequest.id}`,
    transactionReference:
      params.switchRequest.external_reference ?? `SWITCH-DONE-${params.switchRequest.id}`,
    payload: {
      reasonForTransaction: 'E01',
      referenceToLineItem:
        params.switchRequest.external_reference ?? `SWITCH-DONE-${params.switchRequest.id}`,
      meterPointId: getMeterPointIdentifier(params.meteringPoint),
      facilityId: getFacilityIdentifier(params.meteringPoint, params.site),
      gridOwnerEdielId: params.gridOwner?.ediel_id ?? '',
      customerName: getCustomerDisplayName(params.site),
      street: params.site.street,
      postalCode: params.site.postal_code,
      city: params.site.city,
      requestedStartDate: params.switchRequest.requested_start_date,
      incomingSupplierName: params.switchRequest.incoming_supplier_name,
      incomingSupplierOrgNumber: params.switchRequest.incoming_supplier_org_number,
      currentSupplierName: params.switchRequest.current_supplier_name,
      currentSupplierOrgNumber: params.switchRequest.current_supplier_org_number,
    },
  })
}

export async function buildProdatZ09FromSwitch(params: {
  actorUserId?: string | null
  senderEdielId: string
  senderName?: string | null
  receiverEdielId: string
  receiverName?: string | null
  receiverEmail?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): Promise<CreateEdielMessageInput> {
  return buildProdatOutboundDraft({
    actorUserId: params.actorUserId ?? null,
    code: 'Z09',
    communicationRouteId: params.communicationRouteId ?? null,
    customerId: params.switchRequest.customer_id,
    siteId: params.switchRequest.site_id,
    meteringPointId: params.switchRequest.metering_point_id,
    gridOwnerId: params.switchRequest.grid_owner_id,
    switchRequestId: params.switchRequest.id,
    senderEdielId: params.senderEdielId,
    senderName: params.senderName ?? null,
    receiverEdielId: params.receiverEdielId,
    receiverName: params.receiverName ?? null,
    senderSubAddress: 'GRIDEX',
    receiverSubAddress: 'PRODAT',
    mailbox: params.mailbox ?? null,
    receiverEmail: params.receiverEmail ?? null,
    externalReference:
      params.switchRequest.external_reference ?? `MASTERDATA-${params.switchRequest.id}`,
    transactionReference:
      params.switchRequest.external_reference ?? `MASTERDATA-${params.switchRequest.id}`,
    payload: {
      reasonForTransaction: 'A08',
      referenceToLineItem:
        params.switchRequest.external_reference ?? `MASTERDATA-${params.switchRequest.id}`,
      meterPointId: getMeterPointIdentifier(params.meteringPoint),
      facilityId: getFacilityIdentifier(params.meteringPoint, params.site),
      gridOwnerEdielId: params.gridOwner?.ediel_id ?? '',
      customerName: getCustomerDisplayName(params.site),
      street: params.site.street,
      postalCode: params.site.postal_code,
      city: params.site.city,
      requestedStartDate: params.switchRequest.requested_start_date,
      incomingSupplierName: params.switchRequest.incoming_supplier_name,
      incomingSupplierOrgNumber: params.switchRequest.incoming_supplier_org_number,
      currentSupplierName: params.switchRequest.current_supplier_name,
      currentSupplierOrgNumber: params.switchRequest.current_supplier_org_number,
    },
  })
}

export function parseInboundProdat(rawPayload: string): ParsedProdatMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)
  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const ids = extractUnb(unb)
  const bgmParts = bgm?.split('+') ?? []

  return {
    messageFamily: 'PRODAT',
    messageCode:
      (bgmParts[1]?.trim() as ParsedProdatCode | undefined) ??
      (inferred.messageCode as ParsedProdatCode | null),
    transactionReference:
      extractReference(rawPayload, 'TN') ||
      extractReference(rawPayload, 'CR') ||
      extractReference(rawPayload, 'ACW'),
    externalReference: bgmParts[2]?.trim() || extractReference(rawPayload, 'ON'),
    applicationReference: ids.applicationReference,
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    senderSubAddress: ids.senderSubAddress,
    receiverSubAddress: ids.receiverSubAddress,
    rawSegments,
    parsedPayload: {
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
      bgm,
      unb,
      meterPointId:
        firstSegmentValue(rawSegments, 'LOC+172')?.split('+')[2]?.trim() ?? null,
      facilityId:
        firstSegmentValue(rawSegments, 'LOC+64')?.split('+')[2]?.trim() ?? null,
      gridOwnerEdielId:
        firstSegmentValue(rawSegments, 'LOC+322')?.split('+')[2]?.trim() ?? null,
      segmentCount: rawSegments.length,
    },
  }
}