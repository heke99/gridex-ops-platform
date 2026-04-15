// lib/ediel/prodat.ts

import type {
  CreateEdielMessageInput,
  EdielKnownMessageCode,
  EdielMessageFamily,
} from '@/lib/ediel/types'
import type {
  SupplierSwitchRequestRow,
} from '@/lib/operations/types'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import {
  buildSupplierApplicationReference,
  deriveEdielAckDefaults,
} from '@/lib/ediel/references'
import {
  inferEdielFamilyAndCodeFromRawPayload,
  inferEdielFileName,
} from '@/lib/ediel/classify'

export type ProdatOutboundCode = 'Z01' | 'Z03' | 'Z09' | 'Z13' | 'Z18'
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
  receiverEdielId?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  mailbox?: string | null
  receiverEmail?: string | null
  subject?: string | null
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

function extractSubAddress(value: string | null): string | null {
  if (!value) return null
  const parts = value.split(':')
  return parts[1]?.trim() || null
}

function extractTransactionReference(rawPayload: string): string | null {
  const match =
    rawPayload.match(/RFF\+TN:([A-Za-z0-9\-_/.]+)/i) ||
    rawPayload.match(/RFF\+ACW:([A-Za-z0-9\-_/.]+)/i) ||
    rawPayload.match(/RFF\+CR:([A-Za-z0-9\-_/.]+)/i)

  return match?.[1] ?? null
}

function extractExternalReference(rawPayload: string): string | null {
  const match =
    rawPayload.match(/BGM\+[A-Z0-9]+\+([A-Za-z0-9\-_/.]+)/i) ||
    rawPayload.match(/RFF\+ON:([A-Za-z0-9\-_/.]+)/i)

  return match?.[1] ?? null
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

function renderSegment(tag: string, ...parts: Array<string | null | undefined>): string {
  return [tag, ...parts.filter((value) => value !== null && value !== undefined && value !== '')].join('+')
}

function zCodeToDocumentName(code: ProdatOutboundCode): string {
  switch (code) {
    case 'Z01':
      return 'PRODAT_Z01'
    case 'Z03':
      return 'PRODAT_Z03'
    case 'Z09':
      return 'PRODAT_Z09'
    case 'Z13':
      return 'PRODAT_Z13'
    case 'Z18':
      return 'PRODAT_Z18'
  }
}

function buildDateStamp(): string {
  return new Date().toISOString().slice(2, 16).replace(/[-:T]/g, '')
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function defaultReasonForTransaction(code: ProdatOutboundCode): string {
  switch (code) {
    case 'Z03':
      return 'E01'
    case 'Z09':
      return 'A08'
    default:
      return 'E01'
  }
}

function renderProdatDraftRaw(input: {
  code: ProdatOutboundCode
  senderEdielId?: string | null
  receiverEdielId?: string | null
  senderSubAddress?: string | null
  receiverSubAddress?: string | null
  applicationReference?: string | null
  externalReference?: string | null
  transactionReference?: string | null
  payload?: Record<string, unknown>
}): string {
  const datePart = buildDateStamp()
  const sender = input.senderEdielId ?? '00000'
  const receiver = input.receiverEdielId ?? '91100'
  const senderSub = input.senderSubAddress ?? 'GRIDEX'
  const receiverSub = input.receiverSubAddress ?? 'PRODAT'
  const appRef = input.applicationReference ?? buildSupplierApplicationReference()
  const externalReference = input.externalReference ?? `GRX-${datePart}`
  const transactionReference = input.transactionReference ?? `GRX-TX-${datePart}`

  const payload = input.payload ?? {}
  const referenceToLineItem = sanitize(
    String(payload.referenceToLineItem ?? transactionReference)
  )
  const reasonForTransaction = sanitize(
    String(payload.reasonForTransaction ?? defaultReasonForTransaction(input.code))
  )
  const meteringPointId = sanitize(
    String(payload.meterPointId ?? payload.meteringPointId ?? payload.edielReference ?? '')
  )
  const gridAreaId = sanitize(String(payload.gridAreaId ?? payload.gridOwnerEdielId ?? ''))
  const customerName = sanitize(String(payload.customerName ?? 'GRIDEX CUSTOMER'))
  const street = sanitize(String(payload.street ?? 'UNKNOWN STREET 1'))
  const postalCode = sanitize(String(payload.postalCode ?? '11122'))
  const city = sanitize(String(payload.city ?? 'STOCKHOLM'))
  const supplierName = sanitize(String(payload.incomingSupplierName ?? 'Gridex'))
  const supplierOrgNumber = sanitize(String(payload.incomingSupplierOrgNumber ?? ''))
  const currentSupplierName = sanitize(String(payload.currentSupplierName ?? ''))
  const currentSupplierOrgNumber = sanitize(
    String(payload.currentSupplierOrgNumber ?? '')
  )
  const startDate = sanitize(String(payload.requestedStartDate ?? payload.startDate ?? ''))
  const customerId = sanitize(String(payload.customerIdentifier ?? ''))
  const installationAddress = sanitize(
    `${street}${postalCode ? ', ' + postalCode : ''}${city ? ' ' + city : ''}`
  )

  const segments: string[] = [
    renderSegment('UNB', 'UNOC:3', `${sender}:${senderSub}`, `${receiver}:${receiverSub}`, datePart, '', '', '', '', appRef),
    renderSegment('UNH', '1', 'PRODAT:D:03A:UN:1.0'),
    renderSegment('BGM', input.code, externalReference, '9'),
    renderSegment('RFF', `TN:${transactionReference}`),
    renderSegment('RFF', `CR:${referenceToLineItem}`),
    renderSegment('FTX', 'ACB', '', '', reasonForTransaction),
  ]

  if (meteringPointId) {
    segments.push(renderSegment('LOC', '172', meteringPointId))
  }

  if (gridAreaId) {
    segments.push(renderSegment('LOC', '322', gridAreaId))
  }

  if (startDate) {
    segments.push(renderSegment('DTM', `7:${startDate.replace(/-/g, '')}:102`))
  }

  if (customerId) {
    segments.push(renderSegment('RFF', `YC1:${customerId}`))
  }

  segments.push(renderSegment('NAD', 'BY', '', '', customerName))
  segments.push(renderSegment('ADR', street, postalCode, city))

  if (installationAddress) {
    segments.push(renderSegment('FTX', 'ZZZ', '', '', installationAddress))
  }

  if (supplierName || supplierOrgNumber) {
    segments.push(renderSegment('NAD', 'SU', supplierOrgNumber, '', supplierName))
  }

  if (currentSupplierName || currentSupplierOrgNumber) {
    segments.push(
      renderSegment('NAD', 'MS', currentSupplierOrgNumber, '', currentSupplierName)
    )
  }

  segments.push(renderSegment('UNT', String(segments.length + 2), '1'))
  segments.push(renderSegment('UNZ', '1', externalReference))

  return `${segments.join("'")}'`
}

export function buildProdatOutboundDraft(
  input: ProdatOutboundDraftInput
): CreateEdielMessageInput {
  const applicationReference = buildSupplierApplicationReference()
  const ack = deriveEdielAckDefaults({
    family: 'PRODAT',
    code: input.code,
  })

  const parsedPayload = {
    ...input.payload,
    reasonForTransaction: input.reasonForTransaction ?? null,
    referenceToLineItem: input.referenceToLineItem ?? null,
    draftType: 'prodat_outbound',
    documentName: zCodeToDocumentName(input.code),
  }

  const rawPayload = renderProdatDraftRaw({
    code: input.code,
    senderEdielId: input.senderEdielId,
    receiverEdielId: input.receiverEdielId,
    senderSubAddress: input.senderSubAddress,
    receiverSubAddress: input.receiverSubAddress,
    applicationReference,
    externalReference: input.externalReference,
    transactionReference: input.transactionReference,
    payload: parsedPayload,
  })

  return {
    actorUserId: input.actorUserId ?? null,
    direction: 'outbound',
    messageFamily: 'PRODAT',
    messageCode: input.code,
    status: 'draft',
    transportType: 'smtp',
    mailbox: input.mailbox ?? null,
    senderEdielId: input.senderEdielId ?? null,
    receiverEdielId: input.receiverEdielId ?? null,
    senderSubAddress: input.senderSubAddress ?? 'GRIDEX',
    receiverSubAddress: input.receiverSubAddress ?? 'PRODAT',
    receiverEmail: input.receiverEmail ?? null,
    subject:
      input.subject ??
      `${zCodeToDocumentName(input.code)} ${input.externalReference ?? ''}`.trim(),
    fileName: inferEdielFileName({
      family: 'PRODAT',
      code: input.code,
      direction: 'outbound',
      extension: 'edi',
    }),
    mimeType: 'application/edifact',
    applicationReference,
    externalReference: input.externalReference ?? null,
    correlationReference: input.correlationReference ?? null,
    transactionReference: input.transactionReference ?? null,
    communicationRouteId: input.communicationRouteId ?? null,
    outboundRequestId: input.outboundRequestId ?? null,
    switchRequestId: input.switchRequestId ?? null,
    gridOwnerDataRequestId: input.gridOwnerDataRequestId ?? null,
    customerId: input.customerId ?? null,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    gridOwnerId: input.gridOwnerId ?? null,
    rawPayload,
    parsedPayload,
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    contrlStatus: ack.contrlStatus,
    aperakStatus: ack.aperakStatus,
    utiltsErrStatus: 'not_required',
  }
}

export function buildProdatZ03FromSwitch(params: {
  actorUserId?: string | null
  senderEdielId: string
  receiverEdielId: string
  receiverEmail?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): CreateEdielMessageInput {
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
    receiverEdielId: params.receiverEdielId,
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
      meterPointId: params.meteringPoint.meter_point_id,
      edielReference: params.meteringPoint.ediel_reference,
      gridAreaId: params.gridOwner?.ediel_id ?? params.gridOwner?.owner_code ?? '',
      customerName: params.site.site_name,
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

export function buildProdatZ09FromSwitch(params: {
  actorUserId?: string | null
  senderEdielId: string
  receiverEdielId: string
  receiverEmail?: string | null
  communicationRouteId?: string | null
  mailbox?: string | null
  switchRequest: SupplierSwitchRequestRow
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  gridOwner?: GridOwnerRow | null
}): CreateEdielMessageInput {
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
    receiverEdielId: params.receiverEdielId,
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
      meterPointId: params.meteringPoint.meter_point_id,
      edielReference: params.meteringPoint.ediel_reference,
      gridAreaId: params.gridOwner?.ediel_id ?? params.gridOwner?.owner_code ?? '',
      customerName: params.site.site_name,
      street: params.site.street,
      postalCode: params.site.postal_code,
      city: params.site.city,
      currentSupplierName: params.switchRequest.current_supplier_name,
      currentSupplierOrgNumber: params.switchRequest.current_supplier_org_number,
      incomingSupplierName: params.switchRequest.incoming_supplier_name,
      incomingSupplierOrgNumber: params.switchRequest.incoming_supplier_org_number,
    },
  })
}

export function parseInboundProdat(rawPayload: string): ParsedProdatMessage {
  const rawSegments = splitEdifactSegments(rawPayload)
  const inferred = inferEdielFamilyAndCodeFromRawPayload(rawPayload)

  const unb = firstSegmentValue(rawSegments, 'UNB+')
  const unh = firstSegmentValue(rawSegments, 'UNH+')
  const bgm = firstSegmentValue(rawSegments, 'BGM+')
  const loc172 = firstSegmentValue(rawSegments, 'LOC+172')
  const loc322 = firstSegmentValue(rawSegments, 'LOC+322')
  const dtm = firstSegmentValue(rawSegments, 'DTM+7')
  const nadBy = firstSegmentValue(rawSegments, 'NAD+BY')
  const nadSu = firstSegmentValue(rawSegments, 'NAD+SU')
  const nadMs = firstSegmentValue(rawSegments, 'NAD+MS')

  const ids = extractUnbEdielIds(unb)
  const senderSubAddress = extractSubAddress(unb?.split('+')[2] ?? null)
  const receiverSubAddress = extractSubAddress(unb?.split('+')[3] ?? null)

  const bgmParts = bgm?.split('+') ?? []
  const bgmCode = (bgmParts[1]?.trim() || null) as ParsedProdatCode | null
  const extRef = bgmParts[2]?.trim() || extractExternalReference(rawPayload) || null
  const meterPointId = loc172?.split('+')[2]?.trim() || null
  const gridAreaId = loc322?.split('+')[2]?.trim() || null
  const requestedStartDate =
    dtm?.split(':')[1]?.trim()?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') || null

  return {
    messageFamily: 'PRODAT',
    messageCode: inferred.messageCode ?? bgmCode,
    transactionReference: extractTransactionReference(rawPayload),
    externalReference: extRef,
    applicationReference: extractApplicationReference(rawPayload),
    senderEdielId: ids.senderEdielId,
    receiverEdielId: ids.receiverEdielId,
    senderSubAddress,
    receiverSubAddress,
    rawSegments,
    parsedPayload: {
      unb,
      unh,
      bgm,
      bgmCode,
      meterPointId,
      meteringPointId: meterPointId,
      gridAreaId,
      requestedStartDate,
      customerName: nadBy?.split('+')[4]?.trim() || null,
      incomingSupplierName: nadSu?.split('+')[4]?.trim() || null,
      currentSupplierName: nadMs?.split('+')[4]?.trim() || null,
      segmentCount: rawSegments.length,
      inferredFamily: inferred.messageFamily,
      inferredCode: inferred.messageCode,
    },
  }
}